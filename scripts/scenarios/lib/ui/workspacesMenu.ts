import type { PointerPage } from "../../browser.ts";
import { check } from "../waits.ts";

/** Fills the open create dialog and confirms; returns the dialog's refusal, or null once it closes. */
export async function fillCreateWorkspace(page: PointerPage, name: string): Promise<string | null> {
  const open = page.getByRole("dialog");
  await open.getByRole("textbox").fill(name);
  await open.getByRole("button", { name: "Create" }).click();
  const refusal = open.getByRole("alert");
  await Promise.race([refusal.waitFor(), open.waitFor({ state: "detached" })]);
  if (await open.count()) {
    const reason = await refusal.textContent();
    await open.getByRole("button", { name: "Cancel" }).click();
    await open.waitFor({ state: "detached" });
    return reason;
  }
  return null;
}

/** Creates a workspace from the "Workspaces" menu and waits for the tree to show it. */
export async function createWorkspace(page: PointerPage, name: string) {
  await page.getByRole("button", { name: "Workspaces" }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  const refusal = await fillCreateWorkspace(page, name);
  check(refusal === null, `Creating ${name} was refused: ${refusal}`);
  await page.getByRole("tree").getByRole("treeitem", { level: 1, name }).waitFor();
}

/** Shows a saved workspace with the "Workspaces" menu's "Open workspace" list. */
export async function openWorkspace(page: PointerPage, name: string) {
  await page.getByRole("button", { name: "Workspaces" }).click();
  await page.getByRole("menuitem", { name: "Open workspace" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
