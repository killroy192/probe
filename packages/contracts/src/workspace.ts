import * as Schema from "effect/Schema";
import { TrimmedString } from "./baseSchemas.ts";

// A workspace is saved as one file named after it, so its name must be a portable file name.
const WORKSPACE_NAME_MAX_LENGTH = 64;
const FORBIDDEN_CHARACTERS = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"]);
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Why `name` cannot name a workspace, as a sentence for the user, or null when it can. */
export function workspaceNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Enter a name.";
  if (trimmed.length > WORKSPACE_NAME_MAX_LENGTH) {
    return `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`;
  }
  for (const character of trimmed) {
    if (FORBIDDEN_CHARACTERS.has(character) || character.charCodeAt(0) < 32) {
      return 'Leave out / \\ : * ? " < > | and control characters.';
    }
  }
  if (trimmed === "." || trimmed === ".." || trimmed.endsWith(".")) {
    return "Do not end the name with a dot.";
  }
  if (WINDOWS_RESERVED_NAME.test(trimmed)) return "This name is reserved by the file system.";
  return null;
}

export const WorkspaceName = TrimmedString.check(
  Schema.makeFilter((name: string) => workspaceNameProblem(name) === null, {
    expected: "a workspace name that is valid as a file name",
  }),
);
export type WorkspaceName = typeof WorkspaceName.Type;

export const WorkspaceInput = Schema.Struct({ name: WorkspaceName });
export type WorkspaceInput = typeof WorkspaceInput.Type;

export const WorkspaceSummary = Schema.Struct({ name: WorkspaceName });
export type WorkspaceSummary = typeof WorkspaceSummary.Type;

export const WorkspaceListEvent = Schema.Struct({
  workspaces: Schema.Array(WorkspaceSummary),
});
export type WorkspaceListEvent = typeof WorkspaceListEvent.Type;

export class WorkspaceNameTakenError extends Schema.TaggedError<WorkspaceNameTakenError>()(
  "WorkspaceNameTakenError",
  { name: Schema.String },
) {
  override get message() {
    return `A workspace named "${this.name}" already exists.`;
  }
}

export class WorkspaceNotFoundError extends Schema.TaggedError<WorkspaceNotFoundError>()(
  "WorkspaceNotFoundError",
  { name: Schema.String },
) {
  override get message() {
    return `There is no workspace named "${this.name}".`;
  }
}

export class WorkspaceInvalidError extends Schema.TaggedError<WorkspaceInvalidError>()(
  "WorkspaceInvalidError",
  { name: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Workspace "${this.name}" cannot be opened: ${this.reason}`;
  }
}

export class WorkspaceStorageError extends Schema.TaggedError<WorkspaceStorageError>()(
  "WorkspaceStorageError",
  { operation: Schema.Literals(["create", "remove", "list"]), reason: Schema.String },
) {
  override get message() {
    return `Could not ${this.operation} the workspace: ${this.reason}`;
  }
}
