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
import * as Effect from "effect/Effect";

import type { TerminalManager } from "./Manager.ts";

type Manager = TerminalManager["Service"];

// A shell is one terminal owned by `shell:<id>` instead of a chat thread.
const toSummary = (
  shellId: string,
  terminal: TerminalSessionSnapshot | TerminalSummary,
): ShellSummary => ({
  shellId,
  cwd: terminal.cwd,
  status: terminal.status,
  pid: terminal.pid,
  exitCode: terminal.exitCode,
  exitSignal: terminal.exitSignal,
  label: terminal.label,
  updatedAt: terminal.updatedAt,
});

const listEvent = (event: TerminalMetadataStreamEvent): ShellListStreamEvent | null => {
  switch (event.type) {
    case "snapshot":
      return {
        type: "snapshot",
        shells: event.terminals.flatMap((terminal) => {
          const shellId = shellIdFromOwnerId(terminal.threadId);
          return shellId === null ? [] : [toSummary(shellId, terminal)];
        }),
      };
    case "upsert": {
      const shellId = shellIdFromOwnerId(event.terminal.threadId);
      return shellId === null
        ? null
        : { type: "upsert", shell: toSummary(shellId, event.terminal) };
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

export const makeShells = (manager: Manager, newShellId: Effect.Effect<string>) => {
  const session = (shellId: string) => ({
    threadId: shellOwnerId(shellId),
    terminalId: DEFAULT_TERMINAL_ID,
  });

  return {
    // A shell that cannot start is not kept: the caller gets the launch error's reason instead.
    open: Effect.fn("Shells.open")(function* (input: ShellOpenInput) {
      const shellId = yield* newShellId;
      const owner = session(shellId);
      let reason = "The shell program could not be launched.";
      const stop = yield* manager.subscribe((event) =>
        Effect.sync(() => {
          if (event.type === "error" && event.threadId === owner.threadId) reason = event.message;
        }),
      );
      const snapshot = yield* manager
        .open({ ...owner, ...input })
        .pipe(Effect.ensuring(Effect.sync(stop)));
      if (snapshot.status !== "error") return toSummary(shellId, snapshot);
      yield* manager.close({ ...owner, deleteHistory: true });
      return yield* new ShellLaunchError({ reason });
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
    close: (input: ShellInput) => manager.close({ ...session(input.shellId), deleteHistory: true }),
    subscribe: (listener: (event: ShellListStreamEvent) => Effect.Effect<void>) =>
      manager.subscribeMetadata((event) => {
        const mapped = listEvent(event);
        return mapped === null ? Effect.void : listener(mapped);
      }),
  };
};
