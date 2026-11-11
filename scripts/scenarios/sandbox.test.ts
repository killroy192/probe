// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off globalDate:off - Spawns sandboxes and scenario runs as real subprocesses.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { WorkspaceProject } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { launchBrowser } from "./browser.ts";
import {
  findSandbox,
  killServerTree,
  lockSandbox,
  type ManifestEntry,
  processStartTime,
  RUNS_DIR,
  sandboxLogFile,
} from "./cleanup.ts";
import { parseSandboxArgs, strayArgs } from "./environment.ts";
import {
  pickedSelftestScenarios,
  scenarios,
  selftestScenarios,
  storyScenarios,
} from "./registry.ts";
import { withClient } from "./lib/api.ts";
import { issueBearerToken } from "./lib/seam.ts";
import { alive, gone } from "./lib/waits.ts";
import { pickScenario, sandboxRefusal, staleSandboxFile } from "./sandboxRules.ts";
import { attachServer, REPO_ROOT } from "./server.ts";
import { type Spawned, spawnScript } from "./spawned.ts";

const here = (file: string) => NodeURL.fileURLToPath(new URL(file, import.meta.url));
const sandboxBin = here("./sandbox.ts");
const runnerBin = here("./run.ts");
const scratch = (label: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), label));
const registered = [
  ...scenarios,
  ...storyScenarios,
  ...selftestScenarios,
  ...pickedSelftestScenarios,
];

describe("sandbox rules", () => {
  it("refuses every stated need and an unstated one, and accepts only scenarios that need nothing", () => {
    const base = { id: "X", title: "x" };
    assert.isUndefined(sandboxRefusal({ ...base, needs: {} }));
    assert.include(sandboxRefusal(base) ?? "", "does not state its needs");
    for (const [needs, reason] of [
      [{ restart: true }, "restarts the server"],
      [{ secondServer: true }, "starts a second server"],
      [{ pristineHome: true }, "needs an empty home"],
      [{ unshared: "it matches every process" }, "it matches every process); PRB.T-039"],
    ] as const) {
      assert.include(sandboxRefusal({ ...base, needs }) ?? "", reason);
    }
    assert.deepStrictEqual(
      registered.filter((scenario) => sandboxRefusal(scenario) === undefined).map(({ id }) => id),
      ["S4", "S5", "T-041b", "T-041c", "T2", "T5", "T6", "T8", "T9"],
    );
    assert.deepStrictEqual(
      registered.filter(({ needs }) => needs === undefined).map(({ id }) => id),
      [],
    );
  });

  it("runs saved scenarios only, by id", () => {
    assert.deepStrictEqual(pickScenario("S5", registered), {
      scenario: registered.find(({ id }) => id === "S5")!,
    });
    for (const [id, says] of [
      ["./probe-check.ts", "is a path to a script"],
      ["/tmp/x.mjs", "is a path to a script"],
      ["S99", "No scenario has the id S99"],
    ] as const) {
      const picked = pickScenario(id, registered);
      const refusal = "refusal" in picked ? picked.refusal : "";
      assert.include(refusal, says);
      assert.include(refusal, "the sandbox runs saved scenarios only");
      assert.include(refusal, `"Registering a scenario" in .agents/rules/scenarios.md`);
    }
    assert.deepStrictEqual(strayArgs(["--sandbox", "12", "--only", "S5", "./x.ts"]), ["./x.ts"]);
  });

  it("parses the sandbox's options and names one it does not take", () => {
    assert.deepStrictEqual(parseSandboxArgs(["--fixture", "shells", "--keep-home"]), {
      fixture: "shells",
      keepHome: true,
      rebuild: false,
      serverBin: undefined,
    });
    assert.throws(() => parseSandboxArgs(["./script.ts"]), /is not a sandbox option/);
    assert.throws(() => parseSandboxArgs(["--fixture"]), /needs a value/);
  });

  it("finds a sandbox only by its own live, loopback, throwaway record", () => {
    const dir = scratch("scenario-records-");
    const fakeHome = NodePath.join(dir, "user");
    const me = { pid: process.pid, startTime: processStartTime(process.pid)! };
    const record = {
      origin: "http://127.0.0.1:4100",
      home: NodePath.join(NodeOS.tmpdir(), "probe-scenario-x"),
      serverPid: 1,
      logFile: NodePath.join(dir, "x.log"),
      startedMs: 0,
      bundleBuiltMs: null,
    };
    const save = (runner: object, sandbox?: object) =>
      NodeFS.writeFileSync(
        NodePath.join(dir, `${process.pid}.json`),
        JSON.stringify({ runner, entries: [], ...(sandbox ? { sandbox } : {}) }),
      );
    const refusal = () => {
      const found = findSandbox(process.pid, dir, fakeHome);
      return "refusal" in found ? found.refusal : "";
    };
    try {
      assert.include(refusal(), "No sandbox this harness started");
      save(me);
      assert.include(refusal(), "a scenario run, not a sandbox");
      save({ ...me, startTime: "not this process" }, record);
      assert.include(refusal(), "no longer running");
      save(me, { ...record, origin: "http://10.0.0.5:4100" });
      assert.include(refusal(), "only run on loopback");
      save(me, { ...record, home: NodePath.join(fakeHome, ".t3", "userdata") });
      assert.include(refusal(), "only use a throwaway home");
      save(me, record);
      assert.deepStrictEqual(findSandbox(process.pid, dir, fakeHome), { sandbox: record });
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets one run at a time hold a sandbox, and takes over a killed run's lock", () => {
    const dir = scratch("scenario-locks-");
    try {
      const first = lockSandbox(7, dir);
      assert.isTrue("release" in first);
      const second = lockSandbox(7, dir);
      assert.include("refusal" in second ? second.refusal : "", "One scenario runs at a time");
      if ("release" in first) first.release();
      const third = lockSandbox(7, dir);
      assert.isTrue("release" in third);
      if ("release" in third) third.release();
      NodeFS.writeFileSync(
        NodePath.join(dir, "7.lock"),
        JSON.stringify({ pid: process.pid, startTime: "a killed run" }),
      );
      assert.isTrue("release" in lockSandbox(7, dir));
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names a source or harness file newer than the sandbox, and a bundle rebuilt since", () => {
    const root = scratch("scenario-tree-");
    const file = (path: string, content = "") => {
      const full = NodePath.join(root, path);
      NodeFS.mkdirSync(NodePath.dirname(full), { recursive: true });
      NodeFS.writeFileSync(full, content);
      return full;
    };
    const manifest = (name: string, deps: object = {}, dev: object = {}) =>
      JSON.stringify({ name, dependencies: deps, devDependencies: dev });
    const files = [
      file("apps/web/package.json", manifest("web", { shared: "workspace:*" })),
      file("apps/web/src/main.ts"),
      file("apps/web/dist/index.html"),
      file("apps/server/package.json", manifest("server", {}, { contracts: "workspace:*" })),
      file("apps/server/src/bin.ts"),
      file("packages/shared/package.json", manifest("shared")),
      file("packages/shared/src/a.ts"),
      file("packages/contracts/package.json", manifest("contracts")),
      file("packages/contracts/src/rpc.ts"),
      file("scripts/scenarios/server.ts"),
      file("scripts/scenarios/scenarios/close-tab.ts"),
    ];
    const past = new Date(1_700_000_000_000);
    const later = new Date(past.getTime() + 30_000);
    const reset = () => {
      for (const path of files) NodeFS.utimesSync(path, past, past);
    };
    const touch = (path: string, at = later) =>
      NodeFS.utimesSync(NodePath.join(root, path), at, at);
    try {
      reset();
      const sandbox = {
        origin: "http://127.0.0.1:1",
        home: root,
        serverPid: 1,
        logFile: "",
        startedMs: past.getTime() + 15_000,
        bundleBuiltMs: past.getTime(),
      };
      assert.isNull(staleSandboxFile(root, sandbox));
      // A scenario file is loaded by each run, never by the sandbox.
      touch("scripts/scenarios/scenarios/close-tab.ts");
      assert.isNull(staleSandboxFile(root, sandbox));
      for (const changed of [
        "apps/web/src/main.ts",
        "apps/server/src/bin.ts",
        "packages/shared/src/a.ts",
        "packages/contracts/src/rpc.ts",
        "scripts/scenarios/server.ts",
      ]) {
        reset();
        touch(changed);
        assert.strictEqual(staleSandboxFile(root, sandbox), changed);
      }
      reset();
      touch("apps/web/dist/index.html", new Date(sandbox.startedMs - 1_000));
      assert.include(staleSandboxFile(root, sandbox) ?? "", "the bundle was rebuilt");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

interface Sandbox {
  readonly pid: number;
  /** The `sandbox: key=value` lines printed up to `ready`. */
  readonly facts: Readonly<Record<string, string>>;
  readonly spawned: Spawned;
  readonly stop: () => Promise<{ readonly code: number | null; readonly output: string }>;
}

const factsOf = (output: string) =>
  Object.fromEntries(
    [...output.matchAll(/^sandbox: ([\w-]+)=(.*)$/gm)].map(([, key, value]) => [key!, value!]),
  );

async function startSandbox(args: ReadonlyArray<string> = [], env: NodeJS.ProcessEnv = {}) {
  const spawned = spawnScript(sandboxBin, args, env);
  await Promise.race([
    spawned.line(/^sandbox: ready=.*$/m),
    spawned.done.then(({ output }) => {
      throw new Error(`The sandbox exited before it was ready:\n${output}`);
    }),
  ]);
  const pid = spawned.child.pid!;
  const sandbox: Sandbox = {
    pid,
    facts: factsOf(spawned.output()),
    spawned,
    stop: async () => {
      if (spawned.child.exitCode === null && spawned.child.signalCode === null) {
        process.kill(pid, "SIGTERM");
      }
      return spawned.done;
    },
  };
  return sandbox;
}

const onSandbox = (sandbox: Sandbox, id: string, extra: ReadonlyArray<string> = []) =>
  spawnScript(runnerBin, ["--sandbox", String(sandbox.pid), "--only", id, ...extra]);

/** The sandbox server's workspaces (with their projects) and shells, read over its API. */
async function apiState(sandbox: Sandbox) {
  const handle = attachServer(
    {
      home: sandbox.facts.home!,
      origin: sandbox.facts.origin!,
      serverPid: Number(sandbox.facts["server-pid"]),
      logFile: sandboxLogFile(sandbox.pid),
    },
    (need) => new Error(`The test tried ${need}.`),
  );
  return withClient(handle.origin, await issueBearerToken(handle), (client) =>
    Effect.gen(function* () {
      const head = <A, E>(stream: Stream.Stream<A, E>) =>
        Stream.runHead(stream).pipe(Effect.map(Option.getOrUndefined));
      const names = ((yield* head(client.subscribeWorkspaces({})))?.workspaces ?? [])
        .map(({ name }) => name)
        .toSorted();
      const projects: Record<string, ReadonlyArray<WorkspaceProject>> = {};
      for (const name of names)
        projects[name] = (yield* client["workspace.open"]({ name })).projects;
      const shellEvent = yield* head(client.subscribeShells({}));
      const shells = shellEvent?.type === "snapshot" ? shellEvent.shells : [];
      return { workspaces: names, projects, shells };
    }),
  );
}

/** Every process below `pid`, read from the kernel's child lists (Linux). */
function descendants(pid: number): ReadonlyArray<number> {
  const found: Array<number> = [];
  const visit = (parent: number) => {
    let tasks: ReadonlyArray<string> = [];
    try {
      tasks = NodeFS.readdirSync(`/proc/${parent}/task`);
    } catch {
      return;
    }
    for (const task of tasks) {
      let children = "";
      try {
        children = NodeFS.readFileSync(`/proc/${parent}/task/${task}/children`, "utf8");
      } catch {
        continue;
      }
      for (const child of children.trim().split(/\s+/).filter(Boolean).map(Number)) {
        found.push(child);
        visit(child);
      }
    }
  };
  visit(pid);
  return found;
}

/** Every address listening on `port`, from the kernel's socket tables (Linux). */
function listeners(port: number): ReadonlyArray<string> {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const found: Array<string> = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of NodeFS.readFileSync(table, "utf8").split("\n").slice(1)) {
      const [, local, , state] = line.trim().split(/\s+/);
      if (state === "0A" && local?.endsWith(`:${hexPort}`)) found.push(local.split(":")[0]!);
    }
  }
  return found;
}

// The child lists and socket tables these checks read exist only where procfs does (Linux).
const linux = NodeFS.existsSync("/proc/self/task");

describe("sandbox", () => {
  it.live(
    "starts on a throwaway home, prints what to use it with, seeds a fixture and stops by its pid",
    () =>
      Effect.promise(async () => {
        const ambient = {
          T3CODE_AMBIENT_PROBE: "ambient",
          VITE_HTTP_URL: "http://ambient.example",
          PROBE_AMBIENT: "ambient",
        };
        const sandbox = await startSandbox(["--fixture", "shells"], ambient);
        let kept: Sandbox | undefined;
        try {
          const output = sandbox.spawned.output();
          const { facts } = sandbox;
          assert.match(output, new RegExp(`^sandbox: pid=${sandbox.pid}\n`));
          for (const key of ["origin", "home", "server-pid", "bundle", "pairing-url", "fixture"]) {
            assert.property(facts, key);
          }
          assert.notMatch(output, /\u001b\[/);
          const origin = new URL(facts.origin!);
          assert.strictEqual(origin.hostname, "127.0.0.1");
          assert.isTrue(facts.home!.startsWith(NodeOS.tmpdir()));
          assert.match(facts.bundle!, /^apps\/web\/dist built \d{4}-/);
          assert.isTrue((await fetch(facts.origin!)).ok);
          assert.isNull(sandbox.spawned.child.exitCode);
          const serverPid = Number(facts["server-pid"]);

          // The shells fixture starts the shell host, so its pid is printed before `ready`.
          const shellHostPid = Number(facts["shell-host-pid"]);
          assert.isTrue(alive(shellHostPid));
          const state = await apiState(sandbox);
          const [, workspace, project] = /workspace=(\S+) project=(\S+) shells=2/.exec(
            facts.fixture!,
          )!;
          assert.deepStrictEqual(state.workspaces, [workspace]);
          assert.deepStrictEqual(
            state.projects[workspace!]!.map(({ path, isGitRepository }) => ({
              path,
              isGitRepository,
            })),
            [{ path: project, isGitRepository: true }],
          );
          assert.deepStrictEqual(
            state.shells.map(({ cwd, status }) => ({ cwd, status })),
            [
              { cwd: project, status: "running" },
              { cwd: project, status: "running" },
            ],
          );

          // Listening on loopback only, by the address the server was told and, where procfs
          // exists, by the socket table; the env check needs procfs, and `childEnv`'s unit test
          // in harness.test.ts covers it everywhere.
          const argv = NodeChildProcess.execFileSync(
            "ps",
            ["-o", "command=", "-p", String(serverPid)],
            {
              encoding: "utf8",
            },
          );
          assert.include(argv, "--host 127.0.0.1");
          if (linux) {
            const environ = NodeFS.readFileSync(`/proc/${serverPid}/environ`, "utf8").split("\0");
            for (const key of Object.keys(ambient)) {
              assert.isFalse(
                environ.some((entry) => entry.startsWith(`${key}=`)),
                key,
              );
            }
            assert.deepStrictEqual(listeners(Number(origin.port)), ["0100007F"]);
          }
          const token = new URLSearchParams(new URL(facts["pairing-url"]!).hash.slice(1)).get(
            "token",
          )!;
          const grep = NodeChildProcess.spawnSync("git", [
            "grep",
            "-q",
            "--untracked",
            "-F",
            token,
          ]);
          assert.strictEqual(grep.status, 1, "a checkout file holds the pairing URL");

          const browser = await launchBrowser(undefined);
          try {
            const page = await (await browser.newContext()).newPage();
            await page.goto(facts["pairing-url"]!);
            await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
            await page.getByTestId("workspace-screen").waitFor();
          } finally {
            await browser.close();
          }

          kept = await startSandbox(["--keep-home", "--fixture", "shells"]);
          const ended = [serverPid, shellHostPid, ...state.shells.map(({ pid }) => pid!)];
          assert.strictEqual((await sandbox.stop()).code, 0);
          for (const pid of ended) assert.isTrue(await gone(pid), `${pid} survived the stop`);
          assert.isFalse(NodeFS.existsSync(facts.home!));
          assert.isFalse(NodeFS.existsSync(NodePath.join(RUNS_DIR, `${sandbox.pid}.json`)));
          assert.isFalse(NodeFS.existsSync(sandboxLogFile(sandbox.pid)));
          // A stale pid: nothing runs under it any more, and the other sandbox is untouched.
          assert.throws(() => process.kill(sandbox.pid, "SIGTERM"), /ESRCH/);
          assert.isTrue((await fetch(kept.facts.origin!)).ok);

          const keptPids = [
            Number(kept.facts["server-pid"]),
            Number(kept.facts["shell-host-pid"]),
            ...(await apiState(kept)).shells.map(({ pid }) => pid!),
          ];
          assert.lengthOf(keptPids, 4);
          assert.strictEqual((await kept.stop()).code, 0);
          for (const pid of keptPids) assert.isTrue(await gone(pid), `${pid} survived the stop`);
          assert.isTrue(NodeFS.existsSync(NodePath.join(kept.facts.home!, "userdata")));
        } finally {
          await sandbox.stop();
          await kept?.stop();
          if (kept) NodeFS.rmSync(kept.facts.home!, { recursive: true, force: true });
        }
      }),
  );

  it.live(
    "refuses a bad start, and on a live sandbox anything but a saved scenario that needs nothing",
    () =>
      Effect.promise(async () => {
        const unknown = await spawnScript(sandboxBin, ["--fixture", "nope"]).done;
        assert.strictEqual(unknown.code, 2);
        assert.include(unknown.output, "the fixtures are workspace, shells");
        assert.notInclude(unknown.output, "sandbox: home=");

        for (const [args, says] of [
          [["--fixture", "selftest-fails"], ["the self-test fixture fails"]],
          [
            ["--server-bin", NodePath.join(NodeOS.tmpdir(), "scenario-missing", "bin.ts")],
            // The reason, then the tail of what the server printed.
            ["Probe server could not start", "Cannot find module"],
          ],
        ] as const) {
          const { code, output } = await spawnScript(sandboxBin, args).done;
          assert.strictEqual(code, 1, output);
          for (const said of says) assert.include(output, said);
          const facts = factsOf(output);
          assert.isFalse(NodeFS.existsSync(facts.home!), "the home was left");
          assert.isFalse(NodeFS.existsSync(NodePath.join(RUNS_DIR, `${facts.pid}.json`)));
          if (facts["server-pid"]) assert.isTrue(await gone(Number(facts["server-pid"])));
        }

        const fakeHome = scratch("scenario-fake-home-");
        try {
          const asUser = { HOME: fakeHome, USERPROFILE: fakeHome };
          for (const [args, env] of [
            [[], { ...asUser, T3CODE_HOME: NodePath.join(fakeHome, ".t3") }],
            [["--base-dir", NodePath.join(fakeHome, ".t3")], asUser],
          ] as const) {
            const { code, output } = await spawnScript(sandboxBin, args, env).done;
            assert.strictEqual(code, 2);
            assert.include(output, "real Probe data");
            assert.notInclude(output, "sandbox: home=");
          }
        } finally {
          NodeFS.rmSync(fakeHome, { recursive: true, force: true });
        }

        const sandbox = await startSandbox();
        try {
          const before = await apiState(sandbox);
          for (const [id, says] of [
            ["S7", "restarts the server"],
            ["R1", "starts a second server"],
            ["S1", "needs an empty home"],
            ["S6", "PRB.T-039"],
            ["T1", "restarts the server"],
            ["T3", "starts a second server"],
            ["T4", "restarts the server"],
            ["./probe-check.ts", "is a path to a script"],
            ["S99", "No scenario has the id S99"],
          ] as const) {
            const { code, output } = await onSandbox(sandbox, id).done;
            assert.strictEqual(code, 2, output);
            assert.include(output, says);
            assert.notInclude(output, "scenarios: ready");
          }
          for (const [args, says] of [
            [
              ["--sandbox", String(sandbox.pid), "--only", "S5", "./probe-check.ts"],
              "the sandbox runs saved scenarios only",
            ],
            [
              ["--sandbox", String(sandbox.pid), "--only", "S5", "--server", "http://127.0.0.1:1"],
              "only run against a server they start themselves",
            ],
            [
              ["--sandbox", String(sandbox.pid), "--only", "S5", "--rebuild"],
              "start a new sandbox",
            ],
            // A live process that is no sandbox, as a dev server would be.
            [["--sandbox", String(process.pid), "--only", "S5"], "No sandbox this harness started"],
            [["--sandbox", "http://127.0.0.1:1", "--only", "S5"], "takes the sandbox pid"],
          ] as const) {
            const { code, output } = await spawnScript(runnerBin, args).done;
            assert.notStrictEqual(code, 0, output);
            assert.include(output, says);
            assert.notInclude(output, "scenarios: ready");
          }
          // A bundle rebuilt since the start, shown by its time alone; the time is put back.
          const index = NodePath.join(REPO_ROOT, "apps", "web", "dist", "index.html");
          const built = NodeFS.statSync(index);
          NodeFS.utimesSync(index, built.atimeMs / 1000, built.mtimeMs / 1000 + 1);
          try {
            const { code, output } = await onSandbox(sandbox, "S5").done;
            assert.strictEqual(code, 2, output);
            assert.include(
              output,
              `apps/web/dist/index.html (the bundle was rebuilt since the sandbox started) changed since sandbox ${sandbox.pid} started, so it would run older code; start a new sandbox.`,
            );
            assert.notInclude(output, "scenarios: ready");
          } finally {
            NodeFS.utimesSync(index, built.atimeMs / 1000, built.mtimeMs / 1000);
          }
          const after = await apiState(sandbox);
          assert.deepStrictEqual(after.workspaces, before.workspaces);
          assert.isTrue(alive(Number(sandbox.facts["server-pid"])));
        } finally {
          await sandbox.stop();
        }
        const { code, output } = await onSandbox(sandbox, "S5").done;
        assert.strictEqual(code, 2);
        assert.include(output, "No sandbox this harness started");
      }),
  );

  it.live(
    "runs saved scenarios one after another on one server, and only on the sandbox it names",
    () =>
      Effect.promise(async () => {
        const sandbox = await startSandbox(["--fixture", "shells"]);
        const other = await startSandbox(["--fixture", "workspace"]);
        try {
          const serverPid = sandbox.facts["server-pid"];
          const otherBefore = await apiState(other);
          const [seeded] = otherBefore.workspaces;
          assert.match(seeded ?? "", /^fixture-[0-9a-f]{6}$/);
          assert.deepStrictEqual(otherBefore.workspaces, [seeded]);
          assert.deepStrictEqual(
            otherBefore.projects[seeded!]!.map(({ isGitRepository }) => isGitRepository),
            [true],
          );
          assert.isEmpty(otherBefore.shells);
          for (const id of ["S5", "S4"]) {
            const { code, output } = await onSandbox(sandbox, id).done;
            assert.strictEqual(code, 0, output);
            assert.match(
              output,
              new RegExp(`PASS\\s+${id} .* \\(\\d+\\.\\d s, teardown \\d+ ms\\)`),
            );
            assert.include(output, `on sandbox ${sandbox.pid} (server pid=${serverPid} `);
            assert.notInclude(output, `${id} server pid=`);
          }
          assert.strictEqual(factsOf(sandbox.spawned.output())["server-pid"], serverPid);
          assert.isTrue(alive(Number(serverPid)));
          assert.isNull(sandbox.spawned.child.exitCode);
          assert.deepStrictEqual((await apiState(other)).workspaces, otherBefore.workspaces);
        } finally {
          await sandbox.stop();
          await other.stop();
        }
      }),
  );

  it.live(
    "reports a failure on the sandbox from its first run, then runs on; refuses what a run did not state",
    () =>
      Effect.promise(async () => {
        const sandbox = await startSandbox(["--fixture", "shells"]);
        try {
          const serverPid = Number(sandbox.facts["server-pid"]);
          const shellHostPid = Number(sandbox.facts["shell-host-pid"]);
          const first = await onSandbox(sandbox, "S5").done;
          assert.strictEqual(first.code, 0, first.output);

          const failed = await onSandbox(sandbox, "T2").done;
          assert.strictEqual(failed.code, 1);
          assert.match(
            failed.output,
            /FAIL\s+T2 deliberate failure .*at stage "read the page title": expected "a title no page has", found "[^"]*"/,
          );
          const [, dir, saved] = /artifacts: (\S+) \(([^)]*)\)/.exec(failed.output)!;
          assert.isFalse(dir!.startsWith(sandbox.facts.home!));
          assert.deepStrictEqual(saved!.split(", "), [
            "error.txt",
            "page-1.png",
            "sandbox-server-log-tail.txt",
            "recorders.json",
          ]);
          assert.isNotEmpty(
            NodeFS.readFileSync(NodePath.join(dir!, "sandbox-server-log-tail.txt"), "utf8"),
          );
          NodeFS.rmSync(dir!, { recursive: true, force: true });

          // The second S5 run on this server: its names and folders never meet the first one's.
          const next = await onSandbox(sandbox, "S5").done;
          assert.strictEqual(next.code, 0, next.output);
          const names = (await apiState(sandbox)).workspaces.filter((name) =>
            name.startsWith("sparta-"),
          );
          assert.strictEqual(new Set(names).size, 2);

          const unstated = await onSandbox(sandbox, "T5").done;
          assert.strictEqual(unstated.code, 1);
          for (const need of [
            "stopping the shell host",
            "a second server",
            "a restart",
            "a server stop",
          ]) {
            assert.include(
              unstated.output,
              `T5 tried ${need} on the sandbox, a need it did not state.`,
            );
          }
          assert.isTrue(alive(serverPid));
          assert.isTrue(alive(shellHostPid));
          assert.strictEqual(
            factsOf(sandbox.spawned.output())["shell-host-pid"],
            String(shellHostPid),
          );
        } finally {
          await sandbox.stop();
        }
      }),
  );

  it.live(
    "reruns a changed scenario on one sandbox without meeting its earlier run's names or folders",
    () =>
      Effect.promise(async () => {
        const sandbox = await startSandbox();
        try {
          const made: Array<{ workspace: string; folder: string; note: string }> = [];
          // The note stands for a change to the scenario between the two runs.
          for (const note of ["before the change", "after the change"]) {
            const { code, output } = await spawnScript(
              runnerBin,
              ["--sandbox", String(sandbox.pid), "--only", "T6"],
              { SCENARIO_T6_NOTE: note },
            ).done;
            assert.strictEqual(code, 0, output);
            const [, workspace, folder] = /T6 made workspace=(\S+) folder=(\S+)/.exec(output)!;
            made.push({ workspace: workspace!, folder: folder!, note });
          }
          const [first, second] = made as [(typeof made)[number], (typeof made)[number]];
          assert.notStrictEqual(first.workspace, second.workspace);
          assert.notStrictEqual(first.folder, second.folder);
          for (const { folder, note } of made) {
            assert.strictEqual(NodeFS.readFileSync(NodePath.join(folder, "note"), "utf8"), note);
          }
          assert.deepStrictEqual(
            (await apiState(sandbox)).workspaces,
            made.map(({ workspace }) => workspace).toSorted(),
          );
        } finally {
          await sandbox.stop();
        }
      }),
  );

  it.live(
    "runs one scenario at a time, outlives a killed run, and fails a run whose sandbox ends",
    () =>
      Effect.promise(async () => {
        const sandbox = await startSandbox();
        let frozen = false;
        try {
          const killed = onSandbox(sandbox, "S4");
          await killed.line(/scenarios: ready/);
          const busy = await onSandbox(sandbox, "S5").done;
          assert.strictEqual(busy.code, 2);
          assert.include(busy.output, "One scenario runs at a time on a sandbox");

          const browserPids = linux ? descendants(killed.child.pid!) : [];
          if (linux) assert.isNotEmpty(browserPids);
          killed.child.kill("SIGKILL");
          await killed.done;
          for (const pid of browserPids)
            assert.isTrue(await gone(pid), `browser process ${pid} survived`);
          assert.isTrue((await fetch(sandbox.facts.origin!)).ok);

          // The killed run's lock is taken over; the sandbox ends under the next run. Frozen
          // inside its stop's steps, its server and home are gone while its record stays.
          const orphaned = onSandbox(sandbox, "S4");
          await orphaned.line(/scenarios: ready/);
          process.kill(sandbox.pid, "SIGSTOP");
          frozen = true;
          const { entries } = JSON.parse(
            NodeFS.readFileSync(NodePath.join(RUNS_DIR, `${sandbox.pid}.json`), "utf8"),
          ) as { readonly entries: ReadonlyArray<ManifestEntry> };
          killServerTree(entries[0]!);
          const { code, output } = await orphaned.done;
          assert.strictEqual(code, 1);
          assert.include(
            output,
            `The sandbox ${sandbox.pid} ended during the run; no server is started in its place.`,
          );
          assert.notInclude(output, "S4 server pid=");
          assert.match(output, /artifacts: \S+/);
        } finally {
          if (frozen) process.kill(sandbox.pid, "SIGCONT");
          await sandbox.stop();
        }
      }),
  );

  it.live("leaves a live sandbox to other cleanups and cleans one killed with SIGKILL", () =>
    Effect.promise(async () => {
      const live = await startSandbox();
      const pidsOf = async (sandbox: Sandbox) => [
        Number(sandbox.facts["server-pid"]),
        Number(sandbox.facts["shell-host-pid"]),
        ...(await apiState(sandbox)).shells.map(({ pid }) => pid!),
      ];
      let next: Sandbox | undefined;
      try {
        for (const cleaner of ["suite", "sandbox"] as const) {
          const killed = await startSandbox(["--fixture", "shells"]);
          const left = await pidsOf(killed);
          killed.spawned.child.kill("SIGKILL");
          await killed.spawned.done;
          for (const pid of left) assert.isTrue(alive(pid), `${pid} should be left`);

          let output: string;
          if (cleaner === "suite") {
            // A suite start with an id it does not know cleans up first and then stops.
            output = (await spawnScript(runnerBin, ["--only", "S99"]).done).output;
          } else {
            next = await startSandbox();
            output = next.spawned.output();
          }
          assert.include(output, `cleaned up after run ${killed.pid}`);
          for (const pid of left)
            assert.isTrue(await gone(pid), `${pid} survived the ${cleaner} start`);
          assert.isFalse(NodeFS.existsSync(killed.facts.home!));
          assert.isFalse(NodeFS.existsSync(sandboxLogFile(killed.pid)));
          assert.isTrue((await fetch(live.facts.origin!)).ok);
          assert.isTrue("sandbox" in findSandbox(live.pid));
        }
      } finally {
        await live.stop();
        await next?.stop();
      }
    }),
  );
});
