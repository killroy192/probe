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
  // Starts the server's configured agent command as the shell's first input.
  agent: Schema.optional(Schema.Boolean),
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

export const ShellListStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), shells: Schema.Array(ShellSummary) }),
  Schema.Struct({ type: Schema.Literal("upsert"), shell: ShellSummary }),
  Schema.Struct({ type: Schema.Literal("remove"), shellId: ShellId }),
]);
export type ShellListStreamEvent = typeof ShellListStreamEvent.Type;
