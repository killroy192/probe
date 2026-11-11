import * as Effect from "effect/Effect";

import { frameHolder } from "../browser.ts";
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
import { check } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";

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

export const tabSignals: Scenario = {
  id: "T-041a",
  title: "a shell tab says it is attached and ready, hidden or not, after a reload and a restart",
  needs: { restart: true },
  run: async (ctx) => {
    const { openPage, trail } = ctx;
    const page = await openPage();
    const setup = await setupOn(ctx, { as: page });
    const { ws, shells: both } = await shellsInFolder(setup, 2);
    const hidden = both[0]!;
    await showWorkspace(page, ws);
    for (const shell of both) await openTab(page, shell);
    const readyBoth = async (target: typeof page) => {
      for (const shell of both) await shellReady(target, shell.shellId);
    };

    // AC-6: the hidden tab stays mounted, attached and ready like the shown one.
    await trail.stage("AC-6", async () => {
      await readyBoth(page);
      check(
        (await shellPanel(page, hidden.shellId).getAttribute("hidden")) !== null,
        "The first shell's tab is not the hidden one (AC-6).",
      );
    });

    // AC-4: after a reload, a server restart that reattaches the shells, and in a second client.
    await trail.stage("AC-4 reload", async () => {
      await reloadShowing(page, ws.name);
      await readyBoth(page);
    });
    await trail.stage("AC-4 restart", async () => {
      await restartAndReload(ctx, page, ws, setup);
      await readyBoth(page);
    });
    await trail.stage("AC-4 second client", async () => {
      const other = await openPage();
      await reloadShowing(other, ws.name);
      await readyBoth(other);
    });
  },
};

export const layoutSignal: Scenario = {
  id: "T-041b",
  title: "the page says saved only once the server holds its last tab change",
  needs: {},
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

    // AC-11: quick tab changes show pending until the last save is confirmed. The saves are held
    // back so the changes are quicker than the saves on any machine.
    await trail.stage("AC-11 quick changes", async () => {
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
        `Between the first change and the last save the page showed ${JSON.stringify(shownSince)} (AC-11).`,
      );
      const held = await Effect.runPromise(setup.client["workspace.open"]({ name }));
      check(
        held.tabs.active === started[0]!.shellId,
        `"saved" showed while the server held ${JSON.stringify(held.tabs)} (AC-11).`,
      );
    });

    // AC-11: another client's tab change does not make this page pending.
    await trail.stage("AC-11 second client", async () => {
      const other = await openPage();
      await reloadShowing(other, name);
      const beforeOther = (await layoutStates(page)).length;
      await openFromTree(other, started[1]!.shellId);
      await layoutSaved(other, name);
      const afterOther = (await layoutStates(page)).slice(beforeOther);
      check(
        !afterOther.includes("pending"),
        `Another client's change made this page show ${JSON.stringify(afterOther)} (AC-11).`,
      );
    });

    // AC-11: right after a reload, before any change, the page shows saved.
    await trail.stage("AC-11 reload", async () => {
      await reloadShowing(page, name);
      await layoutState(page, "saved").waitFor();
      const afterReload = await layoutStates(page);
      check(
        !afterReload.includes("pending"),
        `After a reload with no change the page showed ${JSON.stringify(afterReload)} (AC-11).`,
      );
    });
  },
};

export const layoutReload: Scenario = {
  id: "T-041c",
  title: "a reload after a tab change keeps the change only when it waits for saved",
  needs: {},
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

    // Negative control (AC-12): a reload while the save is in flight brings the old tab back.
    await trail.stage("AC-12 reload without waiting", async () => {
      holder.hold(SAVE_TABS);
      await shellTab(page, first.shellId).click();
      await layoutState(page, "pending").waitFor();
      await page.reload();
      holder.discard();
      await shellTab(page, second.shellId).waitFor();
      check(
        await selected(second.shellId),
        "The tab strip kept a change whose save never reached the server: the control proves nothing (AC-12).",
      );
    });

    // AC-12: the same change, waited for, survives the reload.
    await trail.stage("AC-12 reload after saved", async () => {
      holder.hold(SAVE_TABS);
      await shellTab(page, first.shellId).click();
      await layoutState(page, "pending").waitFor();
      const saved = layoutSaved(page, name);
      holder.release();
      await saved;
      await reloadShowing(page, name);
      await shellTab(page, first.shellId).waitFor();
      check(
        await selected(first.shellId),
        "The tab change waited for did not survive the reload (AC-12).",
      );
    });
  },
};
