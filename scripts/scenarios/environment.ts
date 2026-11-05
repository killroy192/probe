// @effect-diagnostics nodeBuiltinImport:off - Scenario runner owns host directories and processes directly.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface RunOptions {
  readonly selftest: boolean;
  readonly rebuild: boolean;
  readonly browser: string | undefined;
  readonly serverBin: string | undefined;
  /** Runs only the scenario with this id. */
  readonly only: string | undefined;
}

const VALUE_FLAGS = ["--browser", "--server-bin", "--only"] as const;
// Pointing the harness at existing data or a server is never allowed; these flags only exist to
// be refused with a clear message.
const TARGET_FLAGS = ["--base-dir", "--home-dir", "--server", "--server-url", "--url"] as const;
const HOME_ENV_KEYS = ["T3CODE_HOME", "T3CODE_BASE_DIR"] as const;

export function parseArgs(argv: ReadonlyArray<string>): RunOptions {
  const flagValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  for (const flag of VALUE_FLAGS) {
    if (argv.includes(flag) && !flagValue(flag)) throw new Error(`${flag} needs a value.`);
  }
  return {
    selftest: argv.includes("--selftest"),
    rebuild: argv.includes("--rebuild"),
    browser: flagValue("--browser"),
    serverBin: flagValue("--server-bin"),
    only: flagValue("--only"),
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

export async function removeThrowawayHome(home: string): Promise<void> {
  await NodeFSP.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
