import type { WorkspaceFolderGit, WorkspaceLastStart } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSelection, startingPoints, toChoice, worktreeLabel } from "./worktreeChoice";

const HEAD = "0123456789abcdef";
const git: WorkspaceFolderGit = {
  hasCommit: true,
  currentBranch: "main",
  worktrees: [
    { path: "/repo", branch: "main", head: HEAD, isMain: true },
    { path: "/wt/topic", branch: "topic", head: HEAD, isMain: false },
    { path: "/wt/free", branch: "feature", head: HEAD, isMain: false },
    { path: "/wt/detached", branch: null, head: HEAD, isMain: false },
  ],
  branches: ["feature", "main", "other", "topic"],
  proposedWorktreeName: "probe-worktree-abc123",
  worktreesError: null,
  branchesError: null,
};

const resolve = (
  lastStart: WorkspaceLastStart | null,
  overrides: Partial<Parameters<typeof resolveSelection>[0]> = {},
) =>
  resolveSelection({
    folder: "/repo",
    git,
    lastStart,
    chosenWorktree: null,
    chosenStartingPoint: null,
    ...overrides,
  });

describe("worktree choice", () => {
  it("names the primary worktree, and a linked one by its folder and differing branch", () => {
    expect(git.worktrees.map(worktreeLabel)).toEqual([
      "primary · main",
      "topic",
      "free · feature",
      "detached · 0123456",
    ]);
  });

  it("offers linked worktrees, then every branch of the primary, its current one first", () => {
    expect(startingPoints(git).map((point) => point.label)).toEqual([
      "topic",
      "free · feature",
      "detached · 0123456",
      "primary · main (current)",
      "primary · feature",
      "primary · other",
      "primary · topic",
    ]);
    const detachedPrimary = {
      ...git,
      currentBranch: null,
      worktrees: [{ path: "/repo", branch: null, head: HEAD, isMain: true }],
    };
    expect(startingPoints(detachedPrimary).map((point) => point.label)).toContain(
      "primary · 0123456 (current)",
    );
    expect(resolve(null, { git: detachedPrimary, chosenWorktree: { kind: "new" } })).toEqual({
      worktree: { kind: "new" },
      startingPoint: "worktree:/repo",
    });
  });

  it.each([
    ["no earlier start", null, { worktree: { kind: "checkout" }, startingPoint: "branch:main" }],
    [
      "a new worktree from a branch",
      {
        folder: "/repo",
        worktree: { kind: "new", startingPoint: { kind: "branch", name: "other" } },
      },
      { worktree: { kind: "new" }, startingPoint: "branch:other" },
    ],
    [
      "a starting point that is gone",
      {
        folder: "/repo",
        worktree: { kind: "new", startingPoint: { kind: "branch", name: "gone" } },
      },
      { worktree: { kind: "new" }, startingPoint: "branch:main" },
    ],
    [
      "a linked worktree, even one that has shells",
      { folder: "/repo", worktree: { kind: "existing", path: "/wt/topic" } },
      { worktree: { kind: "existing", path: "/wt/topic" }, startingPoint: "branch:main" },
    ],
    [
      "a worktree removed from disk",
      { folder: "/repo", worktree: { kind: "existing", path: "/wt/removed" } },
      { worktree: { kind: "checkout" }, startingPoint: "branch:main" },
    ],
    [
      "another folder",
      {
        folder: "/other",
        worktree: { kind: "new", startingPoint: { kind: "branch", name: "other" } },
      },
      { worktree: { kind: "checkout" }, startingPoint: "branch:main" },
    ],
  ] as const)("preselects after %s", (_name, lastStart, expected) => {
    expect(resolve(lastStart)).toEqual(expected);
  });

  it("keeps the user's picks over the remembered start, and offers no new worktree without a commit", () => {
    const remembered: WorkspaceLastStart = {
      folder: "/repo",
      worktree: { kind: "new", startingPoint: { kind: "branch", name: "other" } },
    };
    expect(
      resolve(remembered, {
        chosenWorktree: { kind: "new" },
        chosenStartingPoint: "worktree:/wt/detached",
      }),
    ).toEqual({ worktree: { kind: "new" }, startingPoint: "worktree:/wt/detached" });
    expect(resolve(remembered, { git: { ...git, hasCommit: false } }).worktree).toEqual({
      kind: "checkout",
    });
  });

  it("asks for the proposed name and the picked starting point", () => {
    expect(
      toChoice(git, { worktree: { kind: "new" }, startingPoint: "worktree:/wt/detached" }),
    ).toEqual({
      kind: "new",
      name: "probe-worktree-abc123",
      startingPoint: { kind: "worktree", path: "/wt/detached" },
    });
    expect(
      toChoice(
        { ...git, branches: [], worktrees: [] },
        { worktree: { kind: "new" }, startingPoint: null },
      ),
    ).toBeNull();
  });
});
