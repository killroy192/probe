// @effect-diagnostics nodeBuiltinImport:off - Scenario runner owns host directories and processes directly.

import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ProcessIdentity, SandboxRecord } from "./cleanup.ts";
import type { ReporterOptions } from "./reporter.ts";

// Pointing the harness at existing data or a server is never allowed; these flags only exist to
// be refused with a clear message.
const TARGET_FLAGS = ["--base-dir", "--home-dir", "--server", "--server-url", "--url"] as const;
const HOME_ENV_KEYS = ["T3CODE_HOME", "T3CODE_BASE_DIR"] as const;

export interface SandboxOptions {
  readonly fixture: string | undefined;
  /** Leaves the home in place when the sandbox stops, for reading after a failure. */
  readonly keepHome: boolean;
  readonly rebuild: boolean;
  readonly serverBin: string | undefined;
}

const SANDBOX_VALUE_FLAGS = ["--fixture", "--server-bin"];
const SANDBOX_SWITCHES = ["--keep-home", "--rebuild"];

/** The sandbox's options; throws naming an argument it does not take. */
export function parseSandboxArgs(argv: ReadonlyArray<string>): SandboxOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (SANDBOX_SWITCHES.includes(arg)) continue;
    if (!SANDBOX_VALUE_FLAGS.includes(arg)) {
      throw new Error(
        `${arg} is not a sandbox option; it takes ${[...SANDBOX_VALUE_FLAGS.map((flag) => `${flag} <value>`), ...SANDBOX_SWITCHES].join(", ")}.`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
    values.set(arg, value);
    index++;
  }
  return {
    fixture: values.get("--fixture"),
    keepHome: argv.includes("--keep-home"),
    rebuild: argv.includes("--rebuild"),
    serverBin: values.get("--server-bin"),
  };
}

const isUnder = (child: string, parent: string) => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

/** Returns why the run must not start, or undefined when it targets only throwaway state. */
export function refusalReason(
  argv: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
  homeDirectory = NodeOS.homedir(),
): string | undefined {
  const realData = NodePath.join(homeDirectory, ".t3");
  for (const flag of TARGET_FLAGS) {
    const index = argv.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
    if (index === -1) continue;
    const value = argv[index]!.includes("=") ? argv[index]!.split("=")[1] : argv[index + 1];
    if (/^(--server|--server-url|--url)$/.test(flag)) {
      return `Scenarios only run against a server they start themselves; ${flag} is not supported.`;
    }
    if (value && isUnder(NodePath.resolve(value), realData)) {
      return `${flag} points at your real Probe data (${realData}); scenarios use a throwaway directory.`;
    }
    return `${flag} is not supported; scenarios always create their own throwaway directory.`;
  }
  for (const key of HOME_ENV_KEYS) {
    const value = env[key];
    if (value && isUnder(NodePath.resolve(value), realData)) {
      return `${key} points at your real Probe data (${realData}); scenarios use a throwaway directory.`;
    }
  }
  return undefined;
}

export async function createThrowawayHome(): Promise<string> {
  return await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "probe-scenario-"));
}

/**
 * The default folder for this run's failure artifacts; never under a throwaway home. The pid tells
 * apart two runs that start in the same millisecond.
 */
export const defaultArtifactsDir = (startedAt: Date, pid?: number) =>
  NodePath.join(
    NodeOS.tmpdir(),
    "probe-scenario-artifacts",
    `${startedAt.toISOString().replace(/[:.]/g, "-")}${pid === undefined ? "" : `-${pid}`}`,
  );

/** Workers when none are asked for: half the cores, at least one and at most four. */
export const defaultWorkers = (cores: number) => Math.min(4, Math.max(1, Math.floor(cores / 2)));

/** Names the run plan file for Playwright's processes; not `PROBE_*`, which servers never inherit. */
export const RUN_PLAN_ENV = "SCENARIO_RUN_PLAN";

/** What the launcher decided before Playwright starts; its config, spec and fixtures read it. */
export interface RunPlan {
  readonly mode: "suite" | "selftest" | "perf" | "sandbox";
  /** The ids to declare as tests, in this order: fresh-server scenarios first. */
  readonly ids: ReadonlyArray<string>;
  readonly workers: number;
  readonly artifactsRoot: string;
  readonly browser: string | undefined;
  readonly serverBin: string | undefined;
  readonly ownShellConfig: boolean;
  /** The launcher, recorded as the `run` of every manifest its Playwright processes write. */
  readonly launcher: ProcessIdentity;
  /** The live sandbox the run attaches to instead of starting servers; its pid is the sandbox's own. */
  readonly sandbox?: { readonly pid: number; readonly record: SandboxRecord };
  readonly reporter: ReporterOptions;
}

/** The plan the launcher handed over, or undefined when Playwright was started without one. */
export function readRunPlan(
  env: Readonly<Record<string, string | undefined>>,
): RunPlan | undefined {
  const file = env[RUN_PLAN_ENV];
  if (file === undefined || file === "") return undefined;
  return JSON.parse(NodeFS.readFileSync(file, "utf8")) as RunPlan;
}

export async function removeThrowawayHome(home: string): Promise<void> {
  await NodeFSP.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
