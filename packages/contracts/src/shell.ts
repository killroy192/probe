import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionStatus,
  TerminalWriteInput,
} from "./terminal.ts";

// A shell is a terminal owned by the environment, not by a chat thread. The server allocates its id.
export const ShellId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ShellId = typeof ShellId.Type;

// Terminals are keyed by an opaque owner id; the prefix keeps shell owners disjoint from thread ids.
const SHELL_OWNER_PREFIX = "shell:";
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

export const ShellSummary = Schema.Struct({
  shellId: ShellId,
  cwd: Schema.String.check(Schema.isNonEmpty()),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  label: Schema.String.check(Schema.isMaxLength(128)),
  updatedAt: Schema.String,
});
export type ShellSummary = typeof ShellSummary.Type;

export const ShellListStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), shells: Schema.Array(ShellSummary) }),
  Schema.Struct({ type: Schema.Literal("upsert"), shell: ShellSummary }),
  Schema.Struct({ type: Schema.Literal("remove"), shellId: ShellId }),
]);
export type ShellListStreamEvent = typeof ShellListStreamEvent.Type;
