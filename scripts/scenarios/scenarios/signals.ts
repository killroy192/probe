import * as Effect from "effect/Effect";

import { frameHolder, type PointerPage } from "../browser.ts";
import {
  layoutSaved,
  layoutState,
  layoutStates,
  openTab,
  recordLayoutStates,
  reloadShowing,
  restartAndReload,
  showWorkspace,
} from "../lib/navigate.ts";
import { setupOn, type Setup, type ShellResult } from "../lib/setup.ts";
import { shellTab } from "../lib/ui/tabs.ts";
import { shellPanel, shellReady } from "../lib/ui/terminal.ts";
import { openFromTree } from "../lib/ui/tree.ts";
import { expected } from "../lib/expect.ts";
import { check } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

/** The request that saves a workspace's tabs, as the page sends it. */
const SAVE_TABS = '"workspace.saveTabs"';

/** A workspace with one plain folder and `count` shells in it, made over the API. */
async function shellsInFolder(setup: Setup, count: number) {
  const ws = await setup.workspace("signals");
  const project = await setup.project(ws, await setup.folder("plain"));
  const shells: Array<ShellResult> = [];
  for (let n = 0; n < count; n++) shells.push(await setup.shell(project));
  return { ws, shells };
}

/** A page showing a workspace with two shells, both tabs open and the first one hidden. */
async function twoTabs(ctx: ScenarioContext) {
  const page = await ctx.openPage();
  const setup = await setupOn(ctx, { as: page });
  const { ws, shells: both } = await shellsInFolder(setup, 2);
  await showWorkspace(page, ws);
  for (const shell of both) await openTab(page, shell);
  const readyBoth = async (target: PointerPage) => {
    for (const shell of both) await shellReady(target, shell.shellId);
  };
  return { page, setup, ws, hidden: both[0]!, readyBoth };
}

export const hiddenAndReload = defineCheck(import.meta.url, {
  id: "T-041a.hidden-and-reload",
  title:
    "a shell tab says it is attached and ready while hidden, after a reload and in a second client",
  needs: {},
  // One page with a hidden and a shown tab: each later stage reads the same two tabs again.
  verifies: ["reload-and-restart/FR-27", "reload-and-restart/FR-28", "reload-and-restart/FR-29"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, ws, hidden, readyBoth } = await twoTabs(ctx);

    await trail.stage("ready while hidden", async () => {
      await readyBoth(page);
      expected({
        what: `the hidden attribute on shell ${hidden.shellId}'s tab`,
        expected: true,
        found: (await shellPanel(page, hidden.shellId).getAttribute("hidden")) !== null,
      });
    });
    await trail.stage("ready after reload", async () => {
      await reloadShowing(page, ws.name);
      await readyBoth(page);
    });
    await trail.stage("ready in second client", async () => {
      const other = await ctx.openPage();
      await reloadShowing(other, ws.name);
      await readyBoth(other);
    });
  },
});

export const afterRestart = defineCheck(import.meta.url, {
  id: "T-041a.after-restart",
  title: "a shell tab says it is attached and ready again after a server restart reattaches it",
  needs: { restart: true },
  // One restart: the tabs are ready before it and again once it reattaches them.
  verifies: ["reload-and-restart/FR-27", "reload-and-restart/FR-30"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, setup, ws, readyBoth } = await twoTabs(ctx);
    await readyBoth(page);

    await trail.stage("ready after restart", async () => {
      await restartAndReload(ctx, page, ws, setup);
      await readyBoth(page);
    });
  },
});

export const successors = [hiddenAndReload, afterRestart];

export const layoutSignal = defineCheck(import.meta.url, {
  id: "T-041b",
  title: "the page says saved only once the server holds its last tab change",
  needs: {},
  // One workspace's layout signal, read across quick changes, another client and a reload.
  verifies: ["reload-and-restart/FR-31", "reload-and-restart/FR-32", "reload-and-restart/FR-33"],
  run: async (ctx) => {
    const { openPage, trail } = ctx;
    const page = await openPage();
    await recordLayoutStates(page);
    const holder = await frameHolder(page);
    // Both apply from the next load on; the page opened already connected.
    await page.reload();
    await page.getByTestId("workspace-screen").waitFor();
    const setup = await setupOn(ctx, { as: page });
    const { ws, shells: started } = await shellsInFolder(setup, 3);
    const name = ws.name;
    await showWorkspace(page, ws);
    for (const shell of started) await openTab(page, shell);
    await layoutSaved(page, name);

    // Quick tab changes show pending until the last save is confirmed. The saves are held
    // back so the changes are quicker than the saves on any machine.
    await trail.stage("quick changes", async () => {
      const before = (await layoutStates(page)).length;
      holder.hold(SAVE_TABS);
      // From the last tab to the first, so the last change differs from what the server held.
      for (const shell of started.toReversed()) await shellTab(page, shell.shellId).click();
      await layoutState(page, "pending").waitFor();
      holder.release();
      await layoutSaved(page, name);
      const shownSince = (await layoutStates(page)).slice(before);
      check(
        shownSince.indexOf("saved") === shownSince.length - 1 && shownSince[0] === "pending",
        `Between the first change and the last save the page showed ${JSON.stringify(shownSince)}.`,
      );
      const held = await Effect.runPromise(setup.client["workspace.open"]({ name }));
      check(
        held.tabs.active === started[0]!.shellId,
        `"saved" showed while the server held ${JSON.stringify(held.tabs)}.`,
      );
    });

    await trail.stage("another client's change", async () => {
      const other = await openPage();
      await reloadShowing(other, name);
      const beforeOther = (await layoutStates(page)).length;
      await openFromTree(other, started[1]!.shellId);
      await layoutSaved(other, name);
      const afterOther = (await layoutStates(page)).slice(beforeOther);
      check(
        !afterOther.includes("pending"),
        `Another client's change made this page show ${JSON.stringify(afterOther)}.`,
      );
    });

    await trail.stage("saved after reload", async () => {
      await reloadShowing(page, name);
      await layoutState(page, "saved").waitFor();
      const afterReload = await layoutStates(page);
      check(
        !afterReload.includes("pending"),
        `After a reload with no change the page showed ${JSON.stringify(afterReload)}.`,
      );
    });
  },
});

export const layoutReload = defineCheck(import.meta.url, {
  id: "T-041c",
  title: "a reload after a tab change keeps the change only when it waits for saved",
  needs: {},
  verifies: ["reload-and-restart/FR-34"],
  run: async (ctx) => {
    const { openPage, trail } = ctx;
    const page = await openPage();
    const holder = await frameHolder(page);
    // The route applies from the next load on; the page opened already connected.
    await page.reload();
    await page.getByTestId("workspace-screen").waitFor();
    const selected = async (shellId: string) =>
      (await shellTab(page, shellId).getAttribute("aria-selected")) === "true";
    const setup = await setupOn(ctx, { as: page });
    const { ws, shells } = await shellsInFolder(setup, 2);
    const [first, second] = shells as [ShellResult, ShellResult];
    const name = ws.name;
    await showWorkspace(page, ws);
    for (const shell of shells) await openTab(page, shell);
    await layoutSaved(page, name);

    // Negative control: a reload while the save is in flight brings the old tab back.
    await trail.stage("reload without waiting", async () => {
      holder.hold(SAVE_TABS);
      await shellTab(page, first.shellId).click();
      await layoutState(page, "pending").waitFor();
      await page.reload();
      holder.discard();
      await shellTab(page, second.shellId).waitFor();
      check(
        await selected(second.shellId),
        "The tab strip kept a change whose save never reached the server: the control proves nothing.",
      );
    });

    await trail.stage("reload after saved", async () => {
      holder.hold(SAVE_TABS);
      await shellTab(page, first.shellId).click();
      await layoutState(page, "pending").waitFor();
      const saved = layoutSaved(page, name);
      holder.release();
      await saved;
      await reloadShowing(page, name);
      await shellTab(page, first.shellId).waitFor();
      check(await selected(first.shellId), "The tab change waited for did not survive the reload.");
    });
  },
});
