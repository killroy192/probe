import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  SHELL_OWNER_PREFIX,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionStatus,
  TerminalWriteInput,
} from "./terminal.ts";

// A shell is a terminal owned by the environment, not by a chat thread. The server allocates its id.
export const ShellId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ShellId = typeof ShellId.Type;

// Terminals are keyed by an opaque owner id; the prefix keeps shell owners disjoint from thread ids.
export const shellOwnerId = (shellId: string) => `${SHELL_OWNER_PREFIX}${shellId}`;
export const isShellOwnerId = (ownerId: string) => ownerId.startsWith(SHELL_OWNER_PREFIX);
export const shellIdFromOwnerId = (ownerId: string) =>
  isShellOwnerId(ownerId) ? ownerId.slice(SHELL_OWNER_PREFIX.length) : null;

export const ShellOpenInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  cols: TerminalOpenInput.fields.cols,
  rows: TerminalOpenInput.fields.rows,
  env: TerminalOpenInput.fields.env,
});
export type ShellOpenInput = typeof ShellOpenInput.Type;

export const ShellInput = Schema.Struct({ shellId: ShellId });
export type ShellInput = typeof ShellInput.Type;

export const ShellAttachInput = Schema.Struct({
  shellId: ShellId,
  cols: TerminalOpenInput.fields.cols,
  rows: TerminalOpenInput.fields.rows,
});
export type ShellAttachInput = typeof ShellAttachInput.Type;

export const ShellWriteInput = Schema.Struct({
  shellId: ShellId,
  data: TerminalWriteInput.fields.data,
});
export type ShellWriteInput = typeof ShellWriteInput.Type;

export const ShellResizeInput = Schema.Struct({
  shellId: ShellId,
  cols: TerminalResizeInput.fields.cols,
  rows: TerminalResizeInput.fields.rows,
});
export type ShellResizeInput = typeof ShellResizeInput.Type;

export const ShellEndReason = Schema.Literals(["signal", "lost"]);
export type ShellEndReason = typeof ShellEndReason.Type;

export const ShellSummary = Schema.Struct({
  shellId: ShellId,
  cwd: Schema.String.check(Schema.isNonEmpty()),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  label: Schema.String.check(Schema.isMaxLength(128)),
  /** A fixed name such as "Shell 2", numbered within the workspace that started the shell. */
  title: Schema.NullOr(Schema.String),
  /** The short name of the program running in the shell right now, or null when it is idle. */
  process: Schema.NullOr(Schema.String),
  /** The workspace project the shell was started for. */
  project: Schema.NullOr(Schema.String),
  /** The worktree the shell was started in; null outside git. */
  worktree: Schema.NullOr(Schema.String),
  /** That worktree's current branch, or its short commit id when detached. */
  branch: Schema.NullOr(Schema.String),
  /** The shell's current folder while it is outside its worktree (or project), else null. */
  elsewhere: Schema.NullOr(Schema.String),
  /**
   * Why an ended shell is still listed: a signal ended it, or it was lost with the process that
   * held it (a reboot). Null while it runs. A normal exit or a kill removes a shell instead.
   */
  ended: Schema.NullOr(ShellEndReason),
  /** True once the project or worktree the shell was started in is gone from disk. */
  missing: Schema.Boolean,
  /** True once the user restored this shell after it ended; it is a new process in the same place. */
  restored: Schema.Boolean,
  updatedAt: Schema.String,
});
export type ShellSummary = typeof ShellSummary.Type;

export class ShellLaunchError extends Schema.TaggedError<ShellLaunchError>()("ShellLaunchError", {
  reason: Schema.String,
}) {
  override get message() {
    return `The shell could not start: ${this.reason}`;
  }
}

/** The server could not save its list of shells, so the change was not made. */
export class ShellStorageError extends Schema.TaggedError<ShellStorageError>()(
  "ShellStorageError",
  { reason: Schema.String },
) {
  override get message() {
    return `Probe could not save its shells: ${this.reason}`;
  }
}

export const ShellListStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), shells: Schema.Array(ShellSummary) }),
  Schema.Struct({ type: Schema.Literal("upsert"), shell: ShellSummary }),
  Schema.Struct({ type: Schema.Literal("remove"), shellId: ShellId }),
]);
export type ShellListStreamEvent = typeof ShellListStreamEvent.Type;
