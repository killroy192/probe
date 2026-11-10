// @effect-diagnostics nodeBuiltinImport:off - Runs the harness's own entry points as real subprocesses, for its tests.

import * as NodeChildProcess from "node:child_process";

import { REPO_ROOT } from "./server.ts";

export interface Spawned {
  readonly child: NodeChildProcess.ChildProcess;
  /** Resolves with the first output match of `pattern`, from the start of the output on. */
  readonly line: (pattern: RegExp) => Promise<RegExpMatchArray>;
  readonly output: () => string;
  readonly done: Promise<{ readonly code: number | null; readonly output: string }>;
}

/** Starts `node <script> <args>` from the checkout, reading stdout and stderr together. */
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
  return {
    child,
    line: (pattern) =>
      new Promise((resolve) => {
        const match = output.match(pattern);
        if (match) resolve(match);
        else waiters.push({ pattern, resolve });
      }),
    output: () => output,
    done: new Promise((resolve) => child.once("exit", (code) => resolve({ code, output }))),
  };
}
