#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The loop starts the launcher as a child, reads its results files and compares source file times with its start.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { bundleInputs, newestOf, serverInputs } from "./bundle.ts";
import { refusalReason } from "./environment.ts";
import { checks, composed, perfScenarios, sets } from "./registry.ts";
import { type Registry, resolveName } from "./registryRules.ts";
import { REPO_ROOT } from "./server.ts";

export interface LoopOptions {
  /** N: how many times each of the check run and the perf run goes. */
  readonly runs: number;
  readonly only: ReadonlyArray<string>;
  readonly quietConfirmed: boolean;
}

type Refused = { readonly refusal: string };

const USAGE = "vp run test:scenarios:loop -- <N> [--only <name>]... [--quiet-confirmed]";

/** The loop's options, or why it refuses them. N is its only repeat; it takes no other. */
export function parseLoopArgs(
  argv: ReadonlyArray<string>,
): { readonly options: LoopOptions } | Refused {
  const only: Array<string> = [];
  let quietConfirmed = false;
  let runs: number | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    // `vp run <script> -- <args>` passes its separator through.
    if (arg === "--") continue;
    if (arg === "--quiet-confirmed") {
      quietConfirmed = true;
      continue;
    }
    if (arg === "--only" || arg.startsWith("--only=")) {
      const value = arg === "--only" ? argv[++index] : arg.slice("--only=".length);
      if (value === undefined || value === "" || value.startsWith("--")) {
        return { refusal: "--only needs a value." };
      }
      only.push(value);
      continue;
    }
    if (arg.startsWith("-")) {
      return {
        refusal: `${arg.split("=", 1)[0]} is not a loop option; the loop takes ${USAGE}, and N is its only repeat.`,
      };
    }
    if (runs !== undefined) return { refusal: `${arg} is a second N; the loop takes ${USAGE}.` };
    runs = Number(arg);
    if (!Number.isInteger(runs) || runs < 1) {
      return { refusal: `N is the number of runs, a whole number of at least 1, not ${arg}.` };
    }
  }
  if (runs === undefined) return { refusal: `The loop needs N, the number of runs: ${USAGE}.` };
  return { options: { runs, only, quietConfirmed } };
}

export const LOOP_QUIET_UNCONFIRMED =
  "the loop runs the perf run too, which measures nothing until the user confirms the machine is quiet; ask the user, then add --quiet-confirmed";

/** The launcher arguments of each of the loop's two runs; undefined when that run has nothing. */
export interface LoopPlan {
  readonly check: ReadonlyArray<string> | undefined;
  readonly perf: ReadonlyArray<string> | undefined;
}

/**
 * What the loop runs N times: the check suite then the perf run, or what `--only` names, split by
 * kind. The perf run needs the user's confirmation that the machine is quiet.
 */
export function planLoop(
  options: LoopOptions,
  registry: Registry,
): { readonly plan: LoopPlan } | Refused {
  const perfRun = (names: ReadonlyArray<string>) => [
    "--perf",
    "--quiet-confirmed",
    ...names.flatMap((name) => ["--only", name]),
  ];
  if (options.only.length === 0) {
    if (!options.quietConfirmed) {
      return { refusal: `${LOOP_QUIET_UNCONFIRMED}, or name what to loop with --only <name>.` };
    }
    return { plan: { check: [], perf: perfRun([]) } };
  }
  const checkNames: Array<string> = [];
  const perfNames: Array<string> = [];
  const refusals: Array<string> = [];
  for (const name of options.only) {
    const resolved = resolveName(registry, name);
    if (resolved.kind === "unknown") refusals.push(resolved.refusal);
    else (resolved.kind === "perf" ? perfNames : checkNames).push(name);
  }
  if (refusals.length > 0) return { refusal: refusals.join(" ") };
  if (perfNames.length > 0 && !options.quietConfirmed) {
    return { refusal: `${perfNames.join(", ")}: ${LOOP_QUIET_UNCONFIRMED}.` };
  }
  return {
    plan: {
      check: checkNames.length === 0 ? undefined : checkNames.flatMap((name) => ["--only", name]),
      perf: perfNames.length === 0 ? undefined : perfRun(perfNames),
    },
  };
}

/** What the loop reads from the `results.json` a run's reporter writes. */
export interface RunResults {
  readonly scenarios: ReadonlyArray<{ readonly id: string; readonly outcome: string }>;
}

/** Each id's failures over `runs`, in the order ids first ran. */
export function tally(
  runs: ReadonlyArray<RunResults>,
): ReadonlyArray<{ readonly id: string; readonly failed: number; readonly ran: number }> {
  const counts = new Map<string, { failed: number; ran: number }>();
  for (const run of runs) {
    for (const { id, outcome } of run.scenarios) {
      const count = counts.get(id) ?? { failed: 0, ran: 0 };
      count.ran += 1;
      if (outcome !== "passed") count.failed += 1;
      counts.set(id, count);
    }
  }
  return [...counts].map(([id, count]) => ({ id, ...count }));
}

/** The files a run loads: the harness, the mock agent, the server and the web bundle's sources. */
export const loopInputs = (root: string) => [
  NodePath.join(root, "scripts", "scenarios"),
  NodePath.join(root, "scripts", "mock-agent"),
  ...serverInputs(root),
  ...bundleInputs(root),
];

/** Why the loop stops before a run: a source changed since it started, so runs would differ. */
export function changedSource(
  root: string,
  newest: { readonly path: string; readonly mtimeMs: number } | null,
  startedMs: number,
): string | undefined {
  if (newest === null || newest.mtimeMs <= startedMs) return undefined;
  return `${NodePath.relative(root, newest.path)} changed since the loop started; every run must see the same code, so the loop stops.`;
}

const CLI = NodeURL.fileURLToPath(new URL("./cli.ts", import.meta.url));
const write = (line: string) => NodeProcess.stdout.write(`${line}\n`);

let child: NodeChildProcess.ChildProcess | undefined;
let interrupted = false;

function runLauncher(args: ReadonlyArray<string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = NodeChildProcess.spawn(NodeProcess.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    child = started;
    started.once("error", (error) =>
      reject(new Error(`Could not start the launcher: ${error.message}`, { cause: error })),
    );
    started.once("exit", (code) => {
      child = undefined;
      resolve(code ?? 1);
    });
  });
}

function readResults(dir: string): RunResults | undefined {
  try {
    return JSON.parse(
      NodeFS.readFileSync(NodePath.join(dir, "results.json"), "utf8"),
    ) as RunResults;
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const argv = NodeProcess.argv.slice(2);
  const refuse = (why: string) => {
    NodeProcess.stderr.write(`loop: refusing to run. ${why}\n`);
    return 2;
  };
  const guard = refusalReason(argv, NodeProcess.env);
  if (guard !== undefined) return refuse(guard);
  const parsed = parseLoopArgs(argv);
  if ("refusal" in parsed) return refuse(parsed.refusal);
  const planned = planLoop(parsed.options, { checks, composed, perfScenarios, sets });
  if ("refusal" in planned) return refuse(planned.refusal);
  const { runs } = parsed.options;
  const { plan } = planned;

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      interrupted = true;
      // A terminal's Ctrl-C reaches the launcher too; it stops once however often it is told.
      child?.kill(signal);
    });
  }

  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): compared with source file times, and names the loop's folder
  const startedAt = new Date();
  const root = NodePath.join(
    NodeOS.tmpdir(),
    "probe-scenario-artifacts",
    `loop-${startedAt.toISOString().replace(/[:.]/g, "-")}-${NodeProcess.pid}`,
  );
  const kinds = [
    { kind: "check", args: plan.check },
    { kind: "perf", args: plan.perf },
  ] as const;
  const results: Record<"check" | "perf", Array<RunResults>> = { check: [], perf: [] };
  for (const { kind, args } of kinds) {
    if (args === undefined) continue;
    for (let n = 1; n <= runs; n++) {
      const changed = changedSource(
        REPO_ROOT,
        newestOf(loopInputs(REPO_ROOT)),
        startedAt.getTime(),
      );
      if (changed !== undefined) {
        NodeProcess.stderr.write(`loop: ${changed}\n`);
        return 1;
      }
      const dir = NodePath.join(root, `${kind}-${n}`);
      write(`loop: ${kind} run ${n}/${runs}`);
      const code = await runLauncher([...args, "--artifacts", dir]);
      if (interrupted) {
        write(`loop: interrupted in ${kind} run ${n}/${runs}`);
        return 130;
      }
      const read = readResults(dir);
      if (read === undefined) {
        NodeProcess.stderr.write(
          `loop: ${kind} run ${n}/${runs} wrote no results (exit code ${code}); the loop stops.\n`,
        );
        return 1;
      }
      results[kind].push(read);
    }
  }

  let failures = 0;
  for (const { kind, args } of kinds) {
    if (args === undefined) continue;
    for (const { id, failed, ran } of tally(results[kind])) {
      failures += failed;
      write(`loop: ${id} failed ${failed}/${ran}`);
    }
  }
  write(
    `loop: ${failures} failures in ${plan.check === undefined ? 0 : runs} check runs and ${plan.perf === undefined ? 0 : runs} perf runs; artifacts under ${root}`,
  );
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  main()
    .catch((error: unknown) => {
      NodeProcess.stderr.write(`loop: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    })
    .then((code) => NodeProcess.exit(code));
}
