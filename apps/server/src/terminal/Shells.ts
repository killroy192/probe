import {
  DEFAULT_TERMINAL_ID,
  type ShellAttachInput,
  type ShellInput,
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
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { TerminalManager } from "./Manager.ts";

type Manager = TerminalManager["Service"];

// A shell is one terminal owned by `shell:<id>` instead of a chat thread.
const toSummary = (
  shellId: string,
  terminal: TerminalSessionSnapshot | TerminalSummary,
  title: string | null,
): ShellSummary => ({
  shellId,
  cwd: terminal.cwd,
  status: terminal.status,
  pid: terminal.pid,
  exitCode: terminal.exitCode,
  exitSignal: terminal.exitSignal,
  label: terminal.label,
  title,
  // The manager's label is the running program's name while one runs, else a generic default.
  process: "hasRunningSubprocess" in terminal && terminal.hasRunningSubprocess ? terminal.label : null,
  updatedAt: terminal.updatedAt,
});

const listEvent = (
  event: TerminalMetadataStreamEvent,
  titleOf: (shellId: string) => string | null,
): ShellListStreamEvent | null => {
  switch (event.type) {
    case "snapshot":
      return {
        type: "snapshot",
        shells: event.terminals.flatMap((terminal) => {
          const shellId = shellIdFromOwnerId(terminal.threadId);
          return shellId === null ? [] : [toSummary(shellId, terminal, titleOf(shellId))];
        }),
      };
    case "upsert": {
      const shellId = shellIdFromOwnerId(event.terminal.threadId);
      return shellId === null
        ? null
        : { type: "upsert", shell: toSummary(shellId, event.terminal, titleOf(shellId)) };
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
}

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
  // Titles live as long as the server; a shell does not outlive it either.
  const titles = new Map<string, string>();
  const titleOf = (shellId: string) => titles.get(shellId) ?? null;

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
    return shellId === null
      ? Effect.void
      : Effect.logInfo("shell ended", {
          shellId,
          exitCode: event.exitCode,
          exitSignal: event.exitSignal,
        });
  });
  yield* Effect.addFinalizer(() => Effect.sync(stopEndLog));

  const failToStart = (cwd: string, reason: string) =>
    Effect.logWarning("shell failed to start", { cwd, reason }).pipe(
      Effect.andThen(Effect.fail(new ShellLaunchError({ reason }))),
    );

  return {
    // A shell that cannot start is not kept: the caller gets the launch error's reason instead.
    open: Effect.fn("Shells.open")(function* (
      input: ShellOpenInput,
      options?: { readonly title?: string },
    ) {
      const { agent, ...terminal } = input;
      if (agent === true) {
        const problem = yield* agentProblem(input.cwd);
        if (problem !== null) return yield* failToStart(input.cwd, problem);
      }
      const shellId = yield* newShellId;
      const owner = session(shellId);
      if (options?.title !== undefined) titles.set(shellId, options.title);
      let reason = "The shell program could not be launched.";
      const stop = yield* manager.subscribe((event) =>
        Effect.sync(() => {
          if (event.type === "error" && event.threadId === owner.threadId) reason = event.message;
        }),
      );
      const snapshot = yield* manager
        .open({ ...owner, ...terminal })
        .pipe(Effect.ensuring(Effect.sync(stop)));
      if (snapshot.status === "error") {
        titles.delete(shellId);
        yield* manager.close({ ...owner, deleteHistory: true });
        return yield* failToStart(input.cwd, reason);
      }
      yield* Effect.logInfo("shell started", { shellId, cwd: snapshot.cwd });
      if (agent === true && agentCommand !== null) {
        // The pty buffers this until the shell has read its startup files.
        yield* manager.write({ ...owner, data: `${agentCommand}\r` });
      }
      return toSummary(shellId, snapshot, titleOf(shellId));
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
    close: (input: ShellInput) =>
      manager
        .close({ ...session(input.shellId), deleteHistory: true })
        .pipe(Effect.tap(() => Effect.sync(() => titles.delete(input.shellId)))),
    subscribe: (listener: (event: ShellListStreamEvent) => Effect.Effect<void>) =>
      manager.subscribeMetadata((event) => {
        const mapped = listEvent(event, titleOf);
        return mapped === null ? Effect.void : listener(mapped);
      }),
  };
});

/** Environment-owned shells, reachable from any server feature, not only the ws layer. */
export class Shells extends Context.Service<
  Shells,
  Effect.Success<ReturnType<typeof makeShells>>
>()("t3/terminal/Shells") {}

export const layer = Layer.effect(
  Shells,
  Effect.gen(function* () {
    const manager = yield* TerminalManager;
    const crypto = yield* Crypto.Crypto;
    const { agentCommand } = yield* ServerConfig.ServerConfig;
    return yield* makeShells(manager, crypto.randomUUIDv4().pipe(Effect.orDie), {
      agentCommand: agentCommand ?? null,
    });
  }),
);
