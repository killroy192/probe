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
import { alive, check, follow, gone, recorder } from "../support.ts";

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

/** A shell's tab panel; a hidden tab's panel stays mounted. */
export const shellPanel = (page: PointerPage, shellId: string) =>
  page.locator(`[role="tabpanel"][data-shell-id="${shellId}"]`);

/** What the page says about a shell's tab right now, for a failure message. */
// A string, since this package has no DOM types; it runs in the page and never waits.
const tabState = (page: PointerPage, shellId: string): Promise<string> =>
  page.evaluate(`(() => {
    const panel = document.querySelector('[role="tabpanel"][data-shell-id="' + CSS.escape(${JSON.stringify(shellId)}) + '"]');
    if (panel === null) return "no tab";
    const surface = panel.querySelector("[data-terminal-attached]");
    const attached = surface === null ? "no surface yet" : surface.getAttribute("data-terminal-attached");
    return "attached: " + attached + ", ready: " + panel.getAttribute("data-shell-ready");
  })()`);

/**
 * Waits until the page shows the shell's tab attached (its terminal takes input) and the shell at
 * its first prompt; hidden tabs count. A shell that ends meanwhile fails at once. `timeout` is for
 * the self-tests; scenarios use the page's action timeout.
 */
export async function shellReady(
  page: PointerPage,
  shellId: string,
  { timeout }: { readonly timeout?: number } = {},
) {
  const panel = shellPanel(page, shellId);
  const wait = timeout === undefined ? {} : { timeout };
  // An ended shell leaves its tab, so a panel that was there and goes means it ended.
  const hadTab = (await panel.count()) > 0;
  const outcome = await Promise.race([
    page
      .locator(
        `[role="tabpanel"][data-shell-id="${shellId}"][data-shell-ready="ready"]:has([data-terminal-attached="yes"])`,
      )
      .waitFor({ ...wait, state: "attached" })
      .then(() => "ready" as const),
    panel
      .locator('[data-terminal-attached="ended"]')
      .waitFor({ ...wait, state: "attached" })
      .then(() => "ended" as const),
    ...(hadTab ? [panel.waitFor({ ...wait, state: "detached" }).then(() => "ended" as const)] : []),
  ]).catch(() => "timeout" as const);
  if (outcome === "ready") return;
  const seen = await tabState(page, shellId);
  throw new Error(
    outcome === "ended"
      ? `Shell ${shellId} ended while waiting for it to be attached and ready (${seen}).`
      : `Shell ${shellId} never showed attached and ready; its tab last showed ${seen}.`,
  );
}

/**
 * Types into the active tab's terminal the way a user does, then submits the line, once the page
 * shows that shell attached and ready, so the line reaches a shell that reads it.
 */
export async function typeLine(
  page: PointerPage,
  text: string,
  options: { readonly timeout?: number } = {},
) {
  const shellId = await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getAttribute("data-shell-id");
  check(shellId !== null, "The visible tab names no shell.");
  await shellReady(page, shellId, options);
  const input = shellPanel(page, shellId).locator("textarea");
  await input.click({ force: true });
  await input.pressSequentially(text);
  await input.press("Enter");
}

/**
 * Records every layout save state the page shows, from each page load on, so a scenario can
 * check what showed between two moments; `layoutStates` reads them. Install before loading.
 */
export async function recordLayoutStates(page: PointerPage) {
  await page.addInitScript(`(() => {
    const states = (window.__layoutStates = []);
    new MutationObserver(() => {
      const screen = document.querySelector('[data-testid="workspace-screen"]');
      const value = screen === null ? null : screen.getAttribute("data-layout-save");
      if (states[states.length - 1] !== value) states.push(value);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-layout-save"],
    });
  })()`);
}

/** The layout save states this page load showed so far, in order; null where none showed. */
export const layoutStates = (page: PointerPage) =>
  page.evaluate("window.__layoutStates") as Promise<ReadonlyArray<string | null>>;

/** The workspace screen while it shows the shown workspace's layout save as `state`. */
export const layoutState = (page: PointerPage, state: "pending" | "saved" | "failed") =>
  page.locator(`[data-testid="workspace-screen"][data-layout-save="${state}"]`);

/**
 * Waits until the page shows the shown workspace's layout saved, so a reload or a server stop
 * after a tab change finds the tabs it set. Returns at once on a page that shows no workspace.
 */
export async function layoutSaved(
  page: PointerPage,
  workspace: string,
  { timeout }: { readonly timeout?: number } = {},
) {
  const screen = page.getByTestId("workspace-screen");
  if ((await screen.getAttribute("data-layout-save")) === null) return;
  const state = (value: "saved" | "failed") => layoutState(page, value);
  const wait = timeout === undefined ? {} : { timeout };
  const outcome = await Promise.race([
    state("saved")
      .waitFor(wait)
      .then(() => "saved" as const),
    state("failed")
      .waitFor(wait)
      .then(() => "failed" as const),
  ]).catch(() => "timeout" as const);
  if (outcome === "saved") return;
  const seen = await screen.getAttribute("data-layout-save");
  throw new Error(
    outcome === "failed"
      ? `Saving the layout of ${workspace} failed (the page shows ${seen}).`
      : `The layout of ${workspace} was never saved; the page last showed ${seen}.`,
  );
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

/**
 * The pids still running after the bounded wait, for processes the server does not own (a shell's background jobs,
 * shells whose host was stopped), which have no end event; see `gone`.
 */
export async function survivors(pids: ReadonlyArray<number>) {
  const results = await Promise.all(pids.map((pid) => gone(pid)));
  return pids.filter((_, index) => !results[index]);
}

/**
 * Waits for the server's end event of a shell it owns (it leaves the list, or is listed as ended)
 * and then checks its pid once: the server sends the event only after the process ended.
 */
export async function shellEnded(
  shells: ReturnType<typeof shellList>,
  shell: Pick<ShellSummary, "shellId" | "pid">,
) {
  await shells.lists.until(
    `the end of shell ${shell.shellId}`,
    (list) => !list.some((entry) => entry.shellId === shell.shellId && entry.ended === null),
    // Each list is the whole state, so the current one already counts; older ones have passed.
    Math.max(0, shells.lists.mark() - 1),
  );
  check(
    shell.pid === null || !alive(shell.pid),
    `Shell ${shell.shellId} (pid ${shell.pid}) still runs after the server reported its end.`,
  );
}

/**
 * Reloads the page and waits for `name` to show. A page that showed a workspace brings it back
 * by itself (PRB.T-007); a page that never did opens it from the start screen.
 */
export async function reloadShowing(page: PointerPage, name: string) {
  await layoutSaved(page, name);
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
    // The shell reads the next line at its next prompt, which follows the goodbye (SU-1).
    const bye = await output.until(
      "the agent's goodbye",
      (event) => event.includes("mock-agent: bye"),
      typed,
    );
    const promptMark = JSON.stringify("\u001b]133;B").slice(1, -1);
    await output.until(
      "the shell's prompt after the agent's goodbye",
      (event) =>
        event.includes(promptMark) &&
        (event !== bye || event.indexOf(promptMark, event.indexOf("mock-agent: bye")) !== -1),
      output.seen.indexOf(bye, typed),
    );
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
