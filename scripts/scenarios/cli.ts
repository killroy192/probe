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
import { ensureWebBundle } from "./bundle.ts";
import { cleanLeftovers, openManifest, processStartTime, type ProcessIdentity } from "./cleanup.ts";
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
import { REPO_ROOT } from "./server.ts";

export interface LaunchOptions {
  /** Every `--only`: ids, sets and composed scenarios, in the order given. */
  readonly only: ReadonlyArray<string>;
  readonly gate: boolean;
  readonly quietConfirmed: boolean;
  readonly workers: number | undefined;
  readonly selftest: boolean;
  readonly rebuild: boolean;
  readonly browser: string | undefined;
  readonly serverBin: string | undefined;
  readonly ownShellConfig: boolean;
  readonly artifacts: string | undefined;
  /** Lists what the run would declare; starts no browser, bundle build or server. */
  readonly list: boolean;
}

const VALUE_FLAGS = ["--only", "--workers", "--browser", "--server-bin", "--artifacts"] as const;
const SWITCHES = [
  "--gate",
  "--quiet-confirmed",
  "--selftest",
  "--rebuild",
  "--own-shell-config",
  "--list",
] as const;
const REPEAT_FLAGS = ["--retries", "--retry", "--repeat-each", "--repeat"];
const SCRIPT_PATH = /[/\\]|\.[cm]?[jt]sx?$/;

export const repeatRefusal = (flag: string) =>
  `${flag} is not supported: a scenario runs once and is never retried, and the N-run loop in .agents/rules/scenarios.md is the only command that repeats runs.`;

type Refused = { readonly refusal: string };

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
  const options: LaunchOptions = {
    only: values.get("--only") ?? [],
    gate: switches.has("--gate"),
    quietConfirmed: switches.has("--quiet-confirmed"),
    workers,
    selftest: switches.has("--selftest"),
    rebuild: switches.has("--rebuild"),
    browser: one("--browser"),
    serverBin: one("--server-bin"),
    ownShellConfig: switches.has("--own-shell-config"),
    artifacts: one("--artifacts"),
    list: switches.has("--list"),
  };
  if (options.quietConfirmed && !options.gate) {
    return { refusal: "--quiet-confirmed confirms a cap gate run; add --gate." };
  }
  if (options.gate && options.workers !== undefined) {
    return { refusal: "--workers does not apply to the cap gate, which runs on one worker." };
  }
  return { options };
}

export interface Registries {
  readonly suite: Registry;
  readonly selftest: Registry;
  /** What `--selftest` runs with no `--only`. */
  readonly defaultSelftests: ReadonlyArray<Runnable>;
}

export interface PlanContext {
  readonly launcher: ProcessIdentity;
  readonly startedAt: Date;
  readonly cores: number;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const needsOf = (scenario: Runnable) =>
  scenario.kind === "check" ? scenario.needs : composedNeeds(scenario);

/** Fresh-server scenarios first, so their cold starts overlap the shared servers' work. */
const freshFirst = (scenarios: ReadonlyArray<Runnable>) => {
  const fresh = scenarios.filter((scenario) => freshServerNeeded(needsOf(scenario)));
  return [...fresh, ...scenarios.filter((scenario) => !fresh.includes(scenario))];
};

/** What `names` select from `registry`, in the order named and each once, or every refusal. */
function select(
  registry: Registry,
  names: ReadonlyArray<string>,
):
  | { readonly selected: ReadonlyArray<Runnable>; readonly namedSets: ReadonlyArray<string> }
  | Refused {
  const selected = new Map<string, Runnable>();
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
      case "unknown":
        refusals.push(resolved.refusal);
        break;
    }
  }
  if (refusals.length > 0) return { refusal: refusals.join(" ") };
  return { selected: [...selected.values()], namedSets };
}

/** The run plan for `options`, or why the run is refused; decided before anything starts. */
export function planRun(
  options: LaunchOptions,
  registries: Registries,
  context: PlanContext,
): { readonly plan: RunPlan } | Refused {
  const registry = options.selftest ? registries.selftest : registries.suite;
  const mode = options.selftest ? "selftest" : "suite";
  const artifactsRoot =
    options.artifacts === undefined
      ? defaultArtifactsDir(context.startedAt, context.launcher.pid)
      : NodePath.resolve(options.artifacts);
  const common = {
    mode,
    artifactsRoot,
    browser: options.browser,
    serverBin: options.serverBin,
    ownShellConfig: options.ownShellConfig,
    launcher: context.launcher,
  } as const;
  const resultsPath = NodePath.join(artifactsRoot, "results.json");

  if (options.gate) {
    if (!options.quietConfirmed) return { refusal: QUIET_UNCONFIRMED };
    const targets = gateTargets(registry, options.only);
    if (targets.refusals.length > 0) return { refusal: targets.refusals.join("; ") };
    const named = options.only.filter((name) => registry.sets.some((set) => set.name === name));
    return {
      plan: {
        ...common,
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
          resultsPath,
        },
      },
    };
  }

  const chosen =
    options.only.length === 0
      ? {
          selected: options.selftest
            ? registries.defaultSelftests
            : [...registry.checks, ...registry.composed],
          namedSets: [],
        }
      : select(registry, options.only);
  if ("refusal" in chosen) return chosen;
  return {
    plan: {
      ...common,
      ids: freshFirst(chosen.selected).map(({ id }) => id),
      workers: options.workers ?? defaultWorkers(context.cores),
      reporter: { mode, sets: registry.sets, namedSets: chosen.namedSets, resultsPath },
    },
  };
}

const CONFIG = NodeURL.fileURLToPath(new URL("./playwright.config.ts", import.meta.url));
const PLAYWRIGHT_CLI = NodeModule.createRequire(import.meta.url).resolve("@playwright/test/cli");

const write = (line: string) => NodeProcess.stdout.write(`${line}\n`);
const refuse = (why: string) => {
  NodeProcess.stderr.write(`scenarios: refusing to run. ${why}\n`);
  return 2;
};

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
  if ("refusal" in parsed) return refuse(parsed.refusal);
  const { options } = parsed;

  const suite: Registry = { checks, composed, perfScenarios, sets };
  const selftest = registryOf([...selftests, ...pickedSelftests], selftestSets);
  const rejections = validateRegistry(options.selftest ? selftest : suite, (file) =>
    NodeFS.readFileSync(file, "utf8"),
  );
  if (rejections.length > 0) {
    return refuse(rejections.map(({ name, reason }) => `${name}: ${reason}`).join("; "));
  }

  const launcher = { pid: NodeProcess.pid, startTime: processStartTime(NodeProcess.pid) ?? "" };
  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): names the artifacts folder
  const startedAt = new Date();
  const planned = planRun(
    options,
    { suite, selftest, defaultSelftests: selftests },
    { launcher, startedAt, cores, env: NodeProcess.env },
  );
  if ("refusal" in planned) return refuse(planned.refusal);
  const { plan } = planned;

  cleanLeftovers(write);
  const manifest = openManifest();
  try {
    if (!options.list) {
      // Fails on a missing browser before any bundle build or server start.
      const browser = await launchBrowser(options.browser);
      await browser.close();
      await ensureWebBundle(REPO_ROOT, options.rebuild, write);
    }
    NodeFS.mkdirSync(plan.artifactsRoot, { recursive: true });
    const planFile = NodePath.join(plan.artifactsRoot, "run-plan.json");
    NodeFS.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    if (!options.list) {
      write(
        `scenarios: ready (${plan.workers} worker${plan.workers === 1 ? "" : "s"}, shells: ${options.ownShellConfig ? "your own shell config" : `${scenarioShell()}, isolated`})`,
      );
    }
    const { code, signalled } = await runPlaywright(planFile, options.list);
    // Sweeps what a killed worker left, while this run still knows it ended.
    cleanLeftovers(write);
    return signalled ? 130 : code;
  } finally {
    manifest.close();
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
