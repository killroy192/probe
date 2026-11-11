// @effect-diagnostics nodeBuiltinImport:off - Runs git on the scenario's throwaway fixtures, writes their starting scripts and permissions, and reads the server runtime file.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { StartingScript } from "@t3tools/contracts";

import { gitEnv } from "../isolation.ts";
import type { ScenarioContext } from "../scenario.ts";
import type { ServerHandle } from "../server.ts";
import { unlessRoot } from "./report.ts";
import { check } from "./waits.ts";

/** Git for fixtures, with the harness's own config, never the developer's. */
export const git = (cwd: string, args: ReadonlyArray<string>) =>
  new Promise<{ readonly ok: boolean; readonly stdout: string }>((resolve) => {
    NodeChildProcess.execFile(
      "git",
      args,
      { cwd, encoding: "utf8", env: gitEnv() },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    );
  });

/** The git fixture runner; the harness's git config gives commits an identity. */
export async function gitOk(cwd: string, ...args: Array<string>) {
  const result = await git(cwd, args);
  check(result.ok, `git ${args.join(" ")} failed in the fixture.`);
  return result.stdout.trim();
}

/** The user's starting scripts file in a harness home; the server reads it on every use. */
export const startingScriptsFile = (home: string) =>
  NodePath.join(home, "userdata", "starting-scripts.json");

export async function readStartingScripts(home: string): Promise<ReadonlyArray<StartingScript>> {
  const saved = JSON.parse(await NodeFSP.readFile(startingScriptsFile(home), "utf8"));
  return saved.scripts;
}

/** Replaces the saved list, as an edit outside Probe would. */
export async function writeStartingScripts(home: string, scripts: ReadonlyArray<StartingScript>) {
  await NodeFSP.mkdir(NodePath.dirname(startingScriptsFile(home)), { recursive: true });
  await NodeFSP.writeFile(startingScriptsFile(home), JSON.stringify({ version: 1, scripts }));
}

/** Adds a script after the saved ones, such as the mock agent the harness starts with. */
export async function addStartingScript(home: string, script: StartingScript) {
  await writeStartingScripts(home, [...(await readStartingScripts(home)), script]);
}

/** The pid in `server`'s runtime file, the process that holds its home. */
export async function runtimePid(server: Pick<ServerHandle, "home">): Promise<number> {
  const file = NodePath.join(server.home, "userdata", "server-runtime.json");
  return (JSON.parse(await NodeFSP.readFile(file, "utf8")) as { readonly pid: number }).pid;
}

/**
 * Runs `run` with write access to `path` taken away (read access too when `unreadable`), and
 * gives it back when the step ends, pass or fail. As root it skips `run` saying why.
 */
export async function revokeWrite(
  context: Pick<ScenarioContext, "scenarioId" | "onStepEnd">,
  path: string,
  what: string,
  run: () => Promise<void>,
  options?: { readonly unreadable?: true },
): Promise<void> {
  await unlessRoot(context.scenarioId, what, async () => {
    const mode = (await NodeFSP.stat(path)).mode & 0o777;
    await NodeFSP.chmod(path, options?.unreadable ? 0 : mode & ~0o222);
    context.onStepEnd(`write access to ${path}`, () => NodeFSP.chmod(path, mode));
    await run();
  });
}
