import type { WorkspaceDetail, WorkspaceProjectGit } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { StartShellDialog } from "./StartShellDialog";

const repo = { path: "/repo", isGitRepository: true, exists: true };
const workspace: WorkspaceDetail = {
  name: "sparta",
  projects: [repo],
  lastStarts: {},
  tabs: { shellIds: [], active: null },
};

const git: WorkspaceProjectGit = {
  hasCommit: true,
  currentBranch: "main",
  worktrees: [
    { path: "/repo", branch: "main", head: "0123456789", isMain: true },
    { path: "/wt/linked", branch: "linked", head: "0123456789", isMain: false },
  ],
  branches: ["main", "linked"],
  proposedWorktreeName: "probe-worktree-abc123",
  worktreesError: null,
  branchesError: null,
};

const renderDialog = (projectGit: WorkspaceProjectGit) => {
  const onStart = vi.fn(async () => null);
  return render(
    <StartShellDialog
      project={repo}
      onOpenChange={() => undefined}
      workspace={workspace}
      loadGit={async () => ({ git: projectGit })}
      loadScripts={async () => []}
      onStart={onStart}
    />,
  ).then((screen) => ({ screen, onStart }));
};

const createButton = () => page.getByRole("button", { name: "Create shell" });

describe("StartShellDialog", () => {
  it("shows a failed worktree listing and still starts in the project's folder", async () => {
    const { screen, onStart } = await renderDialog({
      ...git,
      worktrees: [],
      worktreesError: "git is unavailable",
    });
    await using _screen = screen;

    await expect
      .element(page.getByText(/worktrees could not be listed: git is unavailable/))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Fork" })).toBeEnabled();
    await expect.element(createButton()).toBeEnabled();
    // Playwright never sees the dialog's footer as stable here; a DOM click submits the same form.
    (createButton().element() as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith("/repo", { kind: "checkout" }, null));
  });

  it("does not create a worktree while its origins cannot be listed", async () => {
    const { screen, onStart } = await renderDialog({
      ...git,
      branches: [],
      branchesError: "git is unavailable",
    });
    await using _screen = screen;

    await userEvent.click(page.getByRole("button", { name: "Fork" }));

    await expect.element(page.getByText(/starting points could not be listed/)).toBeVisible();
    await expect.element(createButton()).toBeDisabled();
    expect(onStart).not.toHaveBeenCalled();
  });
});
