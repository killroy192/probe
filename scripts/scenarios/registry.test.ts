// @effect-diagnostics nodeBuiltinImport:off - Reads each check's source for the registry rules.

import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { checks, composed, OLD_IDS, perfScenarios, sets } from "./registry.ts";
import { type Registry, resolveName, validateRegistry } from "./registryRules.ts";
import { sandboxRefusals } from "./sandboxRules.ts";

interface OldScenario {
  readonly id: string;
  /** Each as `covers` names it: `"<id> <criterion>"`. */
  readonly criteria: ReadonlyArray<string>;
  /** Already atomic: it keeps its id and becomes no set. */
  readonly kept?: true;
}

const old = (id: string, criteria: ReadonlyArray<string>, kept?: true): OldScenario => ({
  id,
  criteria: criteria.map((criterion) => `${id} ${criterion}`),
  ...(kept && { kept }),
});

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `AC-${from + index}`);

// Every criterion and stage of the long scenarios at `ebb9d3287`. A criterion with a qualifier
// after its AC is one that its successors split between them.
const INVENTORY: ReadonlyArray<OldScenario> = [
  old("S1", [
    ...range(1, 10),
    "AC-11 with a workspace shown",
    "AC-11 with none shown",
    ...range(12, 17),
    "AC-20",
  ]),
  old("S2", [
    ...range(1, 14),
    "AC-14b",
    ...range(15, 17),
    "AC-17 git init",
    ...range(18, 21),
    ...range(23, 25),
  ]),
  old("S3", [...range(1, 19), ...range(22, 30)]),
  old("S4", [...range(1, 5), "AC-11", "AC-15", "AC-26", "AC-28", "AC-31", "AC-32", "EC-3"]),
  old("S5", range(3, 6)),
  old("S6", [...range(7, 18), "AC-20", "AC-28", "remove project"]),
  old("S7", [
    ...range(6, 10),
    ...range(12, 14),
    "AC-16",
    "AC-17",
    "AC-17 after restart",
    ...range(18, 23),
    "AC-29",
    "AC-31",
    "AC-33",
    "AC-34",
    "EC-1",
  ]),
  old("S8", [
    "PRB.E-001 FR-17",
    "PRB.E-001 FR-19",
    "restore after a signal",
    "restore after a restart",
    "PRB.T-015 numbering",
    "no restore for exit or kill",
    "no restore for a moved folder",
    "remove after restore",
  ]),
  old("T-002", ["AC-1", "AC-3", "AC-5", "AC-7", "AC-15", "AC-16", "A-14"]),
  old("R1", ["AC-1", "AC-2", "AC-3", "EC-1", "EC-4", "a shell on the second server"]),
  old("E2-S3", ["AC-1", "AC-2a", "AC-2b", "AC-12", "AC-13a"]),
  old("E2-S1", [...range(3, 5), "AC-7", "AC-8", "AC-9", "AC-10", "AC-12", ...range(21, 23)]),
  old("E2-S4", ["AC-1", "AC-2", "AC-4", "AC-5", ...range(9, 12)]),
  old("T-041a", ["AC-4 reload", "AC-4 second client", "AC-4 restart", "AC-6"]),
  old("T-041b", ["AC-11"], true),
  old("T-041c", ["AC-12"], true),
];

const criteria = INVENTORY.flatMap((entry) => entry.criteria);

describe("the inventory of the long scenarios", () => {
  it("is well formed", () => {
    const ids = INVENTORY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(criteria.filter((entry, index) => criteria.indexOf(entry) !== index)).toEqual([]);
    for (const entry of INVENTORY) {
      expect(entry.criteria.length).toBeGreaterThan(0);
    }
  });

  it("holds every criterion a registered check covers, or the one its qualified rows split", () => {
    const named = (covered: string) =>
      criteria.some((entry) => entry === covered || entry.startsWith(`${covered} `));
    const unnamed = checks.flatMap((check) =>
      (check.covers ?? []).filter((covered) => !named(covered)).map((c) => `${check.id}: ${c}`),
    );
    expect(unnamed).toEqual([]);
  });

  it("names ids that are registered: a kept one as a check, the others as a check, a set or successors", () => {
    const checkIds = checks.map((check) => check.id);
    const setNames = new Set(sets.map((set) => set.name));
    const registered = (entry: OldScenario) =>
      checkIds.includes(entry.id) ||
      (!entry.kept &&
        (setNames.has(entry.id) || checkIds.some((id) => id.startsWith(`${entry.id}.`))));
    expect(INVENTORY.filter((entry) => !registered(entry)).map((entry) => entry.id)).toEqual([]);
  });

  it("has every criterion covered by a registered check (AC-1)", () => {
    const covered = new Set(checks.flatMap((check) => check.covers ?? []));
    expect(criteria.filter((entry) => !covered.has(entry))).toEqual([]);
  });

  it("lists every old id that became a set", () => {
    expect(INVENTORY.filter((entry) => !entry.kept).map((entry) => entry.id)).toEqual([...OLD_IDS]);
  });
});

const registry: Registry = { checks, composed, perfScenarios, sets };
const runnable = [...checks, ...composed];
const successorsOf = (old: string) =>
  checks.filter((check) => check.id.startsWith(`${old}.`)).map((check) => check.id);
const refusals = (name: string) => {
  const resolved = resolveName(registry, name);
  if (resolved.kind === "check" || resolved.kind === "composed") {
    return sandboxRefusals([resolved.scenario]);
  }
  if (resolved.kind === "set") return sandboxRefusals(resolved.members);
  throw new Error(`${name} resolves to ${resolved.kind}: ${resolved.refusal}`);
};

describe("the registry", () => {
  it("passes every registry rule", () => {
    expect(validateRegistry(registry, (file) => NodeFS.readFileSync(file, "utf8"))).toEqual([]);
  });

  it("states needs and covers on every check, and no need outside the known ones (AC-4)", () => {
    const known = new Set(["restart", "secondServer", "pristineHome", "serverWide", "condition"]);
    const steps = composed.flatMap((c) => c.steps.map((step) => step.scenario));
    for (const check of [...checks, ...steps]) {
      expect(check.needs, check.id).toBeDefined();
      expect(
        Object.keys(check.needs).filter((need) => !known.has(need)),
        check.id,
      ).toEqual([]);
      expect(check.covers?.length ?? 0, check.id).toBeGreaterThan(0);
    }
  });

  it("makes each old id a set of exactly its successors, and no id an old id (AC-20)", () => {
    for (const old of OLD_IDS) {
      const set = sets.find((entry) => entry.name === old);
      expect(set?.members.toSorted(), old).toEqual(successorsOf(old).toSorted());
      expect(set?.members.length ?? 0, old).toBeGreaterThan(0);
    }
    const ids = runnable.map((entry) => entry.id);
    expect(ids.filter((id) => (OLD_IDS as ReadonlyArray<string>).includes(id))).toEqual([]);
  });

  it("puts every check the sandbox accepts in the set shared (AC-3)", () => {
    const shared = sets.find((entry) => entry.name === "shared")!;
    expect(shared.members.length).toBeGreaterThan(0);
    expect(refusals("shared")).toEqual([]);
    const accepted = checks.filter((check) => sandboxRefusals([check]).length === 0);
    expect(shared.members).toEqual(accepted.map((check) => check.id));
  });

  it.each([
    ["S7", "S7.survive-restart cannot run on a sandbox: it restarts the server"],
    ["S2.git-init-fails", "its server starts under a condition"],
    ["E2-S1.list-offered", "it changes or depends on state every run on the sandbox sees"],
    ["S1.start-screen", "it needs an empty home"],
    ["R1", "R1.two-servers cannot run on a sandbox: it starts a second server"],
  ])("refuses %s on a sandbox, naming why", (name, reason) => {
    expect(refusals(name).join("\n")).toContain(reason);
  });

  it.each(["composed.close-then-kill", "S5", "S5.close-tab", "S6.kill-closed-tab"])(
    "accepts %s on a sandbox",
    (name) => {
      expect(refusals(name)).toEqual([]);
    },
  );
});
