#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The launcher owns the run's processes and folders, and names the artifacts folder by its start.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { launchBrowser } from "./browser.ts";
import { type BundleState, bundleState, ensureWebBundle } from "./bundle.ts";
import {
  bundleUsers,
  cleanLeftovers,
  findSandbox,
  lockSandbox,
  openManifest,
  processStartTime,
  type ProcessIdentity,
  type SandboxRecord,
} from "./cleanup.ts";
import {
  defaultArtifactsDir,
  defaultWorkers,
  refusalReason,
  RUN_PLAN_ENV,
  type RunPlan,
} from "./environment.ts";
import { gateCapMs, gateTargets, QUIET_UNCONFIRMED } from "./gate.ts";
import { scenarioShell } from "./isolation.ts";
import {
  checks,
  composed,
  perfScenarios,
  perfSelftests,
  pickedSelftests,
  selftests,
  selftestSets,
  sets,
} from "./registry.ts";
import {
  composedNeeds,
  freshServerNeeded,
  type Registry,
  registryOf,
  resolveName,
  type Runnable,
  validateRegistry,
} from "./registryRules.ts";
import { sandboxRefusals, staleSandboxFile } from "./sandboxRules.ts";
import type { PerfScenario } from "./scenario.ts";
import { REPO_ROOT } from "./server.ts";

export interface LaunchOptions {
  /** Every `--only`: ids, sets and composed scenarios, in the order given. */
  readonly only: ReadonlyArray<string>;
  readonly gate: boolean;
  /** The serial perf run: `.perf.ts` scenarios only, on one worker. */
  readonly perf: boolean;
  readonly quietConfirmed: boolean;
  readonly workers: number | undefined;
  readonly selftest: boolean;
  /** The pid the sandbox printed; the run attaches to its server instead of starting any. */
  readonly sandbox: number | undefined;
  readonly rebuild: boolean;
  readonly browser: string | undefined;
  readonly serverBin: string | undefined;
  readonly ownShellConfig: boolean;
  readonly artifacts: string | undefined;
  /** Lists what the run would declare; starts no browser, bundle build or server. */
  readonly list: boolean;
}

const VALUE_FLAGS = [
  "--only",
  "--workers",
  "--sandbox",
  "--browser",
  "--server-bin",
  "--artifacts",
] as const;
const SWITCHES = [
  "--gate",
  "--perf",
  "--quiet-confirmed",
  "--selftest",
  "--rebuild",
  "--own-shell-config",
  "--list",
] as const;
const REPEAT_FLAGS = ["--retries", "--retry", "--repeat-each", "--repeat"];
const SCRIPT_PATH = /[/\\]|\.[cm]?[jt]sx?$/;
/** What a sandbox already decided when it started, so a run on it cannot choose again. */
const SANDBOX_FIXED = ["--rebuild", "--server-bin", "--own-shell-config", "--selftest"] as const;

export const repeatRefusal = (flag: string) =>
  `${flag} is not supported: a scenario runs once and is never retried, and the N-run loop in .agents/rules/scenarios.md is the only command that repeats runs.`;

export const PERF_QUIET_UNCONFIRMED =
  "the perf run measures nothing until the user confirms the machine is quiet; ask the user, then add --quiet-confirmed";

type Refused = { readonly refusal: string };

/** Why the combination of modes in `options` is refused; undefined when it is a run. */
function modeRefusal(options: LaunchOptions): string | undefined {
  if (options.gate && options.perf) return "--gate and --perf are separate runs; pick one.";
  if (options.quietConfirmed && !options.gate && !options.perf) {
    return "--quiet-confirmed confirms a cap gate or perf run; add --gate or --perf.";
  }
  if (options.gate && options.workers !== undefined) {
    return "--workers does not apply to the cap gate, which runs on one worker.";
  }
  if (options.perf && options.workers !== undefined) {
    return "--workers does not apply to the perf run, which runs on one worker.";
  }
  if (options.perf && options.selftest) {
    return "--perf runs the saved perf scenarios; perf self-tests run with --selftest.";
  }
  if (options.sandbox === undefined) return undefined;
  if (options.gate) {
    return "--gate does not run on a sandbox; the cap gate times scenarios on servers it starts itself.";
  }
  if (options.perf) return "--perf does not run on a sandbox; the perf run starts its own server.";
  if (options.workers !== undefined) {
    return "--workers does not apply to a sandbox, which runs one scenario at a time.";
  }
  const fixed = SANDBOX_FIXED.find((flag) => {
    switch (flag) {
      case "--rebuild":
        return options.rebuild;
      case "--server-bin":
        return options.serverBin !== undefined;
      case "--own-shell-config":
        return options.ownShellConfig;
      case "--selftest":
        return options.selftest;
    }
  });
  if (fixed !== undefined) {
    return `${fixed} does not apply to a sandbox; start a new sandbox instead.`;
  }
  if (options.only.length === 0) {
    return "--sandbox runs saved scenarios; name each with --only <name>.";
  }
  return undefined;
}

/** The launcher's options, or why it refuses them; `cores` bounds `--workers`. */
export function parseLaunchArgs(
  argv: ReadonlyArray<string>,
  cores: number,
): { readonly options: LaunchOptions } | Refused {
  const values = new Map<string, Array<string>>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (REPEAT_FLAGS.includes(flag)) return { refusal: repeatRefusal(flag) };
    if ((SWITCHES as ReadonlyArray<string>).includes(flag) && equals === -1) {
      switches.add(flag);
      continue;
    }
    if (!(VALUE_FLAGS as ReadonlyArray<string>).includes(flag)) {
      if (!arg.startsWith("-")) {
        return {
          refusal: SCRIPT_PATH.test(arg)
            ? `${arg} is a path to a script; scenarios run by their registered id (see "Registering a scenario" in .agents/rules/scenarios.md).`
            : `${arg} is not an option; name a scenario or set with --only ${arg}.`,
        };
      }
      return {
        refusal: `${flag} is not a scenario runner option; it takes ${[...VALUE_FLAGS.map((known) => `${known} <value>`), ...SWITCHES].join(", ")}.`,
      };
    }
    const value = equals === -1 ? argv[index + 1] : arg.slice(equals + 1);
    if (value === undefined || value === "" || (equals === -1 && value.startsWith("--"))) {
      return { refusal: `${flag} needs a value.` };
    }
    if (equals === -1) index++;
    values.set(flag, [...(values.get(flag) ?? []), value]);
  }
  for (const [flag, given] of values) {
    if (flag !== "--only" && given.length > 1) return { refusal: `${flag} is given twice.` };
  }
  const one = (flag: string) => values.get(flag)?.[0];
  const workersArg = one("--workers");
  let workers: number | undefined;
  if (workersArg !== undefined) {
    workers = Number(workersArg);
    if (!Number.isInteger(workers) || workers < 1 || workers > cores) {
      return {
        refusal: `--workers takes a whole number from 1 to ${cores}, this machine's core count, not ${workersArg}.`,
      };
    }
  }
  const sandboxArg = one("--sandbox");
  let sandbox: number | undefined;
  if (sandboxArg !== undefined) {
    sandbox = Number(sandboxArg);
    if (!Number.isInteger(sandbox) || sandbox <= 0) {
      return { refusal: `--sandbox takes the sandbox pid it printed, not ${sandboxArg}.` };
    }
  }
  const options: LaunchOptions = {
    only: values.get("--only") ?? [],
    gate: switches.has("--gate"),
    perf: switches.has("--perf"),
    quietConfirmed: switches.has("--quiet-confirmed"),
    workers,
    selftest: switches.has("--selftest"),
    sandbox,
    rebuild: switches.has("--rebuild"),
    browser: one("--browser"),
    serverBin: one("--server-bin"),
    ownShellConfig: switches.has("--own-shell-config"),
    artifacts: one("--artifacts"),
    list: switches.has("--list"),
  };
  const refusal = modeRefusal(options);
  return refusal === undefined ? { options } : { refusal };
}

export interface Registries {
  readonly suite: Registry;
  /** Every self-test; its perf scenarios are the perf self-tests. */
  readonly selftest: Registry;
  /** What `--selftest` runs with no `--only`, before the perf self-tests. */
  readonly defaultSelftests: ReadonlyArray<Runnable>;
  /** What a run on a sandbox picks from: every saved check, composed scenario and set, self-tests included. */
  readonly sandbox: Registry;
}

export interface PlanContext {
  readonly launcher: ProcessIdentity;
  readonly startedAt: Date;
  readonly cores: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The live sandbox with this pid, or why there is none. */
  readonly findSandbox: (
    pid: number,
  ) => { readonly sandbox: SandboxRecord } | { readonly refusal: string };
  /** The first file that makes the sandbox run older code than the checkout; null when none. */
  readonly staleSandboxFile: (record: SandboxRecord) => string | null;
}

const needsOf = (scenario: Runnable) =>
  scenario.kind === "check" ? scenario.needs : composedNeeds(scenario);

/** Fresh-server scenarios first, so their cold starts overlap the shared servers' work. */
const freshFirst = (scenarios: ReadonlyArray<Runnable>) => {
  const fresh = scenarios.filter((scenario) => freshServerNeeded(needsOf(scenario)));
  return [...fresh, ...scenarios.filter((scenario) => !fresh.includes(scenario))];
};

interface Selection {
  readonly selected: ReadonlyArray<Runnable>;
  readonly perf: ReadonlyArray<PerfScenario>;
  readonly namedSets: ReadonlyArray<string>;
}

/**
 * What `names` select from `registry`, in the order named and each once, or every refusal. A perf
 * id is refused unless `perfAllowed`, and then goes in `perf`.
 */
function select(
  registry: Registry,
  names: ReadonlyArray<string>,
  perfAllowed: boolean,
): Selection | Refused {
  const selected = new Map<string, Runnable>();
  const perf = new Map<string, PerfScenario>();
  const namedSets: Array<string> = [];
  const refusals: Array<string> = [];
  for (const name of names) {
    const resolved = resolveName(registry, name);
    switch (resolved.kind) {
      case "check":
      case "composed":
        selected.set(resolved.scenario.id, resolved.scenario);
        break;
      case "set":
        namedSets.push(resolved.set.name);
        for (const member of resolved.members) selected.set(member.id, member);
        break;
      case "perf":
        if (perfAllowed) perf.set(resolved.scenario.id, resolved.scenario);
        else refusals.push(resolved.refusal);
        break;
      case "unknown":
        refusals.push(resolved.refusal);
        break;
    }
  }
  if (refusals.length > 0) return { refusal: refusals.join(" ") };
  return { selected: [...selected.values()], perf: [...perf.values()], namedSets };
}

/** The perf scenarios `names` pick for the perf run, or why a name has no place in it. */
function selectPerf(
  registry: Registry,
  names: ReadonlyArray<string>,
): { readonly perf: ReadonlyArray<PerfScenario> } | Refused {
  if (names.length === 0) {
    return registry.perfScenarios.length === 0
      ? { refusal: "No perf scenario is registered." }
      : { perf: registry.perfScenarios };
  }
  const perf = new Map<string, PerfScenario>();
  const refusals: Array<string> = [];
  for (const name of names) {
    const resolved = resolveName(registry, name);
    switch (resolved.kind) {
      case "perf":
        perf.set(resolved.scenario.id, resolved.scenario);
        break;
      case "check":
      case "composed":
        refusals.push(
          `${name} is a check scenario; it runs in the check suite (vp run test:scenarios -- --only ${name}), not the perf run.`,
        );
        break;
      case "set":
        refusals.push(`${name} is a set; perf scenarios are never set members, so name perf ids.`);
        break;
      case "unknown":
        refusals.push(resolved.refusal);
        break;
    }
  }
  return refusals.length > 0 ? { refusal: refusals.join(" ") } : { perf: [...perf.values()] };
}

/**
 * The runs `options` start, in order, or why the run is refused; decided before anything starts.
 * `--selftest` is two runs: the check self-tests on the workers, then the perf self-tests on one.
 */
export function planRun(
  options: LaunchOptions,
  registries: Registries,
  context: PlanContext,
): { readonly plans: ReadonlyArray<RunPlan> } | Refused {
  const root =
    options.artifacts === undefined
      ? defaultArtifactsDir(context.startedAt, context.launcher.pid)
      : NodePath.resolve(options.artifacts);
  const common = (mode: RunPlan["mode"], artifactsRoot: string) =>
    ({
      mode,
      artifactsRoot,
      browser: options.browser,
      serverBin: options.serverBin,
      ownShellConfig: options.ownShellConfig,
      launcher: context.launcher,
    }) as const;
  const resultsPath = (artifactsRoot: string) => NodePath.join(artifactsRoot, "results.json");
  const perfPlan = (
    mode: "perf" | "selftest",
    perf: ReadonlyArray<PerfScenario>,
    artifactsRoot: string,
  ): RunPlan => ({
    ...common(mode, artifactsRoot),
    ids: perf.map(({ id }) => id),
    workers: 1,
    reporter: { mode, sets: [], namedSets: [], resultsPath: resultsPath(artifactsRoot) },
  });

  if (options.sandbox !== undefined) {
    return planSandbox(options, options.sandbox, root, registries.sandbox, context);
  }

  if (options.perf) {
    if (!options.quietConfirmed) return { refusal: PERF_QUIET_UNCONFIRMED };
    const picked = selectPerf(registries.suite, options.only);
    if ("refusal" in picked) return picked;
    return { plans: [perfPlan("perf", picked.perf, root)] };
  }

  const registry = options.selftest ? registries.selftest : registries.suite;
  const mode = options.selftest ? "selftest" : "suite";

  if (options.gate) {
    if (!options.quietConfirmed) return { refusal: QUIET_UNCONFIRMED };
    const targets = gateTargets(registry, options.only);
    if (targets.refusals.length > 0) return { refusal: targets.refusals.join("; ") };
    const named = options.only.filter((name) => registry.sets.some((set) => set.name === name));
    return {
      plans: [
        {
          ...common(mode, root),
          ids: targets.timed.map(({ id }) => id),
          workers: 1,
          reporter: {
            mode,
            sets: registry.sets,
            namedSets: named,
            gate: {
              capMs: gateCapMs(context.env),
              notTimed: targets.notTimed.map(({ id }) => id),
            },
            resultsPath: resultsPath(root),
          },
        },
      ],
    };
  }

  const chosen: Selection | Refused =
    options.only.length === 0
      ? options.selftest
        ? { selected: registries.defaultSelftests, perf: registry.perfScenarios, namedSets: [] }
        : { selected: [...registry.checks, ...registry.composed], perf: [], namedSets: [] }
      : select(registry, options.only, options.selftest);
  if ("refusal" in chosen) return chosen;
  const plans: Array<RunPlan> = [];
  if (chosen.selected.length > 0 || chosen.perf.length === 0) {
    plans.push({
      ...common(mode, root),
      ids: freshFirst(chosen.selected).map(({ id }) => id),
      workers: options.workers ?? defaultWorkers(context.cores),
      reporter: {
        mode,
        sets: registry.sets,
        namedSets: chosen.namedSets,
        resultsPath: resultsPath(root),
      },
    });
  }
  if (chosen.perf.length > 0) {
    // Its own folder, so its results and Playwright output never overwrite the first run's.
    const perfRoot = plans.length === 0 ? root : NodePath.join(root, "perf");
    plans.push(perfPlan("selftest", chosen.perf, perfRoot));
  }
  return { plans };
}

/** One run on the sandbox `pid`: what it may run there, the sandbox itself, and its code's age. */
function planSandbox(
  options: LaunchOptions,
  pid: number,
  root: string,
  registry: Registry,
  context: PlanContext,
): { readonly plans: ReadonlyArray<RunPlan> } | Refused {
  const chosen = select(registry, options.only, false);
  if ("refusal" in chosen) return chosen;
  const refusals = sandboxRefusals(chosen.selected);
  if (refusals.length > 0) return { refusal: refusals.join(" ") };
  const found = context.findSandbox(pid);
  if ("refusal" in found) return found;
  const stale = context.staleSandboxFile(found.sandbox);
  if (stale !== null) {
    return {
      refusal: `${stale} changed since sandbox ${pid} started, so it would run older code; start a new sandbox.`,
    };
  }
  return {
    plans: [
      {
        mode: "sandbox",
        artifactsRoot: root,
        browser: options.browser,
        serverBin: undefined,
        ownShellConfig: false,
        launcher: context.launcher,
        ids: chosen.selected.map(({ id }) => id),
        workers: 1,
        sandbox: { pid, record: found.sandbox },
        reporter: {
          mode: "sandbox",
          sandboxPid: pid,
          sets: registry.sets,
          namedSets: chosen.namedSets,
          resultsPath: NodePath.join(root, "results.json"),
        },
      },
    ],
  };
}

const CONFIG = NodeURL.fileURLToPath(new URL("./playwright.config.ts", import.meta.url));
const PLAYWRIGHT_CLI = NodeModule.createRequire(import.meta.url).resolve("@playwright/test/cli");

const write = (line: string) => NodeProcess.stdout.write(`${line}\n`);
const refuse = (why: string, onSandbox = false) => {
  NodeProcess.stderr.write(
    `scenarios: refusing to run${onSandbox ? " on the sandbox" : ""}. ${why}\n`,
  );
  return 2;
};

/**
 * Why this run may not rebuild the bundle: another live run in the same checkout serves it, and a
 * rebuild would change the pages under it. A run that reuses the bundle proceeds.
 */
export function rebuildRefusal(
  rebuild: boolean,
  bundle: Pick<BundleState, "state">,
  users: ReadonlyArray<number>,
): string | undefined {
  if ((!rebuild && bundle.state === "current") || users.length === 0) return undefined;
  const why = rebuild ? "--rebuild asks for a rebuild" : `the web bundle is ${bundle.state}`;
  return `${why}, but run ${users.join(", ")} in this checkout still serves it; wait for that run to end, then start again.`;
}

/**
 * Runs Playwright in its own process group, so a terminal's Ctrl-C reaches only the launcher, which
 * passes one SIGINT on; Playwright then stops its workers through their fixture teardown.
 */
function runPlaywright(
  planFile: string,
  list: boolean,
): Promise<{ code: number; signalled: boolean }> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      NodeProcess.execPath,
      [PLAYWRIGHT_CLI, "test", "-c", CONFIG, ...(list ? ["--list"] : [])],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: {
          ...NodeProcess.env,
          [RUN_PLAN_ENV]: planFile,
          NODE_OPTIONS: [NodeProcess.env.NODE_OPTIONS, "--disable-warning=DEP0205"]
            .filter(Boolean)
            .join(" "),
        },
      },
    );
    let signalled = false;
    const forward = () => {
      if (signalled || child.pid === undefined) return;
      signalled = true;
      try {
        NodeProcess.kill(-child.pid, "SIGINT");
      } catch {
        // Playwright already ended.
      }
    };
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    for (const signal of signals) NodeProcess.on(signal, forward);
    child.once("error", (error) =>
      reject(new Error(`Could not start Playwright: ${error.message}`, { cause: error })),
    );
    child.once("exit", (code) => {
      for (const signal of signals) NodeProcess.off(signal, forward);
      resolve({ code: code ?? 1, signalled });
    });
  });
}

async function main(): Promise<number> {
  const argv = NodeProcess.argv.slice(2);
  const guard = refusalReason(argv, NodeProcess.env);
  if (guard !== undefined) return refuse(guard);
  const cores = NodeOS.availableParallelism();
  const parsed = parseLaunchArgs(argv, cores);
  if ("refusal" in parsed) return refuse(parsed.refusal, argv.includes("--sandbox"));
  const { options } = parsed;
  const onSandbox = options.sandbox !== undefined;

  const suite: Registry = { checks, composed, perfScenarios, sets };
  const selftest = registryOf([...selftests, ...pickedSelftests, ...perfSelftests], selftestSets);
  const sandbox: Registry = {
    checks: [...suite.checks, ...selftest.checks],
    composed: [...suite.composed, ...selftest.composed],
    perfScenarios: [...suite.perfScenarios, ...selftest.perfScenarios],
    sets: [...suite.sets, ...selftest.sets],
  };
  const rejections = validateRegistry(
    onSandbox ? sandbox : options.selftest ? selftest : suite,
    (file) => NodeFS.readFileSync(file, "utf8"),
  );
  if (rejections.length > 0) {
    return refuse(rejections.map(({ name, reason }) => `${name}: ${reason}`).join("; "), onSandbox);
  }

  const launcher = { pid: NodeProcess.pid, startTime: processStartTime(NodeProcess.pid) ?? "" };
  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): names the artifacts folder
  const startedAt = new Date();
  const planned = planRun(
    options,
    { suite, selftest, defaultSelftests: selftests, sandbox },
    {
      launcher,
      startedAt,
      cores,
      env: NodeProcess.env,
      findSandbox: (pid) => findSandbox(pid),
      staleSandboxFile: (record) => staleSandboxFile(REPO_ROOT, record),
    },
  );
  if ("refusal" in planned) return refuse(planned.refusal, onSandbox);
  const { plans } = planned;

  let releaseSandbox = () => {};
  if (options.sandbox !== undefined) {
    const lock = lockSandbox(options.sandbox);
    if ("refusal" in lock) return refuse(lock.refusal, true);
    releaseSandbox = lock.release;
  }
  cleanLeftovers(write);
  const manifest = openManifest();
  try {
    if (!options.list) {
      // Fails on a missing browser before any bundle build or server start.
      const browser = await launchBrowser(options.browser);
      await browser.close();
      const attached = plans[0]?.sandbox;
      if (attached === undefined) {
        const refusal = rebuildRefusal(
          options.rebuild,
          bundleState(REPO_ROOT),
          bundleUsers(REPO_ROOT),
        );
        if (refusal !== undefined) return refuse(refusal);
        const bundle = await ensureWebBundle(REPO_ROOT, options.rebuild, write);
        manifest.useBundle({ root: REPO_ROOT, builtMs: bundle.builtMs });
      } else {
        // The sandbox's server serves the bundle it started with; a run never rebuilds it under it.
        write(
          `scenarios: on sandbox ${attached.pid} (server pid=${attached.record.serverPid} home=${attached.record.home})`,
        );
      }
    }
    let exitCode = 0;
    for (const plan of plans) {
      NodeFS.mkdirSync(plan.artifactsRoot, { recursive: true });
      const planFile = NodePath.join(plan.artifactsRoot, "run-plan.json");
      NodeFS.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
      if (!options.list) {
        write(
          `scenarios: ready (${plan.mode === "perf" ? "perf run, " : ""}${plan.workers} worker${plan.workers === 1 ? "" : "s"}, shells: ${options.ownShellConfig ? "your own shell config" : `${scenarioShell()}, isolated`})`,
        );
      }
      const { code, signalled } = await runPlaywright(planFile, options.list);
      if (signalled) {
        exitCode = 130;
        break;
      }
      exitCode = Math.max(exitCode, code);
    }
    // Sweeps what a killed worker left, while this run still knows it ended.
    cleanLeftovers(write);
    return exitCode;
  } finally {
    manifest.close();
    releaseSandbox();
  }
}

if (import.meta.main) {
  main()
    .catch((error: unknown) => {
      NodeProcess.stderr.write(
        `scenarios: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    })
    .then((code) => NodeProcess.exit(code));
}
