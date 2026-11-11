// @effect-diagnostics nodeBuiltinImport:off - A Playwright reporter: writes stdout and results.json.

import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";

import { judgeGate } from "./gate.ts";
import type { ScenarioSet } from "./scenario.ts";

export const OUTCOME_ATTACHMENT = "scenario-outcome";

export interface StepOutcome {
  readonly id: string;
  readonly durationMs: number;
  readonly outcome: "passed" | "failed" | "not run";
}

/** What the scenario fixture attaches to `testInfo` as JSON under `OUTCOME_ATTACHMENT`. */
export interface ScenarioOutcome {
  readonly id: string;
  readonly durationMs: number;
  readonly teardownMs: number;
  readonly freshServer: boolean;
  /** The failure message without the step prefix: `at stage "<s>": <what>: expected <e>, found <f>`. */
  readonly failure?: string;
  readonly artifacts?: ReadonlyArray<string>;
  readonly undone?: ReadonlyArray<string>;
  readonly steps?: ReadonlyArray<StepOutcome>;
  /** A perf scenario's verdict on its measured value; a missed limit is also its `failure`. */
  readonly perf?: { readonly line: string; readonly pass: boolean };
}

export type GateJudge = typeof judgeGate;

export interface ReporterOptions {
  readonly mode?: "suite" | "selftest" | "perf" | "sandbox";
  readonly sandboxPid?: number;
  readonly sets?: ReadonlyArray<ScenarioSet>;
  /** Sets the run was started with, announced before the first scenario. */
  readonly namedSets?: ReadonlyArray<string>;
  readonly gate?: { readonly capMs: number; readonly notTimed: ReadonlyArray<string> };
  readonly resultsPath?: string;
  /** Set by Playwright itself; "list" under `--list`, whose listing its own printer then writes. */
  readonly _mode?: string;
}

export interface ReporterDeps {
  readonly write?: (text: string) => void;
  readonly judgeGate?: GateJudge;
}

interface ResultRow {
  readonly id: string;
  readonly title: string;
  readonly outcome: "passed" | "failed";
  readonly durationMs: number;
  readonly teardownMs: number | undefined;
  readonly freshServer: boolean | undefined;
  readonly steps: ReadonlyArray<StepOutcome> | undefined;
  readonly perf: ScenarioOutcome["perf"];
}

type CaseLike = Pick<TestCase, "title">;
type ResultLike = Pick<TestResult, "status" | "duration" | "attachments" | "error">;

const INDENT = "        ";
const ANSI = /\u001b\[[0-9;]*m/g;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function readOutcome(result: ResultLike): ScenarioOutcome | undefined {
  const attachment = result.attachments.find(({ name }) => name === OUTCOME_ATTACHMENT);
  if (attachment?.body === undefined) return undefined;
  return JSON.parse(attachment.body.toString("utf8")) as ScenarioOutcome;
}

function playwrightReason(result: ResultLike): string {
  const message = result.error?.message?.replace(ANSI, "").trim();
  if (message !== undefined && message.length > 0) return message;
  return result.status === "skipped" ? "skipped by Playwright" : result.status;
}

function timing(outcome: ScenarioOutcome | undefined, result: ResultLike): string {
  if (outcome?.steps !== undefined) {
    return `(composed, ${outcome.steps.length} steps, ${seconds(outcome.durationMs)})`;
  }
  if (outcome === undefined) return `(${seconds(result.duration)})`;
  return `(${seconds(outcome.durationMs)}, teardown ${Math.round(outcome.teardownMs)} ms)`;
}

function failureReason(outcome: ScenarioOutcome | undefined, result: ResultLike): string {
  if (outcome?.failure === undefined) return playwrightReason(result);
  const steps = outcome.steps ?? [];
  const failed = steps.findIndex(({ outcome: stepOutcome }) => stepOutcome === "failed");
  if (failed === -1) return outcome.failure;
  return `step ${failed + 1} ${steps[failed]!.id} ${outcome.failure}`;
}

/** The lines one finished scenario prints, in the order they print. */
function scenarioLines(test: CaseLike, result: ResultLike): ReadonlyArray<string> {
  const outcome = readOutcome(result);
  const passed = result.status === "passed" && outcome?.failure === undefined;
  const steps = (outcome?.steps ?? []).map((step, index) => ({ ...step, n: index + 1 }));
  const lines = passed
    ? [
        `PASS    ${test.title} ${timing(outcome, result)}`,
        ...steps.map(
          ({ n, id, durationMs }) => `${INDENT}step ${n} ${id} (${seconds(durationMs)})`,
        ),
        ...(outcome?.perf === undefined ? [] : [`${INDENT}${outcome.perf.line}`]),
      ]
    : [
        `FAIL    ${test.title} ${timing(outcome, result)}: ${failureReason(outcome, result)}`,
        ...steps
          .filter(({ outcome: stepOutcome }) => stepOutcome === "not run")
          .map(({ n, id }) => `${INDENT}not run: step ${n} ${id}`),
        ...(outcome?.artifacts ?? []).map((line) => `${INDENT}${line}`),
      ];
  return [...lines, ...(outcome?.undone ?? []).map((what) => `${INDENT}undone: ${what}`)];
}

function summaryLines(
  rows: ReadonlyArray<ResultRow>,
  skipped: number,
  options: ReporterOptions,
  totalMs: number,
): ReadonlyArray<string> {
  const passed = rows.filter(({ outcome }) => outcome === "passed").length;
  const counts = `${rows.length} ran, ${passed} passed, ${rows.length - passed} failed, ${skipped} checks skipped`;
  const prefix =
    options.mode === "sandbox"
      ? `on sandbox ${options.sandboxPid}, `
      : options.mode === "selftest"
        ? "self-test "
        : options.mode === "perf"
          ? "perf "
          : "";
  const byId = new Map(rows.map((row) => [row.id, row]));
  const setLines = (options.sets ?? []).flatMap(({ name, members }) => {
    const ran = members.filter((id) => byId.has(id));
    if (ran.length === 0) return [];
    const setPassed = ran.filter((id) => byId.get(id)!.outcome === "passed").length;
    return [`scenarios: set ${name} ${setPassed}/${members.length} passed`];
  });
  const measured = rows.flatMap(({ perf }) => (perf === undefined ? [] : [perf]));
  const perfLines =
    measured.length === 0
      ? []
      : [
          `perf: ${measured.length} measured, ${measured.filter(({ pass }) => !pass).length} over the limit`,
        ];
  return [
    ...perfLines,
    `scenarios: ${prefix}${counts}`,
    ...setLines,
    `scenarios: total ${seconds(totalMs)}`,
  ];
}

export default class ScenarioReporter implements Reporter {
  readonly #options: ReporterOptions;
  readonly #write: (text: string) => void;
  readonly #judgeGate: GateJudge;
  readonly #rows: Array<ResultRow> = [];
  #skipped = 0;

  get #listing(): boolean {
    return this.#options._mode === "list";
  }

  constructor(options: ReporterOptions = {}, deps: ReporterDeps = {}) {
    this.#options = options;
    this.#write = deps.write ?? ((text) => NodeProcess.stdout.write(text));
    this.#judgeGate = deps.judgeGate ?? judgeGate;
  }

  printsToStdio(): boolean {
    return !this.#listing;
  }

  onBegin(): void {
    if (this.#listing) return;
    const byName = new Map((this.#options.sets ?? []).map((set) => [set.name, set]));
    for (const name of this.#options.namedSets ?? []) {
      const set = byName.get(name);
      if (set !== undefined) this.#line(`scenarios: set ${name}: ${set.members.length} members`);
    }
  }

  onStdOut(chunk: string | Buffer): void {
    const text = chunk.toString();
    this.#skipped += text.match(/^SKIP {4}/gm)?.length ?? 0;
    this.#write(text);
  }

  onStdErr(chunk: string | Buffer): void {
    NodeProcess.stderr.write(chunk);
  }

  onError(error: Pick<TestError, "message">): void {
    this.#line(`scenarios: ${error.message?.replace(ANSI, "").trim() ?? "unknown error"}`);
  }

  onTestEnd(test: CaseLike, result: ResultLike): void {
    const lines = scenarioLines(test, result);
    this.#write(`${lines.join("\n")}\n`);
    const outcome = readOutcome(result);
    this.#rows.push({
      id: outcome?.id ?? test.title.split(" ", 1)[0]!,
      title: test.title,
      outcome: lines[0]!.startsWith("PASS") ? "passed" : "failed",
      durationMs: outcome?.durationMs ?? result.duration,
      teardownMs: outcome?.teardownMs,
      freshServer: outcome?.freshServer,
      steps: outcome?.steps,
      perf: outcome?.perf,
    });
  }

  async onEnd(
    result: Pick<FullResult, "duration">,
  ): Promise<{ status: FullResult["status"] } | undefined> {
    if (this.#listing) return undefined;
    let gateFailed = false;
    const gate = this.#options.gate;
    if (gate !== undefined) {
      for (const id of gate.notTimed) {
        this.#line(`NOT TIMED ${id}: composed; its steps are timed alone`);
      }
      const rows = this.#rows.flatMap(({ id, durationMs, freshServer }) =>
        freshServer === undefined ? [] : [{ id, ms: durationMs, freshServer }],
      );
      const verdict = this.#judgeGate(rows, gate.capMs);
      for (const line of verdict.lines) this.#line(line);
      gateFailed = verdict.over.length > 0;
    }
    for (const line of summaryLines(this.#rows, this.#skipped, this.#options, result.duration)) {
      this.#line(line);
    }
    if (this.#options.resultsPath !== undefined) {
      NodeFS.writeFileSync(
        this.#options.resultsPath,
        `${JSON.stringify({ scenarios: this.#rows, skipped: this.#skipped }, null, 2)}\n`,
      );
    }
    return gateFailed ? { status: "failed" } : undefined;
  }

  #line(text: string): void {
    this.#write(`${text}\n`);
  }
}
