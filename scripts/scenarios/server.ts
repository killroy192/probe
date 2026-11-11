// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off - Scenario runner owns the server child process.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { isolatedShellEnv, SCENARIO_GITCONFIG } from "./isolation.ts";
import { PROCESS_END_MS, seconds, START_MS, WAIT_MS } from "./lib/deadlines.ts";
import { alive, gone } from "./lib/waits.ts";
import { leasePort, type PortLease, startOnLeasedPort } from "./ports.ts";

export const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");
const DEFAULT_SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");
/** The command of the "mock agent" starting script the harness's state folders start with. */
export const MOCK_AGENT_COMMAND = `node ${NodePath.join(REPO_ROOT, "scripts/mock-agent/mock-agent.ts")}`;
const LOG_LIMIT = 4 * 1024 * 1024;
const LOG_TAIL_CHARS = 4_000;

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
  /**
   * Stops the server and starts it again on the same home and port. `env` replaces the start's
   * `env` for this start only; without it the start's `env` applies again.
   */
  readonly restart: (options?: { readonly env?: ServerEnv }) => Promise<void>;
  /**
   * Resolves when the running server process ends without `stop`, `kill` or `restart` asking it
   * to, whichever process a restart made current; never for an exit the harness made.
   */
  readonly unexpectedExit: () => Promise<UnexpectedExit>;
  /** The last few MiB the server has printed, across restarts. */
  readonly logs: () => string;
  /** How many bytes of log the server has printed so far, across restarts; only ever grows. */
  readonly logMark: () => number;
  /** Everything the server printed after `mark`, read from its log file, so nothing is cut. */
  readonly logSince: (mark: number) => string;
  /** Resolves with the first log entry from `from` (a `logMark`, default the start) on that `match` accepts. */
  readonly logged: (
    what: string,
    match: (entry: string) => boolean,
    options?: { readonly from?: number },
  ) => Promise<string>;
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
  /**
   * Everything `shellId`'s process wrote that this home's servers received, prompt marks included,
   * whenever a page attached. The server saves a chunk before it sends it to any client.
   */
  readonly rawOutput: (shellId: string) => string;
}

export interface UnexpectedExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The last few thousand characters that process printed. */
  readonly tail: string;
}

interface Exiting {
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

/**
 * Tells server processes the harness ended from ones that ended by themselves. Only a process
 * marked `ready` counts: one that ends while starting fails its start instead.
 */
export function exitWatch() {
  let report: (exit: UnexpectedExit) => void = () => {};
  const unexpected = new Promise<UnexpectedExit>((resolve) => {
    report = resolve;
  });
  const ready = new WeakSet<Exiting>();
  const expected = new WeakSet<Exiting>();
  return {
    unexpectedExit: () => unexpected,
    watch: (child: Exiting, tail: () => string) =>
      child.once("close", (code, signal) => {
        if (ready.has(child) && !expected.has(child)) report({ code, signal, tail: tail() });
      }),
    ready: (child: Exiting) => void ready.add(child),
    expect: (child: Exiting) => void expected.add(child),
  };
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
    signal === "SIGKILL" ? undefined : setTimeout(() => child.kill("SIGKILL"), PROCESS_END_MS);
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
  timeoutMs = START_MS,
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
      () => fail(`no answer over HTTP within ${seconds(timeoutMs)}`),
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

/** The bytes of `file` from `from` to its end; empty when the file is missing. */
function bytesFrom(file: string, from: number): Buffer {
  let fd: number;
  try {
    fd = NodeFS.openSync(file, "r");
  } catch {
    return Buffer.alloc(0);
  }
  try {
    const size = NodeFS.fstatSync(fd).size;
    if (size <= from) return Buffer.alloc(0);
    const buffer = Buffer.alloc(size - from);
    const read = NodeFS.readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, read);
  } finally {
    NodeFS.closeSync(fd);
  }
}

function fileSize(file: string): number {
  try {
    return NodeFS.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Log entries of `file` from a byte offset on that `match` accepts, checked again each time
 * `subscribe` wakes it. Each check reads only what follows the last entry that may still grow.
 */
const waitForLog =
  (file: string, subscribe: (wake: () => void) => () => void) =>
  (what: string, match: (entry: string) => boolean, options?: { readonly from?: number }) =>
    new Promise<string>((resolve, reject) => {
      let unsubscribe = () => {};
      let position = options?.from ?? 0;
      const check = () => {
        const text = bytesFrom(file, position).toString("utf8");
        if (text === "") return;
        const entries = entriesOf(text);
        const found = entries.find(match);
        if (found === undefined) {
          const growing = entries.at(-1) ?? "";
          position += Buffer.byteLength(text.slice(0, text.length - growing.length));
          return;
        }
        clearTimeout(timer);
        unsubscribe();
        resolve(found);
      };
      // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (b): deadline raced against the log line, named in the failure
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(`Timed out after ${seconds(WAIT_MS)} waiting for the server to log ${what}.`),
        );
      }, WAIT_MS);
      unsubscribe = subscribe(check);
      check();
    });

/** The shell host that keeps `home`'s shells, from the pid file it writes there (`shellHostPidPath`). */
export function shellHostPidIn(home: string): number | null {
  try {
    const file = NodePath.join(home, "userdata", "shell-host-v1.pid");
    const pid = Number(NodeFS.readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function stopShellHostIn(home: string, signal: NodeJS.Signals = "SIGTERM") {
  const pid = shellHostPidIn(home);
  if (pid === null) return;
  NodeProcess.kill(pid, signal);
  // The host gets PROCESS_END_MS to end its shells, then it is killed outright.
  if (!(await gone(pid))) NodeProcess.kill(pid, "SIGKILL");
}

export async function startServer(options: {
  readonly home: string;
  readonly serverBin?: string | undefined;
  /** False runs shells with the developer's own startup files (`--own-shell-config`). */
  readonly isolateShell?: boolean;
  /** The environment the server would otherwise inherit; tests pass a fake one. */
  readonly ambient?: NodeJS.ProcessEnv;
  /**
   * Variables on top of the defaults for every start; `restart({env})` replaces them for that
   * restart only.
   */
  readonly env?: ServerEnv;
  /** Called once the server process exists, before it is ready, so a killed run can stop it. */
  readonly onSpawn?: (pid: number) => void;
  /** Called with each chunk the server prints, across restarts. */
  readonly onOutput?: (chunk: string) => void;
  /** Called whenever a server process ends, including the stops and restarts the harness makes. */
  readonly onExit?: (how: string) => void;
  /** The server's `--log-level`, debug unless given; null starts it without the flag. */
  readonly logLevel?: string | null;
  /** Where a move to another port is printed; stdout unless given. */
  readonly note?: (line: string) => void;
}): Promise<ServerHandle> {
  const serverBin = options.serverBin ?? DEFAULT_SERVER_BIN;
  let port = 0;
  let origin = "";
  let child: NodeChildProcess.ChildProcess | undefined;
  let logs = "";
  const logFile = harnessLogFileIn(options.home);
  NodeFS.mkdirSync(NodePath.dirname(logFile), { recursive: true });
  let logBytes = fileSize(logFile);
  const logWaiters = new Set<() => void>();
  const logLevel = options.logLevel === undefined ? "debug" : options.logLevel;
  let pairings = 0;
  const defaults: ServerEnv = {
    // Without a UTF-8 locale zsh counts a prompt's "➜" as three columns and redraws over the
    // prompt row where a typed line wraps.
    ...(NodeProcess.env.LANG || NodeProcess.env.LC_ALL ? {} : { LANG: "C.UTF-8" }),
    PROBE_SEED_MOCK_AGENT: MOCK_AGENT_COMMAND,
    MOCK_AGENT_HOME: NodePath.join(options.home, "mock-agent"),
    PROBE_RAW_OUTPUT_DIR: rawOutputDirIn(options.home),
    ...(options.isolateShell === false ? {} : await isolatedShellEnv(options.home)),
  };
  const startEnv = options.env ?? {};
  const envFor = (env: ServerEnv) => childEnv({ ...defaults, ...env }, options.ambient);
  const exits = exitWatch();
  const end = async (signal?: NodeJS.Signals) => {
    if (!child) return;
    exits.expect(child);
    await stopChild(child, signal);
  };

  const start = async (env: ServerEnv) => {
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
        ...(logLevel === null ? [] : ["--log-level", logLevel]),
      ],
      { cwd: REPO_ROOT, env: envFor(env), stdio: ["ignore", "pipe", "pipe"] },
    );
    child = spawned;
    let tail = "";
    exits.watch(spawned, () => tail);
    // Opened per process and closed once its output ends; a write after the home is gone is harmless.
    const logFd = NodeFS.openSync(logFile, "a");
    spawned.once("close", () => NodeFS.closeSync(logFd));
    spawned.once("exit", (code, signal) =>
      options.onExit?.(signal === null ? `code ${String(code)}` : signal),
    );
    if (spawned.pid !== undefined) options.onSpawn?.(spawned.pid);
    try {
      await waitUntilServing(spawned, origin, (chunk) => {
        options.onOutput?.(chunk);
        tail = (tail + chunk).slice(-LOG_TAIL_CHARS);
        const bytes = Buffer.from(chunk);
        NodeFS.writeSync(logFd, bytes);
        logBytes += bytes.length;
        logs = (logs + chunk).slice(-LOG_LIMIT);
        for (const wake of logWaiters) wake();
      });
    } catch (error) {
      exits.expect(spawned);
      await stopChild(spawned, "SIGKILL");
      throw error;
    }
    exits.ready(spawned);
  };
  let lease: PortLease | undefined = (
    await startOnLeasedPort(
      (leased) => {
        port = leased;
        origin = `http://${HOST}:${port}`;
        return start(startEnv);
      },
      { note: options.note ?? ((line) => NodeProcess.stdout.write(`${line}\n`)) },
    )
  ).lease;
  const release = () => {
    lease?.release();
    lease = undefined;
  };

  const stop = async () => {
    await end();
    release();
  };
  const shellHostPid = () => shellHostPidIn(options.home);
  const cli = (args: ReadonlyArray<string>) =>
    runCli(serverBin, [...args, "--base-dir", options.home], envFor(startEnv));
  return {
    home: options.home,
    origin,
    pid: () => {
      if (!child?.pid) throw new Error("Server is not running.");
      return child.pid;
    },
    stop,
    kill: async () => {
      await end("SIGKILL");
      release();
    },
    restart: async (restartOptions) => {
      await end();
      lease ??= await leasePort({ range: { first: port, last: port } }).catch(() => {
        throw new Error(
          `The server cannot start again on port ${port}: another process took it after the stop.`,
        );
      });
      await start(restartOptions?.env ?? startEnv);
    },
    unexpectedExit: exits.unexpectedExit,
    logs: () => logs,
    logMark: () => logBytes,
    logSince: (mark) => bytesFrom(logFile, mark).toString("utf8"),
    logged: waitForLog(logFile, (wake) => {
      logWaiters.add(wake);
      return () => logWaiters.delete(wake);
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
    rawOutput: (shellId) => rawOutputIn(options.home, shellId),
    shellHostPid,
    stopShellHost: (signal) => stopShellHostIn(options.home, signal),
  };
}

/** Every server started on `home` appends its output here, so a failure can copy all of it. */
function harnessLogFileIn(home: string): string {
  return NodePath.join(home, "harness", "server.log");
}

function rawOutputDirIn(home: string): string {
  return NodePath.join(home, "raw-output");
}

function rawOutputIn(home: string, shellId: string): string {
  try {
    return NodeFS.readFileSync(NodePath.join(rawOutputDirIn(home), `${shellId}.log`), "utf8");
  } catch {
    return "";
  }
}

/**
 * A handle on a sandbox's server, which another process owns: a run reads its logs from the file
 * the sandbox writes, and anything that would end or replace the server fails with `refuse`.
 */
export function attachServer(
  target: {
    readonly home: string;
    readonly origin: string;
    readonly serverPid: number;
    readonly logFile: string;
  },
  refuse: (need: string) => Error,
): ServerHandle {
  const readLogs = () => {
    try {
      return NodeFS.readFileSync(target.logFile, "utf8");
    } catch {
      return "";
    }
  };
  let pairings = 0;
  const cli = (args: ReadonlyArray<string>) =>
    runCli(DEFAULT_SERVER_BIN, [...args, "--base-dir", target.home], childEnv());
  const refused = (need: string) => () => Promise.reject(refuse(need));
  return {
    home: target.home,
    origin: target.origin,
    pid: () => target.serverPid,
    stop: refused("a server stop"),
    kill: refused("a server stop"),
    restart: refused("a restart"),
    unexpectedExit: () => new Promise<never>(() => {}),
    logs: readLogs,
    logMark: () => fileSize(target.logFile),
    logSince: (mark) => bytesFrom(target.logFile, mark).toString("utf8"),
    logged: waitForLog(target.logFile, (wake) => {
      const watcher = NodeFS.watch(target.logFile, wake);
      return () => watcher.close();
    }),
    pairingUrl: async () => {
      pairings += 1;
      const credential = parsePairingCredentialOutput(
        await cli(["auth", "pairing", "create", "--json"]),
      );
      return `${target.origin}/pair#${new URLSearchParams([["token", credential]]).toString()}`;
    },
    pairings: () => pairings,
    cli,
    rawOutput: (shellId) => rawOutputIn(target.home, shellId),
    shellHostPid: () => shellHostPidIn(target.home),
    stopShellHost: refused("stopping the shell host"),
  };
}
