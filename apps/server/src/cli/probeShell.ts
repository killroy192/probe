// Runs inside a shell on every `probe` call, before the full CLI loads, so it stays dependency-free.
// @effect-diagnostics globalFetch:off
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import { SHELL_ENV } from "../terminal/shellEnv.ts";

const USAGE = "usage: probe kill    end this shell and everything it started";

interface ProbeShellIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly readFile: (path: string) => Promise<string>;
  readonly stderr: (text: string) => void;
}

/** `probe <command>` inside a Probe shell; resolves to the exit code. */
export async function runProbeShell(
  args: ReadonlyArray<string>,
  io: ProbeShellIo,
): Promise<number> {
  if (args.length !== 1 || args[0] !== "kill") {
    io.stderr(`${USAGE}\n`);
    return 2;
  }
  const token = io.env[SHELL_ENV.token];
  const endpointFile = io.env[SHELL_ENV.endpointFile];
  const fail = (reason: string) => {
    io.stderr(`probe kill: could not reach Probe (${reason}); this shell keeps running.\n`);
    return 1;
  };
  if (!token || (!io.env[SHELL_ENV.endpoint] && !endpointFile)) {
    return fail("this is not a Probe shell");
  }
  try {
    const endpoint = io.env[SHELL_ENV.endpoint] || (await io.readFile(endpointFile!)).trim();
    // On success the server ends this process with the shell, usually before the reply arrives.
    const response = await io.fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) return 0;
    return fail(
      response.status === 401 ? "Probe does not know this shell" : `HTTP ${response.status}`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function runProbeShellCli(args: ReadonlyArray<string>): Promise<void> {
  process.exitCode = await runProbeShell(args, {
    env: process.env,
    fetch: (url, init) => fetch(url, init),
    readFile: (path) => NodeFSP.readFile(path, "utf8"),
    stderr: (text) => process.stderr.write(text),
  });
}
