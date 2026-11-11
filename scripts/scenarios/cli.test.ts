// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Builds run plans for a fixed start time and the host temp folder.

import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { type LaunchOptions, parseLaunchArgs, planRun, type Registries } from "./cli.ts";
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
  measure: { name: "x", limitMs: 1, limitFrom: "PRB.T-004 AC-3" },
  run: async () => 0,
});
const T1 = check("T1");
const T2 = check("T2");
const T16 = check("T16");

const registries: Registries = {
  suite: registryOf(
    [shared, restarts, pristine, pair, perf],
    [{ name: "S1", members: ["S1.a", "composed.pair"] }],
  ),
  selftest: registryOf([T1, T2, T16], [{ name: "T-gate", members: ["T16", "T1"] }]),
  defaultSelftests: [T1],
};

const launcher = { pid: 4242, startTime: "77" };
const startedAt = new Date("2026-11-11T10:00:00.000Z");
const context = (env: Record<string, string | undefined> = {}, cores = 10) => ({
  launcher,
  startedAt,
  cores,
  env,
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
const plan = (argv: ReadonlyArray<string>, env = {}, cores = 10) => {
  const planned = planRun(options(argv, cores), registries, context(env, cores));
  if ("refusal" in planned) throw new Error(planned.refusal);
  return planned.plan;
};
const planRefusal = (argv: ReadonlyArray<string>) => {
  const planned = planRun(options(argv), registries, context());
  return "refusal" in planned ? planned.refusal : undefined;
};

describe("parseLaunchArgs", () => {
  it("collects every --only in order and reads switches and values", () => {
    expect(
      options([
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
    [["--quiet-confirmed"], "--quiet-confirmed confirms a cap gate run; add --gate"],
    [["--gate", "--workers", "2"], "--workers does not apply to the cap gate"],
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

  it("runs only the default self-tests with --selftest, and picks from all self-tests", () => {
    expect(plan(["--selftest"])).toMatchObject({ mode: "selftest", ids: ["T1"] });
    expect(plan(["--selftest", "--only", "T2"]).ids).toEqual(["T2"]);
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
