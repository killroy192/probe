// @effect-diagnostics nodeBuiltinImport:off - Turns a definer's `import.meta.url` into its file path.

import * as NodeURL from "node:url";

import type { PointerPage } from "./browser.ts";
import type {
  ClosedTabShellResult,
  ShellResult,
  WorkspaceResult,
  WorldResult,
} from "./lib/setup.ts";
import type { Trail } from "./lib/trail.ts";
import type { ServerEnv, ServerHandle } from "./server.ts";

export interface ScenarioContext {
  readonly server: ServerHandle;
  /**
   * New for every run of a scenario. A scenario that may share a server puts it in the workspace
   * names and folders it makes, so they never meet those of an earlier run on that server.
   */
  readonly runId: string;
  /** A fresh browser context signed in to this scenario's server. */
  readonly openPage: () => Promise<PointerPage>;
  /** A fresh browser context with no session. */
  readonly openAnonymousPage: () => Promise<PointerPage>;
  /**
   * Starts another Probe server on its own throwaway home and port, stopped with the scenario.
   * `serverBin` exists for the harness self-test of a server that never starts.
   */
  readonly startSecondServer: (options?: { readonly serverBin?: string }) => Promise<ServerHandle>;
  /** The id the scenario runs under, for the lines it prints. */
  readonly scenarioId: string;
  /** This run's stages and setup calls; one per run of a scenario. */
  readonly trail: Trail;
  /**
   * Registers `undo` for what the scenario just made. The undos run in reverse order when the
   * scenario ends, pass or fail; one that fails fails a scenario that passed.
   */
  readonly onStepEnd: (what: string, undo: () => Promise<void>) => void;
}

/**
 * What a scenario needs from its server beyond running steps on it. A sandbox (a server other runs
 * share) refuses every need, and a scenario that states none (`needs` absent) as not yet checked.
 */
export interface ScenarioNeeds {
  readonly restart?: true;
  readonly secondServer?: true;
  /** It asserts on an empty home: nothing another run made may be there. */
  readonly pristineHome?: true;
  /** Why it changes or depends on state every scenario on its server sees. */
  readonly serverWide?: string;
  /** Its server starts under this condition, so it gets one of its own. */
  readonly condition?: ServerCondition;
}

export interface ServerCondition {
  readonly why: string;
  /** Variables on top of the harness's for a server on `home`; `undefined` removes one. */
  readonly env: (home: string) => ServerEnv | Promise<ServerEnv>;
}

/** What a check step can hand the next one, by its `kind`. */
export interface ResultKinds {
  readonly workspace: WorkspaceResult;
  readonly shell: ShellResult;
  readonly world: WorldResult;
  readonly closedTabShell: ClosedTabShellResult;
}

export type ResultKind = keyof ResultKinds;
export type StepValue = ResultKinds[ResultKind];

/** Undefined when the check runs alone; it then builds its own with `given()`. */
type Given<T extends ResultKind> = [T] extends [never] ? undefined : ResultKinds[T] | undefined;
type Returned<R extends ResultKind> = [R] extends [never] ? void : ResultKinds[R];

export interface CheckScenario {
  readonly kind: "check";
  /** The file that defines it. */
  readonly file: string;
  readonly id: string;
  readonly title: string;
  /** `{}` when it needs nothing and is safe on a shared server: its names and folders use `runId`. */
  readonly needs: ScenarioNeeds;
  /** The criteria it proves, as `"S7 AC-6"`. */
  readonly covers?: ReadonlyArray<string>;
  readonly takes?: ResultKind;
  readonly returns?: ResultKind;
  run(context: ScenarioContext, given: StepValue | undefined): Promise<StepValue | void>;
}

export interface PerfMeasure {
  readonly name: string;
  readonly limitMs: number;
  /** The criterion that sets the limit, as `"PRB.T-004 AC-3"`. */
  readonly limitFrom: string;
}

export interface PerfScenario {
  readonly kind: "perf";
  readonly file: string;
  readonly id: string;
  readonly title: string;
  readonly needs: ScenarioNeeds;
  readonly measure: PerfMeasure;
  /** Resolves with the measured milliseconds; the harness judges them against the limit. */
  readonly run: (context: ScenarioContext) => Promise<number>;
}

export interface ComposedStep {
  readonly scenario: CheckScenario;
  /** The 1-based number of the earlier step whose returned value this step takes. */
  readonly given?: { readonly from: number };
}

/** Atomic checks run in order on one server, each step handing a value to a later one. */
export interface ComposedScenario {
  readonly kind: "composed";
  readonly file: string;
  readonly id: string;
  readonly title: string;
  readonly steps: ReadonlyArray<ComposedStep>;
}

/** Check or composed ids that run together under one name; ids and set names share one namespace. */
export interface ScenarioSet {
  readonly name: string;
  readonly members: ReadonlyArray<string>;
}

export type AnyScenario = CheckScenario | PerfScenario | ComposedScenario;

const fileOf = (url: string) => NodeURL.fileURLToPath(url);

/** Defines a check scenario in the file whose `import.meta.url` is `url`. */
export function defineCheck<const T extends ResultKind = never, const R extends ResultKind = never>(
  url: string,
  spec: {
    readonly id: string;
    readonly title: string;
    readonly needs: ScenarioNeeds;
    readonly covers?: ReadonlyArray<string>;
    readonly takes?: T;
    readonly returns?: R;
    readonly run: (context: ScenarioContext, given: Given<T>) => Promise<Returned<R>>;
  },
): CheckScenario {
  return { kind: "check", file: fileOf(url), ...spec };
}

/** Defines a perf scenario; its file must end in `.perf.ts`. */
export function definePerf(url: string, spec: Omit<PerfScenario, "kind" | "file">): PerfScenario {
  return { kind: "perf", file: fileOf(url), ...spec };
}

export function defineComposed(
  url: string,
  spec: Omit<ComposedScenario, "kind" | "file">,
): ComposedScenario {
  return { kind: "composed", file: fileOf(url), ...spec };
}
