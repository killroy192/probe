// @effect-diagnostics nodeBuiltinImport:off - The shell host is a small plain-Node process with no Effect runtime.
// @effect-diagnostics globalTimers:off globalDate:off
/**
 * The shell host: one detached process per Probe state folder that owns every shell's PTY, so
 * shells keep running while the server stops and a new server can take them over. It serves one
 * server at a time over a unix socket, keeps each shell's recent output, and remembers how a shell
 * ended until the server forgets it.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import {
  type ClientMessage,
  encodeLine,
  type HostExit,
  type HostGrid,
  type HostMessage,
  lineReader,
  SHELL_HOST_PROTOCOL,
  shellHostLogPath,
  shellHostPidPath,
  shellHostSocketPath,
} from "./protocol.ts";

/** The output a host keeps per shell, in UTF-16 code units, like the server's 8 MiB history. */
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const DEFAULT_IDLE_MS = 30_000;

/** A shell's recent output, and the grid each part of it was printed at. */
export class KeptOutput {
  private readonly limit: number;
  private chunks: Array<string> = [];
  private size = 0;
  private kept: Array<HostGrid>;

  constructor(cols: number, rows: number, limit = OUTPUT_LIMIT) {
    this.limit = limit;
    this.kept = [{ at: 0, cols, rows }];
  }

  append(data: string): void {
    this.chunks.push(data);
    this.size += data.length;
    let dropped = 0;
    while (this.size > this.limit && this.chunks.length > 0) {
      const oldest = this.chunks[0]!;
      const excess = this.size - this.limit;
      const cut = Math.min(oldest.length, excess);
      if (cut === oldest.length) this.chunks.shift();
      else this.chunks[0] = oldest.slice(cut);
      this.size -= cut;
      dropped += cut;
    }
    if (dropped === 0) return;
    const moved = this.kept.map((grid) => ({ ...grid, at: grid.at - dropped }));
    // The grid of the oldest output left is the last one that started at or before it.
    const first = moved.findLastIndex((grid) => grid.at <= 0);
    this.kept = moved.slice(first);
    this.kept[0] = { ...this.kept[0]!, at: 0 };
  }

  resize(cols: number, rows: number): void {
    const last = this.kept.at(-1)!;
    if (last.at === this.size) this.kept[this.kept.length - 1] = { at: this.size, cols, rows };
    else if (last.cols !== cols || last.rows !== rows)
      this.kept.push({ at: this.size, cols, rows });
  }

  output(): string {
    return this.chunks.join("");
  }

  grids(): ReadonlyArray<HostGrid> {
    return [...this.kept];
  }
}

interface HostedSession {
  readonly id: string;
  readonly pty: import("node-pty").IPty;
  readonly cwd: string;
  cols: number;
  rows: number;
  readonly output: KeptOutput;
  exit: HostExit | null;
}

const requireNodePty = NodeModule.createRequire(import.meta.url);

// Some installs unpack node-pty's spawn helper without its executable bit.
const ensureSpawnHelper = () => {
  try {
    const dir = NodePath.dirname(requireNodePty.resolve("node-pty/package.json"));
    for (const candidate of [
      NodePath.join(dir, "build", "Release", "spawn-helper"),
      // oxlint-disable-next-line t3code/no-global-process-runtime -- The host runs no Effect runtime to inject it.
      NodePath.join(dir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ]) {
      if (NodeFS.existsSync(candidate)) NodeFS.chmodSync(candidate, 0o755);
    }
  } catch {
    // node-pty reports a spawn that cannot run on its own.
  }
};

const isAlive = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    const probe = NodeNet.connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });

export interface ShellHostOptions {
  readonly stateDir: string;
  /** How long the host waits with no shells and no server before it exits. */
  readonly idleMs?: number;
}

export interface RunningShellHost {
  /** Ends every shell and closes the socket. */
  readonly stop: () => void;
  /** Settles once the host stopped, by `stop` or by being idle. */
  readonly finished: Promise<void>;
}

/** Starts serving; null when another host already serves this state folder. */
export async function startShellHost(options: ShellHostOptions): Promise<RunningShellHost | null> {
  const socketPath = shellHostSocketPath(options.stateDir);
  const pidPath = shellHostPidPath(options.stateDir);
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  if (await isAlive(socketPath)) return null;
  NodeFS.rmSync(socketPath, { force: true });
  ensureSpawnHelper();
  const nodePty = requireNodePty("node-pty") as typeof import("node-pty");

  const sessions = new Map<string, HostedSession>();
  let client: NodeNet.Socket | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => (finish = resolve));

  const send = (message: HostMessage) => {
    if (client !== null && !client.destroyed) client.write(encodeLine(message));
  };

  const stop = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    server.close();
    client?.destroy();
    for (const session of sessions.values()) {
      if (session.exit === null) session.pty.kill("SIGHUP");
    }
    NodeFS.rmSync(socketPath, { force: true });
    try {
      if (NodeFS.readFileSync(pidPath, "utf8").trim() === String(process.pid)) {
        NodeFS.rmSync(pidPath, { force: true });
      }
    } catch {
      // Already gone.
    }
    finish();
  };

  const checkIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    if (sessions.size === 0 && client === null) idleTimer = setTimeout(stop, idleMs);
  };

  const handle = (socket: NodeNet.Socket, message: ClientMessage) => {
    switch (message.t) {
      case "hello":
        return;
      case "spawn": {
        let pty: import("node-pty").IPty;
        try {
          pty = nodePty.spawn(message.shell, [...message.args], {
            cwd: message.cwd,
            cols: message.cols,
            rows: message.rows,
            env: message.env,
            name: "xterm-256color",
          });
        } catch (error) {
          socket.write(
            encodeLine({
              t: "spawnFailed",
              req: message.req,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          return;
        }
        const session: HostedSession = {
          id: NodeCrypto.randomUUID(),
          pty,
          cwd: message.cwd,
          cols: message.cols,
          rows: message.rows,
          output: new KeptOutput(message.cols, message.rows),
          exit: null,
        };
        sessions.set(session.id, session);
        checkIdle();
        socket.write(encodeLine({ t: "spawned", req: message.req, id: session.id, pid: pty.pid }));
        pty.onData((data) => {
          session.output.append(data);
          send({ t: "data", id: session.id, data });
        });
        pty.onExit(({ exitCode, signal }) => {
          session.exit = { exitCode, signal: signal ? signal : null };
          send({ t: "exit", id: session.id, ...session.exit });
        });
        return;
      }
      case "list":
        socket.write(
          encodeLine({
            t: "sessions",
            req: message.req,
            sessions: [...sessions.values()].map((session) => ({
              id: session.id,
              pid: session.pty.pid,
              cwd: session.cwd,
              cols: session.cols,
              rows: session.rows,
              output: session.output.output(),
              grids: session.output.grids(),
              exit: session.exit,
            })),
          }),
        );
        return;
      case "write": {
        const session = sessions.get(message.id);
        if (session !== undefined && session.exit === null) session.pty.write(message.data);
        return;
      }
      case "resize": {
        const session = sessions.get(message.id);
        if (session === undefined || session.exit !== null) return;
        session.cols = message.cols;
        session.rows = message.rows;
        session.output.resize(message.cols, message.rows);
        session.pty.resize(message.cols, message.rows);
        return;
      }
      case "signal": {
        const session = sessions.get(message.id);
        if (session !== undefined && session.exit === null) {
          session.pty.kill(message.signal ?? undefined);
        }
        return;
      }
      case "forget": {
        const session = sessions.get(message.id);
        if (session === undefined) return;
        // A running shell is never dropped silently; the server ends it first.
        if (session.exit !== null) sessions.delete(message.id);
        checkIdle();
        return;
      }
    }
  };

  const server = NodeNet.createServer((socket) => {
    socket.setEncoding("utf8");
    let greeted = false;
    const read = lineReader((raw) => {
      const message = raw as ClientMessage;
      if (!greeted) {
        if (message.t !== "hello") return socket.destroy();
        socket.write(encodeLine({ t: "hello", version: SHELL_HOST_PROTOCOL, pid: process.pid }));
        if (message.version !== SHELL_HOST_PROTOCOL) return socket.end();
        greeted = true;
        // One server at a time: a new one takes over from a stale connection.
        if (client !== null && client !== socket) client.destroy();
        client = socket;
        checkIdle();
        return;
      }
      handle(socket, message);
    });
    socket.on("data", (chunk: string) => {
      try {
        read(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      if (client === socket) client = null;
      checkIdle();
    });
  });

  // Only this user may connect. A umask, not chmod: some mounts (a Mac folder in a Linux
  // container) refuse chmod on a socket, and ignore modes anyway.
  const umask = process.umask(0o077);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });
  } finally {
    process.umask(umask);
  }
  NodeFS.writeFileSync(pidPath, `${process.pid}\n`, { mode: 0o600 });
  checkIdle();
  return { stop, finished };
}

/** `__shell-host <state dir>`: started detached by the server. */
export async function runShellHostCli(args: ReadonlyArray<string>): Promise<void> {
  const stateDir = args[0];
  if (stateDir === undefined) {
    process.exitCode = 2;
    return;
  }
  const idle = Number(process.env.PROBE_SHELL_HOST_IDLE_MS);
  let host: RunningShellHost | null;
  try {
    host = await startShellHost({
      stateDir,
      ...(Number.isFinite(idle) && idle > 0 ? { idleMs: idle } : {}),
    });
  } catch (error) {
    // The host runs detached with no output; this file is where a failed start says why.
    NodeFS.appendFileSync(
      shellHostLogPath(stateDir),
      `${new Date().toISOString()} could not start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    NodeFS.rmSync(shellHostSocketPath(stateDir), { force: true });
    process.exit(1);
  }
  if (host === null) return;
  process.on("SIGTERM", host.stop);
  process.on("SIGINT", host.stop);
  // The host is detached, but a closing terminal must not take the shells with it.
  process.on("SIGHUP", () => {});
  await host.finished;
  process.exit(0);
}
