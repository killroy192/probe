// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - Spawns the scenario runner as a real subprocess.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as Fiber from "effect/Fiber";

import { bundleState } from "./bundle.ts";
import { cleanLeftovers, processStartTime } from "./cleanup.ts";
import { refusalReason } from "./environment.ts";
import { agentTypedOnceAfterPrompt, MOCK_AGENT_LINES } from "./fixtures.ts";
import { connectRpc } from "./rpc.ts";
import { issueBearerToken } from "./seam.ts";
import { childEnv, startServer, REPO_ROOT, waitUntilServing } from "./server.ts";
import { alive, follow, recorder } from "./support.ts";

const runner = NodeURL.fileURLToPath(new URL("./run.ts", import.meta.url));

interface RunnerRun {
  readonly child: NodeChildProcess.ChildProcess;
  /** Resolves with the first output line matching `pattern`. */
  readonly line: (pattern: RegExp) => Promise<RegExpMatchArray>;
  readonly done: Promise<{ readonly code: number | null; readonly output: string }>;
}

function spawnRunner(args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}): RunnerRun {
  const child = NodeChildProcess.spawn("node", [runner, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const waiters: Array<{ pattern: RegExp; resolve: (match: RegExpMatchArray) => void }> = [];
  const onData = (chunk: Buffer) => {
    output += chunk.toString();
    for (const waiter of waiters.slice()) {
      const match = output.match(waiter.pattern);
      if (match) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(match);
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return {
    child,
    line: (pattern) =>
      new Promise((resolve) => {
        const match = output.match(pattern);
        if (match) resolve(match);
        else waiters.push({ pattern, resolve });
      }),
    done: new Promise((resolve) => child.once("exit", (code) => resolve({ code, output }))),
  };
}

const scratch = (label: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), label));
const missingPath = (name: string) => NodePath.join(NodeOS.tmpdir(), "scenario-missing", name);

describe("refusalReason", () => {
  const home = NodePath.join(NodeOS.tmpdir(), "scenario-fake-home");
  const realData = NodePath.join(home, ".t3");
  it("refuses real data and server targets, allows a clean run", () => {
    assert.isUndefined(refusalReason([], {}, home));
    assert.isUndefined(
      refusalReason(["--selftest"], { T3CODE_HOME: NodePath.join(home, "elsewhere") }, home),
    );
    assert.include(refusalReason([], { T3CODE_HOME: realData }, home) ?? "", "real Probe data");
    assert.include(
      refusalReason(["--base-dir", NodePath.join(realData, "userdata")], {}, home) ?? "",
      "real Probe data",
    );
    assert.include(
      refusalReason(["--server-url=https://x.example"], {}, home) ?? "",
      "not supported",
    );
  });
});

it.live("refuses to start against real data before launching anything", () =>
  Effect.promise(async () => {
    // os.homedir() honors these, so the runner's idea of "real data" is a scratch folder.
    const fakeHome = scratch("scenario-fake-home-");
    try {
      const { code, output } = await spawnRunner([], {
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        T3CODE_HOME: NodePath.join(fakeHome, ".t3"),
      }).done;
      assert.strictEqual(code, 2);
      assert.include(output, "refusing to run");
      assert.notInclude(output, "scenarios: ready");
    } finally {
      NodeFS.rmSync(fakeHome, { recursive: true, force: true });
    }
  }),
);

it.live("names the browser when it cannot be started", () =>
  Effect.promise(async () => {
    const browser = missingPath("chromium");
    const { code, output } = await spawnRunner(["--browser", browser]).done;
    assert.notStrictEqual(code, 0);
    assert.include(output, `Browser at ${browser} could not be started`);
  }),
);

describe("scenario runner", () => {
  it.live("names the server when it cannot start", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--server-bin", missingPath("bin.ts")]).done;
      assert.notStrictEqual(code, 0);
      assert.include(output, "Probe server could not start");
    }),
  );

  it.live("reports a failing scenario by name and still runs the others", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest"]).done;
      assert.strictEqual(code, 1);
      // Every scenario's time and teardown, and the run's total, pass or fail (AC-17).
      assert.match(output, /PASS\s+T1 restart keeps data \(\d+\.\d s, teardown \d+ ms\)/);
      assert.match(
        output,
        /FAIL\s+T2 deliberate failure \(\d+\.\d s, teardown \d+ ms\): deliberate failure/,
      );
      assert.match(output, /scenarios: total \d+\.\d s/);
      // The failure leaves its evidence outside the removed home (AC-16).
      const dir = /artifacts: (\S+) \(/.exec(output)?.[1];
      assert.isDefined(dir);
      for (const file of ["error.txt", "page-1.png", "server-log-tail.txt", "recorders.json"]) {
        assert.isTrue(NodeFS.existsSync(NodePath.join(dir!, file)), file);
      }
      assert.deepEqual(
        JSON.parse(NodeFS.readFileSync(NodePath.join(dir!, "recorders.json"), "utf8")),
        { "page frames": ["a value the failure keeps"] },
      );
      NodeFS.rmSync(NodePath.dirname(dir!), { recursive: true, force: true });
    }),
  );

  it.live("fails with a second server's output and still stops the one that started", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", "--only", "T3"]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T3 second server cannot start \([^)]*\): Probe server could not start/,
      );
      assert.include(output, "Cannot find module");
      const started = [...output.matchAll(/T3 (?:second )?server pid=(\d+) home=(\S+)/g)];
      assert.lengthOf(started, 2);
      for (const [, pid, home] of started) {
        assert.isFalse(alive(Number(pid)));
        assert.isFalse(NodeFS.existsSync(home!));
      }
      // No page was opened, so there is no screenshot; both started servers left a log tail.
      const saved = /artifacts: \S+ \(([^)]*)\)/.exec(output)?.[1]?.split(", ");
      assert.deepEqual(saved, [
        "error.txt",
        "server-log-tail.txt",
        "second-server-log-tail.txt",
        "recorders.json",
      ]);
    }),
  );

  it.live("reports the original error when the failure artifacts cannot be saved", () =>
    Effect.promise(async () => {
      const blocker = NodePath.join(scratch("scenario-artifacts-"), "a-file");
      NodeFS.writeFileSync(blocker, "");
      const { code, output } = await spawnRunner([
        "--selftest",
        "--only",
        "T2",
        "--artifacts",
        blocker,
      ]).done;
      assert.strictEqual(code, 1);
      assert.match(output, /FAIL\s+T2 deliberate failure .*: deliberate failure/);
      assert.match(output, /artifact missing: .*a-file/);
      NodeFS.rmSync(NodePath.dirname(blocker), { recursive: true, force: true });
    }),
  );

  it.live("stops on a failed web build and runs nothing", () =>
    Effect.promise(async () => {
      const bin = scratch("scenario-fake-vp-");
      NodeFS.writeFileSync(
        NodePath.join(bin, "vp"),
        "#!/bin/sh\necho boom-from-the-build\nexit 3\n",
        {
          mode: 0o755,
        },
      );
      const { code, output } = await spawnRunner(["--rebuild"], {
        PATH: `${bin}${NodePath.delimiter}${process.env.PATH ?? ""}`,
      }).done;
      assert.notStrictEqual(code, 0);
      assert.include(output, "boom-from-the-build");
      assert.include(output, "The web build failed (exit code 3)");
      assert.notInclude(output, "scenarios: ready");
      NodeFS.rmSync(bin, { recursive: true, force: true });
    }),
  );

  it.live("records the server's prompt time and does not judge it", () =>
    Effect.promise(async () => {
      // A slow startup file: the prompt comes after the old 700 ms limit, and the run passes.
      const home = scratch("scenario-slow-home-");
      NodeFS.writeFileSync(NodePath.join(home, ".zshrc"), "sleep 1\n");
      const { code, output } = await spawnRunner(["--only", "E2-S3", "--own-shell-config"], {
        HOME: home,
        ZDOTDIR: "",
        SHELL: "/usr/bin/zsh",
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ??
          NodePath.join(NodeOS.homedir(), ".cache", "ms-playwright"),
      }).done;
      assert.strictEqual(code, 0, output);
      assert.match(output, /PASS\s+E2-S3/);
      const serverMs = Number(/METRIC\s+E2-S3 start-to-prompt ms=(\d+)/.exec(output)?.[1]);
      assert.isAtLeast(serverMs, 1000);
      NodeFS.rmSync(home, { recursive: true, force: true });
    }),
  );

  it.live("cleans up after a runner killed with SIGKILL, by the pids it recorded", () =>
    Effect.promise(async () => {
      // Killed once S2's first shell runs, so a server, a shell host and a shell are left.
      const run = spawnRunner(["--only", "S2"]);
      const [, pid, home] = await run.line(/S2 server pid=(\d+) home=(\S+)/);
      await run.line(/METRIC\s+S2 tree-node/);
      const runnerPid = run.child.pid!;
      run.child.kill("SIGKILL");
      await run.done;
      const userdata = NodePath.join(home!, "userdata");
      const hostPid = Number(
        NodeFS.readFileSync(NodePath.join(userdata, "shell-host-v1.pid"), "utf8"),
      );
      const shellPids = (
        JSON.parse(
          NodeFS.readFileSync(NodePath.join(userdata, "shells", "registry.json"), "utf8"),
        ) as {
          readonly shells: ReadonlyArray<{ readonly pid: number }>;
        }
      ).shells.map((shell) => shell.pid);
      const leftovers = [Number(pid), hostPid, ...shellPids];
      assert.isNotEmpty(shellPids);
      for (const leftover of leftovers)
        assert.isTrue(alive(leftover), `${leftover} should be left`);

      const { code, output } = await spawnRunner(["--selftest", "--only", "T1"]).done;
      assert.strictEqual(code, 0, output);
      assert.include(output, `cleaned up after run ${runnerPid}`);
      for (const leftover of leftovers) assert.isFalse(alive(leftover), `${leftover} survived`);
      assert.isFalse(NodeFS.existsSync(home!));
    }),
  );

  it.live("passes twice in a row beside a running server and leaves it alone", () =>
    Effect.promise(async () => {
      const home = scratch("scenario-bystander-");
      const bystander = await startServer({ home });
      try {
        for (const _ of [1, 2]) {
          // One scenario is enough to show a run leaves the bystander alone.
          const { code, output } = await spawnRunner(["--only", "S1"]).done;
          assert.strictEqual(code, 0);
          assert.include(output, "PASS    S1 boot");
          assert.include(output, "1/8 passing, 0 pending, 0 failed");
        }
        assert.isTrue(alive(bystander.pid()));
        assert.isTrue((await fetch(bystander.origin)).ok);
      } finally {
        await bystander.stop();
        NodeFS.rmSync(home, { recursive: true, force: true });
      }
    }),
  );

  it.live("stops what it started and removes its data when interrupted", () =>
    Effect.promise(async () => {
      // The second row is interrupted once R1 runs both of its servers.
      for (const [args, last] of [
        [[], /S1 server pid=(\d+) home=(\S+)/],
        [["--only", "R1"], /R1 second server pid=(\d+) home=(\S+)/],
      ] as const) {
        const run = spawnRunner(args);
        await run.line(last);
        run.child.kill("SIGINT");
        const { output } = await run.done;
        const started = [...output.matchAll(/server pid=(\d+) home=(\S+)/g)];
        assert.isNotEmpty(started);
        for (const [, pid, home] of started) {
          assert.isFalse(alive(Number(pid)));
          assert.isFalse(NodeFS.existsSync(home!));
        }
      }
    }),
  );
});

describe("web bundle", () => {
  const tree = () => {
    const root = scratch("scenario-bundle-");
    const write = (path: string, content: string, mtimeSeconds: number) => {
      const file = NodePath.join(root, path);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, content);
      NodeFS.utimesSync(file, mtimeSeconds, mtimeSeconds);
    };
    write(
      "apps/web/package.json",
      JSON.stringify({ dependencies: { "@t/contracts": "workspace:*", "@t/kit": "workspace:*" } }),
      100,
    );
    write("apps/web/src/main.tsx", "", 100);
    write("packages/contracts/package.json", JSON.stringify({ name: "@t/contracts" }), 100);
    write("packages/contracts/src/index.ts", "", 100);
    // Only a dev dependency of the web app's dependencies; never bundled.
    write(
      "packages/kit/package.json",
      JSON.stringify({ name: "@t/kit", devDependencies: { "@t/test": "workspace:*" } }),
      100,
    );
    write("packages/test/package.json", JSON.stringify({ name: "@t/test" }), 100);
    return { root, write };
  };

  it("is stale when the web app or a package it uses is newer, and current otherwise", () => {
    const { root, write } = tree();
    assert.strictEqual(bundleState(root).state, "missing");
    write("apps/web/dist/index.html", "", 200);
    assert.strictEqual(bundleState(root).state, "current");
    write("packages/test/src/fixture.ts", "", 300);
    assert.strictEqual(bundleState(root).state, "current", "a dev-only package is not an input");
    write("packages/contracts/src/index.ts", "", 300);
    const stale = bundleState(root);
    assert.strictEqual(stale.state, "stale", "a contracts change makes the bundle stale");
    assert.include(stale.newest?.path ?? "", "packages/contracts/src/index.ts");
    write("apps/web/dist/index.html", "", 400);
    write("apps/web/src/main.tsx", "", 500);
    assert.strictEqual(bundleState(root).state, "stale");
    NodeFS.rmSync(root, { recursive: true, force: true });
  });
});

describe("PRB.T-011 order on raw output", () => {
  const COMMAND = "node /repo/scripts/mock-agent/mock-agent.ts";
  const MARK = "\u001b]133;B\u0007";
  const PROMPT = "\u001b]133;A\u0007$ ";
  const AGENT = "Mock Agent v1\r\nsession: mock-1a2b3c4d\r\n";
  const cases: ReadonlyArray<readonly [string, string, string | null]> = [
    ["typed after the prompt", `${PROMPT}${MARK}${COMMAND}\r\n${AGENT}`, null],
    // A wide prompt scrolls the line and redraws it: the command shows twice, in part.
    [
      "a prompt that redraws the line",
      `\u001b]0;title\u0007${PROMPT}${MARK}\r$ ent/mock-agent.ts\r$ ent/mock-agent.ts\r\n${AGENT}`,
      null,
    ],
    [
      "typed before the prompt",
      `${COMMAND}\r\n${PROMPT}${MARK}${COMMAND}\r\n${AGENT}`,
      "before the first prompt",
    ],
    ["no prompt mark", `${PROMPT}${COMMAND}\r\n${AGENT}`, "no prompt mark"],
    ["banner before the command", `${PROMPT}${MARK}${AGENT}${COMMAND}\r\n`, "banner shows before"],
    ["started twice", `${PROMPT}${MARK}${COMMAND}\r\n${AGENT}${AGENT}`, "started 2 times"],
    [
      "typed again into the agent",
      `${PROMPT}${MARK}${COMMAND}\r\n${AGENT}${COMMAND}\r\necho: ${COMMAND}\r\n`,
      "typed again",
    ],
  ];
  it("passes only for a command typed once, after the first prompt, before the banner", () => {
    for (const [name, output, problem] of cases) {
      const found = agentTypedOnceAfterPrompt(output, COMMAND, MOCK_AGENT_LINES);
      if (problem === null) assert.isNull(found, name);
      else assert.include(found ?? "", problem, name);
    }
  });
});

describe("recorder", () => {
  it.live("waits from an offset, ignoring earlier values", () =>
    Effect.promise(async () => {
      const values = recorder<{ readonly id: number; readonly text: string }>();
      values.push({ id: 1, text: "banner" });
      const from = values.mark();
      const later = values.until("the banner", (value) => value.text === "banner", from);
      values.push({ id: 2, text: "other" });
      values.push({ id: 3, text: "banner" });
      assert.strictEqual((await later).id, 3);
      // From 0, the earlier value answers: the offset is what keeps it out.
      assert.strictEqual((await values.until("the banner", (v) => v.text === "banner", 0)).id, 1);
    }),
  );

  it.live("asserts nothing arrived since an offset, judged at a fence", () =>
    Effect.promise(async () => {
      const values = recorder<string>();
      values.push("typed-agent");
      const clean = values.mark();
      const passing = values.nothingSince("the agent", (v) => v.includes("agent"), clean, {
        what: "the fence",
        match: (v) => v === "fence",
      });
      values.push("prompt");
      values.push("fence");
      await passing;

      // Started on an empty stretch, it does not pass before the fence: a match that comes later fails it.
      const from = values.mark();
      const failing = values.nothingSince("the agent", (v) => v.includes("agent"), from, {
        what: "the fence",
        match: (v) => v === "fence",
      });
      values.push("typed-agent");
      values.push("fence");
      const error = await failing.then(
        () => null,
        (cause: unknown) => cause,
      );
      assert.instanceOf(error, Error);
      assert.include((error as Error).message, "the agent arrived before the fence");
    }),
  );
});

describe("leftover cleanup", () => {
  it.live("leaves live owners, reused pids and unreadable manifests alone", () =>
    Effect.promise(async () => {
      const dir = scratch("scenario-runs-");
      const bystander = NodeChildProcess.spawn("sleep", ["30"], { stdio: "ignore" });
      const bystanderPid = bystander.pid!;
      const lines: Array<string> = [];
      try {
        const home = scratch("probe-scenario-test-");
        const entry = { kind: "server", pid: bystanderPid, home, homeCreatedMs: 0 };
        // A live runner owns it: nothing is touched.
        NodeFS.writeFileSync(
          NodePath.join(dir, "1.json"),
          JSON.stringify({
            runner: { pid: process.pid, startTime: processStartTime(process.pid) },
            entries: [{ ...entry, startTime: processStartTime(bystanderPid) }],
          }),
        );
        // A dead runner, but its pid now belongs to another process (other start time).
        NodeFS.writeFileSync(
          NodePath.join(dir, "2.json"),
          JSON.stringify({
            runner: { pid: 2 ** 22 + 1, startTime: "gone" },
            entries: [{ ...entry, startTime: "another process" }],
          }),
        );
        NodeFS.writeFileSync(NodePath.join(dir, "3.json"), "{ not json");
        cleanLeftovers((line) => lines.push(line), dir);
        assert.isTrue(alive(bystanderPid), "a pid that is not the recorded process was stopped");
        assert.isTrue(NodeFS.existsSync(NodePath.join(dir, "1.json")), "a live run was cleaned");
        assert.isFalse(NodeFS.existsSync(NodePath.join(dir, "2.json")));
        assert.isFalse(NodeFS.existsSync(home), "the dead run's home was kept");
        assert.isTrue(NodeFS.existsSync(NodePath.join(dir, "3.json")));
        assert.isTrue(lines.some((line) => line.includes("3.json is unreadable")));
      } finally {
        bystander.kill("SIGKILL");
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    }),
  );
});

describe("server readiness", () => {
  const fakeBin = (source: string) => {
    const dir = scratch("scenario-fake-server-");
    const file = NodePath.join(dir, "bin.mjs");
    NodeFS.writeFileSync(file, source);
    return { dir, file };
  };

  it.live("is ready when the server answers over HTTP, whatever it prints", () =>
    Effect.promise(async () => {
      const { dir, file } = fakeBin(`
        import * as http from "node:http";
        const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
        http.createServer((_, response) => response.end("{}")).listen(port, "127.0.0.1", () => {
          console.log("listening, no ready line");
        });
      `);
      const home = scratch("scenario-ready-home-");
      const server = await startServer({ home, serverBin: file });
      await server.kill();
      NodeFS.rmSync(dir, { recursive: true, force: true });
      NodeFS.rmSync(home, { recursive: true, force: true });
    }),
  );

  it.live("is not ready on the ready line alone, and fails with what the server printed", () =>
    Effect.promise(async () => {
      const { dir, file } = fakeBin(`
        console.log("T3 Code server is ready.");
        setInterval(() => {}, 1000);
      `);
      for (const [name, source] of [
        ["prints the ready line but never serves", file],
        ["exits before it serves", fakeBin(`console.log("starting"); process.exit(4);`).file],
      ] as const) {
        const child = NodeChildProcess.spawn("node", [source], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const failure = await waitUntilServing(child, "http://127.0.0.1:1", (chunk) => {
          // Seen the line: a server that counted it as ready would have resolved by now.
          if (chunk.includes("ready")) child.kill("SIGKILL");
        }).then(
          () => null,
          (cause: unknown) => cause,
        );
        assert.instanceOf(failure, Error, name);
        assert.include((failure as Error).message, "could not start", name);
        assert.match((failure as Error).message, /T3 Code server is ready\.|starting/, name);
      }
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }),
  );
});

describe("shell isolation", () => {
  const MARKER = "PROBE-LEAK-$((6*7))";

  /** Starts a server on `ambient`, opens a plain shell and returns what it shows and runs. */
  const shellUnder = (ambient: NodeJS.ProcessEnv, isolateShell: boolean, homes: Array<string>) =>
    Effect.gen(function* () {
      const home = scratch("scenario-isolation-");
      homes.push(home);
      const server = yield* Effect.promise(() => startServer({ home, ambient, isolateShell }));
      const rpc = yield* Effect.promise(async () =>
        connectRpc(server.origin, { bearerToken: await issueBearerToken(server) }),
      );
      return yield* Effect.gen(function* () {
        const shell = yield* rpc.client["shell.open"]({ cwd: home, cols: 80, rows: 24 });
        const program = NodeChildProcess.execFileSync(
          "ps",
          ["-o", "comm=", "-p", String(shell.pid)],
          { encoding: "utf8" },
        ).trim();
        if (program !== "zsh") return { home, program, shown: "" };
        // Wrapped shells log their first prompt; the startup files have run by then.
        yield* Effect.promise(() =>
          server.logged(
            "the prompt",
            (entry) => entry.includes("shell prompt ready") && entry.includes(shell.shellId),
          ),
        );
        yield* rpc.client["shell.write"]({ shellId: shell.shellId, data: "echo home=$HOME end\r" });
        const output = recorder<string>("shell output");
        const viewer = follow(rpc.client["shell.attach"]({ shellId: shell.shellId }), (event) =>
          output.push(
            event.type === "snapshot"
              ? event.snapshot.history
              : event.type === "output"
                ? event.data
                : "",
          ),
        );
        const text = () => output.seen.join("");
        // Judges all the text so far; the echoed line is written once.
        yield* Effect.promise(() =>
          output.until("the echoed home", () => /home=\S+ end/.test(text()), 0),
        );
        yield* Fiber.interrupt(viewer);
        return { home, program, shown: text() };
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            await rpc.close();
            await server.kill();
            await server.stopShellHost("SIGKILL");
          }),
        ),
      );
    });

  it.live("runs every shell with the harness's startup files, whatever the developer's are", () => {
    const developer = scratch("scenario-developer-home-");
    const homes: Array<string> = [developer];
    return Effect.gen(function* () {
      for (const file of [".zshrc", ".zshenv", ".bashrc"]) {
        NodeFS.writeFileSync(NodePath.join(developer, file), `echo ${MARKER}\n`);
      }
      const ambient = {
        ...process.env,
        HOME: developer,
        ZDOTDIR: developer,
        SHELL: "/usr/bin/zsh",
      };

      const isolated = yield* shellUnder(ambient, true, homes);
      assert.strictEqual(isolated.program, "zsh");
      assert.notInclude(isolated.shown, "PROBE-LEAK-42");
      // Its HOME is inside the throwaway home, never the developer's (AC-19).
      assert.include(isolated.shown, `home=${NodePath.join(isolated.home, "shell-home")} end`);

      const own = yield* shellUnder(ambient, false, homes);
      assert.include(own.shown, "PROBE-LEAK-42", "the negative control: no isolation, no change");

      // A shell Probe does not wrap: isolation still runs zsh; without it, that shell runs.
      const unwrapped = { ...ambient, SHELL: "/bin/sh" };
      assert.strictEqual((yield* shellUnder(unwrapped, true, homes)).program, "zsh");
      assert.notStrictEqual((yield* shellUnder(unwrapped, false, homes)).program, "zsh");
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const home of homes) NodeFS.rmSync(home, { recursive: true, force: true });
        }),
      ),
    );
  });

  it("never hands the server a Probe, Vite or T3 variable, and always the harness's git config", () => {
    const env = childEnv({}, { T3CODE_HOME: "/x", VITE_WS_URL: "ws://x", PROBE_X: "1", KEEP: "1" });
    assert.deepEqual(
      Object.keys(env).filter((key) => /^(T3CODE_|VITE_|PROBE_)/.test(key)),
      [],
    );
    assert.strictEqual(env.KEEP, "1");
    assert.include(env.GIT_CONFIG_GLOBAL ?? "", "scripts/scenarios/gitconfig");
  });
});
