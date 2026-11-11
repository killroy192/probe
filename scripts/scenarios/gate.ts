import { type Registry, resolveName } from "./registryRules.ts";
import type { CheckScenario, ComposedScenario } from "./scenario.ts";

export const GATE_CAP_MS = 20_000;

export const QUIET_UNCONFIRMED =
  "the cap gate times nothing until the user confirms the machine is quiet; ask the user, then add --quiet-confirmed";

/** The cap for this run. `SCENARIO_GATE_CAP_MS` exists only so the harness test can lower it. */
export function gateCapMs(env: Readonly<Record<string, string | undefined>>): number {
  const lowered = Number(env.SCENARIO_GATE_CAP_MS);
  return Number.isFinite(lowered) && lowered > 0 ? lowered : GATE_CAP_MS;
}

export interface GateOutcome {
  readonly id: string;
  readonly ms: number;
  /** A fresh server's start counts in `ms`; the shared server's never does. */
  readonly freshServer: boolean;
}

const seconds = (ms: number) => `${Number((ms / 1000).toFixed(3))} s`;

/** One `GATE PASS|FAIL` line per outcome and the summary; a time over `capMs` fails. */
export function judgeGate(
  outcomes: ReadonlyArray<GateOutcome>,
  capMs: number,
): { readonly lines: ReadonlyArray<string>; readonly over: ReadonlyArray<string> } {
  const over = outcomes.filter((outcome) => outcome.ms > capMs).map(({ id }) => id);
  const lines = outcomes.map(
    ({ id, ms, freshServer }) =>
      `GATE ${ms > capMs ? "FAIL" : "PASS"} ${id} ${seconds(ms)} (server start ${freshServer ? "included" : "excluded"}), cap ${seconds(capMs)}`,
  );
  return { lines: [...lines, `gate: ${outcomes.length} timed, ${over.length} over the cap`], over };
}

export const notTimedLine = (c: ComposedScenario) =>
  `NOT TIMED ${c.id}: composed; its steps are timed alone`;

/**
 * What a gate run over `names` times: atomic checks, each once. A set's composed members are not
 * timed; a perf or composed scenario named directly, or an unknown name, is refused. No names
 * means every atomic check in the registry.
 */
export function gateTargets(
  registry: Registry,
  names: ReadonlyArray<string>,
): {
  readonly timed: ReadonlyArray<CheckScenario>;
  readonly notTimed: ReadonlyArray<ComposedScenario>;
  readonly refusals: ReadonlyArray<string>;
} {
  if (names.length === 0) return { timed: registry.checks, notTimed: [], refusals: [] };
  const timed = new Map<string, CheckScenario>();
  const notTimed = new Map<string, ComposedScenario>();
  const refusals: Array<string> = [];
  for (const name of names) {
    const resolved = resolveName(registry, name);
    switch (resolved.kind) {
      case "check":
        timed.set(resolved.scenario.id, resolved.scenario);
        break;
      case "composed":
        refusals.push(
          `${name} is a composed scenario; the gate times atomic checks only, so its steps are timed alone`,
        );
        break;
      case "perf":
        refusals.push(`${name} is a perf scenario; the gate times check scenarios only`);
        break;
      case "unknown":
        refusals.push(resolved.refusal);
        break;
      case "set":
        for (const member of resolved.members) {
          if (member.kind === "check") timed.set(member.id, member);
          else notTimed.set(member.id, member);
        }
        break;
    }
  }
  return { timed: [...timed.values()], notTimed: [...notTimed.values()], refusals };
}
