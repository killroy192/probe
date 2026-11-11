// @effect-diagnostics nodeBuiltinImport:off - Runs the harness's own entry points as real subprocesses, for its tests.

import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";

import { onTestFinished } from "vite-plus/test";

import { REPO_ROOT } from "./server.ts";

const LAST_LINES = 50;

export interface Spawned {
  readonly child: NodeChildProcess.ChildProcess;
  /** Resolves with the first output match of `pattern`, from the start of the output on. */
  readonly line: (pattern: RegExp) => Promise<RegExpMatchArray>;
  readonly output: () => string;
  readonly done: Promise<{ readonly code: number | null; readonly output: string }>;
}

/**
 * Starts `node <script> <args>` from the checkout, reading stdout and stderr together. A child still
 * running when the test ends gets SIGTERM, and its last lines are printed.
 */
export function spawnScript(
  script: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = {},
): Spawned {
  const child = NodeChildProcess.spawn("node", [script, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const waiters: Array<{ pattern: RegExp; resolve: (match: RegExpMatchArray) => void }> = [];
  const onData = (chunk: Buffer) => {
    output += chunk.toString();
    for (const waiter of waiters.slice()) {
      const match = output.match(waiter.pattern);
      if (match) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(match);
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const exited = new Promise<{ readonly code: number | null; readonly output: string }>((resolve) =>
    child.once("exit", (code) => resolve({ code, output })),
  );
  // Waits for the exit, so what the child started is stopped before the next test.
  onTestFinished(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const last = output.split("\n").slice(-LAST_LINES).join("\n");
    NodeProcess.stderr.write(
      `${script} ${args.join(" ")} was still running when the test ended; sent SIGTERM. Its last ${LAST_LINES} lines:\n${last}\n`,
    );
    child.kill("SIGTERM");
    await exited;
  });
  return {
    child,
    line: (pattern) =>
      new Promise((resolve) => {
        const match = output.match(pattern);
        if (match) resolve(match);
        else waiters.push({ pattern, resolve });
      }),
    output: () => output,
    done: exited,
  };
}
