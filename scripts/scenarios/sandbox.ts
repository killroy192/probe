#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The sandbox owns its server process, home and log file directly.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { ensureWebBundle } from "./bundle.ts";
import {
  cleanLeftovers,
  killServerTree,
  type ManifestEntry,
  openManifest,
  processStartTime,
  sandboxLogFile,
} from "./cleanup.ts";
import {
  createThrowawayHome,
  parseSandboxArgs,
  refusalReason,
  removeThrowawayHome,
  type SandboxOptions,
} from "./environment.ts";
import { sandboxFixtures, selftestFixtures } from "./fixtures.ts";
import { REPO_ROOT, shellHostPidIn, startServer, type ServerHandle } from "./server.ts";

/**
 * Keeps one harness server up on a throwaway home until its own pid is stopped, so saved scenarios
 * run against it with `test:scenarios -- --sandbox <pid> --only <id>`. Every fact is one
 * `sandbox: <key>=<value>` line; the pid comes first because it is the only way to stop it.
 */
const write = (key: string, value: string | number) =>
  NodeProcess.stdout.write(`sandbox: ${key}=${value}\n`);
const note = (line: string) => NodeProcess.stdout.write(`${line}\n`);

let options: SandboxOptions | undefined;
let manifest: ReturnType<typeof openManifest> | undefined;
let home: string | undefined;
let entry: ManifestEntry | undefined;
let server: ServerHandle | undefined;
let stopping: Promise<void> | undefined;

/** Ends the server, its shell host and shells by recorded pid, and removes the home unless kept. */
function stop(): Promise<void> {
  stopping ??= (async () => {
    await server?.kill().catch(() => undefined);
    const keepHome = options?.keepHome ?? false;
    if (entry !== undefined) killServerTree(entry, { keepHome });
    else if (home !== undefined && !keepHome) await removeThrowawayHome(home);
    manifest?.close();
  })();
  return stopping;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    void stop().then(() => NodeProcess.exit(0));
  });
}

async function main(): Promise<number> {
  write("pid", NodeProcess.pid);
  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): compared with source file times
  const startedMs = Date.now();
  const argv = NodeProcess.argv.slice(2);
  const refusal = refusalReason(argv, NodeProcess.env);
  if (refusal) {
    NodeProcess.stderr.write(`sandbox: refusing to start. ${refusal}\n`);
    return 2;
  }
  const parsed = parseSandboxArgs(argv);
  options = parsed;
  const fixture =
    parsed.fixture === undefined
      ? undefined
      : (sandboxFixtures[parsed.fixture] ?? selftestFixtures[parsed.fixture]);
  if (parsed.fixture !== undefined && fixture === undefined) {
    NodeProcess.stderr.write(
      `sandbox: refusing to start. No fixture is named ${parsed.fixture}; the fixtures are ${Object.keys(sandboxFixtures).join(", ")}.\n`,
    );
    return 2;
  }

  cleanLeftovers(note);
  manifest = openManifest();
  const bundle = await ensureWebBundle(REPO_ROOT, parsed.rebuild, note);

  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): the PID-reuse guard's timestamp
  const homeCreatedMs = Date.now();
  home = await createThrowawayHome();
  const throwawayHome = home;
  write("home", throwawayHome);
  const logFile = sandboxLogFile(NodeProcess.pid);
  const log = NodeFS.openSync(logFile, "w");
  let ended: (how: string) => void = () => {};
  const serverEnded = new Promise<never>((_, reject) => {
    ended = (how) =>
      reject(new Error(`The sandbox's server ended on its own (${how}); the sandbox stops.`));
  });
  server = await startServer({
    home: throwawayHome,
    serverBin: parsed.serverBin,
    onSpawn: (pid) => {
      entry = {
        kind: "server",
        pid,
        startTime: processStartTime(pid) ?? "",
        home: throwawayHome,
        homeCreatedMs,
      };
      manifest?.add(entry);
    },
    onOutput: (chunk) => NodeFS.writeSync(log, chunk),
    onExit: (how) => {
      if (stopping === undefined) ended(how);
    },
  });
  write("origin", server.origin);
  write("server-pid", server.pid());

  if (fixture !== undefined) {
    const state = await fixture(server, NodeCrypto.randomBytes(3).toString("hex"));
    write(
      "fixture",
      `${parsed.fixture} workspace=${state.workspace} project=${state.project} shells=${state.shellIds.length}`,
    );
  }
  // Recorded once seeded, so no run finds a half-seeded sandbox.
  manifest.describeSandbox({
    origin: server.origin,
    home: throwawayHome,
    serverPid: server.pid(),
    logFile,
    startedMs,
    bundleBuiltMs: bundle.builtMs,
  });
  write(
    "bundle",
    `apps/web/dist built ${bundle.builtMs === null ? "never" : new Date(bundle.builtMs).toISOString()}`,
  );
  write("pairing-url", await server.pairingUrl());

  // The shell host starts with the first shell, which may come from a later run.
  let shellHost: number | null = null;
  const reportShellHost = () => {
    const pid = shellHostPidIn(throwawayHome);
    if (pid === null || pid === shellHost) return;
    shellHost = pid;
    write("shell-host-pid", pid);
  };
  NodeFS.watch(NodePath.join(throwawayHome, "userdata"), reportShellHost);
  reportShellHost();
  write("ready", `stop with: kill ${NodeProcess.pid}`);
  return await serverEnded;
}

main()
  .catch((error: unknown) => {
    NodeProcess.stderr.write(
      `sandbox: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  })
  .then(async (code) => {
    await stop();
    NodeProcess.exit(code);
  });
