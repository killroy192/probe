import type { PointerPage } from "../../browser.ts";
import { waitFor } from "../waits.ts";
import { dialog } from "./dialog.ts";

// The folder list floats above the modal, outside the dialog element.
export const folderList = (page: PointerPage) =>
  page.getByRole("listbox", { name: "Folders on the server" }).filter({ visible: true });

/** Closes the folder list the way a user does: a click outside it, here on the modal title. */
export async function closeFolderList(page: PointerPage) {
  if (!(await folderList(page).count())) return;
  // While the list is open the page behind it is hidden from role queries, so find it by tag.
  await page.locator('[role="dialog"]:has([data-testid="add-project"]) h2').click();
  await waitFor(folderList(page), "the folder list to close", { state: "detached" });
}

/** Opens the "Add project to workspace" dialog from the sidebar's Add project icon. */
export async function openAddFolder(page: PointerPage) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Add project" })
    .click();
  await waitFor(dialog(page).getByTestId("add-project"), "the Add project dialog");
}

/**
 * Adds a project with the "Add project to workspace" dialog; returns the refusal, or null once the
 * dialog closes. The dialog stays open after a refusal, so the next call reuses it.
 */
export async function addProject(
  page: PointerPage,
  request:
    | { readonly import: string; readonly pick?: string }
    | { readonly parent: string; readonly name: string },
): Promise<string | null> {
  const panel = dialog(page).getByTestId("add-project");
  if (!(await panel.count())) await openAddFolder(page);
  const isImport = "import" in request;
  await panel
    .getByRole("button", { name: isImport ? "Import existing folder" : "Create new folder" })
    .click();
  // The name goes first: typing a path opens the folder list, which hides the rest from role queries.
  if (!isImport) await panel.getByRole("textbox", { name: "New folder name" }).fill(request.name);
  await panel
    .getByRole("combobox", { name: isImport ? "Folder" : "Create it in" })
    .fill(isImport ? request.import : request.parent);
  if (isImport && request.pick !== undefined) {
    // Picks a folder in the server folder browser, which lists the folder the field points at.
    await folderList(page).getByRole("option", { name: request.pick, exact: true }).click();
  }
  await closeFolderList(page);
  const shown = dialog(page).getByRole("alert");
  const previous = (await shown.count()) ? await shown.getAttribute("data-attempt") : "none";
  await dialog(page)
    .getByRole("button", { name: isImport ? "Add project" : "Create project", exact: true })
    .click();
  const alert = dialog(page).locator(`[role="alert"]:not([data-attempt="${previous}"])`);
  await Promise.race([
    waitFor(panel, "the Add project dialog to close", { state: "detached" }),
    waitFor(alert, "the Add project dialog's refusal"),
  ]);
  if (await panel.count()) return alert.textContent();
  return null;
}
