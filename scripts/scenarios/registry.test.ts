// @effect-diagnostics nodeBuiltinImport:off - Reads each check's source for the registry rules.

import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { harnessFiles, requirementDocs } from "./cli.ts";
import {
  checks,
  composed,
  OLD_IDS,
  perfScenarios,
  perfSelftests,
  pickedSelftests,
  selftests,
  sets,
} from "./registry.ts";
import { type Registry, registryOf, resolveName, validateRegistry } from "./registryRules.ts";
import { sandboxRefusals } from "./sandboxRules.ts";

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
    const inputs = {
      readSource: (file: string) => NodeFS.readFileSync(file, "utf8"),
      docs: requirementDocs(),
      harnessFiles: harnessFiles(),
    };
    expect(validateRegistry(registry, inputs)).toEqual([]);
    const selftest = [...selftests, ...pickedSelftests, ...perfSelftests];
    expect(
      validateRegistry(registryOf(selftest), { ...inputs, selftests: selftest, harnessFiles: [] }),
    ).toEqual([]);
  });

  it("states needs on every check, and no need outside the known ones", () => {
    const known = new Set(["restart", "secondServer", "pristineHome", "serverWide", "condition"]);
    const steps = composed.flatMap((c) => c.steps.map((step) => step.scenario));
    for (const check of [...checks, ...steps]) {
      expect(check.needs, check.id).toBeDefined();
      expect(
        Object.keys(check.needs).filter((need) => !known.has(need)),
        check.id,
      ).toEqual([]);
    }
  });

  it("makes each old id a set of exactly its successors, and no id an old id", () => {
    for (const old of OLD_IDS) {
      const set = sets.find((entry) => entry.name === old);
      expect(set?.members.toSorted(), old).toEqual(successorsOf(old).toSorted());
      expect(set?.members.length ?? 0, old).toBeGreaterThan(0);
    }
    const ids = runnable.map((entry) => entry.id);
    expect(ids.filter((id) => (OLD_IDS as ReadonlyArray<string>).includes(id))).toEqual([]);
  });

  it("puts every check the sandbox accepts in the set shared", () => {
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
