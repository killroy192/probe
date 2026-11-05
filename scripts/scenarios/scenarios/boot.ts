// @effect-diagnostics nodeBuiltinImport:off - Reads the throwaway home and seeds workspace files in it.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { PointerPage } from "../browser.ts";
import { environmentId } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";

/** Fails the scenario with `message` unless `condition` holds. */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const screen = (page: PointerPage) => page.getByTestId("workspace-screen");
const treeRoot = (page: PointerPage) => page.getByRole("tree").getByRole("treeitem");
const alert = (page: PointerPage) => screen(page).getByRole("alert");

async function shownWorkspace(page: PointerPage, name: string) {
  await treeRoot(page).filter({ hasText: name }).waitFor();
  check((await treeRoot(page).count()) === 1, `The tree should show only the root "${name}".`);
}

async function onStartScreen(page: PointerPage) {
  await screen(page).getByRole("button", { name: "Create workspace" }).waitFor();
  check((await page.getByRole("tree").count()) === 0, "The start screen should show no tree.");
}

/** Opens the Workspaces menu, or its "Open workspace" / "Remove workspace" submenu. */
async function workspacesMenu(page: PointerPage, submenu?: "Open workspace" | "Remove workspace") {
  await page.getByRole("button", { name: "Workspaces" }).click();
  if (submenu !== undefined) await page.getByRole("menuitem", { name: submenu }).click();
}

/** The names in the open menu, after it settles on the expected list. */
async function menuNames(page: PointerPage, expected: ReadonlyArray<string>) {
  for (const name of expected) await page.getByRole("menuitem", { name, exact: true }).waitFor();
  return page.getByRole("menuitem").allTextContents();
}

async function closeMenu(page: PointerPage) {
  await page.mouse.click(2, 2);
  await page.getByRole("menu").first().waitFor({ state: "detached" });
}

/** Fills the create dialog and confirms; returns the dialog's refusal, or null once it closes. */
async function createWorkspace(page: PointerPage, name: string): Promise<string | null> {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  const refusal = dialog.getByRole("alert");
  await Promise.race([refusal.waitFor(), dialog.waitFor({ state: "detached" })]);
  if (await dialog.count()) {
    const reason = await refusal.textContent();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached" });
    return reason;
  }
  return null;
}

/** Client-side navigation, the way an in-app link or the back button reaches an address. */
async function navigateInApp(page: PointerPage, path: string) {
  // A string, since this package has no DOM types; it runs in the page.
  await page.evaluate(
    `window.history.pushState({}, "", ${JSON.stringify(path)});
     window.dispatchEvent(new PopStateEvent("popstate"));`,
  );
  await page.waitForURL((url) => url.pathname === "/");
}

export const boot: Scenario = {
  id: "S1",
  title: "boot and workspaces",
  run: async ({ server, openPage }) => {
    const runtime = JSON.parse(
      await NodeFSP.readFile(NodePath.join(server.home, "userdata", "server-runtime.json"), "utf8"),
    ) as { readonly pid: number };
    check(
      runtime.pid === server.pid(),
      `The server using ${server.home} is not the one this run started.`,
    );
    check(
      !(await NodeFSP.realpath(server.home)).startsWith(NodePath.join(NodeOS.homedir(), ".t3")),
      `The throwaway home ${server.home} is inside ~/.t3.`,
    );
    const workspacesDir = NodePath.join(server.home, "userdata", "workspaces");
    const seed = (file: string, contents: string) =>
      NodeFSP.writeFile(NodePath.join(workspacesDir, file), contents);
    // A folder on disk that removing a workspace must leave alone (AC-5).
    const folder = NodePath.join(server.home, "project-folder");
    await NodeFSP.mkdir(folder);
    const envId = await environmentId(server.origin);
    const chatAddresses = [
      `/${envId}/thread-1`,
      "/draft/draft-1",
      "/new?prompt=hello",
      "/pull-requests",
      "/usage",
      "/welcome",
      "/projects/project-1",
      "/settings/chat",
      "/settings/threads",
      "/settings/archived",
      "/settings/providers",
      "/settings/scheduled-tasks",
    ];

    const page = await openPage();
    check(
      !(await page.getByText("Something went wrong.").count()),
      "The first page shows an error state.",
    );

    // AC-1: the start screen offers only "Open workspace" and "Create workspace".
    await onStartScreen(page);
    const buttons = await screen(page).getByRole("button").allTextContents();
    check(
      buttons.length === 2 && buttons.some((label) => label.includes("Open workspace")),
      `The start screen should offer only Open and Create workspace, got ${JSON.stringify(buttons)}.`,
    );
    check(
      (await page.getByRole("navigation", { name: "Threads" }).count()) === 0,
      "The chat thread sidebar is shown.",
    );

    // AC-13: an empty or file-unsafe name is refused with a reason.
    await screen(page).getByRole("button", { name: "Create workspace" }).click();
    check((await createWorkspace(page, "")) === "Enter a name.", "An empty name was not refused.");
    await screen(page).getByRole("button", { name: "Create workspace" }).click();
    check((await createWorkspace(page, "a/b")) !== null, "A name with a slash was not refused.");

    // AC-2: create "sparta"; it is the root of an empty tree.
    await screen(page).getByRole("button", { name: "Create workspace" }).click();
    check((await createWorkspace(page, "sparta")) === null, "Creating sparta failed.");
    await shownWorkspace(page, "sparta");

    // AC-14: the same name in any case is refused.
    await workspacesMenu(page);
    await page.getByRole("menuitem", { name: "Create workspace" }).click();
    const taken = await createWorkspace(page, "Sparta");
    check(taken?.includes("already exists") === true, `A taken name was not refused: ${taken}`);

    // AC-3: a second workspace from the Workspaces button is shown and both are listed.
    await workspacesMenu(page);
    await page.getByRole("menuitem", { name: "Create workspace" }).click();
    check((await createWorkspace(page, "athens")) === null, "Creating athens failed.");
    await shownWorkspace(page, "athens");
    await workspacesMenu(page, "Open workspace");
    await menuNames(page, ["athens", "sparta"]);

    // AC-4, AC-8: switch back to sparta.
    await page.getByRole("menuitem", { name: "sparta", exact: true }).click();
    await shownWorkspace(page, "sparta");

    // AC-9: choosing the shown workspace changes nothing and adds no entry.
    await workspacesMenu(page, "Open workspace");
    await page.getByRole("menuitem", { name: "sparta", exact: true }).click();
    await shownWorkspace(page, "sparta");
    await workspacesMenu(page, "Open workspace");
    const afterReopen = await menuNames(page, ["sparta"]);
    check(
      afterReopen.filter((name) => name === "sparta").length === 1,
      `Expected one sparta entry, got ${JSON.stringify(afterReopen)}.`,
    );
    await closeMenu(page);

    // AC-5: removing the other workspace keeps sparta shown and the folder on disk.
    await workspacesMenu(page, "Remove workspace");
    await page.getByRole("menuitem", { name: "athens", exact: true }).click();
    await shownWorkspace(page, "sparta");
    await workspacesMenu(page, "Open workspace");
    check(
      !(await menuNames(page, ["sparta"])).includes("athens"),
      "athens is still listed after removal.",
    );
    await closeMenu(page);
    await NodeFSP.access(folder);

    // AC-10 (automated part): settings is reachable and lists no chat page.
    await workspacesMenu(page);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/settings"));
    const section = (path: string) => page.locator(`[data-settings-section="${path}"]`);
    await section("/settings/connections").waitFor();
    for (const path of ["/settings/chat", "/settings/threads", "/settings/providers"]) {
      check((await section(path).count()) === 0, `Settings lists ${path}.`);
    }
    await page.goBack();
    await shownWorkspace(page, "sparta");

    // AC-11 with a workspace shown, AC-12: chat addresses and chat shortcuts change nothing.
    for (const address of chatAddresses) {
      await navigateInApp(page, address);
      await shownWorkspace(page, "sparta");
    }
    for (const key of ["n", "N", "o", "O"]) {
      for (const modifiers of [
        { ctrlKey: true },
        { metaKey: true },
        { ctrlKey: true, shiftKey: true },
        { metaKey: true, shiftKey: true },
        { ctrlKey: true, altKey: true },
      ]) {
        const init = JSON.stringify({ key, bubbles: true, ...modifiers });
        await page.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", ${init}))`);
      }
    }
    check(new URL(page.url()).pathname === "/", `A chat shortcut navigated to ${page.url()}.`);
    await shownWorkspace(page, "sparta");

    // AC-20, AC-7: a reload keeps every saved workspace listed; a seeded one opens.
    await seed("delphi.json", '{"version":1}');
    await page.reload();
    await onStartScreen(page);
    await screen(page).getByRole("button", { name: "Open workspace" }).click();
    await menuNames(page, ["delphi", "sparta"]);
    await page.getByRole("menuitem", { name: "delphi", exact: true }).click();
    await shownWorkspace(page, "delphi");

    // AC-15: an invalid or unreadable workspace stays listed and is refused when chosen.
    await seed("broken.json", "not json");
    await seed("locked.json", '{"version":1}');
    await NodeFSP.chmod(NodePath.join(workspacesDir, "locked.json"), 0o000);
    for (const name of ["broken", "locked"]) {
      await workspacesMenu(page, "Open workspace");
      await page.getByRole("menuitem", { name, exact: true }).click();
      await alert(page)
        .filter({ hasText: `Workspace "${name}" cannot be opened` })
        .waitFor();
      await shownWorkspace(page, "delphi");
    }

    // AC-16, AC-17: when the folder cannot change, create and remove say why and the list stays.
    await NodeFSP.chmod(workspacesDir, 0o555);
    try {
      await workspacesMenu(page);
      await page.getByRole("menuitem", { name: "Create workspace" }).click();
      const refused = await createWorkspace(page, "olympia");
      check(refused?.includes("Could not create") === true, `Create did not fail: ${refused}`);
      await workspacesMenu(page, "Remove workspace");
      await page.getByRole("menuitem", { name: "sparta", exact: true }).click();
      await alert(page).filter({ hasText: "Could not remove" }).waitFor();
      await workspacesMenu(page, "Open workspace");
      const unchanged = await menuNames(page, ["broken", "delphi", "locked", "sparta"]);
      check(!unchanged.includes("olympia"), "A refused workspace was listed.");
      await closeMenu(page);
    } finally {
      await NodeFSP.chmod(workspacesDir, 0o755);
    }

    // AC-6: removing the shown workspace returns to the start screen, which lists the rest.
    await workspacesMenu(page, "Remove workspace");
    await page.getByRole("menuitem", { name: "delphi", exact: true }).click();
    await onStartScreen(page);
    await screen(page).getByRole("button", { name: "Open workspace" }).click();
    const remaining = await menuNames(page, ["broken", "locked", "sparta"]);
    check(!remaining.includes("delphi"), "The removed workspace is still listed.");

    // AC-15 from the start screen: the reason shows and the start screen stays.
    await page.getByRole("menuitem", { name: "broken", exact: true }).click();
    await alert(page).filter({ hasText: 'Workspace "broken" cannot be opened' }).waitFor();
    await onStartScreen(page);

    // AC-11 with no workspace shown: each old chat address lands on the start screen. The redirect
    // is the same for a page load, so two typed-in addresses stand for bookmarks.
    for (const address of chatAddresses) {
      await navigateInApp(page, address);
      await onStartScreen(page);
    }
    for (const address of [chatAddresses[0]!, "/settings/threads"]) {
      await page.goto(new URL(address, page.url()).href);
      await page.waitForURL((url) => url.pathname === "/");
      await onStartScreen(page);
    }
  },
};
