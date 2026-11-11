import type {
  AnyScenario,
  CheckScenario,
  ComposedScenario,
  PerfScenario,
  ResultKind,
  ScenarioNeeds,
  ScenarioSet,
} from "./scenario.ts";

export interface Registry {
  readonly checks: ReadonlyArray<CheckScenario>;
  readonly composed: ReadonlyArray<ComposedScenario>;
  readonly perfScenarios: ReadonlyArray<PerfScenario>;
  readonly sets: ReadonlyArray<ScenarioSet>;
}

/** A registry of `scenarios` sorted by kind, for a list that mixes them such as the self-tests. */
export function registryOf(
  scenarios: ReadonlyArray<AnyScenario>,
  sets: ReadonlyArray<ScenarioSet> = [],
): Registry {
  return {
    checks: scenarios.filter((entry) => entry.kind === "check"),
    composed: scenarios.filter((entry) => entry.kind === "composed"),
    perfScenarios: scenarios.filter((entry) => entry.kind === "perf"),
    sets,
  };
}

export interface Rejection {
  /** The scenario or set rejected. */
  readonly name: string;
  readonly reason: string;
}

export type Runnable = CheckScenario | ComposedScenario;

export type Resolved =
  | { readonly kind: "check"; readonly scenario: CheckScenario }
  | { readonly kind: "composed"; readonly scenario: ComposedScenario }
  | { readonly kind: "set"; readonly set: ScenarioSet; readonly members: ReadonlyArray<Runnable> }
  | { readonly kind: "perf"; readonly scenario: PerfScenario; readonly refusal: string }
  | { readonly kind: "unknown"; readonly refusal: string };

const PERF_SUFFIX = ".perf.ts";
const REGISTERING = `see "Registering a scenario" in .agents/rules/scenarios.md`;

// The lint list for clock reads in check scenarios.
const CLOCK_READ =
  /\b(?:Date\.now|performance\.now|(?:process|NodeProcess)\.hrtime)\b|\bnew Date\(/;
const ASSERTION = /\b(?:check|expected|expect)\(|\bassert\b/;
const measures = (source: string) => source.match(/\bmeasure\s*:/g)?.length ?? 0;

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const KIND_NAME: Readonly<Record<ResultKind, string>> = {
  workspace: "a workspace",
  shell: "a shell",
  world: "a world",
  closedTabShell: "a shell with its tab closed",
};
const kindName = (kind: ResultKind | undefined) =>
  kind === undefined ? "nothing" : (KIND_NAME[kind] ?? `a ${kind}`);

const stepName = (c: ComposedScenario, n: number) =>
  `${c.id} step ${n} (${c.steps[n - 1]?.scenario.id ?? "?"})`;

/** Every reason the registry is unfit to run, checked before anything runs; empty when it is fit. */
export function validateRegistry(
  registry: Registry,
  readSource: (file: string) => string,
): ReadonlyArray<Rejection> {
  const rejections: Array<Rejection> = [];
  const reject = (name: string, reason: string) => rejections.push({ name, reason });
  const sources = new Map<string, string>();
  const source = (file: string) => {
    let text = sources.get(file);
    if (text === undefined) {
      text = withoutComments(readSource(file));
      sources.set(file, text);
    }
    return text;
  };

  for (const scenario of [...registry.checks, ...registry.composed]) {
    if (scenario.file.endsWith(PERF_SUFFIX)) {
      reject(
        scenario.id,
        `it is a ${scenario.kind} scenario in a ${PERF_SUFFIX} file (${scenario.file}); only perf scenarios live there`,
      );
    }
  }
  for (const check of registry.checks) {
    const text = source(check.file);
    const clock = CLOCK_READ.exec(text);
    if (clock !== null) {
      reject(
        check.id,
        `it is a check scenario whose file reads the clock (${clock[0]}); a time belongs in a perf scenario`,
      );
    }
    if (measures(text) > 0) {
      reject(
        check.id,
        "it is a check scenario whose file declares a measure; a measure belongs in a perf scenario",
      );
    }
  }
  for (const perf of registry.perfScenarios) {
    if (!perf.file.endsWith(PERF_SUFFIX)) {
      reject(
        perf.id,
        `it is a perf scenario, so its file must end in ${PERF_SUFFIX} (${perf.file})`,
      );
    }
    const text = source(perf.file);
    const assertion = ASSERTION.exec(text);
    if (assertion !== null) {
      reject(
        perf.id,
        `it is a perf scenario whose file asserts (${assertion[0]}); a perf scenario only measures, and the harness judges its limit`,
      );
    }
    const declared = measures(text);
    const { limitMs, limitFrom } = perf.measure;
    if (declared !== 1 || !(limitMs > 0) || limitFrom.trim() === "") {
      reject(
        perf.id,
        `a perf scenario declares exactly one measure with a limit and the criterion that sets it; its file declares ${declared}, limit ${limitMs} ms from "${limitFrom}"`,
      );
    }
  }

  const named = new Map<string, Array<"scenario" | "set">>();
  const name = (key: string, what: "scenario" | "set") =>
    named.set(key, [...(named.get(key) ?? []), what]);
  for (const scenario of [...registry.checks, ...registry.composed, ...registry.perfScenarios]) {
    name(scenario.id, "scenario");
  }
  for (const set of registry.sets) name(set.name, "set");
  for (const [key, whats] of named) {
    if (whats.length < 2) continue;
    reject(
      key,
      whats.includes("set") && whats.includes("scenario")
        ? "a set has the name of a scenario id; ids and set names share one namespace"
        : `the name is registered ${whats.length} times`,
    );
  }

  const ids = new Map<string, AnyScenario>(
    [...registry.checks, ...registry.composed, ...registry.perfScenarios].map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const setNames = new Set(registry.sets.map((set) => set.name));
  for (const set of registry.sets) {
    for (const member of set.members) {
      const entry = ids.get(member);
      if (setNames.has(member)) {
        reject(set.name, `the set names the set ${member}; sets do not nest`);
      } else if (entry === undefined) {
        reject(set.name, `the set names ${member}, which is not registered (${REGISTERING})`);
      } else if (entry.kind === "perf") {
        reject(
          set.name,
          `the set names ${member}, a perf scenario; perf scenarios run only in the serial perf run`,
        );
      }
    }
  }

  for (const composed of registry.composed) {
    for (const reason of composedRejections(composed)) reject(composed.id, reason);
  }
  return rejections;
}

/** Why the composed scenario `c` cannot run: its steps, inputs and conditions. */
export function composedRejections(c: ComposedScenario): ReadonlyArray<string> {
  if (c.steps.length === 0) return ["a composed scenario has at least one step"];
  const reasons: Array<string> = [];
  c.steps.forEach((step, index) => {
    const n = index + 1;
    if ((step.scenario as { readonly kind: string }).kind !== "check") {
      reasons.push(`${stepName(c, n)} is not an atomic check scenario`);
      return;
    }
    if (step.given === undefined) return;
    const from = step.given.from;
    const source = Number.isInteger(from) && from >= 1 && from < n ? c.steps[from - 1] : undefined;
    if (source === undefined) {
      reasons.push(
        `${stepName(c, n)} takes its input from step ${from}, which is not an earlier step`,
      );
      return;
    }
    const takes = step.scenario.takes;
    const gives = source.scenario.returns;
    if (takes === undefined || gives !== takes) {
      reasons.push(
        `${stepName(c, n)} takes ${kindName(takes)}; step ${from} (${source.scenario.id}) returns ${kindName(gives)}`,
      );
    }
  });
  const conditioned = c.steps
    .map((step, index) => ({ n: index + 1, condition: step.scenario.needs.condition }))
    .filter((entry) => entry.condition !== undefined);
  const first = conditioned[0];
  const other = conditioned.find((entry) => entry.condition !== first?.condition);
  if (first !== undefined && other !== undefined) {
    reasons.push(
      `steps ${first.n} (${c.steps[first.n - 1]?.scenario.id}) and ${other.n} (${c.steps[other.n - 1]?.scenario.id}) need different conditions, and the steps share one server`,
    );
  }
  return reasons;
}

/** What `name` runs: a check, a composed scenario, a set's members, or why it runs nothing. */
export function resolveName(registry: Registry, name: string): Resolved {
  const check = registry.checks.find((entry) => entry.id === name);
  if (check !== undefined) return { kind: "check", scenario: check };
  const composed = registry.composed.find((entry) => entry.id === name);
  if (composed !== undefined) return { kind: "composed", scenario: composed };
  const perf = registry.perfScenarios.find((entry) => entry.id === name);
  if (perf !== undefined) {
    return {
      kind: "perf",
      scenario: perf,
      refusal: `${name} is a perf scenario; perf scenarios run only in the serial perf run (vp run test:scenarios:perf)`,
    };
  }
  const set = registry.sets.find((entry) => entry.name === name);
  if (set !== undefined) {
    const runnable = new Map<string, Runnable>(
      [...registry.checks, ...registry.composed].map((entry) => [entry.id, entry]),
    );
    const members = set.members.flatMap((member) => runnable.get(member) ?? []);
    return { kind: "set", set, members };
  }
  if (/[/\\]|\.[cm]?[jt]sx?$/.test(name)) {
    return {
      kind: "unknown",
      refusal: `${name} is a path to a script; scenarios run by their registered id (${REGISTERING}).`,
    };
  }
  return { kind: "unknown", refusal: `No scenario or set has the name ${name}.` };
}

/** The union of a composed scenario's step needs; the steps share one server. */
export function composedNeeds(c: ComposedScenario): ScenarioNeeds {
  const all = c.steps.map((step) => step.scenario.needs);
  const joined = (pick: (needs: ScenarioNeeds) => string | undefined) => {
    const reasons = [...new Set(all.flatMap((needs) => pick(needs) ?? []))];
    return reasons.length === 0 ? undefined : reasons.join("; ");
  };
  const serverWide = joined((needs) => needs.serverWide);
  const condition = all.find((needs) => needs.condition !== undefined)?.condition;
  return {
    ...(all.some((needs) => needs.restart) && { restart: true }),
    ...(all.some((needs) => needs.secondServer) && { secondServer: true }),
    ...(all.some((needs) => needs.pristineHome) && { pristineHome: true }),
    ...(serverWide !== undefined && { serverWide }),
    ...(condition !== undefined && { condition }),
  };
}

/**
 * Whether a scenario with `needs` gets a server of its own rather than the shared one. The runner's
 * choice and the sandbox refusals both rest on this one rule.
 */
export function freshServerNeeded(needs: ScenarioNeeds): boolean {
  return (
    needs.restart === true ||
    needs.pristineHome === true ||
    needs.serverWide !== undefined ||
    needs.condition !== undefined
  );
}

/** Judges a perf scenario's measured value against its product limit. */
export function perfVerdict(
  p: PerfScenario,
  ms: number,
): { readonly pass: boolean; readonly line: string } {
  const { name, limitMs, limitFrom } = p.measure;
  const pass = ms <= limitMs;
  return {
    pass,
    line: `PERF ${pass ? "PASS" : "FAIL"} ${p.id} ${name} ${Math.round(ms)} ms, limit ${limitMs} ms (${limitFrom})`,
  };
}
