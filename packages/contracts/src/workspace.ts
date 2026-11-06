import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { TerminalOpenInput } from "./terminal.ts";

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

/** Why `name` cannot name a new folder, as a sentence for the user, or null when it can. */
export function folderNameProblem(name: string): string | null {
  // A workspace name is already a portable single file name, which is what a folder needs.
  return workspaceNameProblem(name);
}

export const WorkspaceFolderName = TrimmedString.check(
  Schema.makeFilter((name: string) => folderNameProblem(name) === null, {
    expected: "a folder name that is valid on every file system",
  }),
);

export const WorkspaceInput = Schema.Struct({ name: WorkspaceName });
export type WorkspaceInput = typeof WorkspaceInput.Type;

export const WorkspaceSummary = Schema.Struct({ name: WorkspaceName });
export type WorkspaceSummary = typeof WorkspaceSummary.Type;

export const WorkspaceWorktree = Schema.Struct({
  path: Schema.String,
  /** Null on a detached HEAD. */
  branch: Schema.NullOr(Schema.String),
  /** The full commit id of its HEAD. */
  head: Schema.String,
  /** The repository's primary worktree: the folder itself. */
  isMain: Schema.Boolean,
});
export type WorkspaceWorktree = typeof WorkspaceWorktree.Type;

/** A git folder's worktree as the tree knows it; a hidden one keeps running shells out of view. */
export const WorkspaceFolderWorktree = Schema.Struct({
  ...WorkspaceWorktree.fields,
  visible: Schema.Boolean,
});
export type WorkspaceFolderWorktree = typeof WorkspaceFolderWorktree.Type;

export const WorkspaceFolder = Schema.Struct({
  path: Schema.String.check(Schema.isNonEmpty()),
  isGitRepository: Schema.Boolean,
  /** False once the folder is gone from disk; it stays in the workspace but cannot start shells. */
  exists: Schema.Boolean,
  /** A git folder's worktrees, its primary one first; null outside git or when unreadable. */
  worktrees: Schema.NullOr(Schema.Array(WorkspaceFolderWorktree)),
});
export type WorkspaceFolder = typeof WorkspaceFolder.Type;

/** The name Probe gives a new worktree and its branch. */
export const WorkspaceWorktreeName = Schema.String.check(
  Schema.isPattern(/^probe-worktree-[0-9a-f]{6}$/),
);

/** What a new worktree forks from: a local branch, or another worktree's current commit. */
export const WorkspaceStartingPoint = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("branch"), name: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("worktree"), path: TrimmedNonEmptyString }),
]);
export type WorkspaceStartingPoint = typeof WorkspaceStartingPoint.Type;

const CheckoutChoice = Schema.Struct({ kind: Schema.Literal("checkout") });
const ExistingWorktreeChoice = Schema.Struct({
  kind: Schema.Literal("existing"),
  path: TrimmedNonEmptyString,
});

/** Where a shell starts in a git folder: its primary worktree, a linked one, or a new one. */
export const WorkspaceWorktreeChoice = Schema.Union([
  CheckoutChoice,
  ExistingWorktreeChoice,
  Schema.Struct({
    kind: Schema.Literal("new"),
    name: WorkspaceWorktreeName,
    startingPoint: WorkspaceStartingPoint,
  }),
]);
export type WorkspaceWorktreeChoice = typeof WorkspaceWorktreeChoice.Type;

/** The last successful start; a new worktree is remembered by its starting point, not its name. */
export const WorkspaceLastStart = Schema.Struct({
  folder: Schema.String,
  worktree: Schema.Union([
    CheckoutChoice,
    ExistingWorktreeChoice,
    Schema.Struct({ kind: Schema.Literal("new"), startingPoint: WorkspaceStartingPoint }),
  ]),
});
export type WorkspaceLastStart = typeof WorkspaceLastStart.Type;

export const WorkspaceDetail = Schema.Struct({
  name: WorkspaceName,
  folders: Schema.Array(WorkspaceFolder),
  lastStart: Schema.NullOr(WorkspaceLastStart),
});
export type WorkspaceDetail = typeof WorkspaceDetail.Type;

export const WorkspaceAddFolderInput = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("import"),
    name: WorkspaceName,
    path: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    mode: Schema.Literal("create"),
    name: WorkspaceName,
    parentPath: TrimmedNonEmptyString,
    folderName: WorkspaceFolderName,
  }),
]);
export type WorkspaceAddFolderInput = typeof WorkspaceAddFolderInput.Type;

export const WorkspaceAddFolderResult = Schema.Struct({
  workspace: WorkspaceDetail,
  /** The added folder's path as the server stores it. */
  folder: Schema.String,
  /** The imported path when it was a linked worktree and its repository was added instead. */
  resolvedFrom: Schema.NullOr(Schema.String),
});
export type WorkspaceAddFolderResult = typeof WorkspaceAddFolderResult.Type;

export const WorkspaceStartShellInput = Schema.Struct({
  name: WorkspaceName,
  folder: TrimmedNonEmptyString,
  /** Absent for a folder that is not a git repository, and the same as its own checkout. */
  worktree: Schema.optional(WorkspaceWorktreeChoice),
  cols: TerminalOpenInput.fields.cols,
  rows: TerminalOpenInput.fields.rows,
});
export type WorkspaceStartShellInput = typeof WorkspaceStartShellInput.Type;

export const WorkspaceFolderGitInput = Schema.Struct({
  name: WorkspaceName,
  folder: TrimmedNonEmptyString,
});
export type WorkspaceFolderGitInput = typeof WorkspaceFolderGitInput.Type;


/** What the worktree and starting-point steps offer for one git folder. */
export const WorkspaceFolderGit = Schema.Struct({
  hasCommit: Schema.Boolean,
  /** Null on a detached HEAD or when it cannot be read. */
  currentBranch: Schema.NullOr(Schema.String),
  worktrees: Schema.Array(WorkspaceWorktree),
  /** Local branches only. */
  branches: Schema.Array(Schema.String),
  /** Free right now; a start re-checks it and draws another if it was taken meanwhile. */
  proposedWorktreeName: WorkspaceWorktreeName,
  worktreesError: Schema.NullOr(Schema.String),
  branchesError: Schema.NullOr(Schema.String),
});
export type WorkspaceFolderGit = typeof WorkspaceFolderGit.Type;

export const WorkspaceWorktreeVisibilityInput = Schema.Struct({
  name: WorkspaceName,
  folder: TrimmedNonEmptyString,
  worktree: TrimmedNonEmptyString,
  visible: Schema.Boolean,
});
export type WorkspaceWorktreeVisibilityInput = typeof WorkspaceWorktreeVisibilityInput.Type;

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
  { operation: Schema.Literals(["create", "remove", "list", "update"]), reason: Schema.String },
) {
  override get message() {
    return `Could not ${this.operation} the workspace: ${this.reason}`;
  }
}

/** A folder could not be added to a workspace, or a shell could not start in it. */
export class WorkspaceFolderError extends Schema.TaggedError<WorkspaceFolderError>()(
  "WorkspaceFolderError",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason;
  }
}
