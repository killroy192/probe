import { describe, expect, it } from "vite-plus/test";

import {
  composedNeeds,
  freshServerNeeded,
  perfVerdict,
  type Registry,
  registryOf,
  resolveName,
  validateRegistry,
} from "./registryRules.ts";
import { sandboxRefusals } from "./sandboxRules.ts";
import {
  defineCheck,
  defineComposed,
  definePerf,
  type ScenarioNeeds,
  type ScenarioSet,
  type ServerCondition,
} from "./scenario.ts";

const url = (name: string) => `file:///repo/scripts/scenarios/selftest/${name}`;
const path = (name: string) => `/repo/scripts/scenarios/selftest/${name}`;

const CLEAN = "export const x = defineCheck(import.meta.url, { run: async () => {} });";
const PERF_SOURCE = "export const p = definePerf(import.meta.url, { measure: { name: 'm' } });";

const T16 = defineCheck(url("t16.ts"), {
  id: "T16",
  title: "returns a workspace",
  needs: {},
  returns: "workspace",
  run: async () => ({ kind: "workspace", name: "w" }),
});
const T17 = defineCheck(url("t17.ts"), {
  id: "T17",
  title: "takes a workspace",
  needs: {},
  takes: "workspace",
  run: async () => {},
});
const shellMaker = defineCheck(url("shell.ts"), {
  id: "T30",
  title: "returns a shell",
  needs: {},
  returns: "shell",
  run: async () => ({
    kind: "shell",
    shellId: "s",
    pid: null,
    cwd: "/",
    workspace: "w",
    project: "/",
  }),
});
const T1 = defineCheck(url("t1.ts"), {
  id: "T1",
  title: "restarts",
  needs: { restart: true },
  run: async () => {},
});
const perf = definePerf(url("tree.perf.ts"), {
  id: "perf-tree-node",
  title: "tree node",
  needs: {},
  measure: { name: "tree node", limitMs: 1000, limitFrom: "PRB.T-004 AC-3" },
  run: async () => 1,
});

const sources: Record<string, string> = {
  [path("t16.ts")]: CLEAN,
  [path("t17.ts")]: CLEAN,
  [path("shell.ts")]: CLEAN,
  [path("t1.ts")]: CLEAN,
  [path("tree.perf.ts")]: PERF_SOURCE,
  [path("composed.ts")]: CLEAN,
};

const validate = (registry: Partial<Registry>, extra: Record<string, string> = {}) =>
  validateRegistry(
    { checks: [], composed: [], perfScenarios: [], sets: [], ...registry },
    (file) => extra[file] ?? sources[file] ?? "",
  );

describe("registry rules", () => {
  it("accepts a registry of every kind that follows the rules", () => {
    const composed = defineComposed(url("composed.ts"), {
      id: "T22",
      title: "hands workspaces on",
      steps: [
        { scenario: T16 },
        { scenario: T17, given: { from: 1 } },
        { scenario: T16 },
        { scenario: T17, given: { from: 3 } },
      ],
    });
    expect(
      validate({
        checks: [T16, T17, T1],
        composed: [composed],
        perfScenarios: [perf],
        sets: [{ name: "T-gate", members: ["T16", "T1", "T22"] }],
      }),
    ).toStrictEqual([]);
  });

  // AC-3: a check that records a duration and a perf scenario that asserts are rejected.
  it.each([
    ["Date.now()", "reads the clock (Date.now)"],
    ["const t = new Date();", "reads the clock (new Date()"],
    ["performance.now()", "reads the clock (performance.now)"],
    ["NodeProcess.hrtime.bigint()", "reads the clock (NodeProcess.hrtime)"],
    ["const spec = { measure: { name: 'x' } };", "declares a measure"],
  ])("rejects a check scenario whose file holds %s", (code, reason) => {
    const [rejection, ...rest] = validate({ checks: [T16] }, { [path("t16.ts")]: code });
    expect(rest).toStrictEqual([]);
    expect(rejection?.name).toBe("T16");
    expect(rejection?.reason).toContain(reason);
  });

  it("ignores a clock read in a comment", () => {
    expect(
      validate(
        { checks: [T16] },
        { [path("t16.ts")]: "// Date.now() is for perf\n/* new Date( */" },
      ),
    ).toStrictEqual([]);
  });

  it.each([
    ["check(ok, 'x');", "asserts (check()"],
    ["expected({ what, expected: 1, found });", "asserts (expected()"],
    ["assert.equal(1, 1);", "asserts (assert)"],
    ["expect(1).toBe(1);", "asserts (expect()"],
  ])("rejects a perf scenario whose file holds %s", (code, reason) => {
    const [rejection] = validate(
      { perfScenarios: [perf] },
      { [path("tree.perf.ts")]: `${PERF_SOURCE}\n${code}` },
    );
    expect(rejection?.name).toBe("perf-tree-node");
    expect(rejection?.reason).toContain(reason);
  });

  it("rejects a perf scenario without exactly one measure with a limit and its owner", () => {
    const unowned = { ...perf, measure: { ...perf.measure, limitFrom: "" } };
    expect(validate({ perfScenarios: [unowned] })[0]?.reason).toContain('from ""');
    const twice = validate(
      { perfScenarios: [perf] },
      { [path("tree.perf.ts")]: `${PERF_SOURCE}\n${PERF_SOURCE}` },
    );
    expect(twice[0]?.reason).toContain("its file declares 2");
  });

  it("rejects a file name that does not match its kind", () => {
    const misplaced = { ...T16, file: path("t16.perf.ts") };
    const unsuffixed = { ...perf, file: path("t16.ts") };
    const reasons = validate(
      { checks: [misplaced], perfScenarios: [unsuffixed] },
      { [path("t16.perf.ts")]: CLEAN, [path("t16.ts")]: PERF_SOURCE },
    ).map(({ name, reason }) => `${name}: ${reason}`);
    expect(reasons).toStrictEqual([
      expect.stringContaining("T16: it is a check scenario in a .perf.ts file"),
      expect.stringContaining(
        "perf-tree-node: it is a perf scenario, so its file must end in .perf.ts",
      ),
    ]);
  });

  // AC-5 (set side) and AC-9.
  it.each<[string, ScenarioSet, string]>([
    ["names an unknown id", { name: "S", members: ["T99"] }, "names T99, which is not registered"],
    ["names a perf id", { name: "S", members: ["perf-tree-node"] }, "a perf scenario"],
    ["has a scenario's id", { name: "T16", members: ["T17"] }, "has the name of a scenario id"],
  ])("rejects a set that %s", (_, set, reason) => {
    const rejections = validate({ checks: [T16, T17], perfScenarios: [perf], sets: [set] });
    expect(rejections).toStrictEqual([{ name: set.name, reason: expect.stringContaining(reason) }]);
  });

  it("rejects nested sets and duplicate ids", () => {
    const rejections = validate({
      checks: [T16, T16],
      sets: [
        { name: "A", members: ["T16"] },
        { name: "B", members: ["A"] },
      ],
    });
    expect(rejections).toStrictEqual([
      { name: "T16", reason: "the name is registered 2 times" },
      { name: "B", reason: "the set names the set A; sets do not nest" },
    ]);
  });

  // AC-8: a handover of the wrong kind is rejected, naming the step and the input.
  it.each([
    [
      "a step that takes a workspace given a shell",
      [{ scenario: shellMaker }, { scenario: T17, given: { from: 1 } }],
      "T21 step 2 (T17) takes a workspace; step 1 (T30) returns a shell",
    ],
    [
      "a step that takes nothing given a value",
      [{ scenario: T16 }, { scenario: T1, given: { from: 1 } }],
      "T21 step 2 (T1) takes nothing; step 1 (T16) returns a workspace",
    ],
    [
      "a given from a later step",
      [{ scenario: T17, given: { from: 2 } }, { scenario: T16 }],
      "T21 step 1 (T17) takes its input from step 2, which is not an earlier step",
    ],
    [
      "a step that is not atomic",
      [{ scenario: perf as unknown as typeof T16 }],
      "T21 step 1 (perf-tree-node) is not an atomic check scenario",
    ],
  ])("rejects a composed scenario with %s", (_, steps, reason) => {
    const composed = defineComposed(url("composed.ts"), { id: "T21", title: "c", steps });
    expect(validate({ composed: [composed] })).toStrictEqual([{ name: "T21", reason }]);
  });

  it("rejects composed steps that need different conditions", () => {
    const condition = (why: string): ServerCondition => ({ why, env: () => ({}) });
    const under = (id: string, c: ServerCondition) =>
      defineCheck(url("t16.ts"), { id, title: id, needs: { condition: c }, run: async () => {} });
    const shared = condition("one");
    const same = defineComposed(url("composed.ts"), {
      id: "T40",
      title: "c",
      steps: [{ scenario: under("A", shared) }, { scenario: under("B", shared) }],
    });
    const different = defineComposed(url("composed.ts"), {
      id: "T41",
      title: "c",
      steps: [{ scenario: under("A", shared) }, { scenario: under("C", condition("two")) }],
    });
    expect(validate({ composed: [same, different] })).toStrictEqual([
      {
        name: "T41",
        reason: expect.stringContaining("steps 1 (A) and 2 (C) need different conditions"),
      },
    ]);
  });
});

describe("resolveName", () => {
  const composed = defineComposed(url("composed.ts"), {
    id: "T26",
    title: "c",
    steps: [{ scenario: T16 }, { scenario: T1 }],
  });
  const registry = registryOf(
    [T16, T1, composed, perf],
    [{ name: "T-restart-set", members: ["T16", "T1", "T26"] }],
  );

  it("resolves each kind of name", () => {
    expect(resolveName(registry, "T16")).toStrictEqual({ kind: "check", scenario: T16 });
    expect(resolveName(registry, "T26")).toStrictEqual({ kind: "composed", scenario: composed });
    expect(resolveName(registry, "T-restart-set")).toMatchObject({
      kind: "set",
      members: [T16, T1, composed],
    });
  });

  it.each([
    [
      "perf-tree-node",
      "perf-tree-node is a perf scenario; perf scenarios run only in the serial perf run",
    ],
    ["T99", "No scenario or set has the name T99."],
    ["selftest/t16.ts", "selftest/t16.ts is a path to a script"],
  ])("refuses %s", (name, refusal) => {
    expect(resolveName(registry, name)).toMatchObject({
      refusal: expect.stringContaining(refusal),
    });
  });
});

describe("needs", () => {
  const condition: ServerCondition = { why: "unset seed", env: () => ({ X: undefined }) };

  it.each<[ScenarioNeeds, boolean]>([
    [{}, false],
    [{ secondServer: true }, false],
    [{ restart: true }, true],
    [{ pristineHome: true }, true],
    [{ serverWide: "kills its server" }, true],
    [{ condition }, true],
    [{ unshared: "not converted" }, true],
  ])("freshServerNeeded(%j) is %s", (needs, fresh) => {
    expect(freshServerNeeded(needs)).toBe(fresh);
  });

  it("unites a composed scenario's step needs", () => {
    const wide = defineCheck(url("t1.ts"), {
      id: "W",
      title: "w",
      needs: { serverWide: "kills its server", condition },
      run: async () => {},
    });
    const composed = defineComposed(url("composed.ts"), {
      id: "T26",
      title: "c",
      steps: [{ scenario: T16 }, { scenario: T1 }, { scenario: wide }],
    });
    expect(composedNeeds(composed)).toStrictEqual({
      restart: true,
      serverWide: "kills its server",
      condition,
    });
  });

  // AC-10's refusal half: a set holding a restart member and a composed scenario with a restart step.
  it("refuses on a sandbox every member and step that needs its own server", () => {
    const secondServer = defineCheck(url("t1.ts"), {
      id: "R",
      title: "r",
      needs: { secondServer: true },
      run: async () => {},
    });
    const conditioned = defineCheck(url("t1.ts"), {
      id: "T24",
      title: "c",
      needs: { condition },
      run: async () => {},
    });
    const composed = defineComposed(url("composed.ts"), {
      id: "T26",
      title: "c",
      steps: [{ scenario: T16 }, { scenario: T1 }],
    });
    expect(sandboxRefusals([T16, T17])).toStrictEqual([]);
    expect(sandboxRefusals([T16, T1, secondServer, conditioned, composed])).toStrictEqual([
      "T1 cannot run on a sandbox: it restarts the server, which every run on the sandbox shares.",
      "R cannot run on a sandbox: it starts a second server, and a sandbox has one.",
      "T24 cannot run on a sandbox: its server starts under a condition (unset seed), and the sandbox's did not.",
      "T26 step 2 (T1) cannot run on a sandbox: it restarts the server, which every run on the sandbox shares.",
    ]);
  });
});

describe("perfVerdict", () => {
  it.each([
    [1000, true, "PERF PASS perf-tree-node tree node 1000 ms, limit 1000 ms (PRB.T-004 AC-3)"],
    [1000.6, false, "PERF FAIL perf-tree-node tree node 1001 ms, limit 1000 ms (PRB.T-004 AC-3)"],
  ])("judges %d ms", (ms, pass, line) => {
    expect(perfVerdict(perf, ms)).toStrictEqual({ pass, line });
  });
});
