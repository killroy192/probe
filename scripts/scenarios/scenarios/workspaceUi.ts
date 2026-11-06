// @effect-diagnostics nodeBuiltinImport:off - Runs git on the scenario's throwaway fixtures.

import * as NodeChildProcess from "node:child_process";

import type { ShellSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { PointerPage } from "../browser.ts";
import type { WsClient } from "../rpc.ts";
import { follow, recorder } from "../support.ts";

// Pointer-only helpers for the workspace screen, shared by the scenarios that drive it.

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const git = (cwd: string, args: ReadonlyArray<string>) =>
  new Promise<{ readonly ok: boolean; readonly stdout: string }>((resolve) => {
    NodeChildProcess.execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout) =>
      resolve({ ok: error === null, stdout }),
    );
  });

export const dialog = (page: PointerPage) => page.getByRole("dialog");
export const startButton = (page: PointerPage) =>
  dialog(page).getByRole("button", { name: "Start shell", exact: true });
export const folderRadio = (page: PointerPage, path: string) =>
  // The label holds the path and the git badge; no fixture path is a prefix of another.
  dialog(page).getByRole("radiogroup", { name: "Folders" }).getByRole("radio", { name: path });
/** Shell rows in the tree, or under one folder; a git folder holds them under worktree nodes. */
export const shellNodes = (page: PointerPage, folder?: string) =>
  (folder === undefined
    ? page.getByRole("tree")
    : page.locator(`[data-folder="${folder}"]`)
  ).locator("[data-shell-id]");
export const tabs = (page: PointerPage) =>
  page.getByRole("tablist", { name: "Shells" }).getByRole("tab");

// The folder list floats above the modal, outside the dialog element.
const folderList = (page: PointerPage) =>
  page.getByRole("listbox", { name: "Folders on the server" }).filter({ visible: true });

/** Closes the folder list the way a user does: a click outside it, here on the modal title. */
export async function closeFolderList(page: PointerPage) {
  if (!(await folderList(page).count())) return;
  // While the list is open the page behind it is hidden from role queries, so find it by tag.
  await page.locator('[role="dialog"] h2').click();
  await folderList(page).waitFor({ state: "detached" });
}

export { folderList };

/** Opens the "Add folder to workspace" dialog from the sidebar's Add project icon. */
export async function openAddFolder(page: PointerPage) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Add project" })
    .click();
  await dialog(page).getByTestId("add-folder").waitFor();
}

/** Opens the "+" modal and waits for its folder step. */
export async function openModal(page: PointerPage) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Start shell", exact: true })
    .click();
  await dialog(page).getByText("Pick a folder in").waitFor();
}

export async function cancelModal(page: PointerPage) {
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).last().click();
  await dialog(page).waitFor({ state: "detached" });
}

/** The checked folder in the open modal, or null. */
export async function preselected(page: PointerPage): Promise<string | null> {
  const radios = dialog(page).getByRole("radiogroup", { name: "Folders" }).getByRole("radio");
  for (let index = 0; index < (await radios.count()); index++) {
    const radio = radios.nth(index);
    if ((await radio.getAttribute("aria-checked")) === "true") {
      return radio.getAttribute("aria-label");
    }
  }
  return null;
}

/**
 * Adds a folder with the "Add folder to workspace" dialog; returns the refusal, or null once the
 * dialog closes. The dialog stays open after a refusal, so the next call reuses it.
 */
export async function addFolder(
  page: PointerPage,
  request:
    | { readonly import: string; readonly pick?: string }
    | { readonly parent: string; readonly name: string },
): Promise<string | null> {
  const panel = dialog(page).getByTestId("add-folder");
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
    .getByRole("button", { name: isImport ? "Add folder" : "Create folder", exact: true })
    .click();
  const alert = dialog(page).locator(`[role="alert"]:not([data-attempt="${previous}"])`);
  await Promise.race([panel.waitFor({ state: "detached" }), alert.waitFor()]);
  if (await panel.count()) return alert.textContent();
  return null;
}

/** Clicks the up-arrow; returns the refusal, or null once the modal closed on a start. */
export async function startFromModal(page: PointerPage): Promise<string | null> {
  const shown = dialog(page).getByRole("alert");
  const previous = (await shown.count()) ? await shown.getAttribute("data-attempt") : "none";
  await startButton(page).click();
  const alert = dialog(page).locator(`[role="alert"]:not([data-attempt="${previous}"])`);
  await Promise.race([dialog(page).waitFor({ state: "detached" }), alert.waitFor()]);
  if (await dialog(page).count()) return alert.textContent();
  return null;
}

/** Waits until the list of shells has `count` entries for `cwd`. */
export async function shellsIn(
  list: ReturnType<typeof recorder<ReadonlyArray<ShellSummary>>>,
  cwd: string,
  count: number,
) {
  const current = await list.until(
    `${count} shells in ${cwd}`,
    (shells) => shells.filter((shell) => shell.cwd === cwd).length === count,
  );
  return current.filter((shell) => shell.cwd === cwd);
}

/** Follows the server's shell list over `client`. */
export function shellList(client: WsClient) {
  const lists = recorder<ReadonlyArray<ShellSummary>>();
  let list: ReadonlyArray<ShellSummary> = [];
  follow(client.subscribeShells({}), (event) => {
    if (event.type === "snapshot") list = event.shells;
    else if (event.type === "remove")
      list = list.filter((shell) => shell.shellId !== event.shellId);
    else list = [...list.filter((shell) => shell.shellId !== event.shell.shellId), event.shell];
    lists.push(list);
  });
  return { lists, current: () => list };
}

export async function history(client: WsClient, shellId: string): Promise<string> {
  const [first] = await Effect.runPromise(
    client["shell.attach"]({ shellId }).pipe(Stream.take(1), Stream.runCollect),
  );
  return first?.type === "snapshot" ? first.snapshot.history : "";
}

/** Types into the active tab's terminal the way a user does, then submits the line. */
export async function typeLine(page: PointerPage, text: string) {
  const input = page.getByRole("tabpanel").filter({ visible: true }).locator("textarea");
  await input.click({ force: true });
  await input.pressSequentially(text);
  await input.press("Enter");
}

export async function createWorkspace(page: PointerPage, name: string) {
  await page.getByRole("button", { name: "Workspaces" }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  await dialog(page).getByRole("textbox").fill(name);
  await dialog(page).getByRole("button", { name: "Create" }).click();
  await dialog(page).waitFor({ state: "detached" });
  await page.getByRole("tree").getByRole("treeitem", { level: 1, name }).waitFor();
}
