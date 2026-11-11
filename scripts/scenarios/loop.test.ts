// @effect-diagnostics nodeBuiltinImport:off - Names files under a fixed checkout root.

import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { changedSource, LOOP_QUIET_UNCONFIRMED, parseLoopArgs, planLoop, tally } from "./loop.ts";
import { registryOf } from "./registryRules.ts";
import { defineCheck, definePerf } from "./scenario.ts";

const file = "file:///repo/scripts/scenarios/scenarios/x.ts";
const check = (id: string) => defineCheck(file, { id, title: id, needs: {}, run: async () => {} });
const perf = definePerf("file:///repo/scripts/scenarios/scenarios/x.perf.ts", {
  id: "perf-x",
  title: "x",
  needs: {},
  measure: { name: "x", limitMs: 1, limitFrom: "PRB.T-004 AC-3" },
  run: async () => 0,
});
const registry = registryOf(
  [check("S5.a"), check("S5.b"), perf],
  [{ name: "S5", members: ["S5.a", "S5.b"] }],
);

const parsed = (argv: ReadonlyArray<string>) => {
  const result = parseLoopArgs(argv);
  if ("refusal" in result) throw new Error(result.refusal);
  return result.options;
};
const refusalOf = (argv: ReadonlyArray<string>) => {
  const result = parseLoopArgs(argv);
  return "refusal" in result ? result.refusal : undefined;
};
const planOf = (argv: ReadonlyArray<string>) => {
  const result = planLoop(parsed(argv), registry);
  if ("refusal" in result) throw new Error(result.refusal);
  return result.plan;
};
const planRefusal = (argv: ReadonlyArray<string>) => {
  const result = planLoop(parsed(argv), registry);
  return "refusal" in result ? result.refusal : undefined;
};

describe("parseLoopArgs", () => {
  it("reads N, every --only in order and the confirmation", () => {
    expect(parsed(["--", "3", "--only", "S5", "--only=perf-x", "--quiet-confirmed"])).toEqual({
      runs: 3,
      only: ["S5", "perf-x"],
      quietConfirmed: true,
    });
  });

  it.each([
    [[], "The loop needs N, the number of runs"],
    [["--only", "S5"], "The loop needs N"],
    [["0"], "a whole number of at least 1, not 0"],
    [["2.5"], "not 2.5"],
    [["3", "4"], "4 is a second N"],
    [["3", "--only"], "--only needs a value"],
    [["3", "--repeat-each", "2"], "--repeat-each is not a loop option"],
    [["3", "--retries=1"], "--retries is not a loop option"],
    [["3", "--workers", "2"], "--workers is not a loop option"],
  ])("refuses %j", (argv, reason) => {
    expect(refusalOf(argv)).toContain(reason);
  });
});

describe("planLoop", () => {
  it("runs the whole check suite and the whole perf run with the confirmation", () => {
    expect(planOf(["3", "--quiet-confirmed"])).toEqual({
      check: [],
      perf: ["--perf", "--quiet-confirmed"],
    });
  });

  it("refuses the whole loop without the confirmation, since it includes the perf run", () => {
    expect(planRefusal(["3"])).toBe(
      `${LOOP_QUIET_UNCONFIRMED}, or name what to loop with --only <name>.`,
    );
  });

  it("loops a named check or set without the perf run, and needs no confirmation for it", () => {
    expect(planOf(["3", "--only", "S5", "--only", "S5.a"])).toEqual({
      check: ["--only", "S5", "--only", "S5.a"],
      perf: undefined,
    });
  });

  it("sends a named perf id to the perf run, which needs the confirmation", () => {
    expect(planOf(["3", "--only", "perf-x", "--only", "S5.b", "--quiet-confirmed"])).toEqual({
      check: ["--only", "S5.b"],
      perf: ["--perf", "--quiet-confirmed", "--only", "perf-x"],
    });
    expect(planRefusal(["3", "--only", "perf-x"])).toBe(`perf-x: ${LOOP_QUIET_UNCONFIRMED}.`);
  });

  it("refuses a name that matches nothing", () => {
    expect(planRefusal(["3", "--only", "nope"])).toBe("No scenario or set has the name nope.");
  });
});

describe("tally", () => {
  it("counts each id's failures over the runs it ran in, in first-run order", () => {
    expect(
      tally([
        {
          scenarios: [
            { id: "S5.b", outcome: "passed" },
            { id: "S5.a", outcome: "failed" },
          ],
        },
        {
          scenarios: [
            { id: "S5.a", outcome: "passed" },
            { id: "S5.b", outcome: "passed" },
          ],
        },
        { scenarios: [{ id: "S5.a", outcome: "failed" }] },
      ]),
    ).toEqual([
      { id: "S5.b", failed: 0, ran: 2 },
      { id: "S5.a", failed: 2, ran: 3 },
    ]);
  });
});

describe("changedSource", () => {
  const root = "/repo";
  const at = (mtimeMs: number) => ({ path: NodePath.join(root, "apps/web/src/x.ts"), mtimeMs });

  it("lets the next run start while no source is newer than the loop's start", () => {
    expect(changedSource(root, null, 1000)).toBeUndefined();
    expect(changedSource(root, at(999), 1000)).toBeUndefined();
    expect(changedSource(root, at(1000), 1000)).toBeUndefined();
  });

  it("stops the loop naming the source that changed after it started", () => {
    expect(changedSource(root, at(1001), 1000)).toBe(
      "apps/web/src/x.ts changed since the loop started; every run must see the same code, so the loop stops.",
    );
  });
});
