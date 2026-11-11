import type { PointerPage } from "../../browser.ts";
import { shellTab } from "./tabs.ts";

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

/** Opens a shell's tab from the tree, or switches to it. */
export async function openFromTree(page: PointerPage, shellId: string) {
  await shellRow(page, shellId).click();
  await shellTab(page, shellId).and(page.locator('[aria-selected="true"]')).waitFor();
}

/**
 * Clicks the "x" on a shell's tree row ("Kill", or "Remove" for an ended shell); the confirmation
 * is left open for the caller.
 */
export async function askToKill(page: PointerPage, shellId: string) {
  const row = page.locator(`[data-shell-row="${shellId}"]`);
  await row.hover();
  await row.getByRole("button", { name: /^(Kill|Remove) / }).click();
  await page.getByRole("alertdialog").waitFor();
}

export async function answerConfirm(page: PointerPage, answer: "Confirm" | "Cancel") {
  await page.getByRole("alertdialog").getByRole("button", { name: answer, exact: true }).click();
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
}

/** Kills a shell from the tree and waits for its row to leave. */
export async function killFromTree(page: PointerPage, shellId: string) {
  await askToKill(page, shellId);
  await answerConfirm(page, "Confirm");
  await page.locator(`[data-shell-row="${shellId}"]`).waitFor({ state: "detached" });
}
