// @effect-diagnostics nodeBuiltinImport:off - Names the run's artifact folders and log files.

import * as NodePath from "node:path";

import type { ComposedOutcome } from "./compose.ts";
import { StageFailure } from "./lib/trail.ts";
import type { ScenarioOutcome, StepOutcome } from "./reporter.ts";
import type { ComposedScenario, ScenarioContext } from "./scenario.ts";
import type { ServerHandle, UnexpectedExit } from "./server.ts";

/** Where a failure's artifacts go: `<id>/`, or `<id>/step-<n>-<stepId>/` for a composed step. */
export const artifactsDir = (
  root: string,
  id: string,
  step?: { readonly n: number; readonly id: string },
) =>
  step === undefined
    ? NodePath.join(root, id)
    : NodePath.join(root, id, `step-${step.n}-${step.id}`);

/** A shared server's whole log, outside its home, so it survives the home's removal. */
export const sharedLogFile = (root: string, workerIndex: number, n: number) =>
  NodePath.join(root, "servers", `w${workerIndex}-${n}.log`);

/** The lines a `FAIL` prints under itself about what was saved and what could not be. */
export function artifactLines(
  dir: string,
  saved: ReadonlyArray<string>,
  missing: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [
    `artifacts: ${dir}${saved.length > 0 ? ` (${saved.join(", ")})` : ""}`,
    ...missing.map((note) => `artifact missing: ${note}`),
  ];
}

/** The failure as a stage failure: one a stage did not wrap is blamed on the stage running now. */
export const asStageFailure = (caught: unknown, stageNow: string) =>
  caught instanceof StageFailure ? caught : new StageFailure(stageNow, caught);

/**
 * `at stage "<s>": <cause>`, with a composed step's own stage prefix (`step <n>: `) taken off,
 * since the reporter names the step in front of it.
 */
export function failureMessage(error: unknown, stepPrefix?: string): string {
  if (!(error instanceof StageFailure))
    return error instanceof Error ? error.message : String(error);
  const prefix = stepPrefix === undefined ? "" : `${stepPrefix}: `;
  if (prefix === "" || !error.stage.startsWith(prefix)) return error.message;
  const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
  return `at stage "${error.stage.slice(prefix.length)}": ${cause}`;
}

/** Why a run on the sandbox `pid` fails once that sandbox stops under it. */
export const sandboxEndedMessage = (pid: number) =>
  `The sandbox ${pid} ended during the run; no server is started in its place.`;

const LAST_LINES = 5;

/** Names a server's exit and the last lines it printed, for the failure of the stage it ended. */
export function describeExit(label: string, pid: number | undefined, exit: UnexpectedExit): string {
  const how = exit.signal ?? `code ${String(exit.code)}`;
  const lines = exit.tail
    .split("\n")
    .map((line) => line.trimEnd())
    // The startup pairing QR code is block art that names nothing and encodes a pairing token.
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .slice(-LAST_LINES);
  const who = pid === undefined ? label : `${label} (pid ${pid})`;
  return [
    `the ${who} exited unexpectedly with ${how}; its last lines:`,
    ...lines.map((line) => `    ${line}`),
  ].join("\n");
}

/**
 * Settles as `running` does, unless `exited` resolves first: then it fails at the stage running at
 * that moment, and the scenario's own later failure is not the one reported.
 */
export function raceServerExit<A>(
  running: Promise<A>,
  exited: Promise<string>,
  stageNow: () => string,
): Promise<A> {
  return new Promise<A>((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      finish();
    };
    running.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
    void exited.then((cause) =>
      settle(() => reject(new StageFailure(stageNow(), new Error(cause)))),
    );
  });
}

export interface Undo {
  readonly what: string;
  readonly undo: () => Promise<void>;
}

/** Runs every undo, the last registered first; a failing one stops none of the others. */
export async function runUndos(
  undos: ReadonlyArray<Undo>,
): Promise<{ readonly undone: ReadonlyArray<string>; readonly failure: Error | undefined }> {
  const undone: Array<string> = [];
  let failure: Error | undefined;
  for (const { what, undo } of [...undos].reverse()) {
    try {
      await undo();
      undone.push(what);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      failure ??= new Error(`Undoing ${what} failed: ${reason}`);
    }
  }
  return { undone, failure };
}

/** Each step's outcome and time, in step order; a step that did not run took no time. */
export function composedSteps(
  c: ComposedScenario,
  outcome: ComposedOutcome | undefined,
  durations: ReadonlyMap<number, number>,
): ReadonlyArray<StepOutcome> {
  const failedAt = outcome === undefined ? 0 : outcome.ok ? Infinity : outcome.failed.n;
  return c.steps.map(({ scenario }, index) => {
    const n = index + 1;
    return {
      id: scenario.id,
      durationMs: durations.get(n) ?? 0,
      outcome: n < failedAt ? "passed" : n === failedAt ? "failed" : "not run",
    };
  });
}

/** What the reporter reads from a finished test; `failure` is absent on a pass. */
export function scenarioOutcome(input: {
  readonly id: string;
  readonly durationMs: number;
  readonly teardownMs: number;
  readonly freshServer: boolean;
  readonly failure: string | undefined;
  readonly artifacts: ReadonlyArray<string>;
  readonly undone: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<StepOutcome> | undefined;
  readonly perf?: ScenarioOutcome["perf"];
}): ScenarioOutcome {
  return {
    id: input.id,
    durationMs: input.durationMs,
    teardownMs: input.teardownMs,
    freshServer: input.freshServer,
    ...(input.failure !== undefined && { failure: input.failure }),
    ...(input.artifacts.length > 0 && { artifacts: input.artifacts }),
    ...(input.undone.length > 0 && { undone: input.undone }),
    ...(input.steps !== undefined && { steps: input.steps }),
    ...(input.perf !== undefined && { perf: input.perf }),
  };
}

/**
 * The shared server as one scenario sees it: whatever would end or replace it fails naming the
 * need, since other scenarios run on it. A scenario that states the need gets a server of its own.
 */
export function guardShared(
  server: ServerHandle,
  scenarioId: ScenarioContext["scenarioId"],
): ServerHandle {
  const refused = (need: string) => () =>
    Promise.reject(
      new Error(`${scenarioId} tried ${need} on the shared server, a need it did not state.`),
    );
  return {
    ...server,
    stop: refused("a server stop"),
    kill: refused("a server stop"),
    restart: refused("a restart"),
    stopShellHost: refused("stopping the shell host"),
  };
}
