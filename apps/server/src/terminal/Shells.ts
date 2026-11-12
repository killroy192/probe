// @effect-diagnostics-next-line nodeBuiltinImport:off -- A token's hash is a plain sync digest.
import * as NodeCrypto from "node:crypto";

import {
  DEFAULT_TERMINAL_ID,
  type ShellAttachInput,
  type ShellListStreamEvent,
  type ShellOpenInput,
  type ShellResizeInput,
  type ShellSummary,
  type ShellWriteInput,
  ShellEndReason,
  ShellLaunchError,
  ShellStorageError,
  type TerminalMetadataStreamEvent,
  type TerminalSessionSnapshot,
  type TerminalSummary,
  TerminalSessionLookupError,
  isShellOwnerId,
  shellIdFromOwnerId,
  shellOwnerId,
  startingScriptProgram,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, selfInvocationArgs } from "@t3tools/shared/nodeRuntime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import * as ServerConfig from "../config.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import * as ProcessRunner from "../processRunner.ts";
import { ShellHost } from "./shellHost/client.ts";
import { TerminalManager } from "./Manager.ts";
import { killProcessTree, makeReadProcessTable } from "./processTree.ts";
import {
  START_PROGRAM_ENV,
  type ShellOutputEvent,
  makeReadyScanner,
  waitForPromptMark,
} from "./shellReady.ts";
import { PROBE_COMMAND, SELF_KILL_PATH, SHELL_ENV, type ShellSelfKill } from "./shellEnv.ts";

type Manager = TerminalManager["Service"];

/** What the server knows about a shell beyond its terminal: given at start, or polled. */
interface ShellRecord {
  readonly title: string | null;
  readonly project: string | null;
  readonly worktree: string | null;
  /** The folder the shell belongs in (its worktree, else its project), resolved once at start. */
  readonly home: string | null;
  branch: string | null;
  elsewhere: string | null;
  /** The home folder is gone from disk. */
  missing: boolean;
  restored: boolean;
  /** The first prompt: still awaited, seen, or never coming (not wrapped, or none in time). */
  prompt: "pending" | "ready" | "none";
}

const NO_RECORD: ShellRecord = {
  title: null,
  project: null,
  worktree: null,
  home: null,
  branch: null,
  elsewhere: null,
  missing: false,
  restored: false,
  prompt: "pending",
};

/** A shell as the registry keeps it across server restarts. */
const SavedShell = Schema.Struct({
  shellId: Schema.String,
  pid: Schema.NullOr(Schema.Int),
  cwd: Schema.String,
  label: Schema.String,
  title: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  worktree: Schema.NullOr(Schema.String),
  home: Schema.NullOr(Schema.String),
  tokenHash: Schema.NullOr(Schema.String),
  /** Set once the user restored the shell after it ended. */
  restored: Schema.optionalKey(Schema.Boolean),
  /** Set once the first-prompt scan ended, so a takeover does not scan again. */
  prompt: Schema.optionalKey(Schema.Literals(["ready", "none"])),
  /** Set once the shell ended in a way that keeps it listed until it is removed. */
  ended: Schema.NullOr(
    Schema.Struct({
      reason: ShellEndReason,
      exitCode: Schema.NullOr(Schema.Int),
      exitSignal: Schema.NullOr(Schema.Int),
      at: Schema.String,
    }),
  ),
});
type SavedShell = typeof SavedShell.Type;

const RegistryFile = Schema.Struct({
  version: Schema.Literal(1),
  shells: Schema.Array(SavedShell),
});
const encodeRegistry = Schema.encodeSync(Schema.fromJsonString(RegistryFile));

// An older server wrote `folder` where this one writes `project`; reading accepts both, so a
// server upgrade still finds the shells that kept running.
const { project: _project, ...savedShellFields } = SavedShell.fields;
const DiskRegistryFile = Schema.Struct({
  version: Schema.Literal(1),
  shells: Schema.Array(
    Schema.Struct({
      ...savedShellFields,
      project: Schema.optionalKey(Schema.NullOr(Schema.String)),
      folder: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});
const decodeRegistry = Schema.decodeUnknownExit(Schema.fromJsonString(DiskRegistryFile));

const hashToken = (token: string) =>
  NodeCrypto.createHash("sha256").update(token).digest("base64url");

/** A signal number, or null for an exit that had none (node-pty reports 0). */
const signalOf = (signal: number | null | undefined) => (signal ? signal : null);

// A shell is one terminal owned by `shell:<id>` instead of a chat thread.
const toSummary = (
  shellId: string,
  terminal: TerminalSessionSnapshot | TerminalSummary,
  record: ShellRecord,
): ShellSummary => ({
  shellId,
  cwd: terminal.cwd,
  status: terminal.status,
  pid: terminal.pid,
  exitCode: terminal.exitCode,
  exitSignal: terminal.exitSignal,
  label: terminal.label,
  title: record.title,
  // The manager's label is the running program's name while one runs, else a generic default.
  process:
    "hasRunningSubprocess" in terminal && terminal.hasRunningSubprocess ? terminal.label : null,
  project: record.project,
  worktree: record.worktree,
  branch: record.branch,
  elsewhere: record.elsewhere,
  ended: terminal.status === "exited" && signalOf(terminal.exitSignal) !== null ? "signal" : null,
  missing: record.missing,
  restored: record.restored,
  promptReady:
    record.prompt === "ready" && (terminal.status === "running" || terminal.status === "starting"),
  updatedAt: terminal.updatedAt,
});

// A shell that ended before this server started has no terminal, only its saved entry.
const endedSummary = (saved: SavedShell, record: ShellRecord): ShellSummary => ({
  shellId: saved.shellId,
  cwd: saved.cwd,
  status: "exited",
  pid: null,
  exitCode: saved.ended?.exitCode ?? null,
  exitSignal: saved.ended?.exitSignal ?? null,
  label: saved.label,
  title: saved.title,
  process: null,
  project: saved.project,
  worktree: saved.worktree,
  branch: record.branch,
  elsewhere: null,
  ended: saved.ended?.reason ?? "lost",
  missing: record.missing,
  restored: record.restored,
  promptReady: false,
  updatedAt: saved.ended?.at ?? "",
});

const listEvent = (
  event: TerminalMetadataStreamEvent,
  recordOf: (shellId: string) => ShellRecord,
  endedOf: (shellId: string) => ShellSummary | null,
  endedOnly: () => ReadonlyArray<ShellSummary>,
  inStartOrder: (shells: ReadonlyArray<ShellSummary>) => ReadonlyArray<ShellSummary>,
): ShellListStreamEvent | null => {
  switch (event.type) {
    case "snapshot": {
      const shells = event.terminals.flatMap((terminal) => {
        const shellId = shellIdFromOwnerId(terminal.threadId);
        return shellId === null ? [] : [toSummary(shellId, terminal, recordOf(shellId))];
      });
      const listed = new Set(shells.map((shell) => shell.shellId));
      return {
        type: "snapshot",
        shells: inStartOrder([
          ...shells,
          ...endedOnly().filter((shell) => !listed.has(shell.shellId)),
        ]),
      };
    }
    case "upsert": {
      const shellId = shellIdFromOwnerId(event.terminal.threadId);
      return shellId === null
        ? null
        : { type: "upsert", shell: toSummary(shellId, event.terminal, recordOf(shellId)) };
    }
    case "remove": {
      const shellId = shellIdFromOwnerId(event.threadId);
      if (shellId === null) return null;
      // A shell kept as ended stays listed when the manager lets go of its session.
      const ended = endedOf(shellId);
      return ended === null ? { type: "remove", shellId } : { type: "upsert", shell: ended };
    }
  }
};

/** The thread terminal list, which never shows shells. */
export const withoutShells = (
  event: TerminalMetadataStreamEvent,
): TerminalMetadataStreamEvent | null => {
  switch (event.type) {
    case "snapshot":
      return {
        type: "snapshot",
        terminals: event.terminals.filter((terminal) => !isShellOwnerId(terminal.threadId)),
      };
    case "upsert":
      return isShellOwnerId(event.terminal.threadId) ? null : event;
    case "remove":
      return isShellOwnerId(event.threadId) ? null : event;
  }
};

const DEFAULT_PROMPT_TIMEOUT = "15 seconds";
// The terminal manager's kill grace: a killed shell's removal waits no longer for its process to end.
const DEFAULT_KILL_WAIT = "1 second";

interface ShellsOptions {
  /** How long a starting script waits for the shell's prompt; slow startup files need a long wait. */
  readonly promptTimeout?: Duration.Input;
  readonly platform?: NodeJS.Platform;
  /** The current folder of each process; a pid it cannot read is left out. */
  readonly readCwds?: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyMap<number, string>>;
  /** Force-ends a shell's process and everything it started. */
  readonly killTree?: (pid: number) => Effect.Effect<void>;
  /** How long a kill waits for the shell's process to end before it removes the shell anyway. */
  readonly killWait?: Duration.Input;
  /** A secret per shell that lets a command inside it kill it; see `selfKill`. */
  readonly newToken?: Effect.Effect<string>;
  /** Where `probe kill` reaches the server; null leaves shells without the command. */
  readonly selfKill?: ShellSelfKill | null;
  /** The file that keeps shells across server restarts; null keeps them in memory only. */
  readonly registryPath?: string | null;
  /** The shell host whose shells this server takes over at start. */
  readonly host?: Pick<ShellHost["Service"], "list" | "forget"> | null;
  /** Appends each shell's output, as the process wrote it, to `<dir>/<shellId>.log`; tests only. */
  readonly rawOutputDir?: string | null;
}

export interface ShellOpenOptions {
  readonly title?: string;
  /** The workspace project the shell was started for. */
  readonly project?: string;
  /** The git worktree it starts in; its branch is shown and kept up to date. */
  readonly worktree?: string;
  /** Typed once the shell is ready; absent for a plain shell. */
  readonly script?: { readonly name: string; readonly command: string };
}

const optionalEnv = (env: Record<string, string> | undefined) => (env === undefined ? {} : { env });

const SHORT_HASH_LENGTH = 7;

/** A branch name, or the short commit id of a detached HEAD, from a HEAD file's contents. */
const branchFromHead = (head: string) => {
  const content = head.trim();
  if (content.startsWith("ref: "))
    return content.slice("ref: ".length).replace(/^refs\/heads\//, "");
  return content.length > 0 ? content.slice(0, SHORT_HASH_LENGTH) : null;
};

// Linux exposes each process's folder as a link; macOS needs one lsof call for all of them.
const makeReadCwds = Effect.fnUntraced(function* (platform: NodeJS.Platform) {
  const fs = yield* FileSystem.FileSystem;
  const runner = yield* ProcessRunner.ProcessRunner;
  return (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyMap<number, string>> => {
    if (pids.length === 0) return Effect.succeed(new Map());
    if (platform === "linux") {
      return Effect.forEach(pids, (pid) =>
        fs.readLink(`/proc/${pid}/cwd`).pipe(
          Effect.map((cwd) => [[pid, withoutDeletedMark(cwd)] as const]),
          Effect.orElseSucceed(() => []),
        ),
      ).pipe(Effect.map((entries) => new Map(entries.flat())));
    }
    if (platform !== "darwin") return Effect.succeed(new Map());
    return runner
      .run({
        command: "lsof",
        args: ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")],
        timeout: "1 second",
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.map((result) => {
          const cwds = new Map<number, string>();
          let pid: number | null = null;
          for (const line of result.stdout.split("\n")) {
            if (line.startsWith("p")) pid = Number(line.slice(1));
            else if (line.startsWith("n") && pid !== null) cwds.set(pid, line.slice(1));
          }
          return cwds;
        }),
        Effect.orElseSucceed(() => new Map()),
      );
  };
});

/**
 * Linux shows a process's folder that was deleted as "<path> (deleted)"; the shell is still in
 * that path, which its "not found" mark already says, not somewhere else.
 */
export const withoutDeletedMark = (cwd: string) => cwd.replace(/ \(deleted\)$/, "");

// The program is the command's first word; the shell itself parses the rest when it runs the line.
// Leading `NAME=value` words are skipped: they are not the program, and may carry a secret.
// Whether it exists is the shell's to say (PRB.T-016 U-1): see `waitForPromptMark`.
const programOf = (command: string) => startingScriptProgram(command).replace(/^["']|["']$/g, "");

export const makeShells = Effect.fn("Shells.make")(function* (
  manager: Manager,
  newShellId: Effect.Effect<string>,
  options: ShellsOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const platform = options.platform ?? (yield* HostProcess.Platform);
  const promptTimeout = options.promptTimeout ?? DEFAULT_PROMPT_TIMEOUT;
  const killWait = options.killWait ?? DEFAULT_KILL_WAIT;
  const host = options.host ?? null;
  const registryPath = options.registryPath ?? null;
  const session = (shellId: string) => ({
    threadId: shellOwnerId(shellId),
    terminalId: DEFAULT_TERMINAL_ID,
  });
  const records = new Map<string, ShellRecord>();
  const recordOf = (shellId: string) => records.get(shellId) ?? NO_RECORD;
  // The last terminal state of each shell, so a location change can be sent as a full summary.
  const terminals = new Map<string, TerminalSummary>();
  // What survives a restart: every shell this server started or took over, until it is removed.
  const saved = new Map<string, SavedShell>();
  const listeners = new Set<(event: ShellListStreamEvent) => Effect.Effect<void>>();
  const readCwds = options.readCwds ?? (yield* makeReadCwds(platform));
  const killTree =
    options.killTree ??
    (yield* makeReadProcessTable(platform).pipe(
      Effect.map((readTable) => (pid: number) => killProcessTree(readTable, pid)),
    ));
  const newToken: Effect.Effect<string | null> = options.newToken ?? Effect.succeed(null);
  const selfKill = options.selfKill ?? null;
  // Each shell's token hash, so `probe kill` can end that shell and no other.
  const tokens = new Map<string, string>();
  const forgetToken = (shellId: string) => {
    for (const [hash, owner] of tokens) if (owner === shellId) tokens.delete(hash);
  };
  // Shells Probe is killing; their end is logged by the kill, with its reason.
  const killing = new Set<string>();
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  /** A shell kept as ended with no terminal in this server: it ended before the server started. */
  const endedOf = (shellId: string) => {
    const entry = saved.get(shellId);
    return entry?.ended == null ? null : endedSummary(entry, recordOf(shellId));
  };
  const endedOnly = () =>
    [...saved.keys()].flatMap((shellId) => {
      const summary = terminals.has(shellId) ? null : endedOf(shellId);
      return summary === null ? [] : [summary];
    });
  const summaryOf = (shellId: string) => {
    const terminal = terminals.get(shellId);
    return terminal === undefined
      ? endedOf(shellId)
      : toSummary(shellId, terminal, recordOf(shellId));
  };
  // The registry keeps shells in the order they started, also across restarts; the manager's own
  // order is by last update, so a client would see the tree reorder on every reload.
  const inStartOrder = (shells: ReadonlyArray<ShellSummary>) => {
    const order = new Map([...saved.keys()].map((shellId, index) => [shellId, index]));
    return shells.toSorted(
      (left, right) =>
        (order.get(left.shellId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.shellId) ?? Number.MAX_SAFE_INTEGER),
    );
  };
  const emit = Effect.fnUntraced(function* (event: ShellListStreamEvent) {
    for (const listener of listeners) yield* listener(event);
  });

  // One write at a time, each from the list as it is when the write starts: two ends saved at once
  // could otherwise finish out of order and leave the older list on disk.
  const persistLock = yield* Semaphore.make(1);
  const persist = Effect.gen(function* () {
    if (registryPath === null) return;
    yield* writeFileStringAtomically({
      filePath: registryPath,
      contents: encodeRegistry({ version: 1, shells: [...saved.values()] }),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.Platform, platform),
      Effect.mapError((error) => new ShellStorageError({ reason: error.message })),
    );
  }).pipe(persistLock.withPermits(1));
  const persistOrWarn = persist.pipe(
    Effect.catch((error) =>
      Effect.logWarning("could not save the shell list", { reason: error.reason }),
    ),
  );

  /** Drops a shell from the saved list; on failure the entry stays and the error says why. */
  const unsave = Effect.fn("Shells.unsave")(function* (shellId: string) {
    const previous = saved.get(shellId);
    if (previous === undefined) return;
    saved.delete(shellId);
    yield* persist.pipe(Effect.tapError(() => Effect.sync(() => saved.set(shellId, previous))));
  });

  /** Settles a shell's first prompt once, saved so a takeover knows it; ready is sent to clients. */
  const settlePrompt = Effect.fn("Shells.settlePrompt")(function* (
    shellId: string,
    prompt: "ready" | "none",
  ) {
    const record = records.get(shellId);
    if (record === undefined || record.prompt !== "pending") return;
    record.prompt = prompt;
    yield* Effect.logDebug("shell first prompt", { shellId, prompt });
    const entry = saved.get(shellId);
    if (entry !== undefined) {
      saved.set(shellId, { ...entry, prompt });
      yield* persistOrWarn;
    }
    const shell = prompt === "ready" ? summaryOf(shellId) : null;
    if (shell !== null) yield* emit({ type: "upsert", shell });
  });

  /** A shell's output from now on, so a first prompt printed right after cannot slip past. */
  // Untraced: it only subscribes, inside the caller's span (open, restore or the takeover).
  const watchOutput = Effect.fnUntraced(function* (shellId: string) {
    const { threadId } = session(shellId);
    const output = yield* Queue.unbounded<ShellOutputEvent>();
    const stop = yield* manager.subscribe((event) =>
      event.threadId !== threadId
        ? Effect.void
        : event.type === "output"
          ? Queue.offer(output, { type: "output", data: event.data })
          : event.type === "exited"
            ? Queue.offer(output, { type: "exited" })
            : Effect.void,
    );
    return { output, stop };
  });

  /**
   * Scans a shell's output for its first prompt without holding up the caller. The scan ends at
   * the mark, the shell's end or the timeout, so a shell costs nothing once it is settled.
   */
  const scanFirstPrompt = Effect.fn("Shells.scanFirstPrompt")(function* (
    shellId: string,
    watched: Effect.Success<ReturnType<typeof watchOutput>>,
    wrapped: boolean,
    onMark: Effect.Effect<void> = Effect.void,
  ) {
    // Known at once, so a start's own registry write carries it instead of a second write.
    if (!wrapped) {
      watched.stop();
      return yield* settlePrompt(shellId, "none");
    }
    yield* Effect.gen(function* () {
      const ready = yield* waitForPromptMark(Stream.fromQueue(watched.output), promptTimeout);
      if (ready.outcome === "mark") {
        yield* settlePrompt(shellId, "ready");
        yield* onMark;
      } else if (ready.outcome === "timeout") yield* settlePrompt(shellId, "none");
    }).pipe(Effect.ensuring(Effect.sync(watched.stop)), Effect.forkIn(scope));
  });

  const readText = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));

  // Reads the HEAD file directly, so polling never starts a git process.
  const readBranch = Effect.fnUntraced(function* (worktree: string) {
    const dotGit = path.join(worktree, ".git");
    const pointer = yield* readText(dotGit);
    const gitDir =
      pointer === null ? dotGit : path.resolve(worktree, pointer.trim().replace(/^gitdir:\s*/, ""));
    const head = yield* readText(path.join(gitDir, "HEAD"));
    return head === null ? null : branchFromHead(head);
  });

  const realPath = (folder: string) => fs.realPath(folder).pipe(Effect.orElseSucceed(() => folder));
  const exists = (folder: string) => fs.exists(folder).pipe(Effect.orElseSucceed(() => true));

  const isInside = (folder: string, home: string) => {
    const relative = path.relative(home, folder);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const stopTracking = yield* manager.subscribeMetadata((event) =>
    Effect.sync(() => {
      switch (event.type) {
        case "snapshot":
          for (const terminal of event.terminals) {
            const shellId = shellIdFromOwnerId(terminal.threadId);
            if (shellId !== null) terminals.set(shellId, terminal);
          }
          return;
        case "upsert": {
          const shellId = shellIdFromOwnerId(event.terminal.threadId);
          if (shellId !== null) terminals.set(shellId, event.terminal);
          return;
        }
        case "remove": {
          const shellId = shellIdFromOwnerId(event.threadId);
          if (shellId !== null) {
            terminals.delete(shellId);
            if (!saved.has(shellId)) {
              records.delete(shellId);
              forgetToken(shellId);
            }
          }
          return;
        }
      }
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(stopTracking));

  /** Reads every tracked shell's branch, folder and home once and sends the shells that changed. */
  const refreshLocations = Effect.gen(function* () {
    const tracked = [...records].filter(
      ([shellId, record]) => record.home !== null && (terminals.has(shellId) || saved.has(shellId)),
    );
    if (tracked.length === 0) return;
    const branches = new Map<string, string | null>();
    for (const [, record] of tracked) {
      if (record.worktree !== null && !branches.has(record.worktree)) {
        branches.set(record.worktree, yield* readBranch(record.worktree));
      }
    }
    const homes = new Map<string, boolean>();
    for (const [, record] of tracked) {
      if (record.home !== null && !homes.has(record.home)) {
        homes.set(record.home, yield* exists(record.home));
      }
    }
    const pids = tracked.flatMap(([shellId]) => {
      const pid = terminals.get(shellId)?.pid;
      return pid === null || pid === undefined ? [] : [pid];
    });
    const cwds = yield* readCwds(pids);
    for (const [shellId, record] of tracked) {
      const terminal = terminals.get(shellId);
      const missing = record.home !== null && homes.get(record.home) === false;
      // A gone worktree has no branch to read; keep the last one shown next to the warning.
      const branch =
        record.worktree === null
          ? null
          : missing
            ? record.branch
            : (branches.get(record.worktree) ?? null);
      const cwd = terminal?.pid == null ? undefined : cwds.get(terminal.pid);
      // An unreadable folder keeps the last answer instead of flickering.
      const elsewhere =
        cwd === undefined
          ? record.elsewhere
          : record.home !== null && isInside(cwd, record.home)
            ? null
            : cwd;
      if (
        branch === record.branch &&
        elsewhere === record.elsewhere &&
        missing === record.missing
      ) {
        continue;
      }
      record.branch = branch;
      record.elsewhere = elsewhere;
      record.missing = missing;
      const shell = summaryOf(shellId);
      if (shell !== null) yield* emit({ type: "upsert", shell });
    }
  });

  /** A shell that exited on its own without a signal is gone for good, like a killed one. */
  const removeExited = Effect.fn("Shells.removeExited")(function* (shellId: string, pid: number) {
    yield* unsave(shellId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not save the shell list", { reason: error.reason }),
      ),
    );
    yield* manager.close({ ...session(shellId), deleteHistory: true });
    if (host !== null) yield* host.forget(pid);
  });

  /** A shell a signal ended stays listed as ended, also after a restart, until it is removed. */
  const keepEnded = Effect.fn("Shells.keepEnded")(function* (
    shellId: string,
    pid: number,
    exitCode: number | null,
    exitSignal: number,
  ) {
    const entry = saved.get(shellId);
    if (entry !== undefined) {
      saved.set(shellId, {
        ...entry,
        ended: { reason: "signal", exitCode, exitSignal, at: yield* nowIso },
      });
      yield* persistOrWarn;
    }
    if (host !== null) yield* host.forget(pid);
  });

  // Every end leaves a line in the server log (NFR-6); a kill logs its own.
  const stopEndHandling = yield* manager.subscribe((event) => {
    if (event.type !== "exited") return Effect.void;
    const shellId = shellIdFromOwnerId(event.threadId);
    if (shellId === null || killing.has(shellId)) return Effect.void;
    const terminal = terminals.get(shellId);
    const signal = signalOf(event.exitSignal);
    const pid = terminal?.pid ?? saved.get(shellId)?.pid ?? null;
    return Effect.logInfo("shell ended", {
      shellId,
      cwd: terminal?.cwd ?? null,
      exitCode: event.exitCode,
      exitSignal: signal,
      reason: signal === null ? "exited" : "signal",
    }).pipe(
      Effect.andThen(
        // Started at once, so each end has changed the shell list before the next event is handled.
        pid === null
          ? Effect.void
          : (signal === null
              ? removeExited(shellId, pid)
              : keepEnded(shellId, pid, event.exitCode, signal)
            ).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid),
      ),
    );
  });
  yield* Effect.addFinalizer(() => Effect.sync(stopEndHandling));

  const rawOutputDir = options.rawOutputDir ?? null;
  if (rawOutputDir !== null) {
    yield* fs.makeDirectory(rawOutputDir, { recursive: true });
    // Listeners run in publish order, so each file keeps its shell's output in order.
    const stopRawOutput = yield* manager.subscribe((event) => {
      const shellId = event.type === "output" ? shellIdFromOwnerId(event.threadId) : null;
      if (event.type !== "output" || shellId === null) return Effect.void;
      return fs
        .writeFileString(path.join(rawOutputDir, `${shellId}.log`), event.data, { flag: "a" })
        .pipe(
          Effect.catch((error) => Effect.logWarning("raw output not saved", { shellId, error })),
        );
    });
    yield* Effect.addFinalizer(() => Effect.sync(stopRawOutput));
  }

  /**
   * Force-ends a shell and everything it started, and forgets it. A shell that already ended or
   * that this server does not know is forgotten without an error. Once started a kill finishes:
   * `probe kill`'s request dies with the shell, which would otherwise interrupt it halfway.
   */
  const kill = Effect.fn("Shells.kill")(function* (shellId: string) {
    const terminal = terminals.get(shellId);
    const running =
      terminal?.pid != null && (terminal.status === "running" || terminal.status === "starting");
    killing.add(shellId);
    yield* Effect.gen(function* () {
      if (running) {
        // The removal is sent once the process ended, so a client can rely on it (SU-3).
        const ended = yield* Deferred.make<void>();
        const { threadId } = session(shellId);
        const stop = yield* manager.subscribe((event) =>
          event.type === "exited" && event.threadId === threadId
            ? Deferred.succeed(ended, undefined).pipe(Effect.asVoid)
            : Effect.void,
        );
        const exited = yield* killTree(terminal.pid!).pipe(
          Effect.andThen(Deferred.await(ended).pipe(Effect.timeoutOption(killWait))),
          Effect.ensuring(Effect.sync(stop)),
        );
        if (exited._tag === "None") {
          yield* Effect.logDebug("killed shell outlived the wait; removing it", {
            shellId,
            pid: terminal.pid,
          });
        }
      }
      const known = terminal !== undefined || saved.has(shellId);
      const pid = terminal?.pid ?? saved.get(shellId)?.pid ?? null;
      const forgotten = yield* Effect.exit(unsave(shellId));
      if (pid !== null && host !== null) yield* host.forget(pid);
      if (forgotten._tag === "Failure") {
        // A shell already ended stays listed, so the user can try again.
        if (!running) return yield* forgotten;
        const entry = saved.get(shellId);
        if (entry !== undefined) {
          saved.set(shellId, {
            ...entry,
            ended: { reason: "signal", exitCode: null, exitSignal: 9, at: yield* nowIso },
          });
        }
      }
      yield* manager.close({ ...session(shellId), deleteHistory: forgotten._tag === "Success" });
      if (known) {
        yield* Effect.logInfo("shell ended", {
          shellId,
          cwd: terminal?.cwd ?? null,
          reason: "killed",
        });
      }
      if (forgotten._tag === "Failure") return yield* forgotten;
      // A kept-as-ended shell has no terminal to send its removal.
      if (terminal === undefined) yield* emit({ type: "remove", shellId });
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          killing.delete(shellId);
          if (!saved.has(shellId)) {
            records.delete(shellId);
            forgetToken(shellId);
          }
        }),
      ),
      Effect.uninterruptible,
    );
  });

  /** The environment of a shell, with what lets `probe kill` end that shell and no other. */
  const envOf = (
    shellId: string,
    token: string | null,
    base: Record<string, string> | undefined,
  ): Record<string, string> | undefined =>
    selfKill === null || token === null
      ? base
      : {
          ...base,
          [SHELL_ENV.id]: shellId,
          [SHELL_ENV.token]: token,
          [SHELL_ENV.endpointFile]: selfKill.endpointFile,
          [SHELL_ENV.bin]: selfKill.bin,
          PATH: selfKill.path,
        };

  // A script's fields carry its name and program, never its command line (it may carry a secret).
  const failToStart = (
    cwd: string,
    reason: string,
    script: { readonly script: string; readonly program: string } | null = null,
  ) =>
    Effect.logWarning("shell failed to start", { cwd, reason, ...script }).pipe(
      Effect.andThen(Effect.fail(new ShellLaunchError({ reason }))),
    );

  /** Ends a script shell whose start failed before it was saved, leaving nothing behind. */
  const discard = Effect.fn("Shells.discard")(function* (shellId: string, pid: number | null) {
    killing.add(shellId);
    yield* Effect.gen(function* () {
      if (pid !== null) yield* killTree(pid);
      yield* manager.close({ ...session(shellId), deleteHistory: true });
      if (pid !== null && host !== null) yield* host.forget(pid);
    }).pipe(
      // The start fails either way; a shell this could not close is left to the next takeover.
      Effect.catch((error) =>
        Effect.logWarning("could not end a shell that failed to start", {
          shellId,
          reason: error.message,
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          killing.delete(shellId);
          forgetToken(shellId);
        }),
      ),
      Effect.uninterruptible,
    );
  });

  // Shells being restored, so a second request while the first runs is refused.
  const restoring = new Set<string>();
  // Shells whose starting script is not typed yet; input for them waits, so it cannot run ahead of it.
  const scriptPending = new Map<string, Deferred.Deferred<void>>();

  /**
   * Starts an ended shell again as a new process in the same place, under the same id. Only the
   * user asks for this: nothing restores a shell by itself, and a kill or a normal exit never
   * leaves a shell to restore. The earlier output is dropped.
   */
  const restore = Effect.fn("Shells.restore")(function* (shellId: string) {
    const entry = saved.get(shellId);
    if (entry === undefined || entry.ended === null || killing.has(shellId)) {
      return yield* failToStart(entry?.cwd ?? "", "The shell has not ended.");
    }
    if (recordOf(shellId).missing) {
      return yield* failToStart(entry.cwd, "The folder it ran in is gone.");
    }
    if (restoring.has(shellId)) {
      return yield* failToStart(entry.cwd, "The shell is already being restored.");
    }
    restoring.add(shellId);
    return yield* Effect.gen(function* () {
      const owner = session(shellId);
      // A shell lost with its server has no terminal here, but its output file is still on disk.
      if (!terminals.has(shellId)) yield* manager.close({ ...owner, deleteHistory: true });
      let reason = "The shell program could not be launched.";
      const stop = yield* manager.subscribe((event) =>
        Effect.sync(() => {
          if (event.type === "error" && event.threadId === owner.threadId) reason = event.message;
        }),
      );
      const token = yield* newToken;
      // A new process: not ready until its own first prompt.
      const record = recordOf(shellId);
      record.prompt = "pending";
      const watched = yield* watchOutput(shellId);
      const snapshot = yield* manager
        .open({ ...owner, cwd: entry.cwd, ...optionalEnv(envOf(shellId, token, undefined)) })
        .pipe(
          Effect.ensuring(Effect.sync(stop)),
          Effect.onError(() => Effect.sync(watched.stop)),
        );
      if (snapshot.status === "error") {
        watched.stop();
        // The shell stays listed as ended, so the user can try again or remove it.
        yield* manager.close({ ...owner, deleteHistory: false });
        return yield* failToStart(entry.cwd, reason);
      }
      forgetToken(shellId);
      const tokenHash = token === null ? null : hashToken(token);
      if (tokenHash !== null) tokens.set(tokenHash, shellId);
      record.restored = true;
      const { prompt: _earlierPrompt, ...earlier } = entry;
      saved.set(shellId, {
        ...earlier,
        pid: snapshot.pid,
        label: snapshot.label,
        tokenHash,
        ended: null,
        restored: true,
      });
      yield* persistOrWarn;
      yield* Effect.logInfo("shell restored", {
        shellId,
        cwd: snapshot.cwd,
        previous: entry.ended?.reason,
      });
      const summary = toSummary(shellId, snapshot, record);
      yield* emit({ type: "upsert", shell: summary });
      yield* scanFirstPrompt(
        shellId,
        watched,
        yield* manager.printsPromptMark(owner.threadId, owner.terminalId),
      );
      return summary;
    }).pipe(Effect.ensuring(Effect.sync(() => restoring.delete(shellId))));
  });

  /** Takes over the shells an earlier server left in the host, and lists the ones that ended. */
  const takeOver = Effect.gen(function* () {
    if (registryPath === null) return;
    const text = yield* fs.readFileString(registryPath).pipe(Effect.option);
    if (text._tag === "None") return;
    const decoded = decodeRegistry(text.value);
    if (decoded._tag === "Failure") {
      return yield* Effect.logWarning("the shell list is not readable; starting without it", {
        path: registryPath,
      });
    }
    const hosted = host === null ? [] : yield* host.list;
    const byPid = new Map(hosted.map((entry) => [entry.session.pid, entry]));
    for (const { folder, ...disk } of decoded.value.shells) {
      const entry: SavedShell = { ...disk, project: disk.project ?? folder ?? null };
      const home = entry.home;
      const record: ShellRecord = {
        title: entry.title,
        project: entry.project,
        worktree: entry.worktree,
        home,
        branch: entry.worktree === null ? null : yield* readBranch(entry.worktree),
        elsewhere: null,
        missing: home !== null && !(yield* exists(home)),
        restored: entry.restored === true,
        prompt: entry.prompt ?? "pending",
      };
      records.set(entry.shellId, record);
      if (entry.tokenHash !== null) tokens.set(entry.tokenHash, entry.shellId);
      const found = entry.pid === null ? undefined : byPid.get(entry.pid);
      if (entry.pid !== null) byPid.delete(entry.pid);
      if (entry.ended !== null) {
        saved.set(entry.shellId, entry);
      } else if (found === undefined) {
        saved.set(entry.shellId, {
          ...entry,
          ended: { reason: "lost", exitCode: null, exitSignal: null, at: yield* nowIso },
        });
        yield* Effect.logInfo("shell lost", { shellId: entry.shellId, cwd: entry.cwd });
      } else if (found.session.exit === null) {
        // A first prompt printed while no server watched is in the output the host kept.
        if (record.prompt === "pending" && makeReadyScanner().feed(found.session.output)) {
          record.prompt = "ready";
        }
        saved.set(
          entry.shellId,
          record.prompt === "pending" ? entry : { ...entry, prompt: record.prompt },
        );
        const watched = record.prompt === "pending" ? yield* watchOutput(entry.shellId) : null;
        const snapshot = yield* manager.adopt({
          ...session(entry.shellId),
          cwd: found.session.cwd,
          cols: found.session.cols,
          rows: found.session.rows,
          output: found.session.output,
          grids: found.session.grids,
          process: found.process,
        });
        yield* Effect.logInfo("shell reattached", {
          shellId: entry.shellId,
          cwd: snapshot.cwd,
          pid: snapshot.pid,
        });
        // Whether an adopted process is wrapped is not known here; an unwrapped one times out.
        if (watched !== null) yield* scanFirstPrompt(entry.shellId, watched, true);
      } else if (signalOf(found.session.exit.signal) === null) {
        records.delete(entry.shellId);
        forgetToken(entry.shellId);
        if (host !== null) yield* host.forget(found.session.pid);
        yield* manager.close({ ...session(entry.shellId), deleteHistory: true });
        yield* Effect.logInfo("shell ended", {
          shellId: entry.shellId,
          cwd: entry.cwd,
          exitCode: found.session.exit.exitCode,
          reason: "exited",
        });
      } else {
        saved.set(entry.shellId, {
          ...entry,
          ended: {
            reason: "signal",
            exitCode: found.session.exit.exitCode,
            exitSignal: signalOf(found.session.exit.signal),
            at: yield* nowIso,
          },
        });
        if (host !== null) yield* host.forget(found.session.pid);
      }
    }
    // A shell the host holds with no saved entry was started by a server that crashed first.
    for (const orphan of byPid.values()) {
      if (orphan.session.exit === null) yield* killTree(orphan.session.pid);
      if (host !== null) yield* host.forget(orphan.session.pid);
    }
    yield* persistOrWarn;
  });
  yield* takeOver;

  return {
    // A shell that cannot start is not kept: the caller gets the launch error's reason instead.
    // A script start returns at the shell's first prompt, once the shell says it can run the
    // program; until then the shell is listed but unsaved, and input to it waits.
    open: Effect.fn("Shells.open")(function* (input: ShellOpenInput, options?: ShellOpenOptions) {
      const requestedAt = yield* Clock.currentTimeMillis;
      const script = options?.script ?? null;
      const started =
        script === null ? null : { script: script.name, program: programOf(script.command) };
      if (started !== null && started.program.length === 0) {
        return yield* failToStart(input.cwd, "The script has no command.", started);
      }
      const shellId = yield* newShellId;
      const owner = session(shellId);
      const worktree = options?.worktree ?? null;
      const home = worktree ?? options?.project ?? null;
      // Settled once the command is typed or the start failed; input waits for it.
      const typed = started === null ? null : yield* Deferred.make<void>();
      if (typed !== null) scriptPending.set(shellId, typed);
      const settle = Effect.sync(() => {
        if (typed === null) return;
        scriptPending.delete(shellId);
        Deferred.doneUnsafe(typed, Effect.void);
      });
      records.set(shellId, {
        title: options?.title ?? null,
        project: options?.project ?? null,
        worktree,
        home: home === null ? null : yield* realPath(home),
        branch: worktree === null ? null : yield* readBranch(worktree),
        elsewhere: null,
        missing: false,
        restored: false,
        prompt: "pending",
      });
      let reason = "The shell program could not be launched.";
      const stop = yield* manager.subscribe((event) =>
        Effect.sync(() => {
          if (event.type === "error" && event.threadId === owner.threadId) reason = event.message;
        }),
      );
      const token = yield* newToken;
      const tokenHash = token === null ? null : hashToken(token);
      if (tokenHash !== null) tokens.set(tokenHash, shellId);
      const base = envOf(shellId, token, input.env);
      const env = started === null ? base : { ...base, [START_PROGRAM_ENV]: started.program };
      // One scan per shell serves both the script typing and the first-prompt state.
      const watched = yield* watchOutput(shellId);
      const { output, stop: stopOutput } = watched;
      // From the start request to the first prompt; the scenario harness records it (PRB.T-036).
      const logPromptReady = Effect.gen(function* () {
        const ms = (yield* Clock.currentTimeMillis) - requestedAt;
        yield* Effect.logInfo("shell prompt ready", { shellId, ms });
      });
      const snapshot = yield* manager
        .open({ ...owner, ...input, ...(env === undefined ? {} : { env }) })
        .pipe(
          Effect.ensuring(Effect.sync(stop)),
          Effect.onError(() => Effect.andThen(Effect.sync(stopOutput), settle)),
        );
      if (snapshot.status === "error") {
        stopOutput();
        yield* settle;
        records.delete(shellId);
        forgetToken(shellId);
        yield* manager.close({ ...owner, deleteHistory: true });
        return yield* failToStart(input.cwd, reason, started);
      }
      if (started !== null && script !== null) {
        // Typed before the shell is ready, the line is echoed once at once and again after the
        // prompt. A shell that cannot tell (not wrapped, or no mark in time) is not refused (ER-3).
        const ready = yield* Effect.gen(function* () {
          return (yield* manager.printsPromptMark(owner.threadId, owner.terminalId))
            ? yield* waitForPromptMark(Stream.fromQueue(output), promptTimeout)
            : // A shell that already ended has no process left to say it was wrapped.
              (yield* Queue.clear(output)).some((event) => event.type === "exited")
              ? { outcome: "exited" as const, program: null }
              : { outcome: "unwrapped" as const, program: null };
        }).pipe(
          Effect.ensuring(Effect.sync(stopOutput)),
          Effect.onError(() => Effect.andThen(discard(shellId, snapshot.pid), settle)),
        );
        const refusal =
          ready.outcome === "exited"
            ? "The shell ended before its first prompt."
            : ready.program === "missing"
              ? `${started.program} was not found.`
              : null;
        if (refusal !== null) {
          yield* discard(shellId, snapshot.pid);
          yield* settle;
          return yield* failToStart(input.cwd, refusal, started);
        }
        if (ready.outcome === "mark") {
          yield* settlePrompt(shellId, "ready");
          yield* logPromptReady;
        } else yield* settlePrompt(shellId, "none");
        if (ready.outcome === "timeout") {
          yield* Effect.logWarning("shell printed no prompt mark; typing the starting script", {
            shellId,
          });
        }
        yield* manager.write({ ...owner, data: `${script.command}\r` }).pipe(
          Effect.onError(() => discard(shellId, snapshot.pid)),
          Effect.ensuring(settle),
        );
      } else {
        // A plain shell is not held up: its first prompt is awaited in the background.
        yield* scanFirstPrompt(
          shellId,
          watched,
          yield* manager.printsPromptMark(owner.threadId, owner.terminalId),
          logPromptReady,
        );
      }
      const record = recordOf(shellId);
      saved.set(shellId, {
        shellId,
        pid: snapshot.pid,
        cwd: snapshot.cwd,
        label: snapshot.label,
        title: record.title,
        project: record.project,
        worktree: record.worktree,
        home: record.home,
        tokenHash,
        ended: null,
        // The scan may have settled already; one that settles later saves it then.
        ...(record.prompt === "pending" ? {} : { prompt: record.prompt }),
      });
      yield* persistOrWarn;
      yield* Effect.logInfo(
        "shell started",
        record.worktree === null
          ? { shellId, cwd: snapshot.cwd, ...(started ?? { script: "plain" }) }
          : {
              shellId,
              cwd: snapshot.cwd,
              worktree: record.worktree,
              branch: record.branch,
              ...(started ?? { script: "plain" }),
            },
      );
      return summaryOf(shellId) ?? toSummary(shellId, snapshot, record);
    }),
    attach: (input: ShellAttachInput, viewerId: string) =>
      manager.attachOutputStream(
        { ...session(input.shellId), cols: input.cols, rows: input.rows },
        viewerId,
      ),
    write: Effect.fn("Shells.write")(function* (input: ShellWriteInput) {
      const pending = scriptPending.get(input.shellId);
      if (pending !== undefined) yield* Deferred.await(pending);
      yield* manager.write({ ...session(input.shellId), data: input.data });
    }),
    // The manager ignores a resize for a terminal it does not know; a shell id the client holds must exist.
    resize: Effect.fn("Shells.resize")(function* (input: ShellResizeInput, viewerId?: string) {
      const { threadId, terminalId } = session(input.shellId);
      if (!(yield* manager.has(threadId, terminalId))) {
        return yield* new TerminalSessionLookupError({ threadId, terminalId });
      }
      yield* manager.resize({ threadId, terminalId, cols: input.cols, rows: input.rows }, viewerId);
    }),
    /** A client showed, hid or focused the shell, so the program in it is looked at again soon. */
    viewChanged: Effect.fn("Shells.viewChanged")(function* (shellId: string) {
      const { threadId, terminalId } = session(shellId);
      yield* Effect.logDebug("shell view changed", { shellId });
      yield* manager.recheckLabel(threadId, terminalId);
    }),
    kill,
    restore,
    /** Kills the shell the token was given to; false when no live shell has it. */
    killByToken: Effect.fn("Shells.killByToken")(function* (token: string) {
      const shellId = tokens.get(hashToken(token));
      if (shellId === undefined) return false;
      yield* kill(shellId);
      return true;
    }),
    /** Every shell the server runs or still lists. */
    list: Effect.sync(() =>
      inStartOrder([
        ...[...terminals].map(([shellId, terminal]) =>
          toSummary(shellId, terminal, recordOf(shellId)),
        ),
        ...endedOnly(),
      ]),
    ),
    subscribe: Effect.fnUntraced(function* (
      listener: (event: ShellListStreamEvent) => Effect.Effect<void>,
    ) {
      const stop = yield* manager.subscribeMetadata((event) => {
        // A killed shell's end is sent as its removal (or its kept-as-ended entry), not as an exit.
        if (
          event.type === "upsert" &&
          event.terminal.status === "exited" &&
          killing.has(shellIdFromOwnerId(event.terminal.threadId) ?? "")
        ) {
          return Effect.void;
        }
        const mapped = listEvent(event, recordOf, endedOf, endedOnly, inStartOrder);
        return mapped === null ? Effect.void : listener(mapped);
      });
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    }),
    refreshLocations,
  };
});

/** Environment-owned shells, reachable from any server feature, not only the ws layer. */
export class Shells extends Context.Service<
  Shells,
  Effect.Success<ReturnType<typeof makeShells>>
>()("t3/terminal/Shells") {}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Writes the `probe` command into the server's state folder and says how shells reach it. Null
 * on Windows and when the command cannot be written: shells then start without it.
 */
const prepareSelfKill = Effect.fn("Shells.prepareSelfKill")(function* (platform: NodeJS.Platform) {
  if (platform === "win32") return null;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const { address } = yield* HttpServer.HttpServer;
  if (!NetAddress.isInetAddress(address)) return null;
  // A server bound to every interface is reached over loopback, as MCP clients reach it.
  const host = NetAddress.isUnspecified(address.address)
    ? "127.0.0.1"
    : NetAddress.formatUrlHostString(NetAddress.formatIp(address.address));
  const self = yield* resolveSelfInvocation();
  const dir = path.join(stateDir, "shell-bin");
  const bin = path.join(dir, "probe");
  const endpointFile = path.join(dir, "endpoint");
  const command = [self.command, ...selfInvocationArgs(self, [PROBE_COMMAND])]
    .map(shellQuote)
    .join(" ");
  return yield* Effect.gen(function* () {
    yield* fs.makeDirectory(dir, { recursive: true });
    yield* fs.writeFileString(bin, `#!/bin/sh\nexec ${command} "$@"\n`);
    yield* fs.chmod(bin, 0o755);
    // Shells outlive the server, so they read where it listens now rather than when they started.
    yield* fs.writeFileString(endpointFile, `http://${host}:${address.port}${SELF_KILL_PATH}\n`);
    return {
      endpointFile,
      bin,
      path: [dir, process.env.PATH ?? ""].join(":"),
    } satisfies ShellSelfKill;
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("shells start without the probe command", { reason: error.message }).pipe(
        Effect.as(null),
      ),
    ),
  );
});

export const layer = Layer.effect(
  Shells,
  Effect.gen(function* () {
    const manager = yield* TerminalManager;
    const crypto = yield* Crypto.Crypto;
    const { stateDir, rawOutputDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const host = yield* Effect.serviceOption(ShellHost);
    const shells = yield* makeShells(manager, crypto.randomUUIDv4().pipe(Effect.orDie), {
      registryPath: path.join(stateDir, "shells", "registry.json"),
      host: host._tag === "Some" ? host.value : null,
      newToken: crypto.randomBytes(32).pipe(
        Effect.map((bytes) => Buffer.from(bytes).toString("base64url")),
        Effect.orDie,
      ),
      selfKill: yield* prepareSelfKill(yield* HostProcess.Platform),
      rawOutputDir: rawOutputDir ?? null,
    });
    // Costs one HEAD read per worktree and one folder read per shell, and nothing without shells.
    yield* shells.refreshLocations.pipe(
      Effect.repeat(Schedule.spaced("2 seconds")),
      Effect.forkScoped,
    );
    return shells;
  }),
);
