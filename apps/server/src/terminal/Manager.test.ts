import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_TERMINAL_ID,
  type TerminalAttachStreamEvent,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  type ShellListStreamEvent,
  type TerminalOpenInput,
  ProviderDriverKind,
  ProviderInstanceId,
  TerminalProviderInstanceNotFoundError,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as PlatformError from "effect/PlatformError";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { expect, vi } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "./Manager.ts";
import { terminalOutputStream } from "./OutputProtocol.ts";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Shells from "./Shells.ts";

vi.mock("effect/SynchronizedRef", async (importOriginal) => {
  const original = await importOriginal<typeof SynchronizedRef>();
  return { ...original, make: vi.fn(original.make) };
});

// The server omits DOM types, which include TypeScript's WebAssembly declarations.

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

class FakePtyProcess implements PtyAdapter.PtyProcess {
  readonly writes: string[] = [];
  onWrite: (() => void) | undefined;
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  readonly killSignals: Array<string | undefined> = [];
  readonly pid: number;
  writeFailure: unknown | undefined;
  resizeFailure: unknown | undefined;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  killed = false;
  exitOnSubscribe: PtyAdapter.PtyExitEvent | undefined;
  onKill: ((signal?: string) => void) | undefined;

  constructor(pid: number) {
    this.pid = pid;
  }

  write(data: string): void {
    if (this.writeFailure !== undefined) {
      throw this.writeFailure;
    }
    this.writes.push(data);
    this.onWrite?.();
  }

  resize(cols: number, rows: number): void {
    if (this.resizeFailure !== undefined) {
      throw this.resizeFailure;
    }
    this.resizeCalls.push({ cols, rows });
  }

  kill(signal?: string): void {
    this.killed = true;
    this.killSignals.push(signal);
    this.onKill?.(signal);
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => {
      this.dataListeners.delete(callback);
    };
  }

  onExit(callback: (event: PtyAdapter.PtyExitEvent) => void): () => void {
    if (this.exitOnSubscribe) callback(this.exitOnSubscribe);
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  get exitListenerCount(): number {
    return this.exitListeners.size;
  }

  emitExit(event: PtyAdapter.PtyExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

/** A process in the shell host: shutdown lets go of it instead of ending it. */
class DetachablePtyProcess extends FakePtyProcess {
  detached = false;
  detach(): void {
    this.detached = true;
  }
}

class FakePtyAdapter {
  readonly spawnInputs: PtyAdapter.PtySpawnInput[] = [];
  readonly processes: FakePtyProcess[] = [];
  /** Given to every process spawned from now on. */
  onWrite: (() => void) | undefined;
  readonly spawnFailures: Error[] = [];
  private readonly mode: "sync" | "async";
  private nextPid = 9000;
  exitOnSubscribe: PtyAdapter.PtyExitEvent | undefined;
  private readonly detachable: boolean;

  constructor(mode: "sync" | "async" = "sync", detachable = false) {
    this.mode = mode;
    this.detachable = detachable;
  }

  spawn(
    input: PtyAdapter.PtySpawnInput,
  ): Effect.Effect<PtyAdapter.PtyProcess, PtyAdapter.PtySpawnError> {
    this.spawnInputs.push(input);
    const failure = this.spawnFailures.shift();
    if (failure) {
      return Effect.fail(
        new PtyAdapter.PtySpawnError({
          adapter: "fake",
          shell: input.shell,
          cause: failure,
        }),
      );
    }
    const process = this.detachable
      ? new DetachablePtyProcess(this.nextPid++)
      : new FakePtyProcess(this.nextPid++);
    process.exitOnSubscribe = this.exitOnSubscribe;
    process.onWrite = this.onWrite;
    this.processes.push(process);
    if (this.mode === "async") {
      return Effect.tryPromise({
        try: async () => process,
        catch: (cause) =>
          new PtyAdapter.PtySpawnError({
            adapter: "fake",
            shell: input.shell,
            cause,
          }),
      });
    }
    return Effect.succeed(process);
  }
}

// Publishes 9 MiB of output, past a stream's 8 MiB budget, while nothing pulls.
const publishPastOutputBudget = (
  manager: TerminalManager.TerminalManager["Service"],
  process: FakePtyProcess,
) =>
  Effect.gen(function* () {
    const published = yield* Deferred.make<void>();
    const unsubscribe = yield* manager.subscribe((event) =>
      event.type === "output" && event.data === "last\n"
        ? Deferred.succeed(published, undefined).pipe(Effect.asVoid)
        : Effect.void,
    );
    for (let index = 0; index < 9; index++) process.emitData("x".repeat(1024 * 1024));
    process.emitData("last\n");
    yield* Deferred.await(published);
    unsubscribe();
  });

// Holds the next spawn, and with it the thread lock, until `release` succeeds.
class GatedPtyAdapter extends FakePtyAdapter {
  gate: {
    readonly spawning: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  } | null = null;

  override spawn(
    input: PtyAdapter.PtySpawnInput,
  ): Effect.Effect<PtyAdapter.PtyProcess, PtyAdapter.PtySpawnError> {
    const gate = this.gate;
    this.gate = null;
    if (!gate) return super.spawn(input);
    return Deferred.succeed(gate.spawning, undefined).pipe(
      Effect.andThen(Deferred.await(gate.release)),
      Effect.andThen(super.spawn(input)),
    );
  }
}

function openInput(overrides: Partial<TerminalOpenInput> = {}): TerminalOpenInput {
  return {
    threadId: "thread-1",
    terminalId: DEFAULT_TERMINAL_ID,
    cwd: process.cwd(),
    cols: 100,
    rows: 24,
    ...overrides,
  };
}

const historyLogPath = (logsDir: string, threadId = "thread-1") =>
  Effect.service(Path.Path).pipe(
    Effect.map(({ join }) => join(logsDir, `terminal_${Base64Url.encode(threadId)}.log`)),
  );

interface CreateManagerOptions {
  shellResolver?: () => string;
  env?: NodeJS.ProcessEnv;
  subprocessInspector?: (terminalPid: number) => Effect.Effect<{
    readonly hasRunningSubprocess: boolean;
    readonly childCommand: string | null;
    readonly processIds: ReadonlyArray<number>;
  }>;
  processTable?: Effect.Effect<
    ReadonlyArray<{ readonly pid: number; readonly ppid: number; readonly name: string }>,
    never
  >;
  subprocessPollIntervalMs?: number;
  processKillGraceMs?: number;
  registerTerminalProcesses?: Parameters<
    typeof TerminalManager.makeWithOptions
  >[0]["registerTerminalProcesses"];
  maxRetainedInactiveSessions?: number;
  historyByteLimit?: number;
  ptyAdapter?: FakePtyAdapter;
  shellPtyAdapter?: FakePtyAdapter;
  shellReadyDir?: string;
  /** A folder that outlives the manager, for what it saves at shutdown. */
  baseDir?: string;
  resolveProviderInstanceEnvironment?: Parameters<
    typeof TerminalManager.makeWithOptions
  >[0]["resolveProviderInstanceEnvironment"];
  managedBinaryCacheDir?: string;
  managedBinaryToolsDir?: string;
}

interface ManagerFixture {
  readonly baseDir: string;
  readonly logsDir: string;
  readonly ptyAdapter: FakePtyAdapter;
  readonly manager: TerminalManager.TerminalManager["Service"];
  readonly getEvents: Effect.Effect<ReadonlyArray<TerminalEvent>>;
}

const createManager = (
  historyLineLimit = 5,
  options: CreateManagerOptions = {},
): Effect.Effect<
  ManagerFixture,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ProcessRunner.ProcessRunner
> =>
  Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir =
        options.baseDir ?? (yield* fs.makeTempDirectoryScoped({ prefix: "t3code-terminal-" }));
      const logsDir = join(baseDir, "userdata", "logs", "terminals");
      const ptyAdapter = options.ptyAdapter ?? new FakePtyAdapter();

      const manager = yield* TerminalManager.makeWithOptions({
        logsDir,
        historyLineLimit,
        ptyAdapter,
        ...(options.shellPtyAdapter !== undefined
          ? { shellPtyAdapter: options.shellPtyAdapter }
          : {}),
        ...(options.shellReadyDir !== undefined ? { shellReadyDir: options.shellReadyDir } : {}),
        ...(options.historyByteLimit !== undefined
          ? { historyByteLimit: options.historyByteLimit }
          : {}),
        ...(options.shellResolver !== undefined ? { shellResolver: options.shellResolver } : {}),
        ...(options.env !== undefined ? { env: options.env } : {}),
        ...(options.subprocessInspector !== undefined
          ? { subprocessInspector: options.subprocessInspector }
          : {}),
        ...(options.processTable !== undefined ? { processTable: options.processTable } : {}),
        ...(options.subprocessPollIntervalMs !== undefined
          ? { subprocessPollIntervalMs: options.subprocessPollIntervalMs }
          : {}),
        processKillGraceMs: options.processKillGraceMs ?? 1,
        ...(options.registerTerminalProcesses !== undefined
          ? { registerTerminalProcesses: options.registerTerminalProcesses }
          : {}),
        ...(options.maxRetainedInactiveSessions !== undefined
          ? { maxRetainedInactiveSessions: options.maxRetainedInactiveSessions }
          : {}),
        ...(options.resolveProviderInstanceEnvironment !== undefined
          ? { resolveProviderInstanceEnvironment: options.resolveProviderInstanceEnvironment }
          : {}),
        ...(options.managedBinaryCacheDir === undefined
          ? {}
          : {
              managedBinaryCacheDir: options.managedBinaryCacheDir,
              managedBinaryToolsDir: options.managedBinaryToolsDir,
            }),
      });
      const eventsRef = yield* Ref.make<ReadonlyArray<TerminalEvent>>([]);
      const unsubscribe = yield* manager.subscribe((event) =>
        Ref.update(eventsRef, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

      return {
        baseDir,
        logsDir,
        join,
        ptyAdapter,
        manager,
        getEvents: Ref.get(eventsRef),
      };
    }),
  );

const layerWithHostPlatform = (platform: NodeJS.Platform) =>
  Layer.succeed(HostProcess.Platform, platform);

function retainedHistory(text: string, maxLines: number, maxBytes = Infinity): string {
  const terminated = text.endsWith("\n");
  const lines = text.split("\n");
  if (terminated) lines.pop();
  const retained = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  const capped = terminated ? `${retained}\n` : retained;
  if (Buffer.byteLength(capped) <= maxBytes) return capped;
  const points = Array.from(capped);
  let start = points.length;
  let bytes = 0;
  while (start > 0) {
    const next = Buffer.byteLength(points[start - 1]!);
    if (bytes + next > maxBytes) break;
    bytes += next;
    start -= 1;
  }
  return points.slice(start).join("");
}

it("preserves line and byte limits across arbitrary chunks, Unicode, ANSI sequences, and clear", () => {
  let randomSeed = 0x20260904;
  const fragments = [
    "",
    "a",
    "\n",
    "\n\n",
    "\r",
    "\r\n",
    "café",
    "名",
    "🚀",
    "\u001b[31m",
    "\u001b[0m",
    "\u001b]8;;url\u0007",
    "\ud83d",
    "\ude80",
  ];
  const nextFragment = () => {
    randomSeed = (Math.imul(randomSeed, 1_664_525) + 1_013_904_223) >>> 0;
    return fragments[randomSeed % fragments.length]!;
  };

  for (const maxBytes of [0, 3, 8, 64, Infinity]) {
    for (const maxLines of [0, 1, 3, 5, 5_000]) {
      let expected = retainedHistory("before\ninitial\n", maxLines, maxBytes);
      const history = new TerminalManager.BoundedTerminalHistory(
        maxLines,
        "before\ninitial\n",
        maxBytes,
      );
      expect(history.value()).toBe(expected);

      for (let step = 0; step < 300; step += 1) {
        if (step % 73 === 0) {
          history.clear();
          expected = "";
          expect(history.value()).toBe(expected);
        }
        const chunk = nextFragment() + nextFragment();
        history.append(chunk);
        expected = retainedHistory(expected + chunk, maxLines, maxBytes);
        expect(history.value()).toBe(expected);
      }
    }
  }
});

it("bounds long partial lines and joins surrogate pairs across chunk boundaries", () => {
  const maxBytes = 65_539;
  let expected = "";
  const history = new TerminalManager.BoundedTerminalHistory(5_000, "", maxBytes);
  const writes = [
    "a".repeat(16_383) + "😀" + "b".repeat(70_000),
    "\r" + "c".repeat(70_000) + "\ud83d",
    "\ude80" + "d".repeat(100),
    "\uFEFF" + "名".repeat(30_000),
  ];
  for (const text of writes) {
    history.append(text);
    expected = retainedHistory(expected + text, 5_000, maxBytes);
    expect(history.value()).toBe(expected);
    expect(Buffer.byteLength(history.value())).toBeLessThanOrEqual(maxBytes);
  }
});

it.layer(
  Layer.merge(NodeServices.layer, ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
  { excludeTestServices: true },
)("TerminalManager", (it) => {
  it.effect("spawns lazily and reuses running terminal per thread", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const [first, second] = yield* Effect.all(
        [manager.open(openInput()), manager.open(openInput())],
        { concurrency: "unbounded" },
      );
      const third = yield* manager.open(openInput());

      assert.equal(first.threadId, "thread-1");
      assert.equal(first.terminalId, DEFAULT_TERMINAL_ID);
      assert.equal(second.threadId, "thread-1");
      assert.equal(third.threadId, "thread-1");
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
    }),
  );

  it.effect("keeps attach streams live when a terminal id is closed and reopened", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const attachEvents = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const unsubscribe = yield* manager.attachStream(openInput(), (event) =>
        Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

      yield* manager.close({
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        deleteHistory: true,
      });
      yield* manager.open(openInput());

      const events = yield* Ref.get(attachEvents);
      expect(events.map((event) => event.type)).toEqual(["snapshot", "closed", "snapshot"]);
      expect(
        events.filter((event) => event.type === "snapshot").map((event) => event.snapshot.status),
      ).toEqual(["running", "running"]);
      expect(ptyAdapter.spawnInputs).toHaveLength(2);
    }),
  );

  // Which client owns the shared PTY size is left open by the issue, so this only asserts
  // that every attached renderer is told the grid the PTY actually has.
  it.effect("tells every attached stream the shared PTY size when attaches disagree", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const wideEvents: TerminalAttachStreamEvent[] = [];
      const narrowEvents: TerminalAttachStreamEvent[] = [];
      const stopWide = yield* manager.attachStream(openInput({ cols: 130, rows: 15 }), (event) =>
        Effect.sync(() => {
          wideEvents.push(event);
        }),
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopWide));
      const stopNarrow = yield* manager.attachStream(openInput({ cols: 54, rows: 15 }), (event) =>
        Effect.sync(() => {
          narrowEvents.push(event);
        }),
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopNarrow));

      const spawned = ptyAdapter.spawnInputs[0]!;
      const ptySize = ptyAdapter.processes[0]!.resizeCalls.at(-1) ?? {
        cols: spawned.cols,
        rows: spawned.rows,
      };
      const lastReportedSize = (events: ReadonlyArray<TerminalAttachStreamEvent>) => {
        for (const event of events.toReversed()) {
          const source: Record<string, unknown> =
            event.type === "snapshot" ? event.snapshot : event;
          if (typeof source.cols === "number" && typeof source.rows === "number") {
            return { cols: source.cols, rows: source.rows };
          }
        }
        return null;
      };

      expect({
        wide: lastReportedSize(wideEvents),
        narrow: lastReportedSize(narrowEvents),
      }).toEqual({ wide: ptySize, narrow: ptySize });
    }),
  );

  it.effect("gives the PTY back to the remaining viewer when the narrowest one detaches", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const restored = yield* Deferred.make<void>();
      const stopWide = yield* manager.attachStream(
        openInput({ cols: 130, rows: 15 }),
        (event) =>
          event.type === "activity" && event.cols === 130 && event.rows === 15
            ? Deferred.succeed(restored, undefined).pipe(Effect.asVoid)
            : Effect.void,
        undefined,
        "wide",
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopWide));
      const stopNarrow = yield* manager.attachStream(
        openInput({ cols: 54, rows: 15 }),
        () => Effect.void,
        undefined,
        "narrow",
      );
      const process = ptyAdapter.processes[0]!;

      yield* manager.resize(
        { threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID, cols: 80, rows: 12 },
        "narrow",
      );
      // A resize from a client with no attached stream cannot override attached viewers.
      yield* manager.resize({
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        cols: 200,
        rows: 50,
      });
      expect(process.resizeCalls.at(-1)).toEqual({ cols: 80, rows: 12 });

      stopNarrow();
      yield* Deferred.await(restored);
      expect(process.resizeCalls.at(-1)).toEqual({ cols: 130, rows: 15 });
    }),
  );

  // Client retries resend the first attach's size, which a later resize may have replaced.
  it.effect("keeps a viewer's resized grid when the same viewer attaches again", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const restored = yield* Deferred.make<void>();
      const stopWide = yield* manager.attachStream(
        openInput({ cols: 130, rows: 15 }),
        (event) =>
          event.type === "activity" && event.cols === 130 && event.rows === 15
            ? Deferred.succeed(restored, undefined).pipe(Effect.asVoid)
            : Effect.void,
        undefined,
        "wide",
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopWide));
      const stopFirst = yield* manager.attachStream(
        openInput({ cols: 54, rows: 15 }),
        () => Effect.void,
        undefined,
        "phone",
      );
      const process = ptyAdapter.processes[0]!;
      yield* manager.resize(
        { threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID, cols: 100, rows: 15 },
        "phone",
      );

      const stopRetry = yield* manager.attachStream(
        { ...openInput({ cols: 54, rows: 15 }), resume: true },
        () => Effect.void,
        undefined,
        "phone",
      );
      expect(process.resizeCalls.at(-1)).toEqual({ cols: 100, rows: 15 });

      stopRetry();
      stopFirst();
      yield* Deferred.await(restored);
      expect(process.resizeCalls.at(-1)).toEqual({ cols: 130, rows: 15 });
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
    }),
  );

  it.effect("resumed attaches after close never respawn until the terminal is reopened", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.open(openInput());
      yield* manager.close({ threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID });

      const attachEvents = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const unsubscribe = yield* manager.attachStream(
        { ...openInput(), restartIfNotRunning: true, resume: true },
        (event) => Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      expect((yield* Ref.get(attachEvents)).map((event) => event.type)).toEqual(["closed"]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);

      yield* manager.open(openInput());
      const events = yield* Ref.get(attachEvents);
      expect(events.map((event) => event.type)).toEqual(["closed", "snapshot"]);
      expect(ptyAdapter.spawnInputs).toHaveLength(2);
    }),
  );

  it.effect("resumed attaches respect closes before this server has seen a terminal", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.close({ threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID });

      const attachEvents = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const unsubscribe = yield* manager.attachStream(
        { ...openInput(), restartIfNotRunning: true, resume: true },
        (event) => Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      expect((yield* Ref.get(attachEvents)).map((event) => event.type)).toEqual(["closed"]);
      expect(ptyAdapter.spawnInputs).toHaveLength(0);
    }),
  );

  it.effect("resumed attaches leave exited and evicted terminals stopped", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager(5, {
        maxRetainedInactiveSessions: 1,
      });
      const exited = yield* Deferred.make<void>();
      const unsubscribeEvents = yield* manager.subscribe((event) =>
        event.type === "exited"
          ? Deferred.succeed(exited, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeEvents));
      yield* manager.open(openInput());
      ptyAdapter.processes[0]?.emitExit({ exitCode: 0, signal: 0 });
      yield* Deferred.await(exited);

      const attachEvents = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const unsubscribe = yield* manager.attachStream(
        { ...openInput(), restartIfNotRunning: true, resume: true },
        (event) => Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      expect(yield* Ref.get(attachEvents)).toEqual([
        { type: "snapshot", snapshot: expect.objectContaining({ status: "exited" }) },
      ]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);

      // Opening another terminal completes eviction before the next resumed attach.
      yield* manager.open(openInput({ threadId: "thread-2" }));
      const unsubscribeEvicted = yield* manager.attachStream(
        { ...openInput(), restartIfNotRunning: true, resume: true },
        (event) => Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeEvicted));
      expect((yield* Ref.get(attachEvents)).map((event) => event.type)).toEqual([
        "snapshot",
        "closed",
      ]);
      expect(ptyAdapter.spawnInputs).toHaveLength(2);
    }),
  );

  it.effect("resumed attaches recreate terminals this server has never seen", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const attachEvents = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const unsubscribe = yield* manager.attachStream({ ...openInput(), resume: true }, (event) =>
        Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      expect(yield* Ref.get(attachEvents)).toEqual([
        { type: "snapshot", snapshot: expect.objectContaining({ status: "running" }) },
      ]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
    }),
  );

  const pathExists = (filePath: string) =>
    Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.exists(filePath));

  const readFileString = (filePath: string) =>
    Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.readFileString(filePath));

  const writeFileString = (filePath: string, contents: string) =>
    Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) =>
      fs.writeFileString(filePath, contents),
    );

  it.effect("handles an exit replayed during subscription after publishing startup", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakePtyAdapter();
      ptyAdapter.exitOnSubscribe = { exitCode: 7, signal: null };
      const { manager, getEvents } = yield* createManager(5, { ptyAdapter });
      const exited = yield* Deferred.make<void>();
      const unsubscribe = yield* manager.subscribe((event) =>
        event.type === "exited"
          ? Deferred.succeed(exited, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      yield* manager.open(openInput());
      yield* Deferred.await(exited);
      const events = yield* getEvents;
      expect(events.map((event) => event.type)).toEqual(["started", "exited"]);
      expect(events[1]).toMatchObject({ exitCode: 7 });
      const attached: TerminalAttachStreamEvent[] = [];
      const stopAttach = yield* manager.attachStream(openInput(), (event) =>
        Effect.sync(() => {
          attached.push(event);
        }),
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopAttach));
      expect(attached.find((event) => event.type === "snapshot")).toMatchObject({
        snapshot: { status: "exited", exitCode: 7 },
      });
    }),
  );

  it.effect("supports multiple terminals per thread independently", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.open(openInput({ terminalId: "default" }));
      yield* manager.open(openInput({ terminalId: "term-2" }));

      const first = ptyAdapter.processes[0];
      const second = ptyAdapter.processes[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) return;

      yield* manager.write({ threadId: "thread-1", terminalId: "default", data: "pwd\n" });
      yield* manager.write({ threadId: "thread-1", terminalId: "term-2", data: "ls\n" });

      expect(first.writes).toEqual(["pwd\n"]);
      expect(second.writes).toEqual(["ls\n"]);
      expect(ptyAdapter.spawnInputs).toHaveLength(2);
    }),
  );

  it.effect("closes only a thread's idle shells, ignoring a helper forked from the shell", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager(5, {
        processTable: Effect.succeed([
          { pid: 9000, ppid: 1, name: "zsh" },
          { pid: 100, ppid: 9000, name: "zsh" },
          { pid: 9001, ppid: 1, name: "zsh" },
          { pid: 200, ppid: 9001, name: "node" },
          { pid: 9002, ppid: 1, name: "zsh" },
          { pid: 300, ppid: 9002, name: "zsh" },
          { pid: 301, ppid: 300, name: "sleep" },
          { pid: 9003, ppid: 1, name: "zsh" },
        ]),
      }).pipe(Effect.provide(layerWithHostPlatform("linux")));
      yield* manager.open(openInput({ terminalId: "idle" }));
      yield* manager.open(openInput({ terminalId: "dev-server" }));
      yield* manager.open(openInput({ terminalId: "subshell" }));
      yield* manager.open(openInput({ threadId: "thread-2" }));

      yield* manager.closeIdle({ threadId: "thread-1" });

      expect(ptyAdapter.processes.map((process) => process.killed)).toEqual([
        true,
        false,
        false,
        false,
      ]);
    }),
  );

  it.effect("keeps terminals that get input or output while closeIdle checks them", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakePtyAdapter();
      let duringCheck: (pid: number) => Effect.Effect<void> = () => Effect.void;
      const { manager } = yield* createManager(5, {
        ptyAdapter,
        subprocessPollIntervalMs: 60_000,
        subprocessInspector: (pid) =>
          duringCheck(pid).pipe(
            Effect.as({ hasRunningSubprocess: false, childCommand: null, processIds: [] }),
          ),
      });
      const outputSeen = yield* Deferred.make<void>();
      const unsubscribeOutput = yield* manager.subscribe((event) =>
        event.type === "output"
          ? Deferred.succeed(outputSeen, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeOutput));
      yield* manager.open(openInput({ terminalId: "typed" }));
      yield* manager.open(openInput({ terminalId: "echoed" }));
      const [typed, echoed] = ptyAdapter.processes;
      duringCheck = (pid) =>
        pid === typed!.pid
          ? manager
              .write({ threadId: "thread-1", terminalId: "typed", data: "make build\r" })
              .pipe(Effect.orDie)
          : Effect.gen(function* () {
              echoed!.emitData("make build\r\n");
              yield* Deferred.await(outputSeen);
            }).pipe(Effect.orDie);

      yield* manager.closeIdle({ threadId: "thread-1" });

      expect(ptyAdapter.processes.map((process) => process.killed)).toEqual([false, false]);
    }),
  );

  it.effect("caps incrementally appended history without losing partial or empty lines", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager(3);
      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0];
      expect(process).toBeDefined();
      if (!process) return;

      process.emitData("line1\n");
      process.emitData("\n");
      process.emitData("line3");
      process.emitData("-continued\nline4");
      yield* manager.close({ threadId: "thread-1" });

      const reopened = yield* manager.open(openInput());
      expect(reopened.history).toBe("\nline3-continued\nline4");
    }),
  );

  it.effect("bounds persisted and attached history without truncating live output", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter, logsDir } = yield* createManager(5, { historyByteLimit: 10 });
      const attachEvents = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const unsubscribe = yield* manager.attachStream(openInput(), (event) =>
        Ref.update(attachEvents, (events) => [...events, event]),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      const writes = ["a".repeat(32), "😀\rEND"];
      const process = ptyAdapter.processes[0]!;
      for (const text of writes) process.emitData(text);
      yield* manager.close({ threadId: "thread-1" });
      expect(yield* readFileString(yield* historyLogPath(logsDir))).toBe("aa😀\rEND");

      const reopened = yield* manager.open(openInput());
      const events = yield* Ref.get(attachEvents);
      expect(events.filter((event) => event.type === "output").map((event) => event.data)).toEqual(
        writes,
      );
      const snapshot = events.filter((event) => event.type === "snapshot").at(-1)?.snapshot;
      expect(snapshot?.history).toBe("aa😀\rEND");
      expect(snapshot?.sequence).toBe(reopened.sequence);
    }),
  );

  it.effect("retains plain Unicode and control characters around a split query", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0]!;
      const before = "café\t界🙂\u0007\u009c\u0085";
      const after = "e\u0301\r\n";

      process.emitData(before);
      process.emitData("\u001b[5");
      process.emitData(`n${after}`);
      yield* manager.close({ threadId: "thread-1" });

      expect((yield* manager.open(openInput())).history).toBe(before + after);
    }),
  );

  it.effect("strips replayable CSI and DCS traffic while preserving setters", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0];
      expect(process).toBeDefined();
      if (!process) return;

      process.emitData("prompt ");
      process.emitData("\u001b[?2026$p\u001b[?2026;2$y\u001b[>q\u001b[?u\u001b[?31u");
      process.emitData("\u001bP$q m\u001b\\\u001bP1$r0m\u001b\\");
      process.emitData("\u001bP+q544e\u001b\\\u001bP1+r544e=1b\u001b\\");
      process.emitData("\u0090$q m\u009c\u00901$r0m\u009c");
      process.emitData("\u0090+q544e\u009c\u00901+r544e=1b\u009c");
      process.emitData('\u001b[!p\u001b["p\u001b[4 q\u001b[u');
      process.emitData("done\n");

      yield* manager.close({ threadId: "thread-1" });

      const reopened = yield* manager.open(openInput());
      expect(reopened.history.startsWith('prompt \u001b[!p\u001b["p\u001b[4 q\u001b[udone\n')).toBe(
        true,
      );
    }),
  );

  it.effect.each([
    { name: "OSC", sequence: "\u001b]0;unfinished" },
    { name: "DCS", sequence: "\u001bPunfinished" },
    { name: "PM", sequence: "\u001b^unfinished" },
    { name: "APC", sequence: "\u001b_unfinished" },
    { name: "CSI", sequence: "\u001b[5" },
    { name: "C1 OSC", sequence: "\u009d0;unfinished" },
    { name: "C1 DCS", sequence: "\u0090unfinished" },
    { name: "C1 PM", sequence: "\u009eunfinished" },
    { name: "C1 APC", sequence: "\u009funfinished" },
    { name: "C1 CSI", sequence: "\u009b5" },
  ])("keeps output after a cancelled $name sequence in history", ({ sequence }) =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0]!;
      for (const cancel of ["\u0018", "\u001a"]) {
        process.emitData(sequence);
        process.emitData(cancel);
        process.emitData("next line\n");
        process.emitData(`${sequence}${cancel}next line\n`);
      }
      yield* manager.close({ threadId: "thread-1" });

      const reopened = yield* manager.open(openInput());
      expect(reopened.history.match(/next line/g)).toHaveLength(4);
    }),
  );

  it.effect("handles CSI and DCS query sequences split across output chunks", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0];
      expect(process).toBeDefined();
      if (!process) return;

      process.emitData("before ");
      process.emitData("\u001b[?2026$");
      process.emitData("pafter ");
      process.emitData("\u001bP$q ");
      process.emitData("m\u001b");
      process.emitData("\\after ");
      process.emitData("\u009b?3");
      process.emitData("1uafter ");
      process.emitData("\u0090+q544e");
      process.emitData("\u009cafter\n");

      yield* manager.close({ threadId: "thread-1" });

      const reopened = yield* manager.open(openInput());
      assert.equal(reopened.history, "before after after after after\n");
    }),
  );

  it.effect("preserves large chunked OSC 52 and DCS strings across reopen", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter, logsDir } = yield* createManager();
      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0]!;
      const outputSeen = yield* Deferred.make<void>();
      const unsubscribe = yield* manager.subscribe((event) =>
        event.type === "output" && event.data === "done\n"
          ? Deferred.succeed(outputSeen, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      const sequences = [
        { prefix: `\u001b]52;c;${"YWJj".repeat(16_384)}\u001b`, terminator: "\\" },
        { prefix: `\u0090q${"?".repeat(65_536)}`, terminator: "\u009c" },
      ];
      const stripped = "\u001b]11;?\u0007\u0090$q m\u009c";
      const preserved = "\u001b[31m\u009d52;c;YWJj\u009c";
      const expected =
        sequences.map(({ prefix, terminator }) => prefix + terminator + preserved).join("") +
        "done\n";

      // Counts reads of strings larger than one emitted chunk, so rescanning the
      // pending prefix on every chunk shows up as quadratic work.
      const charCodeAt = String.prototype.charCodeAt;
      let largeStringReads = 0;
      yield* Effect.gen(function* () {
        // eslint-disable-next-line no-extend-native -- Count reads without retaining millions of spy call records.
        String.prototype.charCodeAt = function (this: string, index: number) {
          if (this.length > 4_096) largeStringReads += 1;
          return charCodeAt.call(this, index);
        };
        for (const { prefix, terminator } of sequences) {
          for (let offset = 0; offset < prefix.length; offset += 4_096) {
            process.emitData(prefix.slice(offset, offset + 4_096));
          }
          process.emitData(terminator + stripped + preserved);
        }
        process.emitData("done\n");
        yield* Deferred.await(outputSeen);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            // eslint-disable-next-line no-extend-native -- Restore the counting hook even when the test fails.
            String.prototype.charCodeAt = charCodeAt;
          }),
        ),
      );
      yield* manager.close({ threadId: "thread-1" });

      expect(largeStringReads).toBeLessThan(2 * expected.length);
      expect(yield* readFileString(yield* historyLogPath(logsDir))).toBe(expected);
      expect((yield* manager.open(openInput())).history.startsWith(expected)).toBe(true);
    }),
  );

  it.effect(
    "preserves chunk-split ESC sequences with intermediate bytes without leaking final bytes",
    () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager();
        yield* manager.open(openInput());
        const process = ptyAdapter.processes[0];
        expect(process).toBeDefined();
        if (!process) return;

        process.emitData("before ");
        process.emitData("\u001b(");
        process.emitData("Bafter\n");

        yield* manager.close({ threadId: "thread-1" });

        const reopened = yield* manager.open(openInput());
        expect(reopened.history.startsWith("before \u001b(Bafter\n")).toBe(true);
      }),
  );

  it.effect.each([
    {
      label: "subagent",
      threadId:
        "thread:provider:claudeAgent:native-thread:provider-thread%3Aprovider%3AclaudeAgent%3Anative-thread%3Apending%253Arun%253Athread%253A9175fb53-52d7-4d4d-9be7-25a76cf84b91%253Aordinal%253A7%3Aad899ae84c7a131b0",
    },
    // Also too long for the legacy `<sanitized id>.log` lookup.
    { label: "300-character", threadId: "x".repeat(300) },
  ])("persists history for a $label thread id too long to encode into a filename", ({ threadId }) =>
    Effect.gen(function* () {
      const terminalId = "t".repeat(128);
      const { manager, ptyAdapter, logsDir } = yield* createManager();
      const fs = yield* FileSystem.FileSystem;
      yield* manager.open(openInput({ threadId }));
      yield* manager.open(openInput({ threadId, terminalId }));
      ptyAdapter.processes[0]!.emitData("default\n");
      ptyAdapter.processes[1]!.emitData("long\n");
      yield* manager.close({ threadId });

      expect((yield* manager.open(openInput({ threadId }))).history).toBe("default\n");
      expect((yield* manager.open(openInput({ threadId, terminalId }))).history).toBe("long\n");

      yield* manager.close({ threadId, deleteHistory: true });
      expect(yield* fs.readDirectory(logsDir)).toEqual([]);
    }),
  );

  it.effect("keeps reading and deleting history at an encoded path that already fit", () =>
    Effect.gen(function* () {
      const threadId = "x".repeat(120);
      const { manager, logsDir } = yield* createManager();
      const fs = yield* FileSystem.FileSystem;
      const logPath = yield* historyLogPath(logsDir, threadId);
      yield* fs.makeDirectory(logsDir, { recursive: true });
      yield* fs.writeFileString(logPath, "before upgrade\n");

      expect((yield* manager.open(openInput({ threadId }))).history).toBe("before upgrade\n");
      // A long terminal id pushes only this terminal's name past the limit, so the thread's
      // history is split across both forms and deleting the thread must remove both.
      yield* manager.open(openInput({ threadId, terminalId: "t".repeat(128) }));

      yield* manager.close({ threadId, deleteHistory: true });
      expect(yield* fs.exists(logPath)).toBe(false);
      expect(yield* fs.readDirectory(logsDir)).toEqual([]);
    }),
  );

  it.effect("migrates legacy transcript filenames to terminal-scoped history path on open", () =>
    Effect.gen(function* () {
      const { manager, logsDir } = yield* createManager();
      const path = yield* Path.Path;
      const legacyPath = path.join(logsDir, "thread-1.log");
      const nextPath = yield* historyLogPath(logsDir);
      yield* writeFileString(legacyPath, "legacy-line\n");

      const snapshot = yield* manager.open(openInput());

      assert.equal(snapshot.history, "legacy-line\n");
      expect(yield* pathExists(nextPath)).toBe(true);
      expect(yield* readFileString(nextPath)).toBe("legacy-line\n");
      expect(yield* pathExists(legacyPath)).toBe(false);
    }),
  );

  it.effect("retries with fallback shells when preferred shell spawn fails", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      const missingShell =
        platform === "win32" ? "C:\\definitely\\missing-shell.exe" : "/definitely/missing-shell -l";
      const { manager, ptyAdapter } = yield* createManager(5, {
        shellResolver: () => missingShell,
      });
      ptyAdapter.spawnFailures.push(new Error("posix_spawnp failed."));

      const snapshot = yield* manager.open(openInput());

      assert.equal(snapshot.status, "running");
      expect(ptyAdapter.spawnInputs.length).toBeGreaterThanOrEqual(2);
      expect(ptyAdapter.spawnInputs[0]?.shell).toBe(
        platform === "win32" ? missingShell : "/definitely/missing-shell",
      );

      if (platform === "win32") {
        expect(
          ptyAdapter.spawnInputs.some(
            (input) =>
              input.shell === "pwsh.exe" ||
              input.shell === "powershell.exe" ||
              input.shell === "cmd.exe",
          ),
        ).toBe(true);
      } else {
        expect(
          ptyAdapter.spawnInputs
            .slice(1)
            .some((input) => input.shell !== "/definitely/missing-shell"),
        ).toBe(true);
      }
    }),
  );

  it.effect("preserves Windows Path casing when appending managed ACP binaries", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cacheDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-terminal-acp-path-",
      });
      const installBin = path.join(
        cacheDir,
        "tools",
        "example-agent",
        "1.2.3",
        "windows-x86_64",
        "bin",
      );
      yield* fileSystem.makeDirectory(installBin, { recursive: true });
      yield* fileSystem.makeDirectory(path.join(cacheDir, "acp-registry"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(cacheDir, "acp-registry", "registry.json"),
        encodeUnknownJson({
          version: "1.0.0",
          agents: [
            {
              id: "example-agent",
              name: "Example Agent",
              version: "1.2.3",
              description: "ACP Registry test agent",
              distribution: {
                binary: {
                  "windows-x86_64": {
                    archive: "https://registry.test/example-agent.zip",
                    cmd: "bin/example-agent.exe",
                  },
                },
              },
            },
          ],
        }),
      );
      const { manager, ptyAdapter } = yield* createManager(5, {
        managedBinaryCacheDir: cacheDir,
        managedBinaryToolsDir: path.join(cacheDir, "tools"),
        env: {
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          Path: "C:\\Windows\\System32",
          SystemRoot: "C:\\Windows",
        },
      }).pipe(
        Effect.provide(
          Layer.merge(
            layerWithHostPlatform("win32"),
            Layer.succeed(HostProcess.Architecture, "x64"),
          ),
        ),
      );

      yield* manager.open(openInput());

      const spawnEnv = ptyAdapter.spawnInputs[0]?.env;
      expect(spawnEnv?.PATH).toBeUndefined();
      expect(spawnEnv?.Path).toBe(`C:\\Windows\\System32;${installBin}`);
    }),
  );

  it.effect("falls back to built-in PowerShell by absolute path on Windows", () =>
    Effect.gen(function* () {
      const ptyAdapter = new FakePtyAdapter();
      const { manager } = yield* createManager(5, {
        ptyAdapter,
        shellResolver: () => "C:\\missing\\custom-shell.exe",
        env: {
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          PATH: "C:\\Windows\\System32",
          SystemRoot: "C:\\Windows",
        },
      }).pipe(Effect.provide(layerWithHostPlatform("win32")));
      ptyAdapter.spawnFailures.push(
        new Error("spawn custom-shell.exe ENOENT"),
        new Error("spawn pwsh.exe ENOENT"),
      );

      yield* manager.open(openInput());

      expect(ptyAdapter.spawnInputs.map((input) => input.shell)).toEqual([
        "C:\\missing\\custom-shell.exe",
        "pwsh.exe",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ]);
      expect(ptyAdapter.spawnInputs[1]?.args).toEqual(["-NoLogo"]);
      expect(ptyAdapter.spawnInputs[2]?.args).toEqual(["-NoLogo"]);
    }),
  );

  it.effect("turns off fish terminal queries unless the user chose query-term", () =>
    Effect.gen(function* () {
      for (const [platform, env, runtimeEnv, expected] of [
        ["linux", {}, {}, { fish_features: "no-query-term" }],
        [
          "linux",
          { fish_features: "qmark-noglob" },
          {},
          { fish_features: "qmark-noglob,no-query-term" },
        ],
        [
          "linux",
          { fish_features: "qmark-noglob,query-term" },
          {},
          { fish_features: "qmark-noglob,query-term" },
        ],
        [
          "linux",
          { fish_features: "qmark-noglob,no-query-term" },
          {},
          { fish_features: "qmark-noglob,no-query-term" },
        ],
        [
          "linux",
          { fish_features: "query-term" },
          { fish_features: "qmark-noglob" },
          { fish_features: "qmark-noglob,no-query-term" },
        ],
        [
          "win32",
          { FISH_FEATURES: "qmark-noglob" },
          {},
          { FISH_FEATURES: "qmark-noglob,no-query-term" },
        ],
        [
          "win32",
          { Fish_Features: "qmark-noglob,query-term" },
          {},
          { Fish_Features: "qmark-noglob,query-term" },
        ],
        [
          "win32",
          { FISH_FEATURES: "qmark-noglob,no-query-term" },
          {},
          { FISH_FEATURES: "qmark-noglob,no-query-term" },
        ],
        [
          "win32",
          { Fish_Features: "query-term" },
          { fish_features: "qmark-noglob" },
          { Fish_Features: "qmark-noglob,no-query-term" },
        ],
        [
          "win32",
          { FISH_FEATURES: "no-query-term" },
          { fish_features: "qmark-noglob,query-term" },
          { FISH_FEATURES: "qmark-noglob,query-term" },
        ],
      ] as const) {
        const { manager, ptyAdapter } = yield* createManager(5, {
          env,
        }).pipe(Effect.provide(layerWithHostPlatform(platform)));
        yield* manager.open(openInput({ env: runtimeEnv }));
        const fishFeatures = Object.fromEntries(
          Object.entries(ptyAdapter.spawnInputs[0]!.env).filter(
            ([key]) => key.toLowerCase() === "fish_features",
          ),
        );
        expect.soft(fishFeatures, JSON.stringify({ platform, env, runtimeEnv })).toEqual(expected);
      }
    }),
  );

  it.effect("filters app runtime env variables from terminal sessions", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager(5, {
        env: {
          PORT: "5173",
          T3CODE_PORT: "3773",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          TEST_TERMINAL_KEEP: "keep-me",
          TMUX: "/tmp/tmux-1000/default,1234,0",
          TMUX_PANE: "%3",
          ZELLIJ_SESSION_NAME: "work",
          ZELLIJ_CONFIG_DIR: "/home/user/.config/zellij",
        },
      });
      yield* manager.open(openInput());
      yield* manager.open(openInput({ terminalId: "explicit", env: { TMUX_PANE: "%9" } }));
      const spawnInput = ptyAdapter.spawnInputs[0];
      expect(spawnInput).toBeDefined();
      if (!spawnInput) return;

      expect(spawnInput.env.PORT).toBeUndefined();
      expect(spawnInput.env.T3CODE_PORT).toBeUndefined();
      expect(spawnInput.env.VITE_DEV_SERVER_URL).toBeUndefined();
      expect(spawnInput.env.TEST_TERMINAL_KEEP).toBe("keep-me");
      expect(spawnInput.env.TMUX).toBeUndefined();
      expect(spawnInput.env.TMUX_PANE).toBeUndefined();
      expect(spawnInput.env.ZELLIJ_SESSION_NAME).toBeUndefined();
      expect(spawnInput.env.ZELLIJ_CONFIG_DIR).toBe("/home/user/.config/zellij");
      expect(ptyAdapter.spawnInputs[1]?.env.TMUX_PANE).toBe("%9");
    }),
  );

  it.effect("strips AppImage runtime env from terminal sessions", () =>
    Effect.gen(function* () {
      const appDir = "/tmp/.mount_T3Codeabc123";
      const { manager, ptyAdapter } = yield* createManager(5, {
        env: {
          APPIMAGE: "/home/user/T3-Code.AppImage",
          APPDIR: appDir,
          ARGV0: "/home/user/T3-Code.AppImage",
          OWD: "/home/user/project",
          PATH: `${appDir}/usr/bin:${appDir}:/usr/local/bin:/usr/bin:/bin`,
          LD_LIBRARY_PATH: `${appDir}/usr/lib:/home/user/.local/lib`,
          XDG_DATA_DIRS: `${appDir}/usr/share:/usr/local/share:/usr/share`,
          GSETTINGS_SCHEMA_DIR: `${appDir}/usr/share/glib-2.0/schemas`,
          TEST_TERMINAL_KEEP: "keep-me",
        },
      });
      yield* manager.open(openInput());
      const spawnInput = ptyAdapter.spawnInputs[0];
      expect(spawnInput).toBeDefined();
      if (!spawnInput) return;

      expect(spawnInput.env.APPIMAGE).toBeUndefined();
      expect(spawnInput.env.APPDIR).toBeUndefined();
      expect(spawnInput.env.ARGV0).toBeUndefined();
      expect(spawnInput.env.OWD).toBeUndefined();
      expect(spawnInput.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
      expect(spawnInput.env.LD_LIBRARY_PATH).toBe("/home/user/.local/lib");
      expect(spawnInput.env.XDG_DATA_DIRS).toBe("/usr/local/share:/usr/share");
      expect(spawnInput.env.GSETTINGS_SCHEMA_DIR).toBeUndefined();
      expect(spawnInput.env.TEST_TERMINAL_KEEP).toBe("keep-me");
    }),
  );

  it.effect("resolves a provider instance environment before spawning", () =>
    Effect.gen(function* () {
      const providerInstanceId = ProviderInstanceId.make("codex_work");
      const { manager, ptyAdapter } = yield* createManager(5, {
        env: { T3CODE_SECRET: "server-only" },
        resolveProviderInstanceEnvironment: (requestedId, env) =>
          Effect.succeed({
            ...env,
            PROVIDER_SECRET: requestedId === providerInstanceId ? "secret-value" : "wrong",
            CODEX_HOME: "/accounts/codex-work",
          }),
      });

      const snapshot = yield* manager.open(
        openInput({ providerInstanceId, env: { CLIENT_FLAG: "1" } }),
      );

      expect(ptyAdapter.spawnInputs[0]?.env.PROVIDER_SECRET).toBe("secret-value");
      expect(ptyAdapter.spawnInputs[0]?.env.CODEX_HOME).toBe("/accounts/codex-work");
      expect(ptyAdapter.spawnInputs[0]?.env.CLIENT_FLAG).toBe("1");
      expect(ptyAdapter.spawnInputs[0]?.env.T3CODE_SECRET).toBeUndefined();
      expect(snapshot).not.toHaveProperty("env");
      expect(snapshot).not.toHaveProperty("providerInstanceId");
    }),
  );

  it.effect("fails closed when a provider instance is missing", () =>
    Effect.gen(function* () {
      const providerInstanceId = ProviderInstanceId.make("deleted_instance");
      const { manager, ptyAdapter } = yield* createManager(5, {
        resolveProviderInstanceEnvironment: (requestedId) =>
          Effect.fail(
            new TerminalProviderInstanceNotFoundError({
              providerInstanceId: ProviderInstanceId.make(requestedId),
            }),
          ),
      });

      const error = yield* manager.open(openInput({ providerInstanceId })).pipe(Effect.flip);

      assert.deepStrictEqual(
        error,
        new TerminalProviderInstanceNotFoundError({ providerInstanceId }),
      );
      expect(ptyAdapter.spawnInputs).toHaveLength(0);
    }),
  );

  it.effect.each([
    {
      name: "Codex home",
      driver: "codex",
      variable: "CODEX_HOME",
      config: { homePath: "/configured/codex" },
      expectedHome: "/configured/codex",
    },
    {
      name: "Codex shadow home",
      driver: "codex",
      variable: "CODEX_HOME",
      config: { homePath: "/configured/codex", shadowHomePath: "/configured/codex-shadow" },
      expectedHome: "/configured/codex-shadow",
    },
    {
      name: "Claude home",
      driver: "claudeAgent",
      variable: "CLAUDE_CONFIG_DIR",
      config: { homePath: "/configured/claude" },
      expectedHome: "/configured/claude",
    },
  ])("prefers $name over the instance environment", ({ driver, variable, config, expectedHome }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const environment = yield* TerminalManager.resolveProviderInstanceTerminalEnvironment({
        serverSettings,
        path,
        rawProviderInstanceId: "configured_home",
        env: undefined,
      });

      expect(environment[variable]).toBe(path.resolve(expectedHome));
    }).pipe(
      Effect.provide(
        ServerSettings.layerTest({
          providerInstances: {
            [ProviderInstanceId.make("configured_home")]: {
              driver: ProviderDriverKind.make(driver),
              environment: [{ name: variable, value: "~/.environment-account", sensitive: false }],
              config,
            },
          },
        }),
      ),
    ),
  );

  it.effect("restarts a running terminal when the resolved provider environment changes", () =>
    Effect.gen(function* () {
      const providerInstanceId = ProviderInstanceId.make("codex_work");
      let providerSecret = "first-secret";
      const { manager, ptyAdapter } = yield* createManager(5, {
        resolveProviderInstanceEnvironment: () =>
          Effect.succeed({ PROVIDER_SECRET: providerSecret }),
      });

      yield* manager.open(openInput({ providerInstanceId }));
      providerSecret = "second-secret";
      yield* manager.open(openInput({ providerInstanceId }));

      expect(ptyAdapter.processes[0]?.killed).toBe(true);
      expect(ptyAdapter.spawnInputs).toHaveLength(2);
      expect(ptyAdapter.spawnInputs[1]?.env.PROVIDER_SECRET).toBe("second-secret");
    }),
  );

  it.effect("attaches to a running provider terminal without resolving the provider again", () =>
    Effect.gen(function* () {
      const providerInstanceId = ProviderInstanceId.make("codex_work");
      let providerAvailable = true;
      const { manager, ptyAdapter } = yield* createManager(5, {
        resolveProviderInstanceEnvironment: (requestedId) =>
          providerAvailable
            ? Effect.succeed({ PROVIDER_SECRET: "secret-value" })
            : Effect.fail(
                new TerminalProviderInstanceNotFoundError({
                  providerInstanceId: ProviderInstanceId.make(requestedId),
                }),
              ),
      });
      yield* manager.open(openInput({ providerInstanceId }));
      providerAvailable = false;
      const events: TerminalAttachStreamEvent[] = [];

      const unsubscribe = yield* manager.attachStream(
        { ...openInput({ providerInstanceId }), restartIfNotRunning: true },
        (event) => Effect.sync(() => events.push(event)),
      );
      unsubscribe();

      expect(events[0]?.type).toBe("snapshot");
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
      expect(ptyAdapter.processes[0]?.killed).toBe(false);
    }),
  );

  it.effect("removes terminal metadata subscriptions when initial delivery fails", () =>
    Effect.gen(function* () {
      const { manager } = yield* createManager();
      yield* manager.open(openInput({ threadId: "existing-thread" }));

      const leakedLiveEvents = yield* Ref.make(0);
      const exit = yield* Effect.exit(
        manager.subscribeMetadata((event) =>
          event.type === "snapshot"
            ? Effect.die("snapshot listener failed")
            : Ref.update(leakedLiveEvents, (count) => count + 1),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);

      yield* manager.open(openInput({ threadId: "new-thread" }));
      expect(yield* Ref.get(leakedLiveEvents)).toBe(0);
    }),
  );

  it.effect("finishes shell startup when its creating attachment is cancelled", () =>
    Effect.gen(function* () {
      const ptyAdapter = new GatedPtyAdapter();
      const { manager } = yield* createManager(5, { ptyAdapter });
      const input = openInput();
      const gate = {
        spawning: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      ptyAdapter.gate = gate;
      const consumer = yield* Stream.runDrain(
        terminalOutputStream(
          (listener, registerCleanup) => manager.attachStream(input, listener, registerCleanup),
          (listener, registerCleanup) => manager.resyncStream(input, listener, registerCleanup),
        ),
      ).pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(gate.spawning);
      const cancelled = yield* Fiber.interrupt(consumer).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.succeed(gate.release, undefined);
      yield* Fiber.join(cancelled);

      const snapshots: TerminalAttachStreamEvent[] = [];
      const stop = yield* manager.attachStream(input, (event) =>
        Effect.sync(() => {
          snapshots.push(event);
        }),
      );
      stop();
      expect(snapshots).toMatchObject([
        { type: "snapshot", snapshot: { status: "running", pid: ptyAdapter.processes[0]?.pid } },
      ]);
      expect(ptyAdapter.processes).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("resyncs bounded history and follows close/reopen across a stalled stream", () =>
    Effect.gen(function* () {
      const ptyAdapter = new GatedPtyAdapter();
      const historyByteLimit = 64 * 1024;
      const { manager } = yield* createManager(5, { ptyAdapter, historyByteLimit });
      const input = openInput();
      const pull = yield* Stream.toPull(
        terminalOutputStream(
          (listener, registerCleanup) => manager.attachStream(input, listener, registerCleanup),
          (listener, registerCleanup) => manager.resyncStream(input, listener, registerCleanup),
        ),
      );
      expect(yield* pull).toMatchObject([{ type: "snapshot", snapshot: { history: "" } }]);
      const process = ptyAdapter.processes[0]!;
      yield* publishPastOutputBudget(manager, process);

      const resumed = yield* pull;
      expect(resumed).toHaveLength(1);
      expect(resumed[0]?.type).toBe("snapshot");
      if (resumed[0]?.type !== "snapshot") throw new Error("Expected a recovery snapshot");
      expect(Buffer.byteLength(resumed[0].snapshot.history)).toBeLessThanOrEqual(historyByteLimit);
      expect(resumed[0].snapshot.history.endsWith("last\n")).toBe(true);
      process.emitData("after recovery\n");
      expect(yield* pull).toMatchObject([{ type: "output", data: "after recovery\n" }]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);

      yield* publishPastOutputBudget(manager, process);
      yield* manager.close(input);
      expect(yield* pull).toEqual([
        { type: "closed", threadId: input.threadId, terminalId: input.terminalId },
      ]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
      yield* manager.open(input);
      expect(yield* pull).toMatchObject([
        { type: "snapshot", snapshot: { status: "running", pid: ptyAdapter.processes[1]!.pid } },
      ]);
      const reopenedProcess = ptyAdapter.processes[1]!;
      reopenedProcess.emitData("after reopen\n");
      expect(yield* pull).toMatchObject([{ type: "output", data: "after reopen\n" }]);

      yield* publishPastOutputBudget(manager, reopenedProcess);
      // Queue close/reopen ahead of recovery while another spawn owns the thread lock.
      const gate = {
        spawning: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      ptyAdapter.gate = gate;
      const holder = yield* manager
        .open(openInput({ terminalId: "other" }))
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(gate.spawning);
      const closed = yield* manager.close(input).pipe(Effect.forkChild({ startImmediately: true }));
      const reopened = yield* manager
        .open(input)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const recovery = yield* pull.pipe(Effect.forkChild({ startImmediately: true }));
      reopenedProcess.emitData("old session\n");
      yield* Deferred.succeed(gate.release, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.join(closed);
      yield* Fiber.join(reopened);

      const batch = yield* Fiber.join(recovery);
      expect(batch).toHaveLength(1);
      expect(batch[0]).toMatchObject({
        type: "snapshot",
        snapshot: { status: "running", pid: ptyAdapter.processes.at(-1)!.pid },
      });
      ptyAdapter.processes.at(-1)!.emitData("new session only\n");
      expect(yield* pull).toMatchObject([{ type: "output", data: "new session only\n" }]);
      expect(ptyAdapter.spawnInputs).toHaveLength(4);
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    { recovered: true, label: "after recovery" },
    { recovered: false, label: "when cancelled before recovery" },
  ])("keeps a stalled viewer's size until its attach stream ends ($label)", ({ recovered }) =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const restored = yield* Deferred.make<void>();
      const stopWide = yield* manager.attachStream(
        openInput({ cols: 130, rows: 15 }),
        (event) =>
          event.type === "activity" && event.cols === 130 && event.rows === 15
            ? Deferred.succeed(restored, undefined).pipe(Effect.asVoid)
            : Effect.void,
        undefined,
        "wide",
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopWide));
      const process = ptyAdapter.processes[0]!;

      yield* Effect.gen(function* () {
        const pull = yield* Stream.toPull(
          manager.attachOutputStream(openInput({ cols: 54, rows: 15 }), "narrow"),
        );
        expect(yield* pull).toMatchObject([{ type: "snapshot" }]);
        expect(process.resizeCalls.at(-1)).toEqual({ cols: 54, rows: 15 });
        // Overflow releases the inner subscription before any recovery pull.
        yield* publishPastOutputBudget(manager, process);
        yield* manager.resize(
          { threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID, cols: 50, rows: 12 },
          "narrow",
        );
        expect(process.resizeCalls.at(-1)).toEqual({ cols: 50, rows: 12 });
        if (!recovered) return;

        expect(yield* pull).toMatchObject([{ type: "snapshot" }]);
        yield* manager.resize(
          { threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID, cols: 48, rows: 12 },
          "narrow",
        );
        expect(process.resizeCalls.at(-1)).toEqual({ cols: 48, rows: 12 });
      }).pipe(Effect.scoped);

      yield* Deferred.await(restored);
      expect(process.resizeCalls.at(-1)).toEqual({ cols: 130, rows: 15 });
    }).pipe(Effect.scoped),
  );

  it.effect("does not replay in-flight output already included in an observer snapshot", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const input = openInput();
      yield* manager.open(input);
      const reached = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const delivered = yield* Deferred.make<void>();
      // The snapshot sees history before this earlier fanout listener releases it.
      const unsubscribe = yield* manager.subscribe((event) =>
        event.type === "output" && event.data === "in flight\n"
          ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      ptyAdapter.processes[0]!.emitData("in flight\n");
      yield* Deferred.await(reached);
      const observed: TerminalAttachStreamEvent[] = [];
      const stopObserving = yield* manager.observeStream(input, (event) =>
        Effect.gen(function* () {
          observed.push(event);
          if (event.type === "output" && event.data === "after\n") {
            yield* Deferred.succeed(delivered, undefined);
          }
        }),
      );
      yield* Effect.addFinalizer(() => Effect.sync(stopObserving));
      expect(observed).toMatchObject([{ type: "snapshot", snapshot: { history: "in flight\n" } }]);
      yield* Deferred.succeed(release, undefined);
      ptyAdapter.processes[0]!.emitData("after\n");
      yield* Deferred.await(delivered);
      expect(observed.filter((event) => event.type === "output")).toMatchObject([
        { data: "after\n" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("observes terminal history and live output without changing the process", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const opened = yield* manager.open(openInput({ env: { OBSERVER_TEST: "original" } }));
      const process = ptyAdapter.processes[0]!;
      const historyReceived = yield* Deferred.make<void>();
      const unsubscribeHistory = yield* manager.subscribe((event) =>
        event.type === "output"
          ? Deferred.succeed(historyReceived, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      process.emitData("existing history\n");
      yield* Deferred.await(historyReceived);
      unsubscribeHistory();

      const observed = yield* Ref.make<ReadonlyArray<TerminalAttachStreamEvent>>([]);
      const liveReceived = yield* Deferred.make<void>();
      const unsubscribe = yield* manager.observeStream(
        { threadId: opened.threadId, terminalId: opened.terminalId },
        (event) =>
          Ref.update(observed, (events) => [...events, event]).pipe(
            Effect.andThen(
              event.type === "output"
                ? Deferred.succeed(liveReceived, undefined).pipe(Effect.asVoid)
                : Effect.void,
            ),
          ),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      process.emitData("live output\n");
      yield* Deferred.await(liveReceived);

      expect(yield* Ref.get(observed)).toMatchObject([
        {
          type: "snapshot",
          snapshot: {
            cwd: opened.cwd,
            worktreePath: opened.worktreePath,
            pid: opened.pid,
            history: "existing history\n",
          },
        },
        { type: "output", data: "live output\n" },
      ]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
      expect(ptyAdapter.spawnInputs[0]?.env.OBSERVER_TEST).toBe("original");
      expect(process.resizeCalls).toEqual([]);
      expect(process.writes).toEqual([]);
      expect(process.killSignals).toEqual([]);
    }),
  );

  it.effect("observes exited terminals without restarting and rejects missing sessions", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const missingEvents: TerminalAttachStreamEvent[] = [];
      const missing = yield* manager
        .observeStream({ threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID }, (event) =>
          Effect.sync(() => {
            missingEvents.push(event);
          }),
        )
        .pipe(Effect.flip);
      expect(missing._tag).toBe("TerminalSessionLookupError");
      expect(ptyAdapter.spawnInputs).toEqual([]);

      yield* manager.open(openInput());
      const process = ptyAdapter.processes[0]!;
      const exited = yield* Deferred.make<void>();
      const unsubscribeExit = yield* manager.subscribe((event) =>
        event.type === "exited"
          ? Deferred.succeed(exited, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      process.emitExit({ exitCode: 7, signal: 0 });
      yield* Deferred.await(exited);
      unsubscribeExit();

      const events: TerminalAttachStreamEvent[] = [];
      const unsubscribe = yield* manager.observeStream(
        { threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID },
        (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
      );
      unsubscribe();
      expect(events).toMatchObject([
        { type: "snapshot", snapshot: { status: "exited", exitCode: 7, pid: null } },
      ]);
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
      expect(process.resizeCalls).toEqual([]);
      expect(process.writes).toEqual([]);
      expect(process.killSignals).toEqual([]);
      expect(missingEvents).toEqual([]);
    }),
  );
});

it.layer(
  Layer.merge(NodeServices.layer, ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
  { excludeTestServices: true },
)("Shells", (it) => {
  let nextShell = 0;
  // Fake pty pids could belong to real processes, so no test reaches the real process killer.
  const killedTrees: number[] = [];
  const makeShells = (
    manager: TerminalManager.TerminalManager["Service"],
    options?: Parameters<typeof Shells.makeShells>[2],
  ) =>
    Shells.makeShells(
      manager,
      Effect.sync(() => `shell-${++nextShell}`),
      { killTree: (pid) => Effect.sync(() => void killedTrees.push(pid)), ...options },
    );
  type ShellsService = Shells.Shells["Service"];

  const collectList = (shells: ShellsService) =>
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<ShellListStreamEvent>>([]);
      const stop = yield* shells.subscribe((event) => Ref.update(events, (all) => [...all, event]));
      yield* Effect.addFinalizer(() => Effect.sync(stop));
      return Ref.get(events);
    });

  const liveStatus = (shells: ShellsService, shellId: string) =>
    shells.attach({ shellId }, "status-check").pipe(
      Stream.take(1),
      Stream.runCollect,
      Effect.map(([first]) => (first?.type === "snapshot" ? first.snapshot.status : null)),
    );

  it.effect("leaves a shell running while a thread's terminals open, run and close", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const shell = yield* shells.open({ cwd: process.cwd() });

      yield* manager.open(openInput());
      yield* manager.open(openInput({ terminalId: "term-2" }));
      yield* manager.write({ threadId: "thread-1", terminalId: DEFAULT_TERMINAL_ID, data: "ls\n" });
      yield* manager.close({ threadId: "thread-1" });

      expect(ptyAdapter.processes[1]?.writes).toEqual(["ls\n"]);
      expect(ptyAdapter.processes.slice(1).map((p) => p.killed)).toEqual([true, true]);
      assert.equal(ptyAdapter.processes[0]?.killed, false);
      assert.equal(yield* liveStatus(shells, shell.shellId), "running");
    }),
  );

  it.effect("starts, writes to, resizes and lists a shell with no thread", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const events = yield* collectList(shells);

      const shell = yield* shells.open({ cwd: process.cwd(), cols: 100, rows: 24 });
      yield* shells.write({ shellId: shell.shellId, data: "echo hi\n" });
      yield* shells.resize({ shellId: shell.shellId, cols: 120, rows: 40 });

      assert.equal(shell.status, "running");
      assert.equal(shell.cwd, process.cwd());
      assert.notProperty(shell, "threadId");
      expect(ptyAdapter.processes[0]?.writes).toEqual(["echo hi\n"]);
      expect(ptyAdapter.processes[0]?.resizeCalls.at(-1)).toEqual({ cols: 120, rows: 40 });
      const listed = yield* events;
      expect(listed[0]).toEqual({ type: "snapshot", shells: [] });
      expect(listed.some((e) => e.type === "upsert" && e.shell.shellId === shell.shellId)).toBe(
        true,
      );
    }),
  );

  it.effect("keeps shells out of the thread terminal list and thread terminals out of shells", () =>
    Effect.gen(function* () {
      const { manager } = yield* createManager();
      const shells = yield* makeShells(manager);
      const events = yield* collectList(shells);
      const threadEvents: TerminalMetadataStreamEvent[] = [];
      const stop = yield* manager.subscribeMetadata((event) =>
        Effect.sync(() => void threadEvents.push(event)),
      );
      yield* Effect.addFinalizer(() => Effect.sync(stop));

      yield* manager.open(openInput());
      const shell = yield* shells.open({ cwd: process.cwd() });

      const shellListed = (yield* events).flatMap((e) =>
        e.type === "upsert" ? [e.shell.shellId] : [],
      );
      expect(shellListed).toEqual([shell.shellId]);
      const visible = threadEvents.flatMap((event) => Shells.withoutShells(event) ?? []);
      expect(JSON.stringify(visible)).not.toContain("shell:");
      expect(visible.some((e) => e.type === "upsert" && e.terminal.threadId === "thread-1")).toBe(
        true,
      );
    }),
  );

  it.effect("replays output to a shell attached after it was produced", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const shell = yield* shells.open({ cwd: process.cwd() });
      ptyAdapter.processes[0]!.emitData("made while detached\n");

      const [first] = yield* shells
        .attach({ shellId: shell.shellId }, "viewer-1")
        .pipe(Stream.take(1), Stream.runCollect);

      assert.equal(first?.type, "snapshot");
      if (first?.type === "snapshot") {
        assert.equal(first.snapshot.status, "running");
        expect(first.snapshot.history).toContain("made while detached");
      }
    }),
  );

  it.effect("gives two shells in one folder separate output and lifetimes", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const a = yield* shells.open({ cwd: process.cwd() });
      const b = yield* shells.open({ cwd: process.cwd() });
      ptyAdapter.processes[0]!.emitData("only-a\n");
      ptyAdapter.processes[1]!.emitData("only-b\n");

      yield* shells.kill(a.shellId);

      const [first] = yield* shells
        .attach({ shellId: b.shellId }, "viewer-1")
        .pipe(Stream.take(1), Stream.runCollect);
      assert.equal(first?.type, "snapshot");
      if (first?.type === "snapshot") {
        expect(first.snapshot.history).toContain("only-b");
        expect(first.snapshot.history).not.toContain("only-a");
        assert.equal(first.snapshot.status, "running");
      }
      expect(ptyAdapter.processes[0]?.killed).toBe(true);
      expect(ptyAdapter.processes[1]?.killed).toBe(false);
    }),
  );

  it.effect("removes an ended shell from the list and shows a self-exit as ended", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const events = yield* collectList(shells);
      const closed = yield* shells.open({ cwd: process.cwd() });
      const exited = yield* shells.open({ cwd: process.cwd() });

      ptyAdapter.processes[1]!.emitExit({ exitCode: 3, signal: 0 });
      yield* shells.kill(closed.shellId);

      const listed = yield* events;
      const last = listed
        .filter((e) => e.type === "upsert" && e.shell.shellId === exited.shellId)
        .at(-1);
      expect(last).toMatchObject({ shell: { status: "exited", exitCode: 3 } });
      expect(listed).toContainEqual({ type: "remove", shellId: closed.shellId });
    }),
  );

  it.effect("rejects requests for a shell that does not exist and a folder that does not", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const events = yield* collectList(shells);
      const other = yield* shells.open({ cwd: process.cwd() });
      const missing = { shellId: "no-such-shell" };

      const write = yield* Effect.exit(shells.write({ ...missing, data: "x" }));
      const resize = yield* Effect.exit(shells.resize({ ...missing, cols: 80, rows: 24 }));
      const attach = yield* Effect.exit(
        shells.attach(missing, "viewer-1").pipe(Stream.take(1), Stream.runCollect),
      );
      const noFolder = yield* Effect.flip(shells.open({ cwd: "/definitely/not/a/folder" }));
      const aFile = yield* Effect.flip(shells.open({ cwd: `${process.cwd()}/package.json` }));

      const exits: ReadonlyArray<Exit.Exit<unknown, unknown>> = [write, resize, attach];
      for (const exit of exits) assert.isTrue(Exit.isFailure(exit));
      expect(noFolder.message).toContain("does not exist");
      expect(aFile.message).toContain("not a directory");
      expect(ptyAdapter.spawnInputs).toHaveLength(1);
      const listed = (yield* events).flatMap((e) => (e.type === "upsert" ? [e.shell.shellId] : []));
      expect(new Set(listed)).toEqual(new Set([other.shellId]));
      assert.equal(yield* liveStatus(shells, other.shellId), "running");
    }),
  );

  it.effect("reports a shell whose program cannot be launched as failed, not running", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const events = yield* collectList(shells);
      for (let attempt = 0; attempt < 8; attempt++) {
        ptyAdapter.spawnFailures.push(new Error("posix_spawnp failed."));
      }

      const error = yield* Effect.flip(shells.open({ cwd: process.cwd() }));

      assert.equal(error._tag, "ShellLaunchError");
      expect(error.message).toContain("Failed to spawn PTY process");
      const listed = yield* events;
      const removed = new Set(listed.flatMap((e) => (e.type === "remove" ? [e.shellId] : [])));
      const left = listed.flatMap((e) =>
        e.type === "upsert" && !removed.has(e.shell.shellId) ? [e.shell] : [],
      );
      expect(left).toEqual([]);
    }),
  );

  const captureLogs = () => {
    const lines: Array<{ readonly message: string; readonly fields: unknown }> = [];
    const logger = Logger.make(({ message }) => {
      const [text, fields] = Array.isArray(message) ? message : [message];
      lines.push({ message: String(text), fields });
    });
    return { lines, layer: Logger.layer([logger], { mergeWithExisting: false }) };
  };
  const nodeDir = process.execPath.replace(/[\\/][^\\/]*$/, "");

  it.effect("refuses to start an agent shell when the agent command cannot be found", () => {
    const logs = captureLogs();
    return Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const missing = yield* makeShells(manager, {
        agentCommand: "no-such-agent-cli --resume",
        searchPath: nodeDir,
      });
      const unset = yield* makeShells(manager, { agentCommand: null });
      const events = yield* collectList(missing);

      const notFound = yield* Effect.flip(missing.open({ cwd: process.cwd(), agent: true }));
      const notConfigured = yield* Effect.flip(unset.open({ cwd: process.cwd(), agent: true }));

      assert.equal(notFound._tag, "ShellLaunchError");
      expect(notFound.message).toContain("no-such-agent-cli");
      expect(notConfigured.message).toContain("No agent command is configured.");
      expect(ptyAdapter.spawnInputs).toHaveLength(0);
      expect((yield* events).filter((e) => e.type === "upsert")).toEqual([]);
      expect(logs.lines.filter((line) => line.message === "shell failed to start")).toEqual([
        {
          message: "shell failed to start",
          fields: expect.objectContaining({ cwd: process.cwd() }),
        },
        {
          message: "shell failed to start",
          fields: expect.objectContaining({ cwd: process.cwd() }),
        },
      ]);
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("shows the worktree's current branch and marks a shell that left it", () => {
    const logs = captureLogs();
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { manager, ptyAdapter } = yield* createManager();
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-shell-location-" });
      // A main checkout with a .git folder and a linked worktree whose .git file points into it.
      const main = `${root}/main`;
      const linked = `${root}/linked`;
      yield* fs.makeDirectory(`${main}/.git/worktrees/linked`, { recursive: true });
      yield* fs.makeDirectory(linked);
      yield* fs.writeFileString(`${main}/.git/HEAD`, "ref: refs/heads/main\n");
      yield* fs.writeFileString(`${linked}/.git`, "gitdir: ../main/.git/worktrees/linked\n");
      yield* fs.writeFileString(`${main}/.git/worktrees/linked/HEAD`, "ref: refs/heads/topic\n");
      let cwd: string | null = null;
      const shells = yield* makeShells(manager, {
        readCwds: (pids) => Effect.succeed(new Map(pids.map((pid) => [pid, cwd ?? main]))),
      });
      const events = yield* collectList(shells);

      const first = yield* shells.open({ cwd: main }, { project: main, worktree: main });
      const second = yield* shells.open({ cwd: main }, { project: main, worktree: main });
      const other = yield* shells.open({ cwd: linked }, { project: main, worktree: linked });
      expect(
        [first, other].map(({ project, worktree, branch, elsewhere }) => ({
          project,
          worktree,
          branch,
          elsewhere,
        })),
      ).toEqual([
        { project: main, worktree: main, branch: "main", elsewhere: null },
        { project: main, worktree: linked, branch: "topic", elsewhere: null },
      ]);

      const latest = (shellId: string) =>
        events.pipe(
          Effect.map((all) =>
            all
              .flatMap((e) => (e.type === "upsert" && e.shell.shellId === shellId ? [e.shell] : []))
              .at(-1),
          ),
        );
      yield* fs.writeFileString(`${main}/.git/HEAD`, "ref: refs/heads/feature/x\n");
      yield* fs.writeFileString(`${main}/.git/worktrees/linked/HEAD`, "0123456789abcdef0123\n");
      cwd = "/somewhere/else";
      yield* shells.refreshLocations;
      expect(yield* latest(first.shellId)).toMatchObject({
        branch: "feature/x",
        elsewhere: "/somewhere/else",
      });
      expect(yield* latest(second.shellId)).toMatchObject({ branch: "feature/x" });
      expect(yield* latest(other.shellId)).toMatchObject({
        branch: "0123456",
        elsewhere: "/somewhere/else",
      });

      const count = (yield* events).length;
      cwd = `${main}/src`;
      yield* shells.refreshLocations;
      expect(yield* latest(first.shellId)).toMatchObject({ elsewhere: null });
      yield* shells.refreshLocations;
      // Nothing changed since the last refresh, so nothing more is sent.
      expect((yield* events).length).toBe(count + 3);
      expect(logs.lines).toContainEqual({
        message: "shell started",
        fields: { shellId: other.shellId, cwd: linked, worktree: linked, branch: "topic" },
      });

      // A shell that ended is never sent as running again by a later refresh.
      ptyAdapter.processes[0]!.emitExit({ exitCode: 0, signal: 9 });
      yield* liveStatus(shells, first.shellId);
      yield* fs.writeFileString(`${main}/.git/HEAD`, "ref: refs/heads/after-exit\n");
      yield* shells.refreshLocations;
      expect(yield* latest(first.shellId)).toMatchObject({ status: "exited" });
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("says which shells print the prompt mark", () =>
    Effect.gen(function* () {
      const printsMark = (shell: string, owner: string) =>
        Effect.gen(function* () {
          const { manager } = yield* createManager(5, {
            shellResolver: () => shell,
            shellReadyDir: "/ready",
          });
          yield* manager.open(openInput({ threadId: owner }));
          return yield* manager.printsPromptMark(owner, DEFAULT_TERMINAL_ID);
        }).pipe(Effect.scoped);

      assert.isTrue(yield* printsMark("/bin/zsh", "shell:one"));
      assert.isFalse(yield* printsMark("/bin/sh", "shell:one"));
      assert.isFalse(yield* printsMark("/bin/zsh", "thread-1"));
    }),
  );

  it.effect("starts zsh and bash shells through the ready wrapper, and nothing else", () =>
    Effect.gen(function* () {
      const spawnedBy = (shell: string, owner: "shell" | "thread") =>
        Effect.gen(function* () {
          const { manager, ptyAdapter } = yield* createManager(5, {
            shellResolver: () => shell,
            shellReadyDir: "/ready",
            env: { ZDOTDIR: "/home/me/zsh" },
          });
          if (owner === "shell") {
            yield* (yield* makeShells(manager)).open({ cwd: process.cwd() });
          } else {
            yield* manager.open(openInput());
          }
          return ptyAdapter.spawnInputs[0]!;
        }).pipe(Effect.scoped);

      const zsh = yield* spawnedBy("/bin/zsh", "shell");
      assert.equal(zsh.env?.ZDOTDIR, "/ready/zsh");
      assert.equal(zsh.env?.PROBE_ORIG_ZDOTDIR, "/home/me/zsh");
      // Probe's own zsh option stays.
      assert.deepEqual(zsh.args, ["-o", "nopromptsp"]);

      assert.deepEqual((yield* spawnedBy("/bin/bash", "shell")).args, [
        "--rcfile",
        "/ready/bashrc",
      ]);

      // A shell the wrapper cannot serve, and a chat thread's terminal, start as they were.
      const sh = yield* spawnedBy("/bin/sh", "shell");
      assert.equal(sh.env?.ZDOTDIR, "/home/me/zsh");
      assert.notProperty(sh.env ?? {}, "PROBE_ORIG_ZDOTDIR");
      const thread = yield* spawnedBy("/bin/zsh", "thread");
      assert.equal(thread.env?.ZDOTDIR, "/home/me/zsh");
      assert.deepEqual(thread.args, ["-o", "nopromptsp"]);
    }),
  );

  // The agent command is typed in the background, once the shell is ready; these wait for the write.
  {
    const MARK = "\u001b]133;B\u0007";

    const openAgent = (shell: string, options?: { readonly promptTimeout?: "1 millis" }) =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager(5, {
          shellResolver: () => shell,
          shellReadyDir: "/ready",
        });
        const wrote = yield* Deferred.make<void>();
        ptyAdapter.onWrite = () => Deferred.doneUnsafe(wrote, Effect.void);
        const shells = yield* makeShells(manager, {
          agentCommand: "node agent.ts",
          searchPath: nodeDir,
          ...options,
        });
        yield* shells.open({ cwd: process.cwd(), agent: true });
        return { wrote, pty: ptyAdapter.processes[0]! };
      });

    it.effect("starts at once and types the agent command when the prompt mark comes", () =>
      Effect.gen(function* () {
        const { wrote, pty } = yield* openAgent("/bin/zsh");
        // Opening did not wait for the prompt; the mark arrives in pieces, like real output.
        pty.emitData("startup noise\r\n$ \u001b]13");
        pty.emitData("3;B\u0007");
        yield* Deferred.await(wrote);
        pty.emitData(MARK);
        assert.deepEqual(pty.writes, ["node agent.ts\r"]);
      }).pipe(Effect.scoped),
    );

    it.effect("holds input for the shell until the agent command has been typed", () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager(5, {
          shellResolver: () => "/bin/zsh",
          shellReadyDir: "/ready",
        });
        const wrote = yield* Deferred.make<void>();
        ptyAdapter.onWrite = () => Deferred.doneUnsafe(wrote, Effect.void);
        const shells = yield* makeShells(manager, {
          agentCommand: "node agent.ts",
          searchPath: nodeDir,
        });
        const opened = yield* shells.open({ cwd: process.cwd(), agent: true });
        const pty = ptyAdapter.processes[0]!;
        // A line typed before the prompt would reach the bare shell ahead of the agent.
        const typing = yield* shells
          .write({ shellId: opened.shellId, data: "exit\r" })
          .pipe(Effect.forkChild({ startImmediately: true }));
        assert.deepEqual(pty.writes, []);
        pty.emitData(MARK);
        yield* Deferred.await(wrote);
        yield* Fiber.join(typing);
        assert.deepEqual(pty.writes, ["node agent.ts\r", "exit\r"]);
        // Once the agent is typed, input goes straight through.
        yield* shells.write({ shellId: opened.shellId, data: "more\r" });
        assert.deepEqual(pty.writes, ["node agent.ts\r", "exit\r", "more\r"]);
      }).pipe(Effect.scoped),
    );

    it.effect("types anyway when the mark never comes", () =>
      Effect.gen(function* () {
        const { wrote, pty } = yield* openAgent("/bin/bash", { promptTimeout: "1 millis" });
        yield* Deferred.await(wrote);
        assert.deepEqual(pty.writes, ["node agent.ts\r"]);
      }).pipe(Effect.scoped),
    );

    it.effect("types at once in a shell that cannot print the mark", () =>
      Effect.gen(function* () {
        const { wrote, pty } = yield* openAgent("/bin/sh");
        yield* Deferred.await(wrote);
        assert.deepEqual(pty.writes, ["node agent.ts\r"]);
      }).pipe(Effect.scoped),
    );
  }

  it.effect("types the agent command into an agent shell and logs its start and end", () => {
    const logs = captureLogs();
    return Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager, {
        agentCommand: "node agent.ts",
        searchPath: nodeDir,
      });
      const agent = yield* shells.open({ cwd: process.cwd(), agent: true });
      yield* shells.open({ cwd: process.cwd() });

      expect(ptyAdapter.processes[0]?.writes).toEqual(["node agent.ts\r"]);
      expect(ptyAdapter.processes[1]?.writes).toEqual([]);
      ptyAdapter.processes[0]!.emitExit({ exitCode: 0, signal: 9 });
      yield* liveStatus(shells, agent.shellId);

      expect(logs.lines.filter((line) => line.message.startsWith("shell "))).toContainEqual({
        message: "shell started",
        fields: { shellId: agent.shellId, cwd: process.cwd() },
      });
      expect(logs.lines).toContainEqual({
        message: "shell ended",
        fields: {
          shellId: agent.shellId,
          cwd: process.cwd(),
          exitCode: 0,
          exitSignal: 9,
          reason: "signal",
        },
      });
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("kills a shell with everything it started, and forgets one already gone", () => {
    const logs = captureLogs();
    return Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const events = yield* collectList(shells);
      const killed = yield* shells.open({ cwd: process.cwd() });
      const kept = yield* shells.open({ cwd: process.cwd() });
      killedTrees.length = 0;

      yield* shells.kill(killed.shellId);
      yield* shells.kill("never-started");

      expect(killedTrees).toEqual([killed.pid]);
      expect(yield* events).toContainEqual({ type: "remove", shellId: killed.shellId });
      expect((yield* shells.list).map((shell) => shell.shellId)).toEqual([kept.shellId]);
      assert.equal(ptyAdapter.processes[1]?.killed, false);
      const ended = logs.lines.filter((line) => line.message === "shell ended");
      expect(ended).toEqual([
        {
          message: "shell ended",
          fields: { shellId: killed.shellId, cwd: process.cwd(), reason: "killed" },
        },
      ]);
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("finishes a kill whose caller goes away, as probe kill's request does", () =>
    Effect.gen(function* () {
      const { manager } = yield* createManager();
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const shells = yield* makeShells(manager, {
        killTree: () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      });
      const shell = yield* shells.open({ cwd: process.cwd() });

      const killing = yield* shells.kill(shell.shellId).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const interrupting = yield* Fiber.interrupt(killing).pipe(Effect.forkChild);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupting);

      expect(yield* shells.list).toEqual([]);
    }),
  );

  it.effect("gives each shell a token that lets a command inside it kill that shell only", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      let nextToken = 0;
      const shells = yield* makeShells(manager, {
        newToken: Effect.sync(() => `token-${++nextToken}`),
        selfKill: {
          endpointFile: "/state/shell-bin/endpoint",
          bin: "/bin-dir/probe",
          path: "/bin-dir:/usr/bin",
        },
      });
      const first = yield* shells.open({ cwd: process.cwd() });
      const second = yield* shells.open({ cwd: process.cwd() });

      expect(ptyAdapter.spawnInputs[0]?.env).toMatchObject({
        PROBE_SHELL_ID: first.shellId,
        PROBE_SHELL_TOKEN: "token-1",
        PROBE_SHELL_ENDPOINT_FILE: "/state/shell-bin/endpoint",
        PROBE_BIN: "/bin-dir/probe",
        PATH: "/bin-dir:/usr/bin",
      });
      expect(ptyAdapter.spawnInputs[1]?.env).toMatchObject({ PROBE_SHELL_TOKEN: "token-2" });

      assert.equal(yield* shells.killByToken("token-2"), true);
      assert.equal(yield* shells.killByToken("token-2"), false);
      assert.equal(yield* shells.killByToken("forged"), false);
      expect((yield* shells.list).map((shell) => shell.shellId)).toEqual([first.shellId]);
      expect(second.shellId).not.toBe(first.shellId);
    }),
  );
  /** The shells an earlier server left in the host, as the next server finds them. */
  const fakeHost = (
    sessions: ReadonlyArray<{
      readonly pid: number;
      readonly output?: string;
      readonly exit?: { readonly exitCode: number; readonly signal: number | null };
    }>,
  ) =>
    Effect.gen(function* () {
      const forgotten = yield* Queue.unbounded<number>();
      const processes = sessions.map((entry) => new FakePtyProcess(entry.pid));
      return {
        forgotten,
        processes,
        host: {
          list: Effect.succeed(
            sessions.map((entry, index) => ({
              session: {
                id: `host-${entry.pid}`,
                pid: entry.pid,
                cwd: process.cwd(),
                cols: 90,
                rows: 30,
                output: entry.output ?? "",
                exit: entry.exit ?? null,
              },
              process: processes[index]!,
            })),
          ),
          forget: (pid: number) => Queue.offer(forgotten, pid).pipe(Effect.asVoid),
        },
      };
    });

  const registryIn = Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-shells-" });
    return `${dir}/shells/registry.json`;
  });

  const historyOf = (shells: ShellsService, shellId: string) =>
    shells.attach({ shellId }, "history-check").pipe(
      Stream.take(1),
      Stream.runCollect,
      Effect.map(([first]) => (first?.type === "snapshot" ? first.snapshot.history : null)),
    );

  it.effect("spawns shells in the host and lets go of them at shutdown, keeping history", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const hostAdapter = new FakePtyAdapter("sync", true);
      const scope = yield* Scope.make();
      const { manager, ptyAdapter, logsDir } = yield* createManager(5, {
        shellPtyAdapter: hostAdapter,
        baseDir: yield* fs.makeTempDirectoryScoped({ prefix: "t3code-terminal-" }),
      }).pipe(Scope.provide(scope));
      const shells = yield* makeShells(manager).pipe(Scope.provide(scope));
      const shell = yield* shells.open({ cwd: process.cwd() });
      yield* manager.open(openInput());
      const hosted = hostAdapter.processes[0] as DetachablePtyProcess;
      hosted.emitData("kept output\n");
      yield* historyOf(shells, shell.shellId);

      yield* Scope.close(scope, Exit.void);

      expect(hosted).toMatchObject({ detached: true, killed: false });
      // Thread terminals never go to the host and still end with the server.
      expect(ptyAdapter.processes.map((entry) => entry.killed)).toEqual([true]);
      const history = yield* fs.readFileString(
        yield* historyLogPath(logsDir, `shell:${shell.shellId}`),
      );
      expect(history).toContain("kept output");
    }),
  );

  it("reads a shell in a deleted folder as still in that folder, not elsewhere", () => {
    expect(Shells.withoutDeletedMark("/home/u/repo (deleted)")).toBe("/home/u/repo");
    expect(Shells.withoutDeletedMark("/home/u/repo (deleted) x")).toBe("/home/u/repo (deleted) x");
  });

  it.effect("lists shells in the order they started, whichever updated last", () =>
    Effect.gen(function* () {
      const { manager, ptyAdapter } = yield* createManager();
      const shells = yield* makeShells(manager);
      const started = [
        yield* shells.open({ cwd: process.cwd() }),
        yield* shells.open({ cwd: process.cwd() }),
        yield* shells.open({ cwd: process.cwd() }),
      ].map((shell) => shell.shellId);
      // Output makes the first shell the most recently updated one.
      const updated = yield* Deferred.make<void>();
      const stop = yield* manager.subscribe((event) =>
        event.type === "output"
          ? Deferred.succeed(updated, undefined).pipe(Effect.asVoid)
          : Effect.void,
      );
      ptyAdapter.processes[0]!.emitData("later\n");
      yield* Deferred.await(updated);
      stop();

      expect((yield* shells.list).map((shell) => shell.shellId)).toEqual(started);
      const events = yield* collectList(shells);
      const [snapshot] = yield* events;
      expect(
        snapshot?.type === "snapshot" && snapshot.shells.map((shell) => shell.shellId),
      ).toEqual(started);
    }),
  );

  it.effect("takes over the shells the host kept, and lists the ones that ended", () => {
    const logs = captureLogs();
    return Effect.gen(function* () {
      const registryPath = yield* registryIn();
      const before = yield* createManager();
      const earlier = yield* makeShells(before.manager, { registryPath });
      const [alive, exited, signalled, lost] = [
        yield* earlier.open({ cwd: process.cwd() }),
        yield* earlier.open({ cwd: process.cwd() }),
        yield* earlier.open({ cwd: process.cwd() }),
        yield* earlier.open({ cwd: process.cwd() }),
      ];

      const { host, forgotten, processes } = yield* fakeHost([
        { pid: alive!.pid!, output: "earlier output\r\n" },
        { pid: exited!.pid!, exit: { exitCode: 1, signal: null } },
        { pid: signalled!.pid!, exit: { exitCode: 0, signal: 9 } },
        // Started by a server that crashed before it saved the shell.
        { pid: 4242 },
      ]);
      const after = yield* createManager();
      const shells = yield* makeShells(after.manager, { registryPath, host });

      const listed = yield* shells.list;
      expect(listed.map((shell) => [shell.shellId, shell.status, shell.ended])).toEqual([
        [alive!.shellId, "running", null],
        [signalled!.shellId, "exited", "signal"],
        [lost!.shellId, "exited", "lost"],
      ]);
      expect(listed[0]).toMatchObject({ pid: alive!.pid, cwd: process.cwd() });
      expect(yield* historyOf(shells, alive!.shellId)).toContain("earlier output");
      yield* shells.write({ shellId: alive!.shellId, data: "still here\r" });
      expect(processes[0]!.writes).toEqual(["still here\r"]);
      expect(after.ptyAdapter.spawnInputs).toEqual([]);
      expect(killedTrees).toContain(4242);
      expect([...(yield* Queue.takeAll(forgotten))].sort()).toEqual(
        [exited!.pid!, signalled!.pid!, 4242].sort(),
      );
      expect(logs.lines).toContainEqual({
        message: "shell reattached",
        fields: { shellId: alive!.shellId, cwd: process.cwd(), pid: alive!.pid },
      });

      // Removing an ended shell is for good: the next server does not list it either.
      yield* shells.kill(lost!.shellId);
      yield* shells.kill(signalled!.shellId);
      const next = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        host: (yield* fakeHost([{ pid: alive!.pid! }])).host,
      });
      expect((yield* next.list).map((shell) => shell.shellId)).toEqual([alive!.shellId]);
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("removes a shell that exits on its own, and keeps one a signal ended", () =>
    Effect.gen(function* () {
      const registryPath = yield* registryIn();
      const { manager, ptyAdapter } = yield* createManager();
      const { host, forgotten } = yield* fakeHost([]);
      const shells = yield* makeShells(manager, { registryPath, host });
      const events = yield* collectList(shells);
      const exited = yield* shells.open({ cwd: process.cwd() });
      const signalled = yield* shells.open({ cwd: process.cwd() });

      ptyAdapter.processes[0]!.emitExit({ exitCode: 1, signal: 0 });
      ptyAdapter.processes[1]!.emitExit({ exitCode: 0, signal: 9 });
      // Each end is saved before the host is told to forget the shell.
      expect([yield* Queue.take(forgotten), yield* Queue.take(forgotten)].sort()).toEqual(
        [exited.pid!, signalled.pid!].sort(),
      );

      expect(yield* events).toContainEqual({ type: "remove", shellId: exited.shellId });
      expect((yield* shells.list).map((shell) => [shell.shellId, shell.ended])).toEqual([
        [signalled.shellId, "signal"],
      ]);
      const next = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        host: (yield* fakeHost([])).host,
      });
      expect((yield* next.list).map((shell) => [shell.shellId, shell.ended])).toEqual([
        [signalled.shellId, "signal"],
      ]);
    }),
  );

  it.effect("restores an ended shell in place on request, and only an ended one", () =>
    Effect.gen(function* () {
      const registryPath = yield* registryIn();
      const first = yield* createManager();
      const earlier = yield* makeShells(first.manager, { registryPath });
      const signalled = yield* earlier.open({ cwd: process.cwd() });
      const lost = yield* earlier.open({ cwd: process.cwd() });
      const running = yield* earlier.open({ cwd: process.cwd() });
      first.ptyAdapter.processes[0]!.emitData("before the signal\r\n");
      first.ptyAdapter.processes[0]!.emitExit({ exitCode: 0, signal: 9 });

      const refused = yield* Effect.exit(earlier.restore(running.shellId));
      expect(refused._tag).toBe("Failure");

      // The second server finds `lost` without its process, and `signalled` ended by a signal.
      const second = yield* createManager();
      const shells = yield* makeShells(second.manager, {
        registryPath,
        host: (yield* fakeHost([{ pid: signalled.pid!, exit: { exitCode: 0, signal: 9 } }])).host,
      });
      const events = yield* collectList(shells);
      expect(
        (yield* shells.list).map((shell) => [shell.shellId, shell.ended, shell.restored]),
      ).toEqual([
        [signalled.shellId, "signal", false],
        [lost.shellId, "lost", false],
        [running.shellId, "lost", false],
      ]);

      for (const ended of [signalled, lost]) {
        const restored = yield* shells.restore(ended.shellId);
        expect(restored).toMatchObject({ shellId: ended.shellId, status: "running", ended: null });
        expect(restored.restored).toBe(true);
        expect(yield* historyOf(shells, ended.shellId)).not.toContain("before the signal");
      }
      expect(second.ptyAdapter.spawnInputs).toHaveLength(2);
      expect(yield* events).toContainEqual({
        type: "upsert",
        shell: expect.objectContaining({ shellId: lost.shellId, restored: true, ended: null }),
      });
      expect((yield* Effect.exit(shells.restore(lost.shellId)))._tag).toBe("Failure");

      // A restored shell is an ordinary running shell: it survives a restart as one, and the
      // next end of it can be restored again.
      const third = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        host: (yield* fakeHost([{ pid: signalled.pid! }])).host,
      });
      expect(
        (yield* third.list).find((shell) => shell.shellId === signalled.shellId)?.restored,
      ).toBe(true);
    }),
  );

  it.effect("adopts the shells an older registry saved with a folder instead of a project", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const registryPath = yield* registryIn();
      yield* fs.makeDirectory(registryPath.replace(/\/registry\.json$/, ""), { recursive: true });
      yield* fs.writeFileString(
        registryPath,
        JSON.stringify({
          version: 1,
          shells: [
            {
              shellId: "legacy",
              pid: 4343,
              cwd: process.cwd(),
              label: "Shell",
              title: null,
              folder: process.cwd(),
              worktree: null,
              home: process.cwd(),
              tokenHash: null,
              ended: null,
            },
          ],
        }),
      );
      const shells = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        host: (yield* fakeHost([{ pid: 4343 }])).host,
      });
      expect(
        (yield* shells.list).map((shell) => [shell.shellId, shell.status, shell.project]),
      ).toEqual([["legacy", "running", process.cwd()]]);
    }),
  );

  it.effect("keeps an ended shell listed when its removal cannot be saved", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const registryPath = yield* registryIn();
      const earlier = yield* makeShells((yield* createManager()).manager, { registryPath });
      const shell = yield* earlier.open({ cwd: process.cwd() });
      const shells = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        host: (yield* fakeHost([])).host,
      });

      // The registry's folder becomes a file, so the next save fails.
      const folder = registryPath.slice(0, registryPath.lastIndexOf("/"));
      yield* fs.remove(folder, { recursive: true });
      yield* fs.writeFileString(folder, "");
      const failure = yield* Effect.flip(shells.kill(shell.shellId));
      expect(failure._tag).toBe("ShellStorageError");
      expect((yield* shells.list).map((entry) => [entry.shellId, entry.ended])).toEqual([
        [shell.shellId, "lost"],
      ]);
    }),
  );

  it.effect("lets probe kill end a shell that was taken over after a restart", () =>
    Effect.gen(function* () {
      const registryPath = yield* registryIn();
      const earlier = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        newToken: Effect.succeed("the-token"),
      });
      const shell = yield* earlier.open({ cwd: process.cwd() });
      const shells = yield* makeShells((yield* createManager()).manager, {
        registryPath,
        host: (yield* fakeHost([{ pid: shell.pid! }])).host,
      });

      assert.equal(yield* shells.killByToken("forged"), false);
      assert.equal(yield* shells.killByToken("the-token"), true);
      expect(yield* shells.list).toEqual([]);
      expect(killedTrees).toContain(shell.pid);
    }),
  );
});
