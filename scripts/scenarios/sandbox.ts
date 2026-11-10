#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The sandbox owns its server process, home and log file directly.

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
import { createThrowawayHome, refusalReason, removeThrowawayHome } from "./environment.ts";
import { REPO_ROOT, startServer, type ServerHandle } from "./server.ts";

/**
 * Keeps one harness server up on a throwaway home until its own pid is stopped, so saved scenarios
 * run against it with `test:scenarios -- --sandbox <pid> --only <id>`. Every line it prints is
 * `sandbox: <key>=<value>`; the pid comes first because it is the only way to stop the sandbox.
 */
const write = (key: string, value: string | number) =>
  NodeProcess.stdout.write(`sandbox: ${key}=${value}\n`);
const note = (line: string) => NodeProcess.stdout.write(`${line}\n`);

let manifest: ReturnType<typeof openManifest> | undefined;
let home: string | undefined;
let entry: ManifestEntry | undefined;
let server: ServerHandle | undefined;
let stopping: Promise<void> | undefined;

/** Ends the server, its shell host and shells by recorded pid, and removes the home. */
function stop(): Promise<void> {
  stopping ??= (async () => {
    await server?.kill().catch(() => undefined);
    if (entry !== undefined) killServerTree(entry);
    else if (home !== undefined) await removeThrowawayHome(home);
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
  const argv = NodeProcess.argv.slice(2);
  const refusal = refusalReason(argv, NodeProcess.env);
  if (refusal) {
    NodeProcess.stderr.write(`sandbox: refusing to start. ${refusal}\n`);
    return 2;
  }
  cleanLeftovers(note);
  manifest = openManifest();
  const bundle = await ensureWebBundle(REPO_ROOT, argv.includes("--rebuild"), note);

  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): the PID-reuse guard's timestamp
  const homeCreatedMs = Date.now();
  home = await createThrowawayHome();
  const throwawayHome = home;
  const logFile = sandboxLogFile(NodeProcess.pid);
  const log = NodeFS.openSync(logFile, "w");
  server = await startServer({
    home: throwawayHome,
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
  });
  manifest.describeSandbox({
    origin: server.origin,
    home: throwawayHome,
    serverPid: server.pid(),
    logFile,
    // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): compared with source file times
    startedMs: Date.now(),
  });
  write("origin", server.origin);
  write("home", throwawayHome);
  write("server-pid", server.pid());
  write(
    "bundle",
    `${NodePath.relative(REPO_ROOT, NodePath.join(REPO_ROOT, "apps/web/dist"))} built ${
      bundle.builtMs === null ? "never" : new Date(bundle.builtMs).toISOString()
    }`,
  );
  write("pairing-url", await server.pairingUrl());
  write("ready", `stop with: kill ${NodeProcess.pid}`);
  return await new Promise<number>(() => {});
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
