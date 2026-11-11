import type { PointerPage } from "../../browser.ts";
import { waitFor } from "../waits.ts";
import { selectedShellTab } from "./tabs.ts";

/** A workspace's root row in the tree, there while the page shows that workspace. */
export const workspaceRoot = (page: PointerPage, name: string) =>
  page.getByRole("tree").getByRole("treeitem", { level: 1, name, exact: true });

/** Waits until the page shows the workspace `name`. */
export const workspaceShown = (page: PointerPage, name: string, when = "") =>
  waitFor(workspaceRoot(page, name), `the tree to show workspace ${name}${when}`);

/** A shell's ended row in the tree, for any reason or one. */
export const endedRow = (page: PointerPage, shellId: string, reason?: "signal" | "lost") =>
  page.locator(
    reason === undefined
      ? `[data-shell-id="${shellId}"][data-ended]`
      : `[data-shell-id="${shellId}"][data-ended="${reason}"]`,
  );

/** Shell rows in the tree, or under one folder; a git folder holds them under worktree nodes. */
export const shellNodes = (page: PointerPage, folder?: string) =>
  (folder === undefined
    ? page.getByRole("tree")
    : page.locator(`[data-project="${folder}"]`)
  ).locator("[data-shell-id]");

/** A shell's row in the tree, the row's button. */
export const shellRow = (page: PointerPage, shellId: string) =>
  page.getByRole("tree").locator(`[data-shell-id="${shellId}"]`);

/** A shell's whole tree row, with its hover actions. */
const rowWithActions = (page: PointerPage, shellId: string) =>
  page.locator(`[data-shell-row="${shellId}"]`);

/** The "Restore" an ended shell's row offers. */
export const restoreButton = (page: PointerPage, shellId: string) =>
  rowWithActions(page, shellId).getByRole("button", { name: /^Restore / });

/** Opens a shell's tab from the tree, or switches to it. */
export async function openFromTree(page: PointerPage, shellId: string) {
  await shellRow(page, shellId).click();
  await waitFor(selectedShellTab(page, shellId), `the tab of shell ${shellId} to be selected`);
}

/**
 * Clicks the "x" on a shell's tree row ("Kill", or "Remove" for an ended shell); the confirmation
 * is left open for the caller.
 */
export async function askToKill(page: PointerPage, shellId: string) {
  const row = rowWithActions(page, shellId);
  await row.hover();
  await row.getByRole("button", { name: /^(Kill|Remove) / }).click();
  await waitFor(page.getByRole("alertdialog"), `the confirmation for shell ${shellId}`);
}

export async function answerConfirm(page: PointerPage, answer: "Confirm" | "Cancel") {
  await page.getByRole("alertdialog").getByRole("button", { name: answer, exact: true }).click();
  await waitFor(page.getByRole("alertdialog"), `the confirmation to close on ${answer}`, {
    state: "detached",
  });
}

/** Kills a shell from the tree, or removes an ended one, and waits for its row to leave. */
export async function killFromTree(page: PointerPage, shellId: string) {
  await askToKill(page, shellId);
  await answerConfirm(page, "Confirm");
  await waitFor(rowWithActions(page, shellId), `the row of shell ${shellId} to leave the tree`, {
    state: "detached",
  });
}

/** Clicks the "Restore" a row offers once it has ended; the row must stop being ended. */
export async function restoreFromTree(page: PointerPage, shellId: string) {
  await rowWithActions(page, shellId).hover();
  await restoreButton(page, shellId).click();
  await waitFor(endedRow(page, shellId), `the row of shell ${shellId} to stop being ended`, {
    state: "detached",
  });
}
