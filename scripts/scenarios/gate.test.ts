import { describe, expect, it } from "vite-plus/test";

import { gateCapMs, gateTargets, judgeGate, notTimedLine } from "./gate.ts";
import { registryOf } from "./registryRules.ts";
import { defineCheck, defineComposed, definePerf } from "./scenario.ts";

const file = "file:///repo/scripts/scenarios/selftest/gate.ts";
const check = (id: string) => defineCheck(file, { id, title: id, needs: {}, run: async () => {} });
const T16 = check("T16");
const T1 = check("T1");
const T22 = defineComposed(file, { id: "T22", title: "c", steps: [{ scenario: T16 }] });
const perf = definePerf("file:///repo/x.perf.ts", {
  id: "perf-x",
  title: "x",
  needs: {},
  measure: { name: "x", limitMs: 1, limitFrom: "PRB.T-004 AC-3" },
  run: async () => 0,
});
const registry = registryOf(
  [T16, T1, T22, perf],
  [{ name: "T-gate", members: ["T16", "T1", "T22"] }],
);

describe("judgeGate", () => {
  it.each([
    [
      { id: "T16", ms: 19_999, freshServer: false },
      "GATE PASS T16 19.999 s (server start excluded), cap 20 s",
    ],
    [
      { id: "T16", ms: 20_000, freshServer: false },
      "GATE PASS T16 20 s (server start excluded), cap 20 s",
    ],
    [
      { id: "T1", ms: 20_001, freshServer: true },
      "GATE FAIL T1 20.001 s (server start included), cap 20 s",
    ],
    [
      { id: "T1", ms: 3_500, freshServer: true },
      "GATE PASS T1 3.5 s (server start included), cap 20 s",
    ],
  ])("judges %j", (outcome, line) => {
    const fails = line.startsWith("GATE FAIL");
    expect(judgeGate([outcome], 20_000)).toStrictEqual({
      lines: [line, `gate: 1 timed, ${fails ? 1 : 0} over the cap`],
      over: fails ? [outcome.id] : [],
    });
  });

  it("fails every scenario over a lowered cap", () => {
    const { lines, over } = judgeGate(
      [
        { id: "T16", ms: 40, freshServer: false },
        { id: "T1", ms: 900, freshServer: true },
      ],
      1,
    );
    expect(over).toStrictEqual(["T16", "T1"]);
    expect(lines).toStrictEqual([
      "GATE FAIL T16 0.04 s (server start excluded), cap 0.001 s",
      "GATE FAIL T1 0.9 s (server start included), cap 0.001 s",
      "gate: 2 timed, 2 over the cap",
    ]);
  });
});

describe("gateTargets", () => {
  it("times a set's atomic members and lists its composed ones as not timed", () => {
    expect(gateTargets(registry, ["T-gate", "T16"])).toStrictEqual({
      timed: [T16, T1],
      notTimed: [T22],
      refusals: [],
    });
    expect(notTimedLine(T22)).toBe("NOT TIMED T22: composed; its steps are timed alone");
  });

  it("times every atomic check when no name is given", () => {
    expect(gateTargets(registry, [])).toStrictEqual({
      timed: [T16, T1],
      notTimed: [],
      refusals: [],
    });
  });

  // AC-5 and AC-13: perf and composed scenarios named directly are refused, naming why.
  it("refuses perf, composed and unknown names", () => {
    expect(gateTargets(registry, ["perf-x", "T22", "T99"]).refusals).toStrictEqual([
      "perf-x is a perf scenario; the gate times check scenarios only",
      "T22 is a composed scenario; the gate times atomic checks only, so its steps are timed alone",
      "No scenario or set has the name T99.",
    ]);
  });
});

describe("gateCapMs", () => {
  it.each([
    [{}, 20_000],
    [{ SCENARIO_GATE_CAP_MS: "1" }, 1],
    [{ SCENARIO_GATE_CAP_MS: "soon" }, 20_000],
  ])("reads %j as %d ms", (env, ms) => {
    expect(gateCapMs(env)).toBe(ms);
  });
});
