// @effect-diagnostics nodeBuiltinImport:off - Runs git on the scenario's throwaway fixtures and writes their starting scripts.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ShellSummary, StartingScript } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { PointerPage } from "../browser.ts";
import { gitEnv } from "../isolation.ts";
import type { WsClient } from "../rpc.ts";
import { check, follow, gone, recorder } from "../support.ts";

// Pointer-only helpers for the workspace screen, shared by the scenarios that drive it.

/** Git for fixtures, with the harness's own config, never the developer's. */
export const git = (cwd: string, args: ReadonlyArray<string>) =>
  new Promise<{ readonly ok: boolean; readonly stdout: string }>((resolve) => {
    NodeChildProcess.execFile(
      "git",
      args,
      { cwd, encoding: "utf8", env: gitEnv() },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    );
  });

/** The page's alerts, or the ones that say `text`. */
export const alert = (page: PointerPage, text?: string) =>
  text === undefined ? page.getByRole("alert") : page.getByRole("alert").filter({ hasText: text });

/** A shell's ended row in the tree, for any reason or one. */
export const endedRow = (page: PointerPage, shellId: string, reason?: "signal" | "lost") =>
  page.locator(
    reason === undefined
      ? `[data-shell-id="${shellId}"][data-ended]`
      : `[data-shell-id="${shellId}"][data-ended="${reason}"]`,
  );

// Toasts are dialogs too; the app's modals are the dialog popups.
export const dialog = (page: PointerPage) =>
  page.getByRole("dialog").and(page.locator('[data-slot="dialog-popup"]'));
export const startButton = (page: PointerPage) =>
  dialog(page).getByRole("button", { name: "Create shell", exact: true });
/** The "+" on a project's row in the tree. */
export const createShellButton = (page: PointerPage, folder: string) =>
  page.locator(`[data-project="${folder}"]`).getByRole("button", { name: /^Create shell in / });
/** The Existing | Fork switch; absent for a project that is not a git repository. */
export const modeSwitch = (page: PointerPage) =>
  dialog(page).getByRole("group", { name: "Worktree" });
export const modeButton = (page: PointerPage, mode: "Existing" | "Fork") =>
  modeSwitch(page).getByRole("button", { name: mode, exact: true });
export const dropdown = (page: PointerPage, label: "Start in" | "Fork from") =>
  dialog(page).getByRole("combobox", { name: label });
/** Shell rows in the tree, or under one folder; a git folder holds them under worktree nodes. */
export const shellNodes = (page: PointerPage, folder?: string) =>
  (folder === undefined
    ? page.getByRole("tree")
    : page.locator(`[data-project="${folder}"]`)
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
  await page.locator('[role="dialog"]:has([data-testid="add-project"]) h2').click();
  await folderList(page).waitFor({ state: "detached" });
}

export { folderList };

/** Opens the "Add project to workspace" dialog from the sidebar's Add project icon. */
export async function openAddFolder(page: PointerPage) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Add project" })
    .click();
  await dialog(page).getByTestId("add-project").waitFor();
}

/** The "Starting script" dropdown in "Create shell". */
export const scriptDropdown = (page: PointerPage) =>
  dialog(page).getByRole("combobox", { name: "Starting script" });

/** The label of the selected starting script. */
export async function selectedScript(page: PointerPage) {
  return (await scriptDropdown(page).locator("[data-key]").textContent())?.trim() ?? null;
}

/** The starting scripts offered, as their labels in order. */
export async function scriptItems(page: PointerPage) {
  await scriptDropdown(page).click();
  const items = page.getByRole("option");
  await items.first().waitFor();
  const labels = await items.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-title") ?? ""),
  );
  // Closes the list the way a user does: picking the item that was already selected.
  const selected = await scriptDropdown(page).locator("[data-key]").getAttribute("data-key");
  await page.locator(`[role="option"][data-key="${selected}"]`).click();
  return labels;
}

/** Picks a starting script by its label; the first one with that label. */
export async function pickScript(page: PointerPage, label: string) {
  await scriptDropdown(page).click();
  await page.locator(`[role="option"][data-title="${label}"]`).first().click();
  await scriptDropdown(page).filter({ hasText: label }).waitFor();
}

/**
 * Opens "Create shell" from a project's "+" and waits until a git project's choices loaded. The
 * epic 1 scenarios start the mock agent, so it is picked unless `script` says otherwise; null
 * leaves the preselected one.
 */
export async function openModal(
  page: PointerPage,
  folder: string,
  { script = "mock agent" }: { readonly script?: string | null } = {},
) {
  await createShellButton(page, folder).click();
  await dialog(page).getByRole("heading", { name: "Create shell" }).waitFor();
  await dialog(page).getByText("Reading worktrees…").waitFor({ state: "detached" });
  if (script !== null && (await selectedScript(page)) !== script) await pickScript(page, script);
}

/** The pressed side of the Existing | Fork switch. */
export async function mode(page: PointerPage): Promise<"Existing" | "Fork"> {
  return (await modeButton(page, "Fork").getAttribute("aria-pressed")) === "true"
    ? "Fork"
    : "Existing";
}

/** The key of the dropdown's selected item: a worktree path, or `branch:`/`worktree:` for Fork. */
export async function selectedKey(page: PointerPage, label: "Start in" | "Fork from") {
  return dropdown(page, label).locator("[data-key]").getAttribute("data-key");
}

/** The dropdown's items as [key, kind, first line, second line], in order. */
export async function dropdownItems(page: PointerPage, label: "Start in" | "Fork from") {
  await dropdown(page, label).click();
  const items = page.getByRole("option");
  await items.first().waitFor();
  const read = await items.evaluateAll((elements) =>
    elements.map((element) => [
      element.getAttribute("data-key"),
      element.getAttribute("data-kind"),
      element.getAttribute("data-title"),
      element.getAttribute("data-worktree"),
    ]),
  );
  // Closes the list the way a user does: picking the item that was already selected.
  const selected = await selectedKey(page, label);
  await page.locator(`[role="option"][data-key="${selected}"]`).click();
  return read;
}

export async function pickItem(page: PointerPage, label: "Start in" | "Fork from", key: string) {
  await dropdown(page, label).click();
  await page.locator(`[role="option"][data-key="${key}"]`).click();
  await dropdown(page, label).locator(`[data-key="${key}"]`).waitFor();
}

export async function cancelModal(page: PointerPage) {
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).last().click();
  await dialog(page).waitFor({ state: "detached" });
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
    // From the current list on: an older list describes a state that has passed.
    Math.max(0, list.mark() - 1),
  );
  return current.filter((shell) => shell.cwd === cwd);
}

/** Follows the server's shell list over `client`. */
export function shellList(client: WsClient) {
  const lists = recorder<ReadonlyArray<ShellSummary>>("shell lists");
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

/** Waits until `count` running shells have `cwd`, judged from the current list on. */
export async function runningIn(
  list: ReturnType<typeof recorder<ReadonlyArray<ShellSummary>>>,
  cwd: string,
  count: number,
) {
  const running = (shells: ReadonlyArray<ShellSummary>) =>
    shells.filter((shell) => shell.cwd === cwd && shell.status === "running");
  const found = await list.until(
    `${count} running shells in ${cwd}`,
    (shells) => running(shells).length === count,
    Math.max(0, list.mark() - 1),
  );
  return running(found);
}

/** A shell's row in the tree, the row's button. */
export const shellRow = (page: PointerPage, shellId: string) =>
  page.getByRole("tree").locator(`[data-shell-id="${shellId}"]`);

/** A shell's tab in the tab strip. */
export const shellTab = (page: PointerPage, shellId: string) =>
  page.getByRole("tablist", { name: "Shells" }).locator(`[data-shell-id="${shellId}"]`);

/** Opens a shell's tab from the tree, or switches to it. */
export async function openFromTree(page: PointerPage, shellId: string) {
  await shellRow(page, shellId).click();
  await shellTab(page, shellId).and(page.locator('[aria-selected="true"]')).waitFor();
}

/** Closes a shell's tab with the "x" its icon turns into on hover. */
export async function closeTab(page: PointerPage, shellId: string) {
  const tab = page
    .getByRole("tablist", { name: "Shells" })
    .locator("div", { has: page.locator(`[data-shell-id="${shellId}"]`) })
    .last();
  await tab.hover();
  await tab.getByRole("button", { name: /^Close / }).click();
  await shellTab(page, shellId).waitFor({ state: "detached" });
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

/** Whether every pid has ended; gives a killed process the harness's usual grace to leave. */
export async function allGone(pids: ReadonlyArray<number>) {
  const results = await Promise.all(pids.map((pid) => gone(pid)));
  return results.every(Boolean);
}

/**
 * Reloads the page and waits for `name` to show. A page that showed a workspace brings it back
 * by itself (PRB.T-007); a page that never did opens it from the start screen.
 */
export async function reloadShowing(page: PointerPage, name: string) {
  const remembered = await page.evaluate(() =>
    Object.keys(localStorage).some((key) => key.startsWith("probe:shown-workspace:")),
  );
  await page.reload();
  if (!remembered) {
    await page
      .getByTestId("workspace-screen")
      .getByRole("button", { name: "Open workspace" })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await page.getByRole("tree").getByRole("treeitem", { level: 1, name }).waitFor();
}

/** Shows a saved workspace with the "Workspaces" menu's "Open workspace" list. */
export async function openWorkspace(page: PointerPage, name: string) {
  await page.getByRole("button", { name: "Workspaces" }).click();
  await page.getByRole("menuitem", { name: "Open workspace" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** Starts a shell from a project's "+": in an existing worktree, or forked from the default. */
export async function startIn(
  page: PointerPage,
  project: string,
  place: { readonly existing?: string; readonly fork?: boolean } = {},
) {
  await openModal(page, project);
  if (place.fork === true) await modeButton(page, "Fork").click();
  else if ((await modeSwitch(page).count()) > 0) {
    if ((await mode(page)) !== "Existing") await modeButton(page, "Existing").click();
    await pickItem(page, "Start in", place.existing ?? project);
  }
  const refusal = await startFromModal(page);
  check(refusal === null, `The shell in ${project} did not start: ${refusal}`);
}

/** Starts a shell with `startIn` and returns it once the server lists it as running. */
export async function startShell(
  page: PointerPage,
  shells: ReturnType<typeof shellList>,
  project: string,
  place: { readonly existing?: string; readonly fork?: boolean } = {},
) {
  const known = new Set(shells.current().map((shell) => shell.shellId));
  await startIn(page, project, place);
  const list = await shells.lists.until(
    `a new running shell in ${project}`,
    (current) => current.some((shell) => !known.has(shell.shellId) && shell.status === "running"),
    Math.max(0, shells.lists.mark() - 1),
  );
  const shell = list.find((entry) => !known.has(entry.shellId) && entry.status === "running")!;
  await shellRow(page, shell.shellId).waitFor();
  return shell;
}

/** The git fixture runner; the harness's git config gives commits an identity. */
export async function gitOk(cwd: string, ...args: Array<string>) {
  const result = await git(cwd, args);
  check(result.ok, `git ${args.join(" ")} failed in the fixture.`);
  return result.stdout.trim();
}

/** Waits until the shell's mock agent runs, so a typed line reaches the agent, not the shell. */
export async function agentReady(client: WsClient, shellId: string) {
  const output = recorder<string>("agent output");
  const viewer = follow(client["shell.attach"]({ shellId }), (event) =>
    output.push(JSON.stringify(event)),
  );
  try {
    // A fresh attach: its snapshot holds the shell's whole history, which is what counts here.
    await output.until("the agent's banner", (event) => event.includes("Mock Agent v1"), 0);
  } finally {
    await Effect.runPromise(Fiber.interrupt(viewer));
  }
}

/**
 * Types `exit` into the shell's mock agent once it runs, and waits for its goodbye, so the next
 * line reaches the shell, not the agent's input buffer.
 */
export async function leaveAgent(page: PointerPage, client: WsClient, shellId: string) {
  const output = recorder<string>("agent output");
  const viewer = follow(client["shell.attach"]({ shellId }), (event) =>
    output.push(JSON.stringify(event)),
  );
  try {
    // A fresh attach: its snapshot holds the shell's whole history, which is what counts here.
    await output.until("the agent's banner", (event) => event.includes("Mock Agent v1"), 0);
    const typed = output.mark();
    await typeLine(page, "exit");
    await output.until("the agent's goodbye", (event) => event.includes("mock-agent: bye"), typed);
  } finally {
    await Effect.runPromise(Fiber.interrupt(viewer));
  }
}

/** The user's starting scripts file in a harness home; the server reads it on every use. */
export const startingScriptsFile = (home: string) =>
  NodePath.join(home, "userdata", "starting-scripts.json");

export async function readStartingScripts(home: string): Promise<ReadonlyArray<StartingScript>> {
  const saved = JSON.parse(await NodeFSP.readFile(startingScriptsFile(home), "utf8"));
  return saved.scripts;
}

/** Replaces the saved list, as an edit outside Probe would. */
export async function writeStartingScripts(home: string, scripts: ReadonlyArray<StartingScript>) {
  await NodeFSP.mkdir(NodePath.dirname(startingScriptsFile(home)), { recursive: true });
  await NodeFSP.writeFile(startingScriptsFile(home), JSON.stringify({ version: 1, scripts }));
}

/** Adds a script after the saved ones, such as the mock agent the harness starts with. */
export async function addStartingScript(home: string, script: StartingScript) {
  await writeStartingScripts(home, [...(await readStartingScripts(home)), script]);
}
