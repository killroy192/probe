import { describe, expect, it } from "vite-plus/test";

import { checks, sets } from "./registry.ts";

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

  // PRB.T-039 integration adds here: AC-1 (every criterion covered), AC-4, AC-20, refusal rows.
});
