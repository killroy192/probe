import { describe, expect, it } from "vite-plus/test";

import {
  composedNeeds,
  freshServerNeeded,
  perfVerdict,
  type Registry,
  registryOf,
  requirementIds,
  resolveName,
  ticketReference,
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
  measure: { name: "tree node", limitMs: 1000 },
  run: async () => 1,
});

const productUrl = (name: string) => `file:///repo/scripts/scenarios/scenarios/${name}`;
const productPath = (name: string) => `/repo/scripts/scenarios/scenarios/${name}`;
const SHELLS_DOC = [
  "# Shells",
  "",
  "## Requirements",
  "",
  "| ID | Requirement |",
  "| --- | --- |",
  "| FR-1 | A shell starts. |",
  "| FR-2 | A shell ends. |",
  "| NFR-1 | A shell starts within 1 s. |",
  "",
  "## Related",
  "",
  "| FR-3 | Outside the Requirements table. |",
].join("\n");
const DOCS = [{ name: "shells.md", text: SHELLS_DOC }];
const productCheck = (verifies?: ReadonlyArray<string>) =>
  defineCheck(productUrl("shell.ts"), {
    id: "shell.starts",
    title: "a shell starts",
    needs: {},
    ...(verifies && { verifies }),
    run: async () => {},
  });
const productPerf = (verifies?: ReadonlyArray<string>) =>
  definePerf(productUrl("start.perf.ts"), {
    id: "perf-start",
    title: "shell start",
    needs: {},
    measure: { name: "start", limitMs: 1000 },
    ...(verifies && { verifies }),
    run: async () => 1,
  });
const productComposed = (verifies?: ReadonlyArray<string>) =>
  defineComposed(productUrl("composed.ts"), {
    id: "composed.start-then-end",
    title: "start then end",
    steps: [{ scenario: productCheck(["shells/FR-1"]) }],
    ...(verifies && { verifies }),
  });
// Built from parts, so this file holds no reference the harness ban refuses.
const cite = (prefix: string, n: number) => `${prefix}-${n}`;

const sources: Record<string, string> = {
  [path("t16.ts")]: CLEAN,
  [path("t17.ts")]: CLEAN,
  [path("shell.ts")]: CLEAN,
  [path("t1.ts")]: CLEAN,
  [path("tree.perf.ts")]: PERF_SOURCE,
  [path("composed.ts")]: CLEAN,
};

const full = (registry: Partial<Registry>): Registry => ({
  checks: [],
  composed: [],
  perfScenarios: [],
  sets: [],
  ...registry,
});

/** Validates `registry` as self-tests, the kind every fixture above is. */
const validate = (registry: Partial<Registry>, extra: Record<string, string> = {}) => {
  const entries = full(registry);
  return validateRegistry(entries, {
    readSource: (file) => extra[file] ?? sources[file] ?? "",
    docs: DOCS,
    selftests: [...entries.checks, ...entries.composed, ...entries.perfScenarios],
  });
};

/** Validates `registry` as product scenarios, against `DOCS`. */
const validateProduct = (
  registry: Partial<Registry>,
  files: Record<string, string> = {},
  harnessFiles: ReadonlyArray<string> = [],
) =>
  validateRegistry(full(registry), {
    readSource: (file) => files[file] ?? (file.endsWith(".perf.ts") ? PERF_SOURCE : CLEAN),
    docs: DOCS,
    harnessFiles,
  });

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

  // A check that records a duration and a perf scenario that asserts are rejected.
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

  it("rejects a perf scenario without exactly one measure with a limit", () => {
    const unlimited = { ...perf, measure: { ...perf.measure, limitMs: 0 } };
    expect(validate({ perfScenarios: [unlimited] })[0]?.reason).toContain("limit 0 ms");
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

  // A set naming an unknown or perf id, or sharing a scenario's id.
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

  // A handover of the wrong kind is rejected, naming the step and the input.
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

  // A set holding a restart member and a composed scenario with a restart step.
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
    [1000, true, "PERF PASS perf-start start 1000 ms, limit 1000 ms (shells/NFR-1)"],
    [1000.6, false, "PERF FAIL perf-start start 1001 ms, limit 1000 ms (shells/NFR-1)"],
  ])("judges %d ms against the limit its NFR states", (ms, pass, line) => {
    expect(perfVerdict(productPerf(["shells/NFR-1"]), ms)).toStrictEqual({ pass, line });
  });

  it("names no source for a self-test's limit", () => {
    expect(perfVerdict(perf, 1).line).toBe(
      "PERF PASS perf-tree-node tree node 1 ms, limit 1000 ms",
    );
  });
});

describe("verifies", () => {
  it("reads only the ids in a doc's Requirements table", () => {
    expect(requirementIds(SHELLS_DOC)).toStrictEqual(["FR-1", "FR-2", "NFR-1"]);
  });

  it("accepts product checks, composed and perf scenarios that verify known requirements", () => {
    expect(
      validateProduct({
        checks: [productCheck(["shells/FR-1", "shells/FR-2"])],
        composed: [productComposed(["shells/FR-2"])],
        perfScenarios: [productPerf(["shells/NFR-1"])],
      }),
    ).toStrictEqual([]);
  });

  it.each<[string, Partial<Registry>, string]>([
    ["a check with none", { checks: [productCheck()] }, "it is a check scenario with no verifies"],
    [
      "a check with an empty list",
      { checks: [productCheck([])] },
      "it is a check scenario with no verifies",
    ],
    [
      "a composed scenario with none",
      { composed: [productComposed()] },
      "it is a composed scenario with no verifies",
    ],
    [
      "a ref of the wrong shape",
      { checks: [productCheck(["shells-FR-1"])] },
      'its verifies ref "shells-FR-1" is not "<slug>/FR-<n>" or "<slug>/NFR-<n>"',
    ],
    [
      "a ref with no number",
      { checks: [productCheck(["shells/FR-"])] },
      'its verifies ref "shells/FR-" is not',
    ],
    [
      "a ref to an unknown file",
      { checks: [productCheck(["tabs/FR-1"])] },
      'its verifies ref "tabs/FR-1" names docs/scenarios/tabs.md, which does not exist',
    ],
    [
      "a ref to an unknown id",
      { checks: [productCheck(["shells/FR-9"])] },
      'its verifies ref "shells/FR-9" names FR-9, which the Requirements table of docs/scenarios/shells.md does not hold',
    ],
    [
      "a ref to an id outside the Requirements table",
      { checks: [productCheck(["shells/FR-3"])] },
      "names FR-3, which the Requirements table",
    ],
    [
      "a perf scenario with none",
      { perfScenarios: [productPerf()] },
      "it is a perf scenario with no verifies",
    ],
    [
      "a perf scenario that verifies an FR",
      { perfScenarios: [productPerf(["shells/FR-1"])] },
      "a perf scenario verifies exactly one NFR, the requirement that states its limit; it verifies shells/FR-1",
    ],
    [
      "a perf scenario that verifies two requirements",
      { perfScenarios: [productPerf(["shells/NFR-1", "shells/FR-1"])] },
      "a perf scenario verifies exactly one NFR",
    ],
  ])("rejects %s", (_, registry, reason) => {
    const rejections = validateProduct(registry);
    expect(rejections).toStrictEqual([
      { name: expect.any(String), reason: expect.stringContaining(reason) },
    ]);
  });

  it("rejects a self-test that declares verifies", () => {
    const declared = defineCheck(url("t16.ts"), {
      id: "T16",
      title: "returns a workspace",
      needs: {},
      verifies: ["shells/FR-1"],
      run: async () => {},
    });
    expect(validate({ checks: [declared] })).toStrictEqual([
      { name: "T16", reason: "it is a self-test: it verifies the harness and carries no verifies" },
    ]);
  });
});

describe("the ban on ticket references", () => {
  const check = productCheck(["shells/FR-1"]);
  const file = productPath("shell.ts");

  it.each([
    [`// ${cite("AC", 3)}: a shell starts.`, cite("AC", 3)],
    [`covers: ["S7 ${cite("AC", 6)}"],`, cite("AC", 6)],
    [`/* ${cite("EC", 1)} */`, cite("EC", 1)],
    [`// keeps the session (${cite("SA", 3)})`, cite("SA", 3)],
    [`const why = "${cite("PRB.T", 39)} split it";`, cite("PRB.T", 39)],
    [`// ${cite("PRB.E", 1)}`, cite("PRB.E", 1)],
  ])("rejects a product scenario file holding %s", (code, found) => {
    expect(validateProduct({ checks: [check] }, { [file]: code })).toStrictEqual([
      {
        name: file,
        reason: `the product scenario file cites a ticket or acceptance criterion (${found}); scenario code cites docs/scenarios requirements, and only a ticket maps its criteria to scenario ids`,
      },
    ]);
  });

  it("rejects a harness file holding one, and leaves a self-test's file to the harness scan", () => {
    const harness = path("lib.ts");
    const files = { [harness]: `// see ${cite("AC", 4)}`, [path("t16.ts")]: `// ${cite("AC", 5)}` };
    expect(validateProduct({ checks: [check] }, files, [harness])).toStrictEqual([
      {
        name: harness,
        reason: expect.stringContaining(
          `the harness file cites a ticket or acceptance criterion (${cite("AC", 4)})`,
        ),
      },
    ]);
    expect(validate({ checks: [T16] }, files)).toStrictEqual([]);
  });

  it.each(["shells/NFR-1", "T-041a.after-restart", "E2-S1.list-offered", "MAC-3"])(
    "finds none in %s",
    (text) => {
      expect(ticketReference(text)).toBeUndefined();
    },
  );
});
