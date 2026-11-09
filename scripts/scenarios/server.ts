// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Scenario runner owns the server child process.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

export const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");
const DEFAULT_SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");
/** The command of the "mock agent" starting script the harness's state folders start with. */
export const MOCK_AGENT_COMMAND = `node ${NodePath.join(REPO_ROOT, "scripts/mock-agent/mock-agent.ts")}`;
const LOG_LIMIT = 4 * 1024 * 1024;

/** Variables for the server process; `undefined` removes one the harness would set. */
export type ServerEnv = Readonly<Record<string, string | undefined>>;
const HOST = "127.0.0.1";

export interface ServerHandle {
  readonly home: string;
  readonly origin: string;
  readonly pid: () => number;
  readonly stop: () => Promise<void>;
  /** Stops the server and starts it again on the same home and port, with `env` on top of the defaults. */
  readonly restart: (options?: { readonly env?: ServerEnv }) => Promise<void>;
  /** Everything the server has printed so far, across restarts (info level). */
  readonly logs: () => string;
  /** Mints a one-time pairing URL that signs a browser in without a human. */
  readonly pairingUrl: () => Promise<string>;
  /** Runs a `bin.ts` subcommand against this server's home, for fixtures. */
  readonly cli: (args: ReadonlyArray<string>) => Promise<string>;
  /** The shell host that keeps this home's shells across restarts, from its pid file; null when none runs. */
  readonly shellHostPid: () => number | null;
  /** Stops the shell host by the pid it wrote into this home, which ends every shell in it. */
  readonly stopShellHost: (signal?: NodeJS.Signals) => Promise<void>;
}

const isAlive = (pid: number) => {
  try {
    NodeProcess.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The child must see only what the harness gives it, never an ambient home or dev URL.
const childEnv = (overrides: ServerEnv = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...NodeProcess.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("T3CODE_") || key.startsWith("VITE_") || key.startsWith("PROBE_")) {
      delete env[key];
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
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

const waitUntilReady = (child: NodeChildProcess.ChildProcess, onOutput: (chunk: string) => void) =>
  new Promise<void>((resolve, reject) => {
    let tail = "";
    let ready = false;
    const onData = (chunk: Buffer) => {
      onOutput(chunk.toString());
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
  let logs = "";
  const defaults: ServerEnv = {
    PROBE_SEED_MOCK_AGENT: MOCK_AGENT_COMMAND,
    MOCK_AGENT_HOME: NodePath.join(options.home, "mock-agent"),
  };

  const start = async (env: ServerEnv = {}) => {
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
        "info",
      ],
      {
        cwd: REPO_ROOT,
        env: childEnv({ ...defaults, ...env }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child = spawned;
    try {
      await waitUntilReady(spawned, (chunk) => {
        logs = (logs + chunk).slice(-LOG_LIMIT);
      });
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
  // Written by the server's shell host in this throwaway home (`shellHostPidPath`).
  const shellHostPidFile = NodePath.join(options.home, "userdata", "shell-host-v1.pid");
  const shellHostPid = () => {
    try {
      const pid = Number(NodeFS.readFileSync(shellHostPidFile, "utf8").trim());
      return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
    } catch {
      return null;
    }
  };
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
    restart: async (restartOptions) => {
      await stop();
      await start(restartOptions?.env);
    },
    logs: () => logs,
    pairingUrl: async () => {
      const credential = parsePairingCredentialOutput(
        await cli(["auth", "pairing", "create", "--json"]),
      );
      return `${origin}/pair#${new URLSearchParams([["token", credential]]).toString()}`;
    },
    cli,
    shellHostPid,
    stopShellHost: async (signal = "SIGTERM") => {
      const pid = shellHostPid();
      if (pid === null) return;
      NodeProcess.kill(pid, signal);
      // Up to 5 s for the host to end its shells, then it is killed outright.
      for (let attempt = 0; isAlive(pid); attempt++) {
        if (attempt === 100) {
          NodeProcess.kill(pid, "SIGKILL");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}
