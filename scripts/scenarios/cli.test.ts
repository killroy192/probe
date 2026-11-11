// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Builds run plans for a fixed start time and the host temp folder.

import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  type LaunchOptions,
  parseLaunchArgs,
  PERF_QUIET_UNCONFIRMED,
  type PlanContext,
  planRun,
  rebuildRefusal,
  type Registries,
} from "./cli.ts";
import type { SandboxRecord } from "./cleanup.ts";
import { defaultWorkers, refusalReason } from "./environment.ts";
import { QUIET_UNCONFIRMED } from "./gate.ts";
import { registryOf } from "./registryRules.ts";
import { defineCheck, defineComposed, definePerf } from "./scenario.ts";

const file = "file:///repo/scripts/scenarios/scenarios/x.ts";
const check = (id: string, needs = {}) =>
  defineCheck(file, { id, title: `title ${id}`, needs, run: async () => {} });
const shared = check("S1.a");
const restarts = check("S7.restart", { restart: true });
const pristine = check("S2.empty", { pristineHome: true });
const pair = defineComposed(file, {
  id: "composed.pair",
  title: "pair",
  steps: [{ scenario: shared }, { scenario: restarts }],
});
const perf = definePerf("file:///repo/scripts/scenarios/scenarios/x.perf.ts", {
  id: "perf-x",
  title: "x",
  needs: {},
  measure: { name: "x", limitMs: 1 },
  verifies: ["shells/NFR-1"],
  run: async () => 0,
});
const T1 = check("T1");
const T2 = check("T2");
const T16 = check("T16");
const perfWithin = definePerf("file:///repo/scripts/scenarios/selftest/within.perf.ts", {
  id: "T30",
  title: "within",
  needs: {},
  measure: { name: "x", limitMs: 1 },
  run: async () => 0,
});

const suiteScenarios = [shared, restarts, pristine, pair, perf];
const suiteSets = [{ name: "S1", members: ["S1.a", "composed.pair"] }];
const selftestSets = [{ name: "T-gate", members: ["T16", "T1"] }];
const registries: Registries = {
  suite: registryOf(suiteScenarios, suiteSets),
  selftest: registryOf([T1, T2, T16, perfWithin], selftestSets),
  defaultSelftests: [T1],
  sandbox: registryOf([...suiteScenarios, T1, T2, T16], [...suiteSets, ...selftestSets]),
};

const record: SandboxRecord = {
  origin: "http://127.0.0.1:20001",
  home: "/tmp/probe-scenario-abc",
  serverPid: 900,
  logFile: "/tmp/probe-scenario-runs/800.log",
  startedMs: 1,
  bundleBuiltMs: 2,
};

const launcher = { pid: 4242, startTime: "77" };
const startedAt = new Date("2026-11-11T10:00:00.000Z");
const context = (
  env: Record<string, string | undefined> = {},
  cores = 10,
  sandbox: Partial<Pick<PlanContext, "findSandbox" | "staleSandboxFile">> = {},
): PlanContext => ({
  launcher,
  startedAt,
  cores,
  env,
  findSandbox: (pid) =>
    pid === 800
      ? { sandbox: record }
      : { refusal: `No sandbox this harness started has the pid ${pid}.` },
  staleSandboxFile: () => null,
  ...sandbox,
});

const options = (argv: ReadonlyArray<string>, cores = 10): LaunchOptions => {
  const parsed = parseLaunchArgs(argv, cores);
  if ("refusal" in parsed) throw new Error(parsed.refusal);
  return parsed.options;
};
const refusalOf = (argv: ReadonlyArray<string>, cores = 10) => {
  const parsed = parseLaunchArgs(argv, cores);
  return "refusal" in parsed ? parsed.refusal : undefined;
};
const plansOf = (argv: ReadonlyArray<string>, env = {}, cores = 10) => {
  const planned = planRun(options(argv, cores), registries, context(env, cores));
  if ("refusal" in planned) throw new Error(planned.refusal);
  return planned.plans;
};
const plan = (argv: ReadonlyArray<string>, env = {}, cores = 10) => {
  const plans = plansOf(argv, env, cores);
  expect(plans).toHaveLength(1);
  return plans[0]!;
};
const planRefusal = (argv: ReadonlyArray<string>, ctx = context()) => {
  const planned = planRun(options(argv), registries, ctx);
  return "refusal" in planned ? planned.refusal : undefined;
};

describe("parseLaunchArgs", () => {
  it("collects every --only in order and reads switches and values", () => {
    expect(
      options([
        "--",
        "--only",
        "S1",
        "--only=S7.restart",
        "--selftest",
        "--workers",
        "3",
        "--browser",
        "/b/chrome",
        "--own-shell-config",
      ]),
    ).toMatchObject({
      only: ["S1", "S7.restart"],
      selftest: true,
      workers: 3,
      browser: "/b/chrome",
      ownShellConfig: true,
      gate: false,
      list: false,
    });
  });

  it.each([
    ["--retries", ["--retries", "2"]],
    ["--retries", ["--retries=2"]],
    ["--retry", ["--retry"]],
    ["--repeat-each", ["--only", "S1", "--repeat-each", "3"]],
    ["--repeat", ["--repeat", "3"]],
  ])("refuses %s, naming the N-run loop in the rules file", (flag, argv) => {
    const refusal = refusalOf(argv);
    expect(refusal).toContain(flag);
    expect(refusal).toContain("N-run loop in .agents/rules/scenarios.md");
  });

  it.each([
    [["--grep", "S1"], "--grep is not a scenario runner option"],
    [["-x"], "-x is not a scenario runner option"],
    [["--workers", "--selftest"], "--workers needs a value"],
    [["--browser", "a", "--browser", "b"], "--browser is given twice"],
    [["scripts/scenarios/scenarios/boot.ts"], "is a path to a script"],
    [["S1"], "S1 is not an option; name a scenario or set with --only S1"],
    [
      ["--quiet-confirmed"],
      "--quiet-confirmed confirms a cap gate or perf run; add --gate or --perf",
    ],
    [["--gate", "--workers", "2"], "--workers does not apply to the cap gate"],
    [["--perf", "--workers", "2"], "--workers does not apply to the perf run"],
    [["--perf", "--gate"], "--gate and --perf are separate runs"],
    [["--perf", "--selftest"], "perf self-tests run with --selftest"],
    [["--sandbox", "0", "--only", "S1"], "--sandbox takes the sandbox pid it printed, not 0"],
    [["--sandbox", "800"], "--sandbox runs saved scenarios; name each with --only <name>"],
    [["--sandbox", "800", "--only", "S1", "--gate"], "--gate does not run on a sandbox"],
    [["--sandbox", "800", "--only", "S1", "--perf"], "--perf does not run on a sandbox"],
    [
      ["--sandbox", "800", "--only", "S1", "--workers", "2"],
      "--workers does not apply to a sandbox",
    ],
    [
      ["--sandbox", "800", "--only", "S1", "--rebuild"],
      "--rebuild does not apply to a sandbox; start a new sandbox instead",
    ],
    [
      ["--sandbox", "800", "--only", "S1", "--server-bin", "x"],
      "--server-bin does not apply to a sandbox",
    ],
    [
      ["--sandbox", "800", "--only", "S1", "--own-shell-config"],
      "--own-shell-config does not apply to a sandbox",
    ],
    [["--sandbox", "800", "--only", "T1", "--selftest"], "--selftest does not apply to a sandbox"],
  ])("refuses %j", (argv, reason) => {
    expect(refusalOf(argv)).toContain(reason);
  });

  it.each([["0"], ["11"], ["2.5"], ["four"]])(
    "refuses --workers %s on a 10-core machine",
    (value) => {
      expect(refusalOf(["--workers", value])).toBe(
        `--workers takes a whole number from 1 to 10, this machine's core count, not ${value}.`,
      );
    },
  );

  it("takes --workers up to the core count", () => {
    expect(options(["--workers", "10"]).workers).toBe(10);
  });
});

describe("defaultWorkers", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [6, 3],
    [8, 4],
    [10, 4],
    [64, 4],
  ])("on %i cores is %i", (cores, workers) => {
    expect(defaultWorkers(cores)).toBe(workers);
  });
});

describe("the guard on every documented command", () => {
  const home = "/home/dev";
  const commands = [
    [],
    ["--only", "S1.a"],
    ["--only", "S1"],
    ["--selftest"],
    ["--selftest", "--only", "T-gate"],
    ["--gate", "--quiet-confirmed"],
    ["--perf", "--quiet-confirmed"],
    ["--sandbox", "800", "--only", "S1.a"],
    ["--workers", "2"],
  ];
  it.each(commands)("refuses real data and server addresses for %j", (...argv) => {
    expect(refusalReason(argv, { T3CODE_HOME: `${home}/.t3` }, home)).toContain(
      "T3CODE_HOME points at your real Probe data",
    );
    expect(refusalReason(argv, { T3CODE_BASE_DIR: `${home}/.t3/x` }, home)).toContain(
      "T3CODE_BASE_DIR points at your real Probe data",
    );
    expect(refusalReason([...argv, "--home-dir", `${home}/.t3/userdata`], {}, home)).toContain(
      "--home-dir points at your real Probe data",
    );
    expect(refusalReason([...argv, "--server-url=http://127.0.0.1:3773"], {}, home)).toContain(
      "only run against a server they start themselves",
    );
    expect(refusalReason(argv, {}, home)).toBeUndefined();
  });
});

describe("planRun", () => {
  it("runs every check and composed scenario by default, fresh-server ones first", () => {
    const planned = plan([]);
    expect(planned.ids).toEqual(["S7.restart", "S2.empty", "composed.pair", "S1.a"]);
    expect(planned).toMatchObject({
      mode: "suite",
      workers: 4,
      launcher,
      artifactsRoot: NodePath.join(
        NodeOS.tmpdir(),
        "probe-scenario-artifacts",
        "2026-11-11T10-00-00-000Z-4242",
      ),
    });
    expect(planned.reporter).toEqual({
      mode: "suite",
      sets: registries.suite.sets,
      namedSets: [],
      resultsPath: NodePath.join(planned.artifactsRoot, "results.json"),
    });
  });

  it("takes the asked worker count and an artifacts folder", () => {
    expect(plan(["--workers", "2", "--artifacts", "/tmp/a"])).toMatchObject({
      workers: 2,
      artifactsRoot: "/tmp/a",
      reporter: { resultsPath: "/tmp/a/results.json" },
    });
  });

  it("expands a set into its members and names the set for the reporter", () => {
    const planned = plan(["--only", "S1", "--only", "S1.a"]);
    expect(planned.ids).toEqual(["composed.pair", "S1.a"]);
    expect(planned.reporter.namedSets).toEqual(["S1"]);
  });

  it("runs the default self-tests, then the perf self-tests on one worker in their own folder", () => {
    const [checksRun, perfRun] = plansOf(["--selftest"]);
    expect(checksRun).toMatchObject({ mode: "selftest", ids: ["T1"], workers: 4 });
    expect(perfRun).toMatchObject({
      mode: "selftest",
      ids: ["T30"],
      workers: 1,
      artifactsRoot: NodePath.join(checksRun!.artifactsRoot, "perf"),
      reporter: { resultsPath: NodePath.join(checksRun!.artifactsRoot, "perf", "results.json") },
    });
  });

  it("picks from all self-tests with --only, a perf self-test in a run of its own", () => {
    expect(plan(["--selftest", "--only", "T2"]).ids).toEqual(["T2"]);
    expect(plan(["--selftest", "--only", "T30"])).toMatchObject({ ids: ["T30"], workers: 1 });
    expect(plansOf(["--selftest", "--only", "T30", "--only", "T2"]).map(({ ids }) => ids)).toEqual([
      ["T2"],
      ["T30"],
    ]);
    expect(planRefusal(["--only", "T2"])).toBe("No scenario or set has the name T2.");
  });

  it.each([
    [
      ["--only", "perf-x"],
      "perf-x is a perf scenario; perf scenarios run only in the serial perf run",
    ],
    [["--only", "nope"], "No scenario or set has the name nope."],
  ])("refuses %j", (argv, refusal) => {
    expect(planRefusal(argv)).toContain(refusal);
  });

  it("runs every perf scenario on one worker in the perf run, and only with the confirmation", () => {
    expect(plan(["--perf", "--quiet-confirmed"])).toMatchObject({
      mode: "perf",
      ids: ["perf-x"],
      workers: 1,
      reporter: { mode: "perf" },
    });
    expect(plan(["--perf", "--quiet-confirmed", "--only", "perf-x"]).ids).toEqual(["perf-x"]);
    expect(planRefusal(["--perf"])).toBe(PERF_QUIET_UNCONFIRMED);
  });

  it.each([
    [
      ["--only", "S1.a"],
      "S1.a is a check scenario; it runs in the check suite (vp run test:scenarios -- --only S1.a)",
    ],
    [["--only", "composed.pair"], "composed.pair is a check scenario"],
    [["--only", "S1"], "S1 is a set; perf scenarios are never set members"],
    [["--only", "nope"], "No scenario or set has the name nope."],
  ])("the perf run refuses %j", (only, refusal) => {
    expect(planRefusal(["--perf", "--quiet-confirmed", ...only])).toContain(refusal);
  });

  it("runs saved checks, sets and self-tests on a sandbox, on one worker with its record", () => {
    const planned = plan(["--sandbox", "800", "--only", "T-gate", "--only", "S1.a"]);
    expect(planned).toMatchObject({
      mode: "sandbox",
      ids: ["T16", "T1", "S1.a"],
      workers: 1,
      sandbox: { pid: 800, record },
      reporter: { mode: "sandbox", sandboxPid: 800, namedSets: ["T-gate"] },
    });
  });

  it.each([
    [["--only", "S7.restart"], "S7.restart cannot run on a sandbox: it restarts the server"],
    [["--only", "composed.pair"], "composed.pair step 2 (S7.restart) cannot run on a sandbox"],
    [["--only", "perf-x"], "perf-x is a perf scenario"],
    [["--only", "scenarios/boot.ts"], "is a path to a script"],
  ])("a sandbox run refuses %j", (only, refusal) => {
    expect(planRefusal(["--sandbox", "800", ...only])).toContain(refusal);
  });

  it("refuses a sandbox that is gone or runs older code than the checkout", () => {
    expect(planRefusal(["--sandbox", "801", "--only", "S1.a"])).toBe(
      "No sandbox this harness started has the pid 801.",
    );
    expect(
      planRefusal(
        ["--sandbox", "800", "--only", "S1.a"],
        context({}, 10, { staleSandboxFile: () => "apps/web/src/main.tsx" }),
      ),
    ).toBe(
      "apps/web/src/main.tsx changed since sandbox 800 started, so it would run older code; start a new sandbox.",
    );
  });

  it("refuses a gate run the user has not confirmed as quiet", () => {
    expect(planRefusal(["--gate"])).toBe(QUIET_UNCONFIRMED);
  });

  it("times a gate's atomic members on one worker, with the cap from the run's env", () => {
    const planned = plan(["--gate", "--quiet-confirmed", "--only", "S1"], {
      SCENARIO_GATE_CAP_MS: "1",
    });
    expect(planned).toMatchObject({ ids: ["S1.a"], workers: 1 });
    expect(planned.reporter).toMatchObject({
      namedSets: ["S1"],
      gate: { capMs: 1, notTimed: ["composed.pair"] },
    });
    expect(plan(["--gate", "--quiet-confirmed"]).reporter.gate?.capMs).toBe(20_000);
  });

  it("refuses a composed or perf scenario named to the gate", () => {
    expect(planRefusal(["--gate", "--quiet-confirmed", "--only", "composed.pair"])).toContain(
      "the gate times atomic checks only",
    );
    expect(planRefusal(["--gate", "--quiet-confirmed", "--only", "perf-x"])).toContain(
      "the gate times check scenarios only",
    );
  });
});

describe("rebuildRefusal", () => {
  it.each([
    { rebuild: false, state: "current", users: [7], refused: false },
    { rebuild: false, state: "stale", users: [], refused: false },
    { rebuild: true, state: "current", users: [], refused: false },
    { rebuild: false, state: "stale", users: [7], refused: true },
    { rebuild: false, state: "missing", users: [7], refused: true },
    { rebuild: true, state: "current", users: [7, 8], refused: true },
  ] as const)(
    "rebuild $rebuild, bundle $state, other runs $users: refused $refused",
    ({ rebuild, state, users, refused }) => {
      const refusal = rebuildRefusal(rebuild, { state }, users);
      expect(refusal !== undefined).toBe(refused);
      if (refused)
        expect(refusal).toContain(`run ${users.join(", ")} in this checkout still serves it`);
    },
  );
});
