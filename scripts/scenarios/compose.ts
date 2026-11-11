import { StageFailure } from "./lib/trail.ts";
import { composedRejections } from "./registryRules.ts";
import type { CheckScenario, ComposedScenario, StepValue } from "./scenario.ts";

export interface ComposedStepRun {
  /** 1-based, as the output names it. */
  readonly n: number;
  readonly scenario: CheckScenario;
  readonly given: StepValue | undefined;
  /** The composed run's id with the step number, so a step names nothing an earlier one made. */
  readonly runId: string;
}

export interface StepRef {
  readonly n: number;
  readonly scenario: CheckScenario;
}

export type ComposedOutcome =
  | { readonly ok: true; readonly passed: ReadonlyArray<StepRef> }
  | {
      readonly ok: false;
      readonly passed: ReadonlyArray<StepRef>;
      readonly failed: StepRef & { readonly error: unknown; readonly stage: string | undefined };
      readonly notRun: ReadonlyArray<StepRef>;
      /** `step <n> <id> at stage "<s>": <cause>`. */
      readonly message: string;
      /** One `not run: step <n> <id>` per step after the failing one. */
      readonly notRunLines: ReadonlyArray<string>;
    };

/**
 * Runs `c`'s steps in order through `runStep`, handing each the value of the step its `given`
 * names; the first failure stops the run and the later steps are reported as not run. A composed
 * scenario the registry would reject throws before any step runs.
 */
export async function runComposed(
  c: ComposedScenario,
  runId: string,
  runStep: (step: ComposedStepRun) => Promise<StepValue | void>,
): Promise<ComposedOutcome> {
  const rejections = composedRejections(c);
  if (rejections.length > 0) throw new Error(`${c.id} cannot run: ${rejections.join("; ")}.`);
  const returned: Array<StepValue | undefined> = [];
  const passed: Array<StepRef> = [];
  for (const [index, step] of c.steps.entries()) {
    const n = index + 1;
    const given = step.given === undefined ? undefined : returned[step.given.from - 1];
    try {
      returned.push(
        (await runStep({ n, scenario: step.scenario, given, runId: `${runId}s${n}` })) ?? undefined,
      );
      passed.push({ n, scenario: step.scenario });
    } catch (error) {
      const notRun = c.steps
        .slice(n)
        .map((later, offset) => ({ n: n + 1 + offset, scenario: later.scenario }));
      const stage = error instanceof StageFailure ? error.stage : undefined;
      const cause = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        passed,
        failed: { n, scenario: step.scenario, error, stage },
        notRun,
        message: `step ${n} ${step.scenario.id}${stage === undefined ? ":" : ""} ${cause}`,
        notRunLines: notRun.map((later) => `not run: step ${later.n} ${later.scenario.id}`),
      };
    }
  }
  return { ok: true, passed };
}
