// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off - Scenario runner owns the server child process.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { isolatedShellEnv, SCENARIO_GITCONFIG } from "./isolation.ts";
import { alive } from "./support.ts";

export const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");
const DEFAULT_SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");
/** The command of the "mock agent" starting script the harness's state folders start with. */
export const MOCK_AGENT_COMMAND = `node ${NodePath.join(REPO_ROOT, "scripts/mock-agent/mock-agent.ts")}`;
const LOG_LIMIT = 4 * 1024 * 1024;
const LOG_TAIL_CHARS = 4_000;
// A ceiling for a start that never answers, not a measure of a healthy one (about 2 s here).
const START_TIMEOUT_MS = 60_000;
// Matches the page action timeout in run.ts.
const LOG_WAIT_MS = 10_000;

/** Variables for the server process; `undefined` removes one the harness would set. */
export type ServerEnv = Readonly<Record<string, string | undefined>>;
const HOST = "127.0.0.1";

export interface ServerHandle {
  readonly home: string;
  readonly origin: string;
  readonly pid: () => number;
  /** Stops the server gracefully, as a user would; restart scenarios rely on it. */
  readonly stop: () => Promise<void>;
  /** Ends the server at once; throwaway servers have nothing worth flushing. */
  readonly kill: () => Promise<void>;
  /** Stops the server and starts it again on the same home and port, with `env` on top of the defaults. */
  readonly restart: (options?: { readonly env?: ServerEnv }) => Promise<void>;
  /** Everything the server has printed so far, across restarts (info level). */
  readonly logs: () => string;
  /** Resolves with the first log entry that `match` accepts, from the start of the logs on. */
  readonly logged: (what: string, match: (entry: string) => boolean) => Promise<string>;
  /** Mints a one-time pairing URL that signs a browser in without a human. */
  readonly pairingUrl: () => Promise<string>;
  /** How many pairing URLs were minted, each one a CLI process start. */
  readonly pairings: () => number;
  /** Runs a `bin.ts` subcommand against this server's home, for fixtures. */
  readonly cli: (args: ReadonlyArray<string>) => Promise<string>;
  /** The shell host that keeps this home's shells across restarts, from its pid file; null when none runs. */
  readonly shellHostPid: () => number | null;
  /** Stops the shell host by the pid it wrote into this home, which ends every shell in it. */
  readonly stopShellHost: (signal?: NodeJS.Signals) => Promise<void>;
}

const RESERVED_PREFIXES = ["T3CODE_", "VITE_", "PROBE_"];

/**
 * The child sees only what the harness gives it: no ambient home, dev URL or Probe variable,
 * the harness's git config, and (unless `isolation` is null) a shell config of its own.
 */
export const childEnv = (
  overrides: ServerEnv = {},
  ambient: NodeJS.ProcessEnv = NodeProcess.env,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...ambient,
    NO_COLOR: "1",
    GIT_CONFIG_GLOBAL: SCENARIO_GITCONFIG,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const key of Object.keys(env)) {
    if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) delete env[key];
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

async function stopChild(
  child: NodeChildProcess.ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (exited(child)) return;
  const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill(signal);
  const escalate =
    signal === "SIGKILL" ? undefined : setTimeout(() => child.kill("SIGKILL"), 5_000);
  await done;
  clearTimeout(escalate);
}

/**
 * Ready once the server answers its environment descriptor over HTTP, whatever it prints. Each
 * chunk of output triggers at most one request, so a server that prints and never serves, or
 * exits, or stays silent, fails with the tail of what it printed.
 */
export const waitUntilServing = (
  child: NodeChildProcess.ChildProcess,
  origin: string,
  onOutput: (chunk: string) => void,
  timeoutMs = START_TIMEOUT_MS,
) =>
  new Promise<void>((resolve, reject) => {
    let tail = "";
    let settled = false;
    let probing = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const fail = (why: string) =>
      settle(new Error(`Probe server could not start (${why}).\n${tail.trim()}`));
    const probe = () => {
      if (probing || settled) return;
      probing = true;
      fetch(`${origin}/.well-known/t3/environment`)
        .then((response) => {
          if (response.ok) settle();
        })
        .catch(() => undefined)
        .finally(() => {
          probing = false;
        });
    };
    const onData = (chunk: Buffer) => {
      onOutput(chunk.toString());
      tail = (tail + chunk.toString()).slice(-LOG_TAIL_CHARS);
      probe();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) => fail(error.message));
    child.once("exit", (code, signal) => fail(`exited with ${signal ?? `code ${String(code)}`}`));
    // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (b): deadline raced against output, exit and the HTTP answer, named in the failure
    const timer = setTimeout(
      () => fail(`no answer over HTTP within ${timeoutMs / 1000} s`),
      timeoutMs,
    );
  });

const runCli = (serverBin: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      "node",
      [serverBin, ...args],
      { cwd: REPO_ROOT, env, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
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

/** The log entries in `logs`; an entry starts with its time and continues on indented lines. */
const entriesOf = (logs: string) => logs.split(/\n(?=\S)/);

export async function startServer(options: {
  readonly home: string;
  readonly serverBin?: string | undefined;
  /** False runs shells with the developer's own startup files (`--own-shell-config`). */
  readonly isolateShell?: boolean;
  /** The environment the server would otherwise inherit; tests pass a fake one. */
  readonly ambient?: NodeJS.ProcessEnv;
  /** Called once the server process exists, before it is ready, so a killed run can stop it. */
  readonly onSpawn?: (pid: number) => void;
}): Promise<ServerHandle> {
  const serverBin = options.serverBin ?? DEFAULT_SERVER_BIN;
  const port = await reservePort();
  const origin = `http://${HOST}:${port}`;
  let child: NodeChildProcess.ChildProcess | undefined;
  let logs = "";
  const logWaiters = new Set<() => void>();
  let pairings = 0;
  const defaults: ServerEnv = {
    // Without a UTF-8 locale zsh counts a prompt's "➜" as three columns and redraws over the
    // prompt row where a typed line wraps.
    ...(NodeProcess.env.LANG || NodeProcess.env.LC_ALL ? {} : { LANG: "C.UTF-8" }),
    PROBE_SEED_MOCK_AGENT: MOCK_AGENT_COMMAND,
    MOCK_AGENT_HOME: NodePath.join(options.home, "mock-agent"),
    ...(options.isolateShell === false ? {} : await isolatedShellEnv(options.home)),
  };
  const envFor = (env: ServerEnv = {}) => childEnv({ ...defaults, ...env }, options.ambient);

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
      { cwd: REPO_ROOT, env: envFor(env), stdio: ["ignore", "pipe", "pipe"] },
    );
    child = spawned;
    if (spawned.pid !== undefined) options.onSpawn?.(spawned.pid);
    try {
      await waitUntilServing(spawned, origin, (chunk) => {
        logs = (logs + chunk).slice(-LOG_LIMIT);
        for (const wake of logWaiters) wake();
      });
    } catch (error) {
      await stopChild(spawned, "SIGKILL");
      throw error;
    }
  };
  await start();

  const stop = async () => {
    if (child) await stopChild(child);
  };
  // Written by the server's shell host in this throwaway home (`shellHostPidPath`).
  const shellHostPidFile = NodePath.join(options.home, "userdata", "shell-host-v1.pid");
  const shellHostPid = () => {
    try {
      const pid = Number(NodeFS.readFileSync(shellHostPidFile, "utf8").trim());
      return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
    } catch {
      return null;
    }
  };
  const cli = (args: ReadonlyArray<string>) =>
    runCli(serverBin, [...args, "--base-dir", options.home], envFor());
  return {
    home: options.home,
    origin,
    pid: () => {
      if (!child?.pid) throw new Error("Server is not running.");
      return child.pid;
    },
    stop,
    kill: async () => {
      if (child) await stopChild(child, "SIGKILL");
    },
    restart: async (restartOptions) => {
      await stop();
      await start(restartOptions?.env);
    },
    logs: () => logs,
    logged: (what, match) =>
      new Promise<string>((resolve, reject) => {
        const check = () => {
          const found = entriesOf(logs).find(match);
          if (found === undefined) return;
          clearTimeout(timer);
          logWaiters.delete(check);
          resolve(found);
        };
        // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (b): deadline raced against the log line, named in the failure
        const timer = setTimeout(() => {
          logWaiters.delete(check);
          reject(new Error(`Timed out waiting for the server to log ${what}.`));
        }, LOG_WAIT_MS);
        logWaiters.add(check);
        check();
      }),
    pairingUrl: async () => {
      pairings += 1;
      const credential = parsePairingCredentialOutput(
        await cli(["auth", "pairing", "create", "--json"]),
      );
      return `${origin}/pair#${new URLSearchParams([["token", credential]]).toString()}`;
    },
    pairings: () => pairings,
    cli,
    shellHostPid,
    stopShellHost: async (signal = "SIGTERM") => {
      const pid = shellHostPid();
      if (pid === null) return;
      NodeProcess.kill(pid, signal);
      // Up to 5 s for the host to end its shells, then it is killed outright.
      // oxlint-disable-next-line t3code/no-polling-loop-in-tests -- permanent (c): no exit event, the detached host is not our child and drops its pid file before it exits
      for (let attempt = 0; alive(pid); attempt++) {
        if (attempt === 100) {
          NodeProcess.kill(pid, "SIGKILL");
          break;
        }
        // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (c): no exit event, the detached host is not our child
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}
