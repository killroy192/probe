import type { PointerPage } from "../../browser.ts";
import { expected } from "../expect.ts";
import { type ShellFollower, shellsIn } from "../shells.ts";
import { check, waitFor } from "../waits.ts";
import { dialog } from "./dialog.ts";
import { shellRow } from "./tree.ts";

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
  await waitFor(items.first(), "the starting script list");
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
  await waitFor(scriptDropdown(page).filter({ hasText: label }), `the starting script ${label}`);
}

/** The id of the selected starting script ("plain" for Plain shell), once the list has loaded. */
export async function selectedScriptKey(page: PointerPage) {
  // Start stays disabled until the dialog has read the list.
  await waitFor(startButton(page).and(page.locator(":enabled")), "the starting scripts to load");
  return scriptDropdown(page).locator("[data-key]").getAttribute("data-key");
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
  await waitFor(
    dialog(page).getByRole("heading", { name: "Create shell" }),
    `"Create shell" for ${folder}`,
  );
  await waitFor(dialog(page).getByText("Reading worktrees…"), `the worktrees of ${folder}`, {
    state: "detached",
  });
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
  await waitFor(items.first(), `the "${label}" list`);
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
  await waitFor(dropdown(page, label).locator(`[data-key="${key}"]`), `"${label}" to show ${key}`);
}

export async function cancelModal(page: PointerPage) {
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).last().click();
  await waitFor(dialog(page), '"Create shell" to close on Cancel', { state: "detached" });
}

/** Clicks the up-arrow; returns the refusal, or null once the modal closed on a start. */
export async function startFromModal(page: PointerPage): Promise<string | null> {
  const shown = dialog(page).getByRole("alert");
  const previous = (await shown.count()) ? await shown.getAttribute("data-attempt") : "none";
  await startButton(page).click();
  const alert = dialog(page).locator(`[role="alert"]:not([data-attempt="${previous}"])`);
  await Promise.race([
    waitFor(dialog(page), '"Create shell" to close on a start', { state: "detached" }),
    waitFor(alert, `"Create shell"'s refusal`),
  ]);
  if (await dialog(page).count()) return alert.textContent();
  return null;
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
  shells: ShellFollower,
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
  await waitFor(shellRow(page, shell.shellId), `the tree row of shell ${shell.shellId}`);
  return shell;
}

/** The starting scripts "Create shell" offers for `project`, by label in order; closes the modal. */
export async function offeredScripts(page: PointerPage, project: string) {
  await openModal(page, project, { script: null });
  await selectedScriptKey(page);
  const offered = await scriptItems(page);
  await cancelModal(page);
  return offered;
}

/** The starting script "Create shell" preselects for `project` ("plain" for Plain shell). */
export async function preselectedScript(page: PointerPage, project: string) {
  await openModal(page, project, { script: null });
  const key = await selectedScriptKey(page);
  await cancelModal(page);
  return key;
}

/** Starts `script` in `project` through "Create shell" and returns the shell once it is listed. */
export async function startScriptThroughModal(
  page: PointerPage,
  shells: ShellFollower,
  project: string,
  script: string,
) {
  await openModal(page, project, { script });
  expected({
    what: `the refusal of the ${script} start in ${project}`,
    expected: null,
    found: await startFromModal(page),
  });
  const [started] = await shellsIn(shells.lists, project, 1);
  return started!;
}
