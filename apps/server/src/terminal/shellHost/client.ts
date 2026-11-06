// @effect-diagnostics nodeBuiltinImport:off - Speaks the shell host's socket protocol and starts the detached host.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";

import { AgentScope } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, selfInvocationArgs } from "@t3tools/shared/nodeRuntime";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import {
  type ClientMessage,
  encodeLine,
  type HostExit,
  type HostMessage,
  type HostSession,
  lineReader,
  SHELL_HOST_COMMAND,
  SHELL_HOST_PROTOCOL,
  shellHostSocketPath,
} from "./protocol.ts";

/** What the manager sees when the host itself goes away: the shells got SIGHUP with it. */
const HOST_LOST: HostExit = { exitCode: 0, signal: 1 };

/** A shell running in the host, driven through the socket. */
export class HostPtyProcess implements PtyAdapter.PtyProcess {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  // Output that arrives before the manager subscribes, such as right after a takeover.
  private queued: Array<string> | null = [];
  private exitEvent: PtyAdapter.PtyExitEvent | null = null;
  private detached = false;
  readonly hostId: string;
  readonly pid: number;
  private readonly send: (message: ClientMessage) => void;

  constructor(hostId: string, pid: number, send: (message: ClientMessage) => void) {
    this.hostId = hostId;
    this.pid = pid;
    this.send = send;
  }

  write(data: string): void {
    if (!this.detached) this.send({ t: "write", id: this.hostId, data });
  }

  resize(cols: number, rows: number): void {
    if (!this.detached) this.send({ t: "resize", id: this.hostId, cols, rows });
  }

  kill(signal?: string): void {
    if (!this.detached) this.send({ t: "signal", id: this.hostId, signal: signal ?? null });
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    const queued = this.queued;
    this.queued = null;
    for (const data of queued ?? []) callback(data);
    return () => this.dataListeners.delete(callback);
  }

  onExit(callback: (event: PtyAdapter.PtyExitEvent) => void): () => void {
    if (this.exitEvent !== null) {
      callback(this.exitEvent);
      return () => {};
    }
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  /** Lets go of the shell without ending it; the host keeps it for the next server. */
  detach(): void {
    this.detached = true;
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  /** @internal */
  receiveData(data: string): void {
    if (this.detached) return;
    if (this.queued !== null) this.queued.push(data);
    else for (const listener of this.dataListeners) listener(data);
  }

  /** @internal */
  receiveExit(exit: HostExit): void {
    if (this.exitEvent !== null || this.detached) return;
    this.exitEvent = exit;
    for (const listener of this.exitListeners) listener(exit);
    this.exitListeners.clear();
  }
}

/** One server's connection to its host. */
export class HostConnection {
  private readonly processes = new Map<string, HostPtyProcess>();
  private readonly waiting = new Map<number, (message: HostMessage) => void>();
  private nextReq = 1;
  private closing = false;
  closed = false;
  private readonly socket: NodeNet.Socket;
  readonly hostPid: number;

  private constructor(socket: NodeNet.Socket, hostPid: number) {
    this.socket = socket;
    this.hostPid = hostPid;
  }

  /** Connects and greets; fails when nothing listens or the host speaks another version. */
  static connect(socketPath: string): Promise<HostConnection> {
    return new Promise((resolve, reject) => {
      const socket = NodeNet.connect(socketPath);
      socket.setEncoding("utf8");
      let connection: HostConnection | null = null;
      const read = lineReader((raw) => {
        const message = raw as HostMessage;
        if (connection === null) {
          if (message.t !== "hello" || message.version !== SHELL_HOST_PROTOCOL) {
            socket.destroy();
            reject(
              new Error(
                `The shell host speaks protocol ${message.t === "hello" ? message.version : "?"}, not ${SHELL_HOST_PROTOCOL}.`,
              ),
            );
            return;
          }
          connection = new HostConnection(socket, message.pid);
          resolve(connection);
          return;
        }
        connection.receive(message);
      });
      socket.on("data", (chunk: string) => read(chunk));
      socket.once("connect", () =>
        socket.write(encodeLine({ t: "hello", version: SHELL_HOST_PROTOCOL })),
      );
      socket.on("error", (error) => {
        if (connection === null) reject(error);
      });
      socket.on("close", () => {
        if (connection === null) reject(new Error("The shell host closed the connection."));
        else connection.lost();
      });
    });
  }

  private send = (message: ClientMessage) => {
    if (!this.closed) this.socket.write(encodeLine(message));
  };

  private request<A extends HostMessage>(build: (req: number) => ClientMessage) {
    return new Promise<A>((resolve, reject) => {
      if (this.closed) return reject(new Error("The shell host is not connected."));
      const req = this.nextReq++;
      this.waiting.set(req, (message) => resolve(message as A));
      this.send(build(req));
    });
  }

  private receive(message: HostMessage) {
    switch (message.t) {
      case "data":
        this.processes.get(message.id)?.receiveData(message.data);
        return;
      case "exit":
        this.processes
          .get(message.id)
          ?.receiveExit({ exitCode: message.exitCode, signal: message.signal });
        return;
      case "spawned":
      case "spawnFailed":
      case "sessions": {
        const resolve = this.waiting.get(message.req);
        this.waiting.delete(message.req);
        resolve?.(message);
        return;
      }
      case "hello":
        return;
    }
  }

  private lost() {
    this.closed = true;
    for (const resolve of this.waiting.values())
      resolve({ t: "spawnFailed", req: 0, message: "The shell host went away." });
    this.waiting.clear();
    if (this.closing) return;
    for (const process of this.processes.values()) process.receiveExit(HOST_LOST);
  }

  private track(id: string, pid: number) {
    const process = new HostPtyProcess(id, pid, this.send);
    this.processes.set(id, process);
    return process;
  }

  async spawn(input: PtyAdapter.PtySpawnInput): Promise<HostPtyProcess> {
    const env = Object.fromEntries(
      Object.entries(input.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const reply = await this.request<Extract<HostMessage, { t: "spawned" | "spawnFailed" }>>(
      (req) => ({
        t: "spawn",
        req,
        shell: input.shell,
        args: input.args ?? [],
        cwd: input.cwd,
        cols: input.cols,
        rows: input.rows,
        env,
      }),
    );
    if (reply.t === "spawnFailed") throw new Error(reply.message);
    return this.track(reply.id, reply.pid);
  }

  /** Every shell the host holds, each with a process the manager can take over. */
  async list(): Promise<ReadonlyArray<{ session: HostSession; process: HostPtyProcess }>> {
    const reply = await this.request<Extract<HostMessage, { t: "sessions" | "spawnFailed" }>>(
      (req) => ({ t: "list", req }),
    );
    if (reply.t !== "sessions") throw new Error(reply.message);
    return reply.sessions.map((session) => {
      const process = this.processes.get(session.id) ?? this.track(session.id, session.pid);
      if (session.exit !== null) process.receiveExit(session.exit);
      return { session, process };
    });
  }

  /** Drops an ended shell from the host; a running one is kept. */
  forget(pid: number) {
    for (const [id, process] of this.processes) {
      if (process.pid !== pid) continue;
      this.processes.delete(id);
      this.send({ t: "forget", id });
    }
  }

  /** Disconnects, leaving every shell running in the host. */
  close() {
    this.closing = true;
    this.socket.end();
  }
}

/** The shell host as the server uses it; absent on Windows, where shells end with the server. */
export class ShellHost extends Context.Service<
  ShellHost,
  {
    /** Spawns shells in the host, starting it when none runs. */
    readonly adapter: PtyAdapter.PtyAdapter["Service"];
    /** The shells a running host holds; none when no host runs (it is never started for this). */
    readonly list: Effect.Effect<
      ReadonlyArray<{ readonly session: HostSession; readonly process: PtyAdapter.PtyProcess }>
    >;
    readonly forget: (pid: number) => Effect.Effect<void>;
  }
>()("t3/terminal/shellHost/client/ShellHost") {}

const START_ATTEMPTS = 100;

/** @public */
export const make = Effect.fn("ShellHost.make")(function* (options: {
  readonly socketPath: string;
  /** Starts a detached host; the connection is retried until it answers. */
  readonly start: Effect.Effect<void>;
}) {
  const lock = Semaphore.makeUnsafe(1);
  let connection: HostConnection | null = null;

  const tryConnect = Effect.tryPromise(() => HostConnection.connect(options.socketPath)).pipe(
    Effect.tapError((error) =>
      Effect.logDebug("shell host not reachable", { reason: error.message }),
    ),
    Effect.option,
  );

  const current = (startIfMissing: boolean) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (connection !== null && !connection.closed) return connection;
        const existing = yield* tryConnect;
        if (existing._tag === "Some") return (connection = existing.value);
        if (!startIfMissing) return null;
        yield* options.start;
        for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
          const started = yield* tryConnect;
          if (started._tag === "Some") {
            yield* Effect.logInfo("shell host started", { pid: started.value.hostPid });
            return (connection = started.value);
          }
          yield* Effect.sleep("50 millis");
        }
        return null;
      }),
    );

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      connection?.close();
      connection = null;
    }),
  );

  return ShellHost.of({
    adapter: PtyAdapter.PtyAdapter.of({
      spawn: Effect.fn("ShellHost.spawn")(function* (input) {
        const host = yield* current(true);
        if (host === null) {
          return yield* new PtyAdapter.PtySpawnError({
            adapter: "shell-host",
            shell: input.shell,
            cause: new Error("The shell host did not start."),
          });
        }
        return yield* Effect.tryPromise({
          try: () => host.spawn(input),
          catch: (cause) =>
            new PtyAdapter.PtySpawnError({ adapter: "shell-host", shell: input.shell, cause }),
        });
      }),
    }),
    list: current(false).pipe(
      Effect.flatMap((host) =>
        host === null ? Effect.succeed([]) : Effect.tryPromise(() => host.list()),
      ),
      Effect.catch((error) =>
        Effect.logWarning("could not list the shell host's shells", { reason: error.message }).pipe(
          Effect.as([]),
        ),
      ),
    ),
    forget: Effect.fn("ShellHost.forget")((pid: number) =>
      Effect.sync(() => connection?.forget(pid)),
    ),
  });
});

/** Starts `<self> __shell-host <state dir>` detached, outside the server's process group. */
const startDetached = Effect.fn("ShellHost.startDetached")(function* (stateDir: string) {
  const self = yield* resolveSelfInvocation();
  const scope = yield* AgentScope;
  const launch = yield* scope.wrap({
    command: self.command,
    args: [...selfInvocationArgs(self, [SHELL_HOST_COMMAND, stateDir])],
    name: "shell-host",
    survivesRestart: true,
  });
  const failure = yield* Effect.sync(() => {
    try {
      NodeChildProcess.spawn(launch.command, [...launch.args], {
        detached: true,
        stdio: "ignore",
        cwd: stateDir,
      }).unref();
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  });
  if (failure !== null)
    yield* Effect.logWarning("could not start the shell host", { reason: failure });
});

/** Present everywhere except Windows. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32") return Layer.empty;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return Layer.effect(
      ShellHost,
      make({
        socketPath: shellHostSocketPath(stateDir),
        start: startDetached(stateDir).pipe(Effect.provideService(Path.Path, path)),
      }),
    );
  }),
);
