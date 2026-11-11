// @effect-diagnostics nodeBuiltinImport:off - Reads the throwaway home and seeds workspace files in it.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { PointerPage } from "../browser.ts";
import { environmentId } from "../lib/api.ts";
import { expected } from "../lib/expect.ts";
import { revokeWrite, runtimePid } from "../lib/files.ts";
import { closeWorkspacesMenu, expectMenuOffers } from "../lib/scoped.ts";
import { waitForPath } from "../lib/navigate.ts";
import { followWorkspaces, setupOn, world } from "../lib/setup.ts";
import { alert } from "../lib/ui/dialog.ts";
import { workspaceShown } from "../lib/ui/tree.ts";
import {
  createWorkspace,
  fillCreateWorkspace,
  menuItem,
  openWorkspace,
  openWorkspacesMenu,
  removeWorkspace,
  startScreenButton,
} from "../lib/ui/workspacesMenu.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";
import type { ServerHandle } from "../server.ts";

const screen = (page: PointerPage) => page.getByTestId("workspace-screen");
const treeRoot = (page: PointerPage) => page.getByRole("tree").getByRole("treeitem");

async function shownWorkspace(page: PointerPage, name: string) {
  await workspaceShown(page, name);
  expected({
    what: `rows in the tree of the empty workspace ${name}`,
    expected: 1,
    found: await treeRoot(page).count(),
  });
}

async function onStartScreen(page: PointerPage) {
  await waitFor(startScreenButton(page, "Create workspace"), "the start screen");
  expected({
    what: "trees on the start screen",
    expected: 0,
    found: await page.getByRole("tree").count(),
  });
}

/** Client-side navigation, the way an in-app link or the back button reaches an address. */
async function navigateInApp(page: PointerPage, path: string) {
  // A string, since this package has no DOM types; it runs in the page.
  await page.evaluate(
    `window.history.pushState({}, "", ${JSON.stringify(path)});
     window.dispatchEvent(new PopStateEvent("popstate"));`,
  );
  await waitForPath(page, "/", `${path} to redirect to /`);
}

/** A page load of `path`, the way a bookmark or a typed-in address reaches it. */
async function loadAddress(page: PointerPage, path: string) {
  await page.goto(new URL(path, page.url()).href);
  await waitForPath(page, "/", `the page load of ${path} to redirect to /`);
}

const workspacesDir = (server: ServerHandle) =>
  NodePath.join(server.home, "userdata", "workspaces");

/** Writes a workspace file straight into the server's folder, as a user or another tool would. */
async function seedWorkspace(server: ServerHandle, name: string, contents: string) {
  const path = NodePath.join(workspacesDir(server), `${name}.json`);
  await NodeFSP.writeFile(path, contents);
  return path;
}

/** The 13 chat-era addresses; each is reached in the app once, split over the two route checks. */
async function chatAddresses(server: ServerHandle): Promise<ReadonlyArray<string>> {
  const envId = await environmentId(server.origin);
  return [
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
    "/guest",
  ];
}
const SHOWN_ADDRESSES = 7;

export const startScreen = defineCheck(import.meta.url, {
  id: "S1.start-screen",
  title: "the first page is the start screen, offering only Open and Create workspace",
  needs: { pristineHome: true },
  covers: ["S1 AC-1"],
  run: async ({ server, openPage, trail }) => {
    await trail.stage("the harness's server and home", async () => {
      expected({
        what: `the pid of the server using ${server.home}`,
        expected: server.pid(),
        found: await runtimePid(server),
      });
      const home = await NodeFSP.realpath(server.home);
      expected({
        what: `whether the throwaway home ${home} is inside ~/.t3`,
        expected: false,
        found: home.startsWith(NodePath.join(NodeOS.homedir(), ".t3")),
      });
    });
    const page = await openPage();
    await trail.stage("AC-1", async () => {
      await onStartScreen(page);
      expected({
        what: "error states on the first page",
        expected: 0,
        found: await page.getByText("Something went wrong.").count(),
      });
      const labels = await screen(page).getByRole("button").allTextContents();
      expected({
        what: "the start screen's buttons",
        expected: ["Create workspace", "Open workspace"],
        found: labels
          .map((label) =>
            label.includes("Open workspace")
              ? "Open workspace"
              : label.includes("Create workspace")
                ? "Create workspace"
                : label.trim(),
          )
          .toSorted(),
      });
      expected({
        what: "chat thread sidebars",
        expected: 0,
        found: await page.getByRole("navigation", { name: "Threads" }).count(),
      });
      // The app sidebar stays, holding the workspace; its chat utilities do not.
      await waitFor(page.getByRole("navigation", { name: "Workspace" }), "the workspace sidebar");
      for (const label of ["Pull requests", "Usage"]) {
        expected({
          what: `"${label}" buttons in the sidebar`,
          expected: 0,
          found: await page.getByRole("button", { name: label }).count(),
        });
      }
    });
  },
});

export const createFromStartScreen = defineCheck(import.meta.url, {
  id: "S1.create-workspace",
  title: "a workspace created from the start screen is the root of an empty tree",
  needs: {},
  covers: ["S1 AC-2"],
  run: async ({ runId, openPage, trail }) => {
    const page = await openPage();
    const name = `sparta-${runId}`;
    await trail.stage("AC-2", async () => {
      await onStartScreen(page);
      await createWorkspace(page, name, { from: "start screen" });
      await shownWorkspace(page, name);
    });
  },
});

export const nameRefusals = defineCheck(import.meta.url, {
  id: "S1.name-refusals",
  title: "an empty, file-unsafe or taken name is refused with a reason",
  needs: {},
  // Both are the create dialog's refusals of a name; only the taken one needs a workspace.
  covers: ["S1 AC-13", "S1 AC-14"],
  run: async (ctx) => {
    const page = await ctx.openPage();
    const setup = await setupOn(ctx, { as: page });
    const ws = await setup.workspace("sparta");
    await ctx.trail.stage("AC-13", async () => {
      await onStartScreen(page);
      await startScreenButton(page, "Create workspace").click();
      expected({
        what: "the refusal of an empty name",
        expected: "Enter a name.",
        found: await fillCreateWorkspace(page, ""),
      });
      await startScreenButton(page, "Create workspace").click();
      expected({
        what: "whether a name with a slash is refused",
        expected: true,
        found: (await fillCreateWorkspace(page, "a/b")) !== null,
      });
    });
    await ctx.trail.stage("AC-14", async () => {
      const taken = ws.name.toUpperCase();
      await openWorkspace(page, ws.name);
      await shownWorkspace(page, ws.name);
      await openWorkspacesMenu(page);
      await page.getByRole("menuitem", { name: "Create workspace" }).click();
      const refusal = await fillCreateWorkspace(page, taken);
      expected({
        what: `whether creating ${taken} is refused as taken`,
        expected: true,
        found: refusal?.includes("already exists") ?? "no refusal",
      });
    });
  },
});

export const secondWorkspace = defineCheck(import.meta.url, {
  id: "S1.second-workspace",
  title: "a second workspace from the Workspaces menu is listed, and switching shows each once",
  needs: {},
  // One switch flow: create a second, list both, switch back, then choose the shown one again.
  covers: ["S1 AC-3", "S1 AC-4", "S1 AC-8", "S1 AC-9"],
  run: async (ctx) => {
    const { workspace: sparta, shown } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const athens = `athens-${ctx.runId}`;
    await ctx.trail.stage("AC-3", async () => {
      await createWorkspace(page, athens);
      await shownWorkspace(page, athens);
      await expectMenuOffers(page, "Open workspace", { includes: [athens, sparta.name] });
    });
    await ctx.trail.stage("AC-4, AC-8", async () => {
      await openWorkspace(page, sparta.name);
      await shownWorkspace(page, sparta.name);
    });
    await ctx.trail.stage("AC-9", async () => {
      await openWorkspace(page, sparta.name);
      await shownWorkspace(page, sparta.name);
      await openWorkspacesMenu(page, "Open workspace");
      await waitFor(menuItem(page, sparta.name), `"Open workspace" to offer ${sparta.name}`);
      expected({
        what: `entries for ${sparta.name} after choosing it while shown`,
        expected: 1,
        found: await menuItem(page, sparta.name).count(),
      });
      await closeWorkspacesMenu(page);
    });
  },
});

export const removeOther = defineCheck(import.meta.url, {
  id: "S1.remove-other",
  title: "removing another workspace keeps the shown one and leaves its folder on disk",
  needs: {},
  covers: ["S1 AC-5"],
  run: async (ctx) => {
    const { workspace: kept, shown, setup } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const other = await setup.workspace("athens");
    const folder = await setup.folder("athens-project");
    await setup.project(other, folder);
    const names = followWorkspaces(setup.client);
    await ctx.trail.stage("AC-5", async () => {
      const from = names.mark();
      await removeWorkspace(page, other.name);
      await names.until(
        `the server to stop listing ${other.name}`,
        (list) => !list.includes(other.name),
        from,
      );
      await shownWorkspace(page, kept.name);
      await expectMenuOffers(page, "Open workspace", {
        includes: [kept.name],
        excludes: [other.name],
      });
      expected({
        what: `whether the removed workspace's folder ${folder.path} is on disk`,
        expected: true,
        found: await NodeFSP.access(folder.path).then(
          () => true,
          (error: unknown) => String(error),
        ),
      });
    });
  },
});

export const removeShown = defineCheck(import.meta.url, {
  id: "S1.remove-shown",
  title: "removing the shown workspace returns to the start screen, which lists the rest",
  needs: {},
  covers: ["S1 AC-6"],
  run: async (ctx) => {
    const { workspace: removed, shown, setup } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const rest = await setup.workspace("rest");
    const names = followWorkspaces(setup.client);
    await ctx.trail.stage("AC-6", async () => {
      const from = names.mark();
      await removeWorkspace(page, removed.name);
      await names.until(
        `the server to stop listing ${removed.name}`,
        (list) => !list.includes(removed.name),
        from,
      );
      await onStartScreen(page);
      await startScreenButton(page, "Open workspace").click();
      await waitFor(menuItem(page, rest.name), `the start screen to offer ${rest.name}`);
      await waitFor(
        menuItem(page, removed.name),
        `the start screen to stop offering ${removed.name}`,
        { state: "detached" },
      );
      const offered = await page.getByRole("menu").last().getByRole("menuitem").allTextContents();
      const offeredNames = offered.map((name) => name.trim());
      expected({
        what: "which of the scenario's workspaces the start screen offers",
        expected: [rest.name],
        found: [rest.name, removed.name].filter((name) => offeredNames.includes(name)),
      });
      await closeWorkspacesMenu(page);
    });
  },
});

export const settingsNoChat = defineCheck(import.meta.url, {
  id: "S1.settings-no-chat",
  title: "settings opens from the sidebar footer and lists no chat page",
  needs: {},
  covers: ["S1 AC-10"],
  run: async (ctx) => {
    const { workspace: ws, shown } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    await ctx.trail.stage("AC-10", async () => {
      await page.getByRole("button", { name: "Settings" }).click();
      const section = (path: string) => page.locator(`[data-settings-section="${path}"]`);
      await waitFor(section("/settings/connections"), "the Connections settings section");
      for (const path of [
        "/settings/chat",
        "/settings/threads",
        "/settings/providers",
        "/settings/snap-shot",
      ]) {
        expected({
          what: `settings sections for ${path}`,
          expected: 0,
          found: await section(path).count(),
        });
      }
      await page.goBack();
      await shownWorkspace(page, ws.name);
    });
  },
});

export const chatRoutesShown = defineCheck(import.meta.url, {
  id: "S1.chat-routes-shown",
  title: "with a workspace shown, chat addresses and chat shortcuts change nothing",
  needs: {},
  // One page showing a workspace: chat addresses and chat shortcuts both leave it shown.
  covers: ["S1 AC-11 with a workspace shown", "S1 AC-12"],
  run: async (ctx) => {
    const { workspace: ws, shown, setup } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const addresses = (await chatAddresses(ctx.server)).slice(0, SHOWN_ADDRESSES);
    // A project gives chat shortcuts something to start a thread in, had they stayed installed (AC-12).
    const folder = await setup.folder("chat-project");
    await ctx.server.cli(["project", "add", folder.path, "--title", `chat-project-${ctx.runId}`]);
    await ctx.trail.stage("AC-11 with a workspace shown", async () => {
      for (const address of addresses) {
        await navigateInApp(page, address);
        await shownWorkspace(page, ws.name);
      }
      await loadAddress(page, addresses[0]!);
      await shownWorkspace(page, ws.name);
    });
    await ctx.trail.stage("AC-12", async () => {
      // Count every navigation the page starts, so a working chat shortcut is caught even though
      // the draft address it opens would redirect back to "/".
      await page.evaluate(`(() => {
        window.__probeNavigations = 0;
        for (const method of ["pushState", "replaceState"]) {
          const original = window.history[method].bind(window.history);
          window.history[method] = (...args) => {
            window.__probeNavigations += 1;
            return original(...args);
          };
        }
      })()`);
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
      expected({
        what: "navigations the chat shortcuts started",
        expected: 0,
        found: await page.evaluate("window.__probeNavigations"),
      });
      await shownWorkspace(page, ws.name);
    });
  },
});

export const chatRoutesStartScreen = defineCheck(import.meta.url, {
  id: "S1.chat-routes-start-screen",
  title: "with no workspace shown, each chat address lands on the start screen",
  needs: {},
  covers: ["S1 AC-11 with none shown"],
  run: async (ctx) => {
    const page = await ctx.openPage();
    const addresses = (await chatAddresses(ctx.server)).slice(SHOWN_ADDRESSES);
    await ctx.trail.stage("AC-11 with none shown", async () => {
      await onStartScreen(page);
      for (const address of addresses) {
        await navigateInApp(page, address);
        await onStartScreen(page);
      }
      // The redirect is the same for a page load, so one typed-in address stands for bookmarks.
      await loadAddress(page, "/settings/threads");
      await onStartScreen(page);
    });
  },
});

export const reloadKeepsSaved = defineCheck(import.meta.url, {
  id: "S1.reload-keeps-saved",
  title: "a reload shows the same workspace and keeps every saved one listed, a seeded one too",
  needs: { serverWide: "writes into the server's workspaces folder" },
  // One reload: it shows the same workspace (AC-20) and its list keeps every saved one (AC-7).
  covers: ["S1 AC-20", "S1 AC-7"],
  run: async (ctx) => {
    const { workspace: ws, shown } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const delphi = `delphi-${ctx.runId}`;
    await ctx.trail.stage("AC-20, AC-7", async () => {
      await seedWorkspace(ctx.server, delphi, '{"version":1}');
      await page.reload();
      await shownWorkspace(page, ws.name);
      await expectMenuOffers(page, "Open workspace", { includes: [delphi, ws.name] });
      await openWorkspace(page, delphi);
      await shownWorkspace(page, delphi);
    });
  },
});

export const invalidWorkspace = defineCheck(import.meta.url, {
  id: "S1.invalid-workspace",
  title: "an invalid or unreadable workspace stays listed and is refused when chosen",
  needs: { serverWide: "writes into the server's workspaces folder" },
  covers: ["S1 AC-15"],
  run: async (ctx) => {
    const broken = `broken-${ctx.runId}`;
    const locked = `locked-${ctx.runId}`;
    await seedWorkspace(ctx.server, broken, "not json");
    const lockedFile = await seedWorkspace(ctx.server, locked, '{"version":1}');
    const { workspace: ws, shown } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const refusedOnOpen = async (name: string) => {
      await openWorkspace(page, name);
      await waitFor(
        alert(page, `Workspace "${name}" cannot be opened`),
        `the refusal to open ${name}`,
      );
      await shownWorkspace(page, ws.name);
    };
    await ctx.trail.stage("AC-15 from the menu", async () => {
      await refusedOnOpen(broken);
      await revokeWrite(
        ctx,
        lockedFile,
        "AC-15 unreadable workspace",
        () => refusedOnOpen(locked),
        { unreadable: true },
      );
    });
    // A page of its own, so the menu's refusal toast cannot answer for this one.
    await ctx.trail.stage("AC-15 from the start screen", async () => {
      const fresh = await ctx.openPage();
      await onStartScreen(fresh);
      await startScreenButton(fresh, "Open workspace").click();
      await menuItem(fresh, broken).click();
      await waitFor(
        alert(fresh, `Workspace "${broken}" cannot be opened`),
        `the start screen's refusal to open ${broken}`,
      );
      await onStartScreen(fresh);
    });
  },
});

export const folderUnwritable = defineCheck(import.meta.url, {
  id: "S1.folder-unwritable",
  title: "when the workspaces folder cannot change, create and remove say why and the list stays",
  needs: { serverWide: "makes the workspaces folder read-only" },
  // One read-only folder refuses both changes: the create (AC-16) and the remove (AC-17).
  covers: ["S1 AC-16", "S1 AC-17"],
  run: async (ctx) => {
    const { workspace: ws, shown } = await world(ctx, { projects: [], page: true });
    const page = shown!.page;
    const olympia = `olympia-${ctx.runId}`;
    await ctx.trail.stage("AC-16, AC-17", async () => {
      await revokeWrite(
        ctx,
        workspacesDir(ctx.server),
        "AC-16, AC-17 folder that cannot change",
        async () => {
          await openWorkspacesMenu(page);
          await page.getByRole("menuitem", { name: "Create workspace" }).click();
          const refusal = await fillCreateWorkspace(page, olympia);
          expected({
            what: `whether creating ${olympia} in a read-only folder is refused`,
            expected: true,
            found: refusal?.includes("Could not create") ?? "no refusal",
          });
          await removeWorkspace(page, ws.name);
          await waitFor(alert(page, "Could not remove"), `the refusal to remove ${ws.name}`);
          await expectMenuOffers(page, "Open workspace", {
            includes: [ws.name],
            excludes: [olympia],
          });
        },
      );
    });
  },
});

export const successors = [
  startScreen,
  createFromStartScreen,
  nameRefusals,
  secondWorkspace,
  removeOther,
  removeShown,
  settingsNoChat,
  chatRoutesShown,
  chatRoutesStartScreen,
  reloadKeepsSaved,
  invalidWorkspace,
  folderUnwritable,
];
