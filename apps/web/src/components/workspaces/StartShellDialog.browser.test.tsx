import type { WorkspaceDetail, WorkspaceFolderGit } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { StartShellDialog } from "./StartShellDialog";

const workspace: WorkspaceDetail = {
  name: "sparta",
  folders: [{ path: "/repo", isGitRepository: true, exists: true, worktrees: null }],
  lastStart: null,
};

const git: WorkspaceFolderGit = {
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

const renderDialog = (folderGit: WorkspaceFolderGit) => {
  const onStart = vi.fn(async () => null);
  return render(
    <StartShellDialog
      open
      onOpenChange={() => undefined}
      workspace={workspace}
      loadGit={async () => ({ git: folderGit })}
      onStart={onStart}
    />,
  ).then((screen) => ({ screen, onStart }));
};

describe("StartShellDialog", () => {
  it("shows a failed worktree listing and still starts in the checkout or a new worktree", async () => {
    const { screen, onStart } = await renderDialog({
      ...git,
      worktrees: [],
      worktreesError: "git is unavailable",
    });
    await using _screen = screen;
    await userEvent.click(page.getByText("/repo", { exact: true }));

    await expect
      .element(page.getByText(/worktrees could not be listed: git is unavailable/))
      .toBeVisible();
    await expect.element(page.getByRole("radio", { name: /^primary · main/ })).toBeChecked();
    await expect.element(page.getByRole("radio", { name: /^New worktree/ })).toBeInTheDocument();
    expect(page.getByRole("radio", { name: /linked/ }).elements()).toHaveLength(0);

    const startButton = page.getByRole("button", { name: "Start shell" });
    await expect.element(startButton).toBeEnabled();
    // Playwright never sees the dialog's footer as stable here; a DOM click submits the same form.
    (startButton.element() as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledWith("/repo", { kind: "checkout" }));
  });

  it("does not start a new worktree while its starting points cannot be listed", async () => {
    const { screen, onStart } = await renderDialog({
      ...git,
      branches: [],
      branchesError: "git is unavailable",
    });
    await using _screen = screen;
    await userEvent.click(page.getByText("/repo", { exact: true }));

    await userEvent.click(page.getByText("New worktree", { exact: true }));

    await expect.element(page.getByText(/starting points could not be listed/)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Start shell" })).toBeDisabled();
    expect(onStart).not.toHaveBeenCalled();
  });
});
