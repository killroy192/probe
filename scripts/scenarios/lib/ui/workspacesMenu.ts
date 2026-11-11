import type { PointerPage } from "../../browser.ts";
import { check, waitFor } from "../waits.ts";
import { workspaceShown } from "./tree.ts";

/** Opens the "Workspaces" menu, or its "Open workspace" / "Remove workspace" submenu. */
export async function openWorkspacesMenu(
  page: PointerPage,
  submenu?: "Open workspace" | "Remove workspace",
) {
  await page.getByRole("button", { name: "Workspaces" }).click();
  // "Create workspace" joins the menu's top once the page learns it may change workspaces; until
  // then the items below it move and the submenu under the pointer shuts. Harness pages may.
  await waitFor(
    page.getByRole("menuitem", { name: "Create workspace" }),
    'the "Workspaces" menu to offer Create workspace',
  );
  if (submenu !== undefined) await page.getByRole("menuitem", { name: submenu }).click();
}

/** Fills the open create dialog and confirms; returns the dialog's refusal, or null once it closes. */
export async function fillCreateWorkspace(page: PointerPage, name: string): Promise<string | null> {
  const open = page.getByRole("dialog");
  await open.getByRole("textbox").fill(name);
  await open.getByRole("button", { name: "Create" }).click();
  const refusal = open.getByRole("alert");
  await Promise.race([
    waitFor(refusal, `a refusal to create ${name}`),
    waitFor(open, `the create dialog to close on ${name}`, { state: "detached" }),
  ]);
  if (await open.count()) {
    const reason = await refusal.textContent();
    await open.getByRole("button", { name: "Cancel" }).click();
    await waitFor(open, "the create dialog to close on Cancel", { state: "detached" });
    return reason;
  }
  return null;
}

/**
 * Creates a workspace from the "Workspaces" menu, or from the start screen's "Create workspace",
 * and waits for the tree to show it.
 */
export async function createWorkspace(
  page: PointerPage,
  name: string,
  { from = "menu" }: { readonly from?: "menu" | "start screen" } = {},
) {
  if (from === "menu") {
    await openWorkspacesMenu(page);
    await page.getByRole("menuitem", { name: "Create workspace" }).click();
  } else {
    await page
      .getByTestId("workspace-screen")
      .getByRole("button", { name: "Create workspace" })
      .click();
  }
  const refusal = await fillCreateWorkspace(page, name);
  check(refusal === null, `Creating ${name} was refused: ${refusal}`);
  await workspaceShown(page, name, " after creating it");
}

/** Shows a saved workspace with the "Workspaces" menu's "Open workspace" list. */
export async function openWorkspace(page: PointerPage, name: string) {
  await openWorkspacesMenu(page, "Open workspace");
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** Removes a saved workspace with the "Workspaces" menu's "Remove workspace" list. */
export async function removeWorkspace(page: PointerPage, name: string) {
  await openWorkspacesMenu(page, "Remove workspace");
  await page.getByRole("menuitem", { name, exact: true }).click();
}
