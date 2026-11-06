import {
  DEFAULT_TERMINAL_ID,
  type ShellAttachInput,
  type ShellListStreamEvent,
  type ShellOpenInput,
  type ShellResizeInput,
  type ShellSummary,
  type ShellWriteInput,
  ShellLaunchError,
  type TerminalMetadataStreamEvent,
  type TerminalSessionSnapshot,
  type TerminalSummary,
  TerminalSessionLookupError,
  isShellOwnerId,
  shellIdFromOwnerId,
  shellOwnerId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, selfInvocationArgs } from "@t3tools/shared/nodeRuntime";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { TerminalManager } from "./Manager.ts";
import { killProcessTree, makeReadProcessTable } from "./processTree.ts";
import { PROBE_COMMAND, SELF_KILL_PATH, SHELL_ENV, type ShellSelfKill } from "./shellEnv.ts";

type Manager = TerminalManager["Service"];

/** What the server knows about a shell beyond its terminal: given at start, or polled. */
interface ShellRecord {
  readonly title: string | null;
  readonly folder: string | null;
  readonly worktree: string | null;
  /** The folder the shell belongs in (its worktree, else its folder), resolved once at start. */
  readonly home: string | null;
  branch: string | null;
  elsewhere: string | null;
}

const NO_RECORD: ShellRecord = {
  title: null,
  folder: null,
  worktree: null,
  home: null,
  branch: null,
  elsewhere: null,
};

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
  folder: record.folder,
  worktree: record.worktree,
  branch: record.branch,
  elsewhere: record.elsewhere,
  updatedAt: terminal.updatedAt,
});

const listEvent = (
  event: TerminalMetadataStreamEvent,
  recordOf: (shellId: string) => ShellRecord,
): ShellListStreamEvent | null => {
  switch (event.type) {
    case "snapshot":
      return {
        type: "snapshot",
        shells: event.terminals.flatMap((terminal) => {
          const shellId = shellIdFromOwnerId(terminal.threadId);
          return shellId === null ? [] : [toSummary(shellId, terminal, recordOf(shellId))];
        }),
      };
    case "upsert": {
      const shellId = shellIdFromOwnerId(event.terminal.threadId);
      return shellId === null
        ? null
        : { type: "upsert", shell: toSummary(shellId, event.terminal, recordOf(shellId)) };
    }
    case "remove": {
      const shellId = shellIdFromOwnerId(event.threadId);
      return shellId === null ? null : { type: "remove", shellId };
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

interface ShellsOptions {
  /** Typed into a shell opened with `agent: true`; null when none is configured. */
  readonly agentCommand?: string | null;
  readonly searchPath?: string | undefined;
  readonly platform?: NodeJS.Platform;
  /** The current folder of each process; a pid it cannot read is left out. */
  readonly readCwds?: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyMap<number, string>>;
  /** Force-ends a shell's process and everything it started. */
  readonly killTree?: (pid: number) => Effect.Effect<void>;
  /** A secret per shell that lets a command inside it kill it; see `selfKill`. */
  readonly newToken?: Effect.Effect<string>;
  /** Where `probe kill` reaches the server; null leaves shells without the command. */
  readonly selfKill?: ShellSelfKill | null;
}

export interface ShellOpenOptions {
  readonly title?: string;
  /** The workspace folder the shell was started for. */
  readonly folder?: string;
  /** The git worktree it starts in; its branch is shown and kept up to date. */
  readonly worktree?: string;
}

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
          Effect.map((cwd) => [[pid, cwd] as const]),
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

// The program is the command's first word; the shell itself parses the rest when it runs the line.
const programOf = (command: string) =>
  command
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^["']|["']$/g, "");

export const makeShells = Effect.fn("Shells.make")(function* (
  manager: Manager,
  newShellId: Effect.Effect<string>,
  options: ShellsOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = options.platform ?? (yield* HostProcess.Platform);
  const agentCommand = options.agentCommand ?? null;
  const session = (shellId: string) => ({
    threadId: shellOwnerId(shellId),
    terminalId: DEFAULT_TERMINAL_ID,
  });
  // Records live as long as the server; a shell does not outlive it either.
  const records = new Map<string, ShellRecord>();
  const recordOf = (shellId: string) => records.get(shellId) ?? NO_RECORD;
  // The last terminal state of each shell, so a location change can be sent as a full summary.
  const terminals = new Map<string, TerminalSummary>();
  const listeners = new Set<(event: ShellListStreamEvent) => Effect.Effect<void>>();
  const readCwds = options.readCwds ?? (yield* makeReadCwds(platform));
  const killTree =
    options.killTree ??
    (yield* makeReadProcessTable(platform).pipe(
      Effect.map((readTable) => (pid: number) => killProcessTree(readTable, pid)),
    ));
  const newToken: Effect.Effect<string | null> = options.newToken ?? Effect.succeed(null);
  const selfKill = options.selfKill ?? null;
  // Each shell's own token, so `probe kill` can end that shell and no other.
  const tokens = new Map<string, string>();
  const forgetToken = (shellId: string) => {
    for (const [token, owner] of tokens) if (owner === shellId) tokens.delete(token);
  };
  // Shells Probe is killing; their end is logged by the kill, with its reason.
  const killing = new Set<string>();

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
            records.delete(shellId);
            forgetToken(shellId);
          }
          return;
        }
      }
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(stopTracking));

  /** Reads every tracked shell's branch and folder once and sends the shells that changed. */
  const refreshLocations = Effect.gen(function* () {
    const tracked = [...records].filter(
      ([shellId, record]) => record.home !== null && terminals.has(shellId),
    );
    if (tracked.length === 0) return;
    const branches = new Map<string, string | null>();
    for (const [, record] of tracked) {
      if (record.worktree !== null && !branches.has(record.worktree)) {
        branches.set(record.worktree, yield* readBranch(record.worktree));
      }
    }
    const pids = tracked.flatMap(([shellId]) => {
      const pid = terminals.get(shellId)?.pid;
      return pid === null || pid === undefined ? [] : [pid];
    });
    const cwds = yield* readCwds(pids);
    for (const [shellId, record] of tracked) {
      const terminal = terminals.get(shellId);
      if (terminal === undefined) continue;
      const branch = record.worktree === null ? null : (branches.get(record.worktree) ?? null);
      const cwd = terminal.pid === null ? undefined : cwds.get(terminal.pid);
      // An unreadable folder keeps the last answer instead of flickering.
      const elsewhere =
        cwd === undefined
          ? record.elsewhere
          : record.home !== null && isInside(cwd, record.home)
            ? null
            : cwd;
      if (branch === record.branch && elsewhere === record.elsewhere) continue;
      record.branch = branch;
      record.elsewhere = elsewhere;
      const event: ShellListStreamEvent = {
        type: "upsert",
        shell: toSummary(shellId, terminal, record),
      };
      for (const listener of listeners) yield* listener(event);
    }
  });

  const isFile = (candidate: string) =>
    fs.stat(candidate).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );

  const findProgram = Effect.fnUntraced(function* (program: string, cwd: string) {
    if (program.includes("/") || program.includes("\\")) {
      return yield* isFile(path.resolve(cwd, program));
    }
    const extensions =
      platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
    const dirs = (options.searchPath ?? process.env.PATH ?? "")
      .split(platform === "win32" ? ";" : ":")
      .filter((dir) => dir.length > 0);
    for (const dir of dirs) {
      for (const extension of extensions) {
        if (yield* isFile(path.join(dir, `${program}${extension}`))) return true;
      }
    }
    return false;
  });

  const agentProblem = Effect.fnUntraced(function* (cwd: string) {
    if (agentCommand === null || agentCommand.trim().length === 0) {
      return "No agent command is configured.";
    }
    const program = programOf(agentCommand);
    if (program === undefined || program.length === 0 || !(yield* findProgram(program, cwd))) {
      return `The agent command was not found: ${program ?? agentCommand}`;
    }
    return null;
  });

  // A shell that ends on its own or is killed leaves a line in the server log (NFR-6).
  const stopEndLog = yield* manager.subscribe((event) => {
    if (event.type !== "exited") return Effect.void;
    const shellId = shellIdFromOwnerId(event.threadId);
    return shellId === null || killing.has(shellId)
      ? Effect.void
      : Effect.logInfo("shell ended", {
          shellId,
          cwd: terminals.get(shellId)?.cwd ?? null,
          exitCode: event.exitCode,
          exitSignal: event.exitSignal,
        });
  });
  yield* Effect.addFinalizer(() => Effect.sync(stopEndLog));

  /**
   * Force-ends a shell and everything it started, and forgets it. A shell that already ended or
   * that this server does not know is forgotten without an error.
   */
  const kill = Effect.fn("Shells.kill")(function* (shellId: string) {
    const terminal = terminals.get(shellId);
    killing.add(shellId);
    yield* Effect.gen(function* () {
      if (
        terminal?.pid != null &&
        (terminal.status === "running" || terminal.status === "starting")
      ) {
        yield* killTree(terminal.pid);
      }
      yield* manager.close({ ...session(shellId), deleteHistory: true });
      if (terminal !== undefined) {
        yield* Effect.logInfo("shell ended", { shellId, cwd: terminal.cwd, reason: "killed" });
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          killing.delete(shellId);
          records.delete(shellId);
          forgetToken(shellId);
        }),
      ),
    );
  });

  const failToStart = (cwd: string, reason: string) =>
    Effect.logWarning("shell failed to start", { cwd, reason }).pipe(
      Effect.andThen(Effect.fail(new ShellLaunchError({ reason }))),
    );

  return {
    // A shell that cannot start is not kept: the caller gets the launch error's reason instead.
    open: Effect.fn("Shells.open")(function* (input: ShellOpenInput, options?: ShellOpenOptions) {
      const { agent, ...terminal } = input;
      if (agent === true) {
        const problem = yield* agentProblem(input.cwd);
        if (problem !== null) return yield* failToStart(input.cwd, problem);
      }
      const shellId = yield* newShellId;
      const owner = session(shellId);
      const worktree = options?.worktree ?? null;
      const home = worktree ?? options?.folder ?? null;
      records.set(shellId, {
        title: options?.title ?? null,
        folder: options?.folder ?? null,
        worktree,
        home: home === null ? null : yield* realPath(home),
        branch: worktree === null ? null : yield* readBranch(worktree),
        elsewhere: null,
      });
      let reason = "The shell program could not be launched.";
      const stop = yield* manager.subscribe((event) =>
        Effect.sync(() => {
          if (event.type === "error" && event.threadId === owner.threadId) reason = event.message;
        }),
      );
      const token = yield* newToken;
      if (token !== null) tokens.set(token, shellId);
      const env =
        selfKill === null || token === null
          ? terminal.env
          : {
              ...terminal.env,
              [SHELL_ENV.id]: shellId,
              [SHELL_ENV.token]: token,
              [SHELL_ENV.endpoint]: selfKill.endpoint,
              [SHELL_ENV.bin]: selfKill.bin,
              PATH: selfKill.path,
            };
      const snapshot = yield* manager
        .open({ ...owner, ...terminal, ...(env === undefined ? {} : { env }) })
        .pipe(Effect.ensuring(Effect.sync(stop)));
      if (snapshot.status === "error") {
        records.delete(shellId);
        forgetToken(shellId);
        yield* manager.close({ ...owner, deleteHistory: true });
        return yield* failToStart(input.cwd, reason);
      }
      const record = recordOf(shellId);
      yield* Effect.logInfo(
        "shell started",
        record.worktree === null
          ? { shellId, cwd: snapshot.cwd }
          : { shellId, cwd: snapshot.cwd, worktree: record.worktree, branch: record.branch },
      );
      if (agent === true && agentCommand !== null) {
        // The pty buffers this until the shell has read its startup files.
        yield* manager.write({ ...owner, data: `${agentCommand}\r` });
      }
      return toSummary(shellId, snapshot, record);
    }),
    attach: (input: ShellAttachInput, viewerId: string) =>
      manager.attachOutputStream(
        { ...session(input.shellId), cols: input.cols, rows: input.rows },
        viewerId,
      ),
    write: (input: ShellWriteInput) =>
      manager.write({ ...session(input.shellId), data: input.data }),
    // The manager ignores a resize for a terminal it does not know; a shell id the client holds must exist.
    resize: Effect.fn("Shells.resize")(function* (input: ShellResizeInput, viewerId?: string) {
      const { threadId, terminalId } = session(input.shellId);
      if (!(yield* manager.has(threadId, terminalId))) {
        return yield* new TerminalSessionLookupError({ threadId, terminalId });
      }
      yield* manager.resize({ threadId, terminalId, cols: input.cols, rows: input.rows }, viewerId);
    }),
    kill,
    /** Kills the shell the token was given to; false when no live shell has it. */
    killByToken: Effect.fn("Shells.killByToken")(function* (token: string) {
      const shellId = tokens.get(token);
      if (shellId === undefined) return false;
      yield* kill(shellId);
      return true;
    }),
    /** Every shell the server runs or still lists. */
    list: Effect.sync(() =>
      [...terminals].map(([shellId, terminal]) => toSummary(shellId, terminal, recordOf(shellId))),
    ),
    subscribe: Effect.fnUntraced(function* (
      listener: (event: ShellListStreamEvent) => Effect.Effect<void>,
    ) {
      const stop = yield* manager.subscribeMetadata((event) => {
        const mapped = listEvent(event, recordOf);
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
  const command = [self.command, ...selfInvocationArgs(self, [PROBE_COMMAND])]
    .map(shellQuote)
    .join(" ");
  return yield* Effect.gen(function* () {
    yield* fs.makeDirectory(dir, { recursive: true });
    yield* fs.writeFileString(bin, `#!/bin/sh\nexec ${command} "$@"\n`);
    yield* fs.chmod(bin, 0o755);
    return {
      endpoint: `http://${host}:${address.port}${SELF_KILL_PATH}`,
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
    const { agentCommand } = yield* ServerConfig.ServerConfig;
    const shells = yield* makeShells(manager, crypto.randomUUIDv4().pipe(Effect.orDie), {
      agentCommand: agentCommand ?? null,
      newToken: crypto.randomBytes(32).pipe(
        Effect.map((bytes) => Buffer.from(bytes).toString("base64url")),
        Effect.orDie,
      ),
      selfKill: yield* prepareSelfKill(yield* HostProcess.Platform),
    });
    // Costs one HEAD read per worktree and one folder read per shell, and nothing without shells.
    yield* shells.refreshLocations.pipe(
      Effect.repeat(Schedule.spaced("2 seconds")),
      Effect.forkScoped,
    );
    return shells;
  }),
);
