import type { StartingScript, WorkspaceProjectGit, WorkspaceLastStart } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  existingWorktrees,
  PLAIN_SHELL,
  preselectedScript,
  resolvePlace,
  startingPoints,
  toChoice,
  type WorktreeOption,
} from "./worktreeChoice";

const HEAD = "0123456789abcdef";
const git: WorkspaceProjectGit = {
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
  overrides: Partial<Parameters<typeof resolvePlace>[0]> = {},
) =>
  resolvePlace({
    project: "/repo",
    git,
    lastStart,
    chosenMode: null,
    chosenWorktree: null,
    chosenStartingPoint: null,
    ...overrides,
  });

const fromOther: WorkspaceLastStart = {
  worktree: { kind: "new", startingPoint: { kind: "branch", name: "other" } },
};

describe("worktree choice", () => {
  const lines = (options: ReadonlyArray<WorktreeOption>) =>
    options.map((option) => [option.kind, option.title, option.worktree]);

  it("lists the primary worktree as its branch, then linked worktrees by branch and name", () => {
    expect(lines(existingWorktrees(git))).toEqual([
      ["branch", "main", null],
      ["worktree", "topic", "topic worktree"],
      ["worktree", "feature", "free worktree"],
      ["worktree", "0123456", "detached worktree"],
    ]);
  });

  it("offers linked worktrees, then every branch, the primary's current one first", () => {
    // "topic" and "feature" are checked out in linked worktrees, so they are not listed again.
    expect(lines(startingPoints(git))).toEqual([
      ["worktree", "topic", "topic worktree"],
      ["worktree", "feature", "free worktree"],
      ["worktree", "0123456", "detached worktree"],
      ["branch", "main (current)", null],
      ["branch", "other", null],
    ]);
    // A branch named like a linked worktree that has another branch checked out goes with it.
    const switched = {
      ...git,
      worktrees: [
        { path: "/repo", branch: "main", head: HEAD, isMain: true },
        { path: "/wt/wkt", branch: "wkt-new", head: HEAD, isMain: false },
      ],
      branches: ["main", "wkt", "wkt-new", "wkt-old"],
    };
    expect(lines(startingPoints(switched))).toEqual([
      ["worktree", "wkt-new", "wkt worktree"],
      ["worktree", "wkt", "wkt worktree"],
      ["branch", "main (current)", null],
      ["branch", "wkt-old", null],
    ]);
    expect(startingPoints(switched)[1]?.point).toEqual({ kind: "branch", name: "wkt" });
    const detachedPrimary = {
      ...git,
      currentBranch: null,
      worktrees: [{ path: "/repo", branch: null, head: HEAD, isMain: true }],
    };
    expect(lines(startingPoints(detachedPrimary))).toContainEqual([
      "branch",
      "0123456 (current)",
      null,
    ]);
    expect(resolve(null, { git: detachedPrimary, chosenMode: "new" }).startingPoint).toBe(
      "worktree:/repo",
    );
  });

  it.each([
    [
      "no earlier start",
      null,
      { mode: "existing", worktree: "/repo", startingPoint: "branch:main" },
    ],
    [
      "a new worktree from a branch",
      fromOther,
      { mode: "new", worktree: "/repo", startingPoint: "branch:other" },
    ],
    [
      "a starting point that is gone",
      {
        worktree: { kind: "new", startingPoint: { kind: "branch", name: "gone" } },
      },
      { mode: "new", worktree: "/repo", startingPoint: "branch:main" },
    ],
    [
      "a linked worktree",
      { worktree: { kind: "existing", path: "/wt/topic" } },
      { mode: "existing", worktree: "/wt/topic", startingPoint: "branch:main" },
    ],
    [
      "a worktree removed from disk",
      { worktree: { kind: "existing", path: "/wt/removed" } },
      { mode: "existing", worktree: "/repo", startingPoint: "branch:main" },
    ],
  ] as const)("preselects after %s", (_name, lastStart, expected) => {
    expect(resolve(lastStart)).toEqual(expected);
  });

  it("keeps the user's picks over the remembered start, and has no new mode without a commit", () => {
    expect(
      resolve(fromOther, { chosenMode: "new", chosenStartingPoint: "worktree:/wt/detached" }),
    ).toEqual({ mode: "new", worktree: "/repo", startingPoint: "worktree:/wt/detached" });
    expect(
      resolve(fromOther, { chosenMode: "existing", chosenWorktree: "/wt/free" }),
    ).toMatchObject({
      mode: "existing",
      worktree: "/wt/free",
    });
    expect(resolve(fromOther, { git: { ...git, hasCommit: false } }).mode).toBe("existing");
  });

  it("asks for the primary as its checkout, a linked worktree by path, or a new one", () => {
    const place = { startingPoint: "worktree:/wt/detached" } as const;
    expect(toChoice(git, { ...place, mode: "existing", worktree: "/repo" })).toEqual({
      kind: "checkout",
    });
    expect(toChoice(git, { ...place, mode: "existing", worktree: "/wt/topic" })).toEqual({
      kind: "existing",
      path: "/wt/topic",
    });
    expect(toChoice(git, { ...place, mode: "existing", worktree: null })).toEqual({
      kind: "checkout",
    });
    expect(toChoice(git, { ...place, mode: "new", worktree: "/repo" })).toEqual({
      kind: "new",
      name: "probe-worktree-abc123",
      startingPoint: { kind: "worktree", path: "/wt/detached" },
    });
    expect(
      toChoice(
        { ...git, branches: [], worktrees: [] },
        { mode: "new", worktree: null, startingPoint: null },
      ),
    ).toBeNull();
  });

  const scripts: ReadonlyArray<StartingScript> = [
    { id: "a", name: "mock agent", command: "mock" },
    { id: "b", name: "renamed", command: "claude" },
  ];
  const checkout = { kind: "checkout" } as const;

  it.each([
    ["no earlier start", null, PLAIN_SHELL],
    ["a plain start", { worktree: checkout }, PLAIN_SHELL],
    ["a script still in the list, renamed since", { worktree: checkout, script: "b" }, "b"],
    ["a script no longer in the list", { worktree: checkout, script: "gone" }, PLAIN_SHELL],
  ] as const)("preselects the starting script after %s", (_name, lastStart, expected) => {
    expect(preselectedScript(lastStart, scripts)).toBe(expected);
  });
});
