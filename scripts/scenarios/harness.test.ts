// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - Spawns the scenario runner as a real subprocess.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { refusalReason } from "./environment.ts";
import { startServer, REPO_ROOT } from "./server.ts";

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

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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
      assert.match(output, /PASS\s+T1 restart keeps data/);
      assert.match(output, /FAIL\s+T2 deliberate failure: deliberate failure/);
    }),
  );

  it.live("passes twice in a row beside a running server and leaves it alone", () =>
    Effect.promise(async () => {
      const home = scratch("scenario-bystander-");
      const bystander = await startServer({ home });
      try {
        for (const _ of [1, 2]) {
          const { code, output } = await spawnRunner([]).done;
          assert.strictEqual(code, 0);
          assert.include(output, "PASS    S1 boot");
          assert.include(output, "PENDING S8");
          assert.include(output, "1/8 passing, 7 pending, 0 failed");
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
      const run = spawnRunner([]);
      const started = await run.line(/server pid=(\d+) home=(\S+)/);
      const pid = Number(started[1]);
      const home = started[2]!;
      run.child.kill("SIGINT");
      await run.done;
      assert.isFalse(alive(pid));
      assert.isFalse(NodeFS.existsSync(home));
    }),
  );
});
