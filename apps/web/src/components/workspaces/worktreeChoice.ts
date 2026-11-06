import type {
  ShellSummary,
  WorkspaceFolderGit,
  WorkspaceLastStart,
  WorkspaceStartingPoint,
  WorkspaceWorktree,
  WorkspaceWorktreeChoice,
} from "@t3tools/contracts";

import { folderName } from "./shellName";

/** What the tree and the dialogs call a repository's original worktree, its own folder. */
const PRIMARY = "primary";

export type WorktreeMode = "existing" | "new";

/** A dropdown item: the branch, and below it the linked worktree that has it checked out. */
export interface WorktreeOption {
  readonly key: string;
  readonly kind: "worktree" | "branch";
  /** The branch, or the short commit id of a detached HEAD. */
  readonly title: string;
  /** "<name> worktree" for a linked worktree; null for the primary worktree and for branches. */
  readonly worktree: string | null;
}

interface StartingPointOption extends WorktreeOption {
  readonly point: WorkspaceStartingPoint;
}

/** The create-shell modal's picks: start in an existing worktree, or fork a new one. */
export interface ShellPlace {
  readonly mode: WorktreeMode;
  /** The existing worktree's path; null when the worktrees could not be listed. */
  readonly worktree: string | null;
  /** The new worktree's origin, as a `startingPoints` key. */
  readonly startingPoint: string | null;
}

const shortHash = (head: string) => head.slice(0, 7);

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

const worktreeOption = (key: string, worktree: WorkspaceWorktree, suffix = ""): WorktreeOption => ({
  key,
  // The primary worktree is shown as its branch, like the branches it can fork from.
  kind: worktree.isMain ? "branch" : "worktree",
  title: `${worktree.branch ?? shortHash(worktree.head)}${suffix}`,
  worktree: worktree.isMain ? null : `${folderName(worktree.path)} worktree`,
});

/** Where an existing-worktree start can run: the primary worktree first, then the linked ones. */
export function existingWorktrees(git: WorkspaceFolderGit): ReadonlyArray<WorktreeOption> {
  return [
    ...git.worktrees.filter((worktree) => worktree.isMain),
    ...git.worktrees.filter((worktree) => !worktree.isMain),
  ].map((worktree) => worktreeOption(worktree.path, worktree));
}

const startingPointKey = (point: WorkspaceStartingPoint) =>
  point.kind === "branch" ? `branch:${point.name}` : `worktree:${point.path}`;

/**
 * What a fork can start from: linked worktrees, then every local branch (forked from the primary
 * worktree's repository), the primary's checked-out one first and marked "(current)". A
 * detached primary is offered by its commit.
 */
export function startingPoints(git: WorkspaceFolderGit): ReadonlyArray<StartingPointOption> {
  const linkedWorktrees = git.worktrees.filter((worktree) => !worktree.isMain);
  const checkedOut = new Set(git.worktrees.flatMap((worktree) => worktree.branch ?? []));
  const branchPoint = (name: string, worktree: string | null, current = false) => {
    const point = { kind: "branch", name } as const;
    return {
      key: startingPointKey(point),
      point,
      kind: worktree === null ? ("branch" as const) : ("worktree" as const),
      title: current ? `${name} (current)` : name,
      worktree,
    };
  };
  // A branch named like a linked worktree's folder reads as that worktree's, so it is listed
  // with it; a branch a linked worktree has checked out is only listed as that worktree.
  const grouped = new Set<string>();
  const linked = linkedWorktrees.flatMap((worktree) => {
    const point = { kind: "worktree", path: worktree.path } as const;
    const name = folderName(worktree.path);
    const own = { ...worktreeOption(startingPointKey(point), worktree), point };
    if (worktree.branch === name || checkedOut.has(name) || !git.branches.includes(name)) {
      return [own];
    }
    grouped.add(name);
    return [own, branchPoint(name, `${name} worktree`)];
  });
  const primary = git.worktrees.find((worktree) => worktree.isMain);
  const detachedPrimary =
    git.currentBranch === null && primary !== undefined
      ? [
          {
            ...worktreeOption(
              startingPointKey({ kind: "worktree", path: primary.path }),
              primary,
              " (current)",
            ),
            point: { kind: "worktree", path: primary.path } as const,
          },
        ]
      : [];
  const inLinked = new Set(linkedWorktrees.flatMap((worktree) => worktree.branch ?? []));
  const free = git.branches.filter(
    (name) => !grouped.has(name) && (!inLinked.has(name) || name === git.currentBranch),
  );
  const branches = [
    ...free.filter((name) => name === git.currentBranch),
    ...free.filter((name) => name !== git.currentBranch),
  ].map((name) => branchPoint(name, null, name === git.currentBranch));
  return [...linked, ...detachedPrimary, ...branches];
}

/**
 * The modal's picks for `folder`: the user's own first, then the last start when it was in this
 * folder and is still possible (EC-3, EC-4, EC-5), else an existing start in the primary worktree.
 */
export function resolvePlace(input: {
  readonly folder: string;
  readonly git: WorkspaceFolderGit;
  readonly lastStart: WorkspaceLastStart | null;
  readonly chosenMode: WorktreeMode | null;
  readonly chosenWorktree: string | null;
  readonly chosenStartingPoint: string | null;
}): ShellPlace {
  const { git } = input;
  const existing = existingWorktrees(git);
  const points = startingPoints(git);
  const remembered = input.lastStart?.folder === input.folder ? input.lastStart.worktree : null;
  const primary = git.worktrees.find((worktree) => worktree.isMain)?.path ?? null;

  const wantsNew =
    input.chosenMode !== null ? input.chosenMode === "new" : remembered?.kind === "new";
  const mode: WorktreeMode = wantsNew && git.hasCommit ? "new" : "existing";

  const isWorktree = (path: string | null) =>
    path !== null && existing.some((option) => option.key === path);
  const rememberedWorktree =
    remembered?.kind === "existing"
      ? remembered.path
      : remembered?.kind === "checkout"
        ? primary
        : null;
  const worktree =
    [input.chosenWorktree, rememberedWorktree, primary].find(isWorktree) ??
    existing[0]?.key ??
    null;

  const hasPoint = (key: string | null) =>
    key !== null && points.some((point) => point.key === key);
  const rememberedPoint =
    remembered?.kind === "new" ? startingPointKey(remembered.startingPoint) : null;
  const current =
    git.currentBranch !== null
      ? startingPointKey({ kind: "branch", name: git.currentBranch })
      : primary === null
        ? null
        : startingPointKey({ kind: "worktree", path: primary });
  const startingPoint =
    [input.chosenStartingPoint, rememberedPoint, current].find(hasPoint) ?? points[0]?.key ?? null;

  return { mode, worktree, startingPoint };
}

/** What the server is asked for, or null while a new worktree has no origin. */
export function toChoice(
  git: WorkspaceFolderGit,
  place: ShellPlace,
): WorkspaceWorktreeChoice | null {
  if (place.mode === "existing") {
    const isPrimary = git.worktrees.some(
      (worktree) => worktree.isMain && worktree.path === place.worktree,
    );
    // A repository whose worktrees could not be listed can still start in its own folder.
    return place.worktree === null || isPrimary
      ? { kind: "checkout" }
      : { kind: "existing", path: place.worktree };
  }
  const point = startingPoints(git).find((option) => option.key === place.startingPoint);
  return point === undefined
    ? null
    : { kind: "new", name: git.proposedWorktreeName, startingPoint: point.point };
}
