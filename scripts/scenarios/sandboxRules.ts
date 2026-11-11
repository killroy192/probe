// @effect-diagnostics nodeBuiltinImport:off - Reads the checkout's file times to judge a sandbox's code.

import * as NodePath from "node:path";

import { bundleBuiltMs, bundleInputs, newestOf, serverInputs } from "./bundle.ts";
import type { SandboxRecord } from "./cleanup.ts";
import { freshServerNeeded, type Runnable } from "./registryRules.ts";
import type { CheckScenario, ScenarioNeeds } from "./scenario.ts";

const REGISTERING = `see "Registering a scenario" in .agents/rules/scenarios.md`;
const SAVED_ONLY = `the sandbox runs saved scenarios only; register it under an id (${REGISTERING})`;

/** The harness files the sandbox process loaded at start; a run loads every other one itself. */
const SANDBOX_HARNESS = [
  "sandbox.ts",
  "server.ts",
  "isolation.ts",
  "cleanup.ts",
  "environment.ts",
  "bundle.ts",
  "browser.ts",
  "ports.ts",
  "gitconfig",
  "lib/api.ts",
  "lib/deadlines.ts",
  "lib/files.ts",
  "lib/navigate.ts",
  "lib/report.ts",
  "lib/setup.ts",
  "lib/shells.ts",
  "lib/trail.ts",
  "lib/ui/addProject.ts",
  "lib/ui/dialog.ts",
  "lib/ui/tabs.ts",
  "lib/ui/terminal.ts",
  "lib/ui/tree.ts",
  "lib/ui/workspacesMenu.ts",
  "lib/waits.ts",
];

/** The registered scenario `id` names, or why the sandbox refuses it: a script path or an unknown id. */
export function pickScenario(
  id: string,
  registered: ReadonlyArray<CheckScenario>,
): { readonly scenario: CheckScenario } | { readonly refusal: string } {
  const scenario = registered.find((candidate) => candidate.id === id);
  if (scenario !== undefined) return { scenario };
  if (/[/\\]|\.[cm]?[jt]sx?$/.test(id)) {
    return { refusal: `${id} is a path to a script; ${SAVED_ONLY}.` };
  }
  return { refusal: `No scenario has the id ${id}; ${SAVED_ONLY}.` };
}

/** What in `needs` a sandbox refuses: everything that needs a fresh server, and a second server. */
function refusedNeeds(needs: ScenarioNeeds): ReadonlyArray<string> {
  if (!freshServerNeeded(needs) && needs.secondServer !== true) return [];
  return [
    needs.restart && "it restarts the server, which every run on the sandbox shares",
    needs.secondServer && "it starts a second server, and a sandbox has one",
    needs.pristineHome && "it needs an empty home, and a sandbox keeps what earlier runs made",
    needs.serverWide !== undefined &&
      `it changes or depends on state every run on the sandbox sees (${needs.serverWide})`,
    needs.condition !== undefined &&
      `its server starts under a condition (${needs.condition.why}), and the sandbox's did not`,
  ].filter((reason) => typeof reason === "string");
}

/** Why `scenario` may not run on a server other runs share; undefined when it may. */
export function sandboxRefusal(scenario: {
  readonly id: string;
  readonly needs?: ScenarioNeeds;
}): string | undefined {
  const { id, needs } = scenario;
  if (needs === undefined) {
    return `${id} does not state its needs, so it is not known to be safe on a shared server (${REGISTERING}).`;
  }
  const reasons = refusedNeeds(needs);
  return reasons.length === 0 ? undefined : `${id} cannot run on a sandbox: ${reasons.join("; ")}.`;
}

/**
 * Every member or step of `targets` the sandbox refuses, with its reason. One refusal refuses the
 * whole run, so a set or composed scenario runs on a sandbox entirely or not at all.
 */
export function sandboxRefusals(targets: ReadonlyArray<Runnable>): ReadonlyArray<string> {
  return targets.flatMap((target) => {
    if (target.kind === "check") return sandboxRefusal(target) ?? [];
    return target.steps.flatMap(({ scenario }, index) => {
      const reasons = refusedNeeds(scenario.needs);
      return reasons.length === 0
        ? []
        : `${target.id} step ${index + 1} (${scenario.id}) cannot run on a sandbox: ${reasons.join("; ")}.`;
    });
  });
}

/**
 * The first file that makes the sandbox older than the checkout: a web, server or package source,
 * or a harness file the sandbox loaded, newer than its start, or a bundle rebuilt since. Null when
 * the sandbox still runs the checkout's code.
 */
export function staleSandboxFile(root: string, sandbox: SandboxRecord): string | null {
  const built = bundleBuiltMs(root);
  if (built !== sandbox.bundleBuiltMs) {
    return "apps/web/dist/index.html (the bundle was rebuilt since the sandbox started)";
  }
  const harness = SANDBOX_HARNESS.map((file) => NodePath.join(root, "scripts", "scenarios", file));
  const newest = newestOf([...harness, ...serverInputs(root), ...bundleInputs(root)]);
  return newest !== null && newest.mtimeMs > sandbox.startedMs
    ? NodePath.relative(root, newest.path)
    : null;
}
