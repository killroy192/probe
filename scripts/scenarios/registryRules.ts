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

export interface RequirementDoc {
  /** The file name in `docs/scenarios`, as `"shells.md"`; its slug is the name without `.md`. */
  readonly name: string;
  readonly text: string;
}

export interface RegistryInputs {
  readonly readSource: (file: string) => string;
  /** Every file in `docs/scenarios`: the requirements a `verifies` ref may name. */
  readonly docs: ReadonlyArray<RequirementDoc>;
  /** The registry's self-tests: they verify the harness, not the product, and carry no `verifies`. */
  readonly selftests?: ReadonlyArray<AnyScenario>;
  /** The harness's own files, held to the same ban on ticket references as a product scenario's. */
  readonly harnessFiles?: ReadonlyArray<string>;
}

const REF = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/((?:N?FR)-[1-9]\d*)$/;
const REQUIREMENT_ROW = /^\|\s*(N?FR-[1-9]\d*)\s*\|/;
// A ticket, acceptance criterion, edge case or story assumption; matched in comments too.
const TICKET_REFERENCE = /\b(?:AC|EC|SA)-\d+|\bPRB\.[TE]-\d+/;
const CITE_REQUIREMENTS =
  "scenario code cites docs/scenarios requirements, and only a ticket maps its criteria to scenario ids";

/** The FR and NFR ids in the `## Requirements` table of a `docs/scenarios` file, in table order. */
export function requirementIds(markdown: string): ReadonlyArray<string> {
  const ids: Array<string> = [];
  let inTable = false;
  for (const line of markdown.split("\n")) {
    if (/^##\s/.test(line)) inTable = /^##\s+Requirements\s*$/.test(line);
    const row = inTable ? REQUIREMENT_ROW.exec(line) : null;
    if (row !== null) ids.push(row[1]!);
  }
  return ids;
}

/** The first ticket or acceptance-criterion reference in `source`, comments included. */
export function ticketReference(source: string): string | undefined {
  return TICKET_REFERENCE.exec(source)?.[0];
}

/** Why `scenario`'s `verifies` is unfit, against the requirements `known` holds per doc slug. */
function verifiesRejections(
  scenario: AnyScenario,
  known: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyArray<string> {
  const refs = scenario.verifies ?? [];
  if (refs.length === 0) {
    return [
      `it is a ${scenario.kind} scenario with no verifies; it lists the docs/scenarios requirements it proves, as "shells/FR-3" (${REGISTERING})`,
    ];
  }
  const reasons: Array<string> = [];
  for (const ref of refs) {
    const shape = REF.exec(ref);
    if (shape === null) {
      reasons.push(`its verifies ref "${ref}" is not "<slug>/FR-<n>" or "<slug>/NFR-<n>"`);
      continue;
    }
    const [, slug, id] = shape;
    const ids = known.get(slug!);
    if (ids === undefined) {
      reasons.push(
        `its verifies ref "${ref}" names docs/scenarios/${slug}.md, which does not exist`,
      );
    } else if (!ids.has(id!)) {
      reasons.push(
        `its verifies ref "${ref}" names ${id}, which the Requirements table of docs/scenarios/${slug}.md does not hold`,
      );
    }
  }
  if (scenario.kind === "perf" && (refs.length !== 1 || !refs[0]!.includes("/NFR-"))) {
    reasons.push(
      `a perf scenario verifies exactly one NFR, the requirement that states its limit; it verifies ${refs.join(", ")}`,
    );
  }
  return reasons;
}

/** Every reason the registry is unfit to run, checked before anything runs; empty when it is fit. */
export function validateRegistry(
  registry: Registry,
  inputs: RegistryInputs,
): ReadonlyArray<Rejection> {
  const { readSource } = inputs;
  const rejections: Array<Rejection> = [];
  const reject = (name: string, reason: string) => rejections.push({ name, reason });
  const raw = new Map<string, string>();
  const rawSource = (file: string) => {
    let text = raw.get(file);
    if (text === undefined) {
      text = readSource(file);
      raw.set(file, text);
    }
    return text;
  };
  const sources = new Map<string, string>();
  const source = (file: string) => {
    let text = sources.get(file);
    if (text === undefined) {
      text = withoutComments(rawSource(file));
      sources.set(file, text);
    }
    return text;
  };

  const known = new Map(
    inputs.docs
      .filter((doc) => doc.name.endsWith(".md") && doc.name !== "README.md")
      .map((doc) => [doc.name.slice(0, -".md".length), new Set(requirementIds(doc.text))]),
  );
  const selftests = new Set(inputs.selftests ?? []);
  const scanned = new Set<string>();
  const scan = (file: string, whose: string) => {
    if (scanned.has(file)) return;
    scanned.add(file);
    const found = ticketReference(rawSource(file));
    if (found !== undefined) {
      reject(
        file,
        `${whose} cites a ticket or acceptance criterion (${found}); ${CITE_REQUIREMENTS}`,
      );
    }
  };
  for (const scenario of [...registry.checks, ...registry.composed, ...registry.perfScenarios]) {
    if (selftests.has(scenario)) {
      if (scenario.verifies !== undefined) {
        reject(scenario.id, "it is a self-test: it verifies the harness and carries no verifies");
      }
      continue;
    }
    for (const reason of verifiesRejections(scenario, known)) reject(scenario.id, reason);
    scan(scenario.file, "the product scenario file");
  }
  for (const file of inputs.harnessFiles ?? []) scan(file, "the harness file");

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
    const { limitMs } = perf.measure;
    if (declared !== 1 || !(limitMs > 0)) {
      reject(
        perf.id,
        `a perf scenario declares exactly one measure with a limit; its file declares ${declared}, limit ${limitMs} ms`,
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
  const { name, limitMs } = p.measure;
  const pass = ms <= limitMs;
  const from = p.verifies?.[0];
  return {
    pass,
    line: `PERF ${pass ? "PASS" : "FAIL"} ${p.id} ${name} ${Math.round(ms)} ms, limit ${limitMs} ms${from === undefined ? "" : ` (${from})`}`,
  };
}
