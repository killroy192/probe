// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off - Spawns the scenario launcher as a real subprocess.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { onTestFinished } from "vite-plus/test";

import * as Fiber from "effect/Fiber";

import { launchBrowser } from "./browser.ts";
import { bundleState } from "./bundle.ts";
import { cleanLeftovers, processStartTime } from "./cleanup.ts";
import { refusalReason } from "./environment.ts";
import { QUIET_UNCONFIRMED } from "./gate.ts";
import { connectApi, issueBearerToken } from "./lib/api.ts";
import { agentTypedOnceAfterPrompt, followShells, MOCK_AGENT_LINES } from "./lib/shells.ts";
import { createTrail, StageFailure } from "./lib/trail.ts";
import { alive, follow, recorder } from "./lib/waits.ts";
import { portTakenLine, startOnLeasedPort } from "./ports.ts";
import { childEnv, REPO_ROOT, startServer, waitUntilServing } from "./server.ts";
import { spawnScript } from "./spawned.ts";

const launcher = NodeURL.fileURLToPath(new URL("./cli.ts", import.meta.url));
const SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");

const scratch = (label: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), label));
const missingPath = (name: string) => NodePath.join(NodeOS.tmpdir(), "scenario-missing", name);
const removedAtEnd = (path: string) =>
  onTestFinished(() => NodeFS.rmSync(path, { recursive: true, force: true }));

/**
 * Runs the launcher with its artifacts in `artifacts`, removed when the test ends. Registered
 * before the spawn, so it runs after the spawn's own end-of-test stop.
 */
function spawnRunner(
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = {},
  artifacts = scratch("scenario-run-"),
) {
  removedAtEnd(artifacts);
  return { ...spawnScript(launcher, [...args, "--artifacts", artifacts], env), artifacts };
}

const only = (...ids: ReadonlyArray<string>) => ids.flatMap((id) => ["--only", id]);

/** The folder and the saved files of the first failure a run printed artifacts for. */
function artifactsOf(output: string) {
  const found = /artifacts: (\S+) \(([^)]*)\)/.exec(output);
  assert.isNotNull(found, output);
  const dir = found![1]!;
  return {
    dir,
    saved: found![2]!.split(", "),
    read: (file: string) => NodeFS.readFileSync(NodePath.join(dir, file), "utf8"),
  };
}

/** Every server a run printed as started: shared, fresh and second ones. */
const startedServers = (output: string) =>
  [...output.matchAll(/ server pid=(\d+) home=(\S+)/g)].map(([, pid, home]) => ({
    pid: Number(pid),
    home: home!,
  }));

function assertStopped(servers: ReadonlyArray<{ readonly pid: number; readonly home: string }>) {
  assert.isNotEmpty(servers);
  for (const { pid, home } of servers) {
    assert.isFalse(alive(pid), `server ${pid} survived`);
    assert.isFalse(NodeFS.existsSync(home), `${home} was kept`);
  }
}

const parentOf = (pid: number) =>
  Number(
    NodeChildProcess.execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim(),
  );

/** A pretty-printed server log entry at debug level: `[time] DEBUG (#fiber) ...`. */
const DEBUG_ENTRY = / DEBUG \(#\d+\)/;

const UNMASKED_SECRETS = [
  /wsTicket=(?!\[redacted\])/,
  /\/pair#(?!\[redacted\])/,
  /\bBearer\s+(?!\[redacted\])/i,
  /t3_session\w*=(?!\[redacted\])/,
];

function assertNoSecrets(dir: string) {
  for (const file of NodeFS.readdirSync(dir).filter((name) => !/\.(png|zip)$/.test(name))) {
    const text = NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
    for (const pattern of UNMASKED_SECRETS) assert.notMatch(text, pattern, file);
  }
}

const fakeBin = (source: string) => {
  const dir = scratch("scenario-fake-server-");
  const file = NodePath.join(dir, "bin.mjs");
  NodeFS.writeFileSync(file, source);
  return { dir, file };
};

/** A fake server that only answers HTTP on the port it is given. */
const HTTP_ONLY_SERVER = `
  import * as http from "node:http";
  const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
  http.createServer((_, response) => response.end("{}")).listen(port, "127.0.0.1", () => {
    console.log("listening, no ready line");
  });
`;

/** A `vp` first on PATH that prints `say` and exits with `code`, so no real build runs. */
function fakeVp(say: string, code: number) {
  const bin = scratch("scenario-fake-vp-");
  removedAtEnd(bin);
  NodeFS.writeFileSync(NodePath.join(bin, "vp"), `#!/bin/sh\necho ${say}\nexit ${code}\n`, {
    mode: 0o755,
  });
  return { PATH: `${bin}${NodePath.delimiter}${NodeProcess.env.PATH ?? ""}` };
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
    // os.homedir() honors these, so the launcher's idea of "real data" is a scratch folder.
    const fakeHome = scratch("scenario-fake-home-");
    removedAtEnd(fakeHome);
    const { code, output } = await spawnRunner([], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      T3CODE_HOME: NodePath.join(fakeHome, ".t3"),
    }).done;
    assert.strictEqual(code, 2);
    assert.include(output, "refusing to run");
    assert.notInclude(output, "scenarios: ready");
  }),
);

it.live("names the browser when it cannot be started, before any server starts", () =>
  Effect.promise(async () => {
    const browser = missingPath("chromium");
    const { code, output } = await spawnRunner(["--selftest", ...only("T16"), "--browser", browser])
      .done;
    assert.notStrictEqual(code, 0);
    assert.include(output, `Browser at ${browser} could not be started`);
    assert.include(output, "Install it with");
    assert.deepEqual(startedServers(output), []);
  }),
);

describe("scenario launcher", () => {
  it.live("names the shared server when it cannot start, and reports every scenario", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner([
        "--selftest",
        "--workers",
        "2",
        "--server-bin",
        missingPath("bin.ts"),
        ...only("T16", "T17"),
      ]).done;
      assert.strictEqual(code, 1);
      for (const id of ["T16", "T17"]) {
        assert.match(
          output,
          new RegExp(`FAIL\\s+${id} [^\\n]*: at stage "setup": Probe server could not start`),
        );
      }
      assert.include(output, "Cannot find module");
      assert.include(output, "scenarios: self-test 2 ran, 0 passed, 2 failed");
    }),
  );

  it.live("reports each failure by name with its evidence, then judges the perf self-tests", () =>
    Effect.promise(async () => {
      const run = spawnRunner(["--selftest"]);
      const { code, output } = await run.done;
      assert.strictEqual(code, 1, output);
      // Every scenario's time and teardown, and the run's total, pass or fail.
      assert.match(output, /PASS\s+T1 restart keeps data \(\d+\.\d s, teardown \d+ ms\)/);
      assert.match(
        output,
        /FAIL\s+T2 deliberate failure \(\d+\.\d s, teardown \d+ ms\): at stage "setup": deliberate failure [^\n]*expected "a title no page has", found /,
      );
      assert.match(output, /scenarios: self-test 5 ran, 4 passed, 1 failed, \d+ checks skipped/);
      assert.match(output, /scenarios: total \d+\.\d s/);
      // The failure leaves its evidence, a trace included, outside the removed home.
      const artifacts = artifactsOf(output);
      assert.strictEqual(artifacts.dir, NodePath.join(run.artifacts, "T2"));
      assert.deepEqual(artifacts.saved, [
        "error.txt",
        "page-1-signed-in.png",
        "page-1-signed-in.console.txt",
        "server.stage.log",
        "server.log",
        "setup.json",
        "recorders.json",
        "trace-1.zip",
      ]);
      assert.deepEqual(JSON.parse(artifacts.read("recorders.json")), {
        "page frames": ["a value the failure keeps"],
      });
      // The negative control: a scenario that passed leaves no failure artifacts.
      const kept = NodeFS.readdirSync(run.artifacts);
      for (const id of ["T1", "T4", "T10", "T11"]) assert.notInclude(kept, id);
      assert.notInclude(NodeFS.readdirSync(NodePath.join(run.artifacts, "perf")), "T33");

      // The second run: the perf self-tests, one within its budget and one over it.
      assert.match(
        output,
        /PASS\s+T33 a perf self-test within its budget \([^)]*\)\n\s+PERF PASS T33 open-a-page \d+ ms, limit 60000 ms \(PRB\.T-040 AC-11\)/,
      );
      assert.match(
        output,
        /FAIL\s+T34 a perf self-test over its budget \([^)]*\): PERF FAIL T34 open-a-page \d+ ms, limit 1 ms \(PRB\.T-040 AC-11\)/,
      );
      assert.include(output, "perf: 2 measured, 1 over the limit");
      assert.match(output, /scenarios: self-test 2 ran, 1 passed, 1 failed/);
    }),
  );

  it.live("fails a scenario whose shared server dies, then runs the next on a working one", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner([
        "--selftest",
        "--workers",
        "1",
        ...only("T32", "T16", "T2", "T17"),
      ]).done;
      assert.strictEqual(code, 1, output);
      const shared = [...output.matchAll(/shared server pid=(\d+) home=(\S+)/g)];
      const killed =
        /FAIL\s+T32 the shared server crashes mid-stage \([^)]*\): at stage "kill the shared server mid-stage": the shared server \(pid (\d+)\) exited unexpectedly with SIGKILL; its last lines:/.exec(
          output,
        );
      assert.isNotNull(killed, output);
      assert.strictEqual(killed![1], shared[0]?.[1]);
      assert.match(output, /PASS\s+T16 /);
      assert.match(
        output,
        /FAIL\s+T2 deliberate failure [^\n]*: at stage "setup": deliberate failure/,
      );
      assert.match(output, /PASS\s+T17 /);
      // Each failure replaced its worker, and the worker its shared server.
      assert.lengthOf(shared, 3);
      assert.include(output, "scenarios: self-test 4 ran, 2 passed, 2 failed");
      assertStopped(startedServers(output));
    }),
  );

  it.live("fails with a second server's output and still stops the one that started", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T3")]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T3 second server cannot start \([^)]*\): at stage "setup": Probe server could not start/,
      );
      assert.include(output, "Cannot find module");
      // The shared server and the second server that started.
      const started = startedServers(output);
      assert.lengthOf(started, 2);
      assertStopped(started);
      // No page was opened, so there is no screenshot or trace; both started servers left their logs.
      assert.deepEqual(artifactsOf(output).saved, [
        "error.txt",
        "server.stage.log",
        "server.log",
        "second-server.stage.log",
        "second-server.log",
        "setup.json",
        "recorders.json",
      ]);
    }),
  );

  it.live("fails a setup call in setup, naming the call and the server's reason", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T12")]).done;
      assert.strictEqual(code, 1);
      const home = /shared server pid=\d+ home=(\S+)/.exec(output)?.[1];
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
      // What each call asked for and got back.
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
    }),
  );

  it.live("names the workspace a page did not show, and saves the page", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T13")]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T13 a workspace is not shown \([^)]*\): at stage "show a workspace that does not exist": Workspace missing-\w+ was not shown/,
      );
      assert.deepEqual(artifactsOf(output).saved, [
        "error.txt",
        "page-1-signed-in.png",
        "page-1-signed-in.console.txt",
        "server.stage.log",
        "server.log",
        "setup.json",
        "recorders.json",
        "trace-1.zip",
      ]);
    }),
  );

  it.live("labels every server's debug log and every page's console, with no secret in them", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T15")]).done;
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
        "trace-1.zip",
        "trace-2.zip",
      ]);
      const signedIn = artifacts.read("page-1-signed-in.console.txt");
      const anonymous = artifacts.read("page-2-anonymous.console.txt");
      assert.include(signedIn, "[log] T15 marker signed-in");
      assert.notInclude(signedIn, "T15 marker anonymous");
      assert.include(anonymous, "[log] T15 marker anonymous");
      assert.notInclude(anonymous, "T15 marker signed-in");
      // The failing stage's slice holds the server's debug-level entries.
      assert.match(artifacts.read("server.stage.log"), DEBUG_ENTRY);
      assertNoSecrets(artifacts.dir);
    }),
  );

  it.live("reports the original error when the failure artifacts cannot be saved", () =>
    Effect.promise(async () => {
      const root = scratch("scenario-artifacts-");
      // A file where T2's artifacts folder would go.
      NodeFS.writeFileSync(NodePath.join(root, "T2"), "");
      const { code, output } = await spawnRunner(["--selftest", ...only("T2")], {}, root).done;
      assert.strictEqual(code, 1);
      assert.match(output, /FAIL\s+T2 deliberate failure .*: at stage "setup": deliberate failure/);
      assert.include(output, `artifact missing: ${NodePath.join(root, "T2")}: `);
    }),
  );

  it.live("stops on a failed web build and runs nothing", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(
        ["--selftest", ...only("T16"), "--rebuild"],
        fakeVp("boom-from-the-build", 3),
      ).done;
      assert.notStrictEqual(code, 0);
      assert.include(output, "boom-from-the-build");
      assert.include(output, "The web build failed (exit code 3)");
      assert.notInclude(output, "scenarios: ready");
    }),
  );

  it.live("builds the web bundle once for a run on several workers, and names it", () =>
    Effect.promise(async () => {
      // T16 and T17 set up over the API only, so the fake build's bundle serves no page.
      const { code, output } = await spawnRunner(
        ["--selftest", "--rebuild", "--workers", "2", ...only("T16", "T17")],
        fakeVp("fake-vp-build", 0),
      ).done;
      assert.strictEqual(code, 0, output);
      assert.lengthOf(output.match(/fake-vp-build/g) ?? [], 1);
      assert.lengthOf(output.match(/scenarios: building the web bundle \(--rebuild\)/g) ?? [], 1);
      assert.match(output, /scenarios: web bundle rebuilt, built \S+/);
      assert.match(output, /scenarios: ready \(2 workers,/);
    }),
  );

  it.live(
    "runs fresh-server scenarios beside shared ones on two workers, and stops every server",
    () =>
      Effect.promise(async () => {
        // T1 restarts its server and T36 stops its shell host; the other four share.
        const ids = ["T1", "T36", "T16", "T17", "T29", "T30"];
        const { code, output } = await spawnRunner([
          "--selftest",
          "--workers",
          "2",
          ...only(...ids),
        ]).done;
        assert.strictEqual(code, 0, output);
        assert.match(output, /scenarios: ready \(2 workers,/);
        for (const id of ids) assert.match(output, new RegExp(`PASS\\s+${id} `));
        assert.include(output, "scenarios: self-test 6 ran, 6 passed, 0 failed");

        const fresh = ["T1", "T36"].map((id) => {
          const line = new RegExp(`scenarios: ${id} server pid=(\\d+) home=(\\S+)`).exec(output);
          assert.isNotNull(line, output);
          return { pid: Number(line![1]), home: line![2]!, at: line!.index };
        });
        const shared = [...output.matchAll(/worker (\d+) shared server pid=/g)];
        // One shared server per worker at most, and never more workers than asked for.
        assert.isAtMost(shared.length, 2);
        for (const [, worker] of shared) assert.isBelow(Number(worker), 2);
        const started = startedServers(output);
        assert.isBelow(started.length, ids.length, "as many servers as scenarios");
        // A fresh server and its home are its scenario's own: no other line names either.
        for (const { pid, home } of fresh) {
          assert.lengthOf(
            started.filter((server) => server.pid === pid || server.home === home),
            1,
          );
        }
        // Both fresh servers were up before any scenario ended, so two scenarios ran at once.
        const firstEnd = output.search(/^(PASS|FAIL) /m);
        for (const { at } of fresh) assert.isBelow(at, firstEnd);
        assertStopped(started);
      }),
  );

  it.live(
    "keeps two scenarios on one shared server to their own, and fails a server-wide check",
    () =>
      Effect.promise(async () => {
        const { code, output } = await spawnRunner([
          "--selftest",
          "--workers",
          "1",
          ...only("T-shared"),
        ]).done;
        assert.strictEqual(code, 1, output);
        assert.match(output, /scenarios: ready \(1 worker,/);
        assert.include(output, "scenarios: set T-shared: 3 members");
        assert.match(output, /PASS\s+T29 /);
        assert.match(output, /PASS\s+T30 /);
        const failed =
          /FAIL\s+T31 counts every workspace on its server \(negative control\) \([^)]*\): at stage "count every workspace on the server": every workspace on the server: expected (\[[^\]]*\]), found (\[[^\]]*\])/.exec(
            output,
          );
        assert.isNotNull(failed, output);
        const own = JSON.parse(failed![1]!) as ReadonlyArray<string>;
        const every = JSON.parse(failed![2]!) as ReadonlyArray<string>;
        assert.lengthOf(every, 3);
        assert.includeMembers([...every], [...own]);
        assert.lengthOf([...output.matchAll(/shared server pid=/g)], 1);
        assert.include(output, "scenarios: set T-shared 2/3 passed");
      }),
  );

  it.live("names the cause of each deliberate failure: UI state, missing output, server exit", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T-diagnosis")]).done;
      assert.strictEqual(code, 1);
      assert.include(output, "scenarios: set T-diagnosis: 3 members");
      assert.match(
        output,
        /FAIL\s+T18 a wrong UI state \([^)]*\): at stage "count the projects in the tree": projects the tree shows for \S+: expected 2, found 1/,
      );
      assert.match(
        output,
        /FAIL\s+T19 terminal output that never comes \([^)]*\): at stage "wait for a line the shell never prints": Timed out after 2 s waiting for the line t19-43 in shell \S+ [^\n]*: expected t19-43, found /,
      );
      const t20 = /scenarios: T20 server pid=(\d+)/.exec(output);
      assert.isNotNull(t20, output);
      assert.match(
        output,
        new RegExp(
          `FAIL\\s+T20 a server that crashes mid-stage \\([^)]*\\): at stage "kill the server mid-stage": the server \\(pid ${t20![1]}\\) exited unexpectedly with SIGKILL; its last lines:`,
        ),
      );
      assert.include(output, "scenarios: set T-diagnosis 0/3 passed");
      assertStopped(startedServers(output));
    }),
  );

  it.live("runs composed scenarios step by step, naming a failed step and what did not run", () =>
    Effect.promise(async () => {
      const run = spawnRunner(["--selftest", ...only("T-compose")]);
      const { code, output } = await run.done;
      assert.strictEqual(code, 1);
      const failed =
        /FAIL\s+T21 a composed scenario whose second step fails \(composed, 3 steps, \d+\.\d s\): step 2 T18 at stage "count the projects in the tree": projects the tree shows for \S+: expected 2, found 1\n\s+not run: step 3 T17\n\s+artifacts: (\S+)/.exec(
          output,
        );
      assert.isNotNull(failed, output);
      assert.strictEqual(failed![1], NodePath.join(run.artifacts, "T21", "step-2-T18"));
      assert.match(
        output,
        /PASS\s+T22 two handovers of a workspace \(composed, 4 steps, \d+\.\d s\)\n\s+step 1 T16 \(\d+\.\d s\)\n\s+step 2 T17 \(\d+\.\d s\)\n\s+step 3 T16 \(\d+\.\d s\)\n\s+step 4 T17 \(\d+\.\d s\)/,
      );
      assert.match(output, /PASS\s+T17 takes a workspace or makes its own/);
      if (NodeProcess.getuid?.() === 0) {
        // Root ignores permission bits, so the step that needs them is skipped and T25 passes.
        assert.match(output, /SKIP {4}T25 /);
        assert.include(output, "scenarios: set T-compose 3/4 passed");
      } else {
        assert.match(
          output,
          /FAIL\s+T25 fails while a folder is unwritable \([^)]*\): at stage "fail while the folder is unwritable": T25 fails on purpose while \S+ is unwritable/,
        );
        assert.match(output, /undone: write access to \S+t25-unwritable/);
        assert.include(output, "scenarios: set T-compose 2/4 passed");
      }
    }),
  );

  it.live("gives server-wide and conditioned scenarios a server each", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T-needs")]).done;
      assert.strictEqual(code, 0, output);
      for (const id of ["T23", "T24"]) {
        assert.match(output, new RegExp(`PASS\\s+${id} `));
        assert.match(output, new RegExp(`scenarios: ${id} server pid=\\d+ home=`));
      }
      assert.notMatch(output, /shared server pid=/);
      assert.include(output, "scenarios: set T-needs 2/2 passed");
    }),
  );

  it.live("fails a held output let go too early or never, naming the check", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T27", "T28")]).done;
      assert.strictEqual(code, 1);
      assert.match(
        output,
        /FAIL\s+T27 [^\n]*: at stage "reload while the output is held": the held output of shell \S+ in its raw output once the reload began: expected not printed yet, found printed/,
      );
      assert.match(
        output,
        /FAIL\s+T28 [^\n]*: at stage "reload while the output is held": Timed out after 2 s waiting for the held output during-\w+-s4 after the reload/,
      );
    }),
  );

  it.live(
    "refuses a gate run it cannot time, a name nothing has and a bare sandbox run, before anything starts",
    () =>
      Effect.promise(async () => {
        for (const [args, says] of [
          [["--gate", "--selftest", ...only("T-gate")], QUIET_UNCONFIRMED],
          [
            ["--gate", "--quiet-confirmed", ...only("perf-tree-node")],
            "perf-tree-node is a perf scenario; the gate times check scenarios only",
          ],
          [
            ["--gate", "--quiet-confirmed", "--selftest", ...only("T22")],
            "T22 is a composed scenario; the gate times atomic checks only",
          ],
          [only("no-such-scenario"), "No scenario or set has the name no-such-scenario."],
          [["--sandbox", "4194304"], "name each with --only"],
        ] as const) {
          const { code, output } = await spawnRunner(args).done;
          assert.strictEqual(code, 2, output);
          assert.include(output, says);
          assert.notInclude(output, "web bundle");
        }
      }),
  );

  it.live(
    "fails each timed scenario over a lowered cap, counting only a fresh server's start",
    () =>
      Effect.promise(async () => {
        const { code, output } = await spawnRunner(
          ["--gate", "--quiet-confirmed", "--selftest", ...only("T-gate")],
          { SCENARIO_GATE_CAP_MS: "1" },
        ).done;
        assert.strictEqual(code, 1, output);
        assert.match(output, /scenarios: ready \(1 worker,/);
        assert.include(output, "NOT TIMED T22: composed; its steps are timed alone");
        assert.match(output, /GATE FAIL T16 [\d.]+ s \(server start excluded\), cap 0\.001 s/);
        assert.match(output, /GATE FAIL T1 [\d.]+ s \(server start included\), cap 0\.001 s/);
        assert.include(output, "gate: 2 timed, 2 over the cap");
      }),
  );

  it.live("never judges a normal run against the cap", () =>
    Effect.promise(async () => {
      const { code, output } = await spawnRunner(["--selftest", ...only("T-gate")], {
        SCENARIO_GATE_CAP_MS: "1",
      }).done;
      assert.strictEqual(code, 0, output);
      assert.notMatch(output, /GATE /);
      assert.include(output, "scenarios: set T-gate 3/3 passed");
    }),
  );

  it.live("measures the server's prompt time in the perf run, past a slow startup file", () =>
    Effect.promise(async () => {
      // A slow startup file: the first prompt comes after the 700 ms limit.
      const home = scratch("scenario-slow-home-");
      removedAtEnd(home);
      NodeFS.writeFileSync(NodePath.join(home, ".zshrc"), "sleep 1\n");
      const { code, output } = await spawnRunner(
        ["--perf", "--quiet-confirmed", ...only("perf-prompt-server"), "--own-shell-config"],
        {
          HOME: home,
          ZDOTDIR: "",
          SHELL: "/usr/bin/zsh",
          PLAYWRIGHT_BROWSERS_PATH:
            NodeProcess.env.PLAYWRIGHT_BROWSERS_PATH ??
            NodePath.join(NodeOS.homedir(), ".cache", "ms-playwright"),
        },
      ).done;
      assert.strictEqual(code, 1, output);
      const serverMs = Number(
        /PERF FAIL perf-prompt-server start-to-prompt (\d+) ms, limit 700 ms \(PRB\.E-002 NFR-1\)/.exec(
          output,
        )?.[1],
      );
      assert.isAtLeast(serverMs, 1000);
      assert.notMatch(output, /METRIC/);
    }),
  );

  it.live.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "stops every server, shell host and shell it started on %s",
    (signal) =>
      Effect.promise(async () => {
        const run = spawnRunner(["--selftest", ...only("T35")]);
        const [, shellPid, hostPid] = await run.line(/T35 shell pid=(\d+) host=(\d+)/);
        run.child.kill(signal);
        const { code, output } = await run.done;
        assert.strictEqual(code, 130, output);
        assertStopped(startedServers(output));
        for (const pid of [shellPid, hostPid]) {
          assert.isFalse(alive(Number(pid)), `${pid} survived`);
        }
      }),
  );

  it.live("cleans up after a launcher killed with SIGKILL, by the next run", () =>
    Effect.promise(async () => {
      const run = spawnRunner(["--selftest", ...only("T35")]);
      const [, serverPid, home] = await run.line(/shared server pid=(\d+) home=(\S+)/);
      const [, shellPid, hostPid] = await run.line(/T35 shell pid=(\d+) host=(\d+)/);
      run.child.kill("SIGKILL");
      await run.done;

      const next = await spawnRunner(["--selftest", ...only("T16")]).done;
      assert.strictEqual(next.code, 0, next.output);
      for (const leftover of [serverPid, hostPid, shellPid]) {
        assert.isFalse(alive(Number(leftover)), `${leftover} survived`);
      }
      assert.isFalse(NodeFS.existsSync(home!));
    }),
  );

  it.live(
    "reports a scenario whose worker was killed, runs the next, and sweeps what it left",
    () =>
      Effect.promise(async () => {
        const run = spawnRunner(["--selftest", "--workers", "1", ...only("T35", "T16")]);
        const [, serverPid, home] = await run.line(/shared server pid=(\d+) home=(\S+)/);
        const [, shellPid, hostPid] = await run.line(/T35 shell pid=(\d+) host=(\d+)/);
        // The worker started the shared server; its parent is Playwright, whose parent is this launcher.
        const worker = parentOf(Number(serverPid));
        assert.strictEqual(parentOf(parentOf(worker)), run.child.pid);
        NodeProcess.kill(worker, "SIGKILL");
        const { code, output } = await run.done;
        assert.strictEqual(code, 1, output);
        assert.match(output, /FAIL\s+T35 a shell held running until the run is stopped /);
        assert.match(output, /PASS\s+T16 /);
        assert.include(output, `cleaned up after run ${worker}`);
        for (const leftover of [serverPid, hostPid, shellPid]) {
          assert.isFalse(alive(Number(leftover)), `${leftover} survived`);
        }
        assert.isFalse(NodeFS.existsSync(home!));
      }),
  );

  it.live("passes twice in a row beside a running server and leaves it alone", () =>
    Effect.promise(async () => {
      const home = scratch("scenario-bystander-");
      const bystander = await startServer({ home });
      try {
        for (const _ of [1, 2]) {
          const { code, output } = await spawnRunner(["--selftest", ...only("T16")]).done;
          assert.strictEqual(code, 0, output);
          assert.match(output, /PASS\s+T16 makes a workspace and returns it/);
          assert.include(output, "scenarios: self-test 1 ran, 1 passed, 0 failed");
        }
        assert.isTrue(alive(bystander.pid()));
        assert.isTrue((await fetch(bystander.origin)).ok);
      } finally {
        await bystander.stop();
        NodeFS.rmSync(home, { recursive: true, force: true });
      }
    }),
  );
});

describe("server ports", () => {
  it.live("moves a real server to a newly leased port when another process took its own", () =>
    Effect.promise(async () => {
      const home = scratch("scenario-port-taken-");
      removedAtEnd(home);
      const foreign = NodeNet.createServer((socket) => socket.destroy());
      const children: Array<NodeChildProcess.ChildProcess> = [];
      const notes: Array<string> = [];
      let taken: number | undefined;
      try {
        const { value: origin, lease } = await startOnLeasedPort(
          async (port) => {
            // The foreign listener takes the first leased port before the server binds it.
            if (taken === undefined) {
              taken = port;
              await new Promise<void>((resolve) => foreign.listen(port, "127.0.0.1", resolve));
            }
            const child = NodeChildProcess.spawn(
              "node",
              [
                SERVER_BIN,
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                String(port),
                "--base-dir",
                home,
                "--no-browser",
              ],
              { cwd: REPO_ROOT, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] },
            );
            children.push(child);
            const at = `http://127.0.0.1:${port}`;
            await waitUntilServing(child, at, () => {});
            return at;
          },
          { note: (line) => notes.push(line) },
        );
        try {
          const port = Number(new URL(origin).port);
          assert.notStrictEqual(port, taken);
          assert.deepEqual(notes, [portTakenLine(taken!, port)]);
          assert.isTrue((await fetch(`${origin}/.well-known/t3/environment`)).ok);
        } finally {
          lease.release();
        }
      } finally {
        for (const child of children) child.kill("SIGKILL");
        if (foreign.listening) await new Promise<void>((resolve) => foreign.close(() => resolve()));
      }
    }),
  );

  it.live("starts several servers at once, each on a free port of its own", () =>
    Effect.promise(async () => {
      const { dir, file } = fakeBin(HTTP_ONLY_SERVER);
      removedAtEnd(dir);
      const homes = [1, 2, 3, 4].map(() => scratch("scenario-ports-home-"));
      for (const home of homes) removedAtEnd(home);
      const starts = await Promise.allSettled(
        homes.map((home) => startServer({ home, serverBin: file })),
      );
      const servers = starts.flatMap((start) =>
        start.status === "fulfilled" ? [start.value] : [],
      );
      try {
        assert.deepEqual(
          starts.flatMap((start) => (start.status === "rejected" ? [String(start.reason)] : [])),
          [],
        );
        assert.lengthOf(new Set(servers.map(({ origin }) => origin)), homes.length);
        for (const server of servers) assert.isTrue((await fetch(server.origin)).ok);
      } finally {
        await Promise.all(servers.map((server) => server.kill()));
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
  it.live("is ready when the server answers over HTTP, whatever it prints", () =>
    Effect.promise(async () => {
      const { dir, file } = fakeBin(HTTP_ONLY_SERVER);
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

  it("never hands the server a Probe, Vite or T3 variable or forced colour, and always the harness's git config", () => {
    const env = childEnv(
      {},
      { T3CODE_HOME: "/x", VITE_WS_URL: "ws://x", PROBE_X: "1", FORCE_COLOR: "1", KEEP: "1" },
    );
    assert.notProperty(env, "FORCE_COLOR");
    assert.deepEqual(
      Object.keys(env).filter((key) => /^(T3CODE_|VITE_|PROBE_)/.test(key)),
      [],
    );
    assert.strictEqual(env.KEEP, "1");
    assert.include(env.GIT_CONFIG_GLOBAL ?? "", "scripts/scenarios/gitconfig");
  });
});
