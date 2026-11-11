// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off - Spawns the scenario runner as a real subprocess.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as Fiber from "effect/Fiber";

import { launchBrowser } from "./browser.ts";
import { bundleState } from "./bundle.ts";
import { childPids, cleanLeftovers, processStartTime } from "./cleanup.ts";
import { refusalReason } from "./environment.ts";
import { connectApi, issueBearerToken } from "./lib/api.ts";
import { agentTypedOnceAfterPrompt, followShells, MOCK_AGENT_LINES } from "./lib/shells.ts";
import { createTrail, StageFailure } from "./lib/trail.ts";
import { alive, follow, recorder } from "./lib/waits.ts";
import { childEnv, startServer, waitUntilServing } from "./server.ts";
import { spawnScript } from "./spawned.ts";

const runner = NodeURL.fileURLToPath(new URL("./run.ts", import.meta.url));

const spawnRunner = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}) =>
  spawnScript(runner, args, env);

const scratch = (label: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), label));
const missingPath = (name: string) => NodePath.join(NodeOS.tmpdir(), "scenario-missing", name);

/** The folder and the saved files of the one failure a run printed artifacts for. */
function artifactsOf(output: string) {
  const found = /artifacts: (\S+) \(([^)]*)\)/.exec(output);
  assert.isNotNull(found, output);
  const dir = found![1]!;
  return {
    dir,
    saved: found![2]!.split(", "),
    read: (file: string) => NodeFS.readFileSync(NodePath.join(dir, file), "utf8"),
    remove: () => NodeFS.rmSync(NodePath.dirname(dir), { recursive: true, force: true }),
  };
}

/** A pretty-printed server log entry at debug level: `[time] DEBUG (#fiber) ...`. */
const DEBUG_ENTRY = / DEBUG \(#\d+\)/;

const UNMASKED_SECRETS = [
  /wsTicket=(?!\[redacted\])/,
  /\/pair#(?!\[redacted\])/,
  /\bBearer\s+(?!\[redacted\])/i,
  /t3_session\w*=(?!\[redacted\])/,
];

function assertNoSecrets(dir: string) {
  for (const file of NodeFS.readdirSync(dir).filter((name) => !name.endsWith(".png"))) {
    const text = NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
    for (const pattern of UNMASKED_SECRETS) assert.notMatch(text, pattern, file);
  }
}

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
        /FAIL\s+T2 deliberate failure \(\d+\.\d s, teardown \d+ ms\): at stage "setup": deliberate failure/,
      );
      assert.match(output, /scenarios: total \d+\.\d s/);
      // The failure leaves its evidence outside the removed home (AC-16).
      const artifacts = artifactsOf(output);
      assert.deepEqual(artifacts.saved, [
        "error.txt",
        "page-1-signed-in.png",
        "page-1-signed-in.console.txt",
        "server.stage.log",
        "server.log",
        "setup.json",
        "recorders.json",
      ]);
      assert.deepEqual(JSON.parse(artifacts.read("recorders.json")), {
        "page frames": ["a value the failure keeps"],
      });
      artifacts.remove();
    }),
  );

  it.live("fails with a second server's output and still stops the one that started", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", "--only", "T3"]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T3 second server cannot start \([^)]*\): at stage "setup": Probe server could not start/,
      );
      assert.include(output, "Cannot find module");
      const started = [...output.matchAll(/T3 (?:second )?server pid=(\d+) home=(\S+)/g)];
      assert.lengthOf(started, 2);
      for (const [, pid, home] of started) {
        assert.isFalse(alive(Number(pid)));
        assert.isFalse(NodeFS.existsSync(home!));
      }
      // No page was opened, so there is no screenshot; both started servers left their logs.
      const artifacts = artifactsOf(output);
      assert.deepEqual(artifacts.saved, [
        "error.txt",
        "server.stage.log",
        "server.log",
        "second-server.stage.log",
        "second-server.log",
        "setup.json",
        "recorders.json",
      ]);
      artifacts.remove();
    }),
  );

  it.live("fails a setup call in setup, naming the call and the server's reason", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", "--only", "T12"]).done;
      assert.strictEqual(code, 1);
      const home = /T12 server pid=\d+ home=(\S+)/.exec(output)?.[1];
      const failed =
        /FAIL\s+T12 a setup call fails \([^)]*\): at stage "setup": setup call workspace\.addProject (\{.*\}) failed: WorkspaceProjectError: The folder does not exist: (\S+)/.exec(
          output,
        );
      assert.isNotNull(failed, output);
      const asked = JSON.parse(failed![1]!) as { name: string; path: string };
      const runId = /^t12-(\w+)-1$/.exec(asked.name)?.[1];
      assert.isDefined(runId, asked.name);
      assert.strictEqual(asked.path, NodePath.join(home!, "folders", runId!, "missing"));
      assert.strictEqual(failed![2], asked.path);

      const artifacts = artifactsOf(output);
      assert.deepEqual(artifacts.saved, [
        "error.txt",
        "server.stage.log",
        "server.log",
        "setup.json",
        "recorders.json",
      ]);
      // What each call asked for and got back (AC-21).
      const notes = JSON.parse(artifacts.read("setup.json")) as ReadonlyArray<{
        call: string;
        asked: unknown;
        got: unknown;
      }>;
      assert.deepEqual(
        notes.map(({ call, asked }) => ({ call, asked })),
        [
          { call: "workspace.create", asked: { name: asked.name } },
          { call: "workspace.addProject", asked: { mode: "import", ...asked } },
        ],
      );
      assert.isDefined(notes[0]!.got);
      assert.deepEqual(notes[1]!.got, {
        failed: `WorkspaceProjectError: The folder does not exist: ${asked.path}`,
      });
      assert.include(artifacts.read("error.txt"), "setup call workspace.addProject");
      assertNoSecrets(artifacts.dir);
      artifacts.remove();
    }),
  );

  it.live("names the workspace a page did not show, and saves the page", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", "--only", "T13"]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T13 a workspace is not shown \([^)]*\): at stage "show a workspace that does not exist": Workspace missing-\w+ was not shown/,
      );
      const artifacts = artifactsOf(output);
      assert.deepEqual(artifacts.saved, [
        "error.txt",
        "page-1-signed-in.png",
        "page-1-signed-in.console.txt",
        "server.stage.log",
        "server.log",
        "setup.json",
        "recorders.json",
      ]);
      artifacts.remove();
    }),
  );

  it.live("labels every server's debug log and every page's console, with no secret in them", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", "--only", "T15"]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T15 labelled failure artifacts \([^)]*\): at stage "fail after a reload": T15 fails on purpose/,
      );
      for (const label of ["server", "second-server"]) {
        assert.match(output, new RegExp(`scenarios: T15 ${label} log=\\d+KiB`));
      }
      const artifacts = artifactsOf(output);
      assert.deepEqual(artifacts.saved, [
        "error.txt",
        "page-1-signed-in.png",
        "page-1-signed-in.console.txt",
        "page-2-anonymous.png",
        "page-2-anonymous.console.txt",
        "server.stage.log",
        "server.log",
        "second-server.stage.log",
        "second-server.log",
        "setup.json",
        "recorders.json",
      ]);
      const signedIn = artifacts.read("page-1-signed-in.console.txt");
      const anonymous = artifacts.read("page-2-anonymous.console.txt");
      assert.include(signedIn, "[log] T15 marker signed-in");
      assert.notInclude(signedIn, "T15 marker anonymous");
      assert.include(anonymous, "[log] T15 marker anonymous");
      assert.notInclude(anonymous, "T15 marker signed-in");
      // The failing stage's slice holds the server's debug-level entries (AC-17).
      assert.match(artifacts.read("server.stage.log"), DEBUG_ENTRY);
      assertNoSecrets(artifacts.dir);
      artifacts.remove();
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
      assert.match(output, /FAIL\s+T2 deliberate failure .*: at stage "setup": deliberate failure/);
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
      // Killed once S2's first shell runs its agent, so a server, a shell host and a shell are left.
      const run = spawnRunner(["--only", "S2"]);
      const [, pid, home] = await run.line(/S2 server pid=(\d+) home=(\S+)/);
      await run.line(/METRIC\s+S2 start-to-banner/);
      const runnerPid = run.child.pid!;
      run.child.kill("SIGKILL");
      await run.done;
      const hostPid = Number(
        NodeFS.readFileSync(NodePath.join(home!, "userdata", "shell-host-v1.pid"), "utf8"),
      );
      // The host's children, not the shell list: the runner may die before the server saves it.
      const shellPids = childPids(hostPid);
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
          assert.include(output, "scenarios: 1 ran, 1 passed, 0 failed");
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

describe("failure artifacts", () => {
  it.live("keep the failing stage's server lines past what the log buffer holds", () =>
    Effect.promise(async () => {
      // 6 MiB in one stage, more than the server handle's 4 MiB in-memory log.
      const dir = scratch("scenario-fake-server-");
      const bin = NodePath.join(dir, "bin.mjs");
      NodeFS.writeFileSync(
        bin,
        `
        import * as http from "node:http";
        const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
        const filler = "x".repeat(1023) + "\\n";
        http.createServer((request, response) => {
          if (request.url === "/before") console.log("AC18 before the stage");
          if (request.url === "/flood") {
            console.log("AC18 stage start");
            process.stdout.write(filler.repeat(6 * 1024));
            console.log("AC18 stage end");
          }
          response.end("{}");
        }).listen(port, "127.0.0.1", () => console.log("listening"));
      `,
      );
      const home = scratch("scenario-flood-home-");
      const artifactsDir = NodePath.join(dir, "artifacts");
      const server = await startServer({ home, serverBin: bin });
      try {
        const trail = createTrail();
        trail.addServer("server", server);
        await fetch(`${server.origin}/before`);
        await server.logged("the line before the stage", (entry) =>
          entry.includes("AC18 before the stage"),
        );
        const failure = await trail
          .stage("flood the log", async () => {
            const from = server.logMark();
            await fetch(`${server.origin}/flood`);
            await server.logged("the flood's end", (entry) => entry.includes("AC18 stage end"), {
              from,
            });
            throw new Error("fails after the flood");
          })
          .then(
            () => null,
            (cause: unknown) => cause,
          );
        assert.instanceOf(failure, StageFailure);
        assert.notInclude(server.logs(), "AC18 stage start", "the buffer still holds the start");

        const { saved, missing } = await trail.save(artifactsDir, failure);
        assert.deepEqual(missing, []);
        assert.includeMembers([...saved], ["server.stage.log", "server.log"]);
        const read = (file: string) =>
          NodeFS.readFileSync(NodePath.join(artifactsDir, file), "utf8");
        const stageLog = read("server.stage.log");
        assert.isTrue(stageLog.startsWith("AC18 stage start"), stageLog.slice(0, 200));
        assert.include(stageLog, "AC18 stage end");
        assert.notInclude(stageLog, "AC18 before the stage");
        assert.include(read("server.log"), "AC18 before the stage");
      } finally {
        await server.kill();
        NodeFS.rmSync(dir, { recursive: true, force: true });
        NodeFS.rmSync(home, { recursive: true, force: true });
      }
    }),
  );

  it.live("save every other piece and name the screenshot of a closed page as missing", () =>
    Effect.promise(async () => {
      const dir = scratch("scenario-closed-page-");
      const browser = await launchBrowser(undefined);
      try {
        const page = await (await browser.newContext()).newPage();
        const trail = createTrail();
        trail.addPage("closed", page);
        await Promise.all([
          page.waitForEvent("console"),
          page.evaluate("console.log('AC20 before the close')"),
        ]);
        await page.close();
        const { saved, missing } = await trail.save(dir, new Error("the original failure"));
        assert.deepEqual(missing, ["page-1-closed.png: the page was closed before the failure"]);
        assert.deepEqual(saved, [
          "error.txt",
          "page-1-closed.console.txt",
          "setup.json",
          "recorders.json",
        ]);
        const read = (file: string) => NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
        assert.include(read("error.txt"), "the original failure");
        assert.include(read("page-1-closed.console.txt"), "AC20 before the close");
      } finally {
        await browser.close();
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    }),
  );
});

describe("server log level", () => {
  /** Starts a server at `logLevel`, starts and kills one shell, and returns its whole log and token. */
  const shellRunAt = (logLevel: string | null) =>
    Effect.gen(function* () {
      const home = scratch("scenario-log-level-");
      const server = yield* Effect.promise(() => startServer({ home, logLevel }));
      const token = yield* Effect.promise(() => issueBearerToken(server));
      const rpc = yield* Effect.promise(() => connectApi(server, { bearerToken: token }));
      return yield* Effect.gen(function* () {
        const shells = followShells(rpc.client);
        const shell = yield* rpc.client["shell.open"]({ cwd: home, cols: 80, rows: 24 });
        yield* Effect.promise(() =>
          shells.lists.until(
            "the shell's first prompt",
            (list) => list.some((entry) => entry.shellId === shell.shellId && entry.promptReady),
            0,
          ),
        );
        yield* rpc.client["shell.kill"]({ shellId: shell.shellId });
        // Logged after the first prompt's entry on the same stdout, so that one is in by now.
        yield* Effect.promise(() =>
          server.logged(
            "the shell's end",
            (entry) => entry.includes("shell ended") && entry.includes(shell.shellId),
          ),
        );
        return { log: server.logSince(0), token };
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            await rpc.close();
            await server.kill();
            await server.stopShellHost("SIGKILL");
            NodeFS.rmSync(home, { recursive: true, force: true });
          }),
        ),
      );
    });

  // A shell start runs the debug entry "shell first prompt"; null starts with no log flag.
  it.live("prints debug entries only when asked, and never the bearer token", () =>
    Effect.gen(function* () {
      const debug = yield* shellRunAt("debug");
      const quiet = yield* shellRunAt(null);
      assert.match(debug.log, /DEBUG \(#\d+\)[^\n]*: shell first prompt/);
      assert.notMatch(quiet.log, DEBUG_ENTRY);
      assert.notInclude(quiet.log, "shell first prompt");
      for (const { log, token } of [debug, quiet]) assert.notInclude(log, token);
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
        connectApi(server, { bearerToken: await issueBearerToken(server) }),
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
