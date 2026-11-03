// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Scenario runner owns the server child process.

import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

export const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");
const DEFAULT_SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");
const HOST = "127.0.0.1";

export interface ServerHandle {
  readonly home: string;
  readonly origin: string;
  readonly pid: () => number;
  readonly stop: () => Promise<void>;
  /** Stops the server and starts it again on the same home and port. */
  readonly restart: () => Promise<void>;
  /** Mints a one-time pairing URL that signs a browser in without a human. */
  readonly pairingUrl: () => Promise<string>;
  /** Runs a `bin.ts` subcommand against this server's home, for fixtures. */
  readonly cli: (args: ReadonlyArray<string>) => Promise<string>;
}

// The child must see only what the harness gives it, never an ambient home or dev URL.
const childEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...NodeProcess.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("T3CODE_") || key.startsWith("VITE_")) delete env[key];
  }
  return env;
};

const reservePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const exited = (child: NodeChildProcess.ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

async function stopChild(child: NodeChildProcess.ChildProcess): Promise<void> {
  if (exited(child)) return;
  const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const escalate = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await done;
  clearTimeout(escalate);
}

const waitUntilReady = (child: NodeChildProcess.ChildProcess) =>
  new Promise<void>((resolve, reject) => {
    let tail = "";
    let ready = false;
    const onData = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-4_000);
      if (!ready && tail.includes("server is ready")) {
        ready = true;
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) =>
      reject(new Error(`Probe server could not start: ${error.message}`)),
    );
    child.once("exit", (code, signal) => {
      if (ready) return;
      reject(
        new Error(
          `Probe server could not start (exited with ${signal ?? `code ${String(code)}`}).\n${tail.trim()}`,
        ),
      );
    });
  });

const runCli = (serverBin: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      "node",
      [serverBin, ...args],
      { cwd: REPO_ROOT, env: childEnv(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout),
    );
  });

export function parsePairingCredentialOutput(output: string): string {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("Pairing command did not return JSON.");
  const parsed = JSON.parse(output.slice(start, end + 1)) as { readonly credential?: unknown };
  if (typeof parsed.credential !== "string" || parsed.credential.length === 0) {
    throw new Error("Pairing command returned no credential.");
  }
  return parsed.credential;
}

export async function startServer(options: {
  readonly home: string;
  readonly serverBin?: string | undefined;
}): Promise<ServerHandle> {
  const serverBin = options.serverBin ?? DEFAULT_SERVER_BIN;
  const port = await reservePort();
  let child: NodeChildProcess.ChildProcess | undefined;

  const start = async () => {
    const spawned = NodeChildProcess.spawn(
      "node",
      [
        serverBin,
        "serve",
        "--host",
        HOST,
        "--port",
        String(port),
        "--base-dir",
        options.home,
        "--no-browser",
        "--log-level",
        "error",
      ],
      { cwd: REPO_ROOT, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] },
    );
    child = spawned;
    try {
      await waitUntilReady(spawned);
    } catch (error) {
      await stopChild(spawned);
      throw error;
    }
  };
  await start();

  const stop = async () => {
    if (child) await stopChild(child);
  };
  const origin = `http://${HOST}:${port}`;
  const cli = (args: ReadonlyArray<string>) =>
    runCli(serverBin, [...args, "--base-dir", options.home]);
  return {
    home: options.home,
    origin,
    pid: () => {
      if (!child?.pid) throw new Error("Server is not running.");
      return child.pid;
    },
    stop,
    restart: async () => {
      await stop();
      await start();
    },
    pairingUrl: async () => {
      const credential = parsePairingCredentialOutput(
        await cli(["auth", "pairing", "create", "--json"]),
      );
      return `${origin}/pair#${new URLSearchParams([["token", credential]]).toString()}`;
    },
    cli,
  };
}
