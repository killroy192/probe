import type {
  ShellSummary,
  WorkspaceFolderGit,
  WorkspaceLastStart,
  WorkspaceStartingPoint,
  WorkspaceWorktree,
  WorkspaceWorktreeChoice,
} from "@t3tools/contracts";

import { folderName } from "./shellName";

/** The worktree step's choice; a new worktree gets its name when the shell starts. */
export type WorktreeSelection =
  | { readonly kind: "checkout" }
  | { readonly kind: "existing"; readonly path: string }
  | { readonly kind: "new" };

export interface StartingPointOption {
  readonly key: string;
  readonly point: WorkspaceStartingPoint;
  readonly label: string;
}

const CHECKOUT: WorktreeSelection = { kind: "checkout" };

const shortHash = (head: string) => head.slice(0, 7);

/** What the tree and the dialogs call a repository's original worktree, its own folder. */
export const PRIMARY = "primary";

/** "primary · main", or a linked worktree's folder name plus its branch when that differs. */
export function worktreeLabel(
  worktree: Pick<WorkspaceWorktree, "path" | "branch" | "head" | "isMain">,
): string {
  const branch = worktree.branch ?? shortHash(worktree.head);
  if (worktree.isMain) return `${PRIMARY} · ${branch}`;
  const name = folderName(worktree.path);
  return branch === name ? name : `${name} · ${branch}`;
}

/** A shell the tree shows; an ended one leaves the tree (EC-14). */
export const isActiveShell = (shell: ShellSummary) =>
  shell.status === "running" || shell.status === "starting";

const startingPointKey = (point: WorkspaceStartingPoint) =>
  point.kind === "branch" ? `branch:${point.name}` : `worktree:${point.path}`;

/**
 * Linked worktrees first, then every local branch as a branch of the primary worktree, its
 * checked-out one first and marked "(current)". A detached primary is offered by its commit.
 */
export function startingPoints(git: WorkspaceFolderGit): ReadonlyArray<StartingPointOption> {
  const linked = git.worktrees
    .filter((worktree) => !worktree.isMain)
    .map((worktree) => {
      const point = { kind: "worktree", path: worktree.path } as const;
      return { key: startingPointKey(point), point, label: worktreeLabel(worktree) };
    });
  const primary = git.worktrees.find((worktree) => worktree.isMain);
  const detachedPrimary =
    git.currentBranch === null && primary !== undefined
      ? [
          {
            key: startingPointKey({ kind: "worktree", path: primary.path }),
            point: { kind: "worktree", path: primary.path } as const,
            label: `${worktreeLabel(primary)} (current)`,
          },
        ]
      : [];
  const branches = [
    ...git.branches.filter((name) => name === git.currentBranch),
    ...git.branches.filter((name) => name !== git.currentBranch),
  ].map((name) => {
    const point = { kind: "branch", name } as const;
    const current = name === git.currentBranch ? " (current)" : "";
    return { key: startingPointKey(point), point, label: `${PRIMARY} · ${name}${current}` };
  });
  return [...linked, ...detachedPrimary, ...branches];
}

/**
 * The worktree and starting point shown for `folder`: the user's own picks first, then the last
 * start when it was in this folder and is still possible (EC-3, EC-4, EC-5), else the defaults.
 */
export function resolveSelection(input: {
  readonly folder: string;
  readonly git: WorkspaceFolderGit;
  readonly lastStart: WorkspaceLastStart | null;
  readonly chosenWorktree: WorktreeSelection | null;
  readonly chosenStartingPoint: string | null;
}): { readonly worktree: WorktreeSelection; readonly startingPoint: string | null } {
  const { git } = input;
  const points = startingPoints(git);
  const isPossible = (selection: WorktreeSelection) =>
    selection.kind === "checkout" ||
    (selection.kind === "existing" &&
      git.worktrees.some((worktree) => !worktree.isMain && worktree.path === selection.path)) ||
    (selection.kind === "new" && git.hasCommit);
  const hasPoint = (key: string | null) =>
    key !== null && points.some((point) => point.key === key);

  const remembered = input.lastStart?.folder === input.folder ? input.lastStart.worktree : null;
  const worktree =
    input.chosenWorktree !== null && isPossible(input.chosenWorktree)
      ? input.chosenWorktree
      : remembered !== null && isPossible(remembered)
        ? remembered.kind === "new"
          ? ({ kind: "new" } as const)
          : remembered
        : CHECKOUT;

  const rememberedPoint =
    remembered?.kind === "new" ? startingPointKey(remembered.startingPoint) : null;
  const primary = git.worktrees.find((worktree) => worktree.isMain);
  const currentBranch =
    git.currentBranch !== null
      ? startingPointKey({ kind: "branch", name: git.currentBranch })
      : primary === undefined
        ? null
        : startingPointKey({ kind: "worktree", path: primary.path });
  const startingPoint = [input.chosenStartingPoint, rememberedPoint, currentBranch].find(hasPoint);
  return { worktree, startingPoint: startingPoint ?? points[0]?.key ?? null };
}

/** What the server is asked for, or null while a new worktree has no starting point. */
export function toChoice(
  git: WorkspaceFolderGit,
  selection: { readonly worktree: WorktreeSelection; readonly startingPoint: string | null },
): WorkspaceWorktreeChoice | null {
  if (selection.worktree.kind !== "new") return selection.worktree;
  const point = startingPoints(git).find((option) => option.key === selection.startingPoint);
  return point === undefined
    ? null
    : { kind: "new", name: git.proposedWorktreeName, startingPoint: point.point };
}
