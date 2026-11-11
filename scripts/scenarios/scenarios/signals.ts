// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { frameHolder } from "../browser.ts";
import { restartAndReload, setUp } from "../fixtures.ts";
import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { check } from "../support.ts";
import {
  layoutSaved,
  layoutState,
  layoutStates,
  openFromTree,
  recordLayoutStates,
  reloadShowing,
  shellList,
  shellPanel,
  shellReady,
  shellTab,
  startShell,
} from "./workspaceUi.ts";

const plainFolder = async (home: string, runId: string) => {
  const plain = NodePath.join(home, "folders", runId, "plain");
  await NodeFSP.mkdir(plain, { recursive: true });
  return plain;
};

/** The request that saves a workspace's tabs, as the page sends it. */
const SAVE_TABS = '"workspace.saveTabs"';

export const tabSignals: Scenario = {
  id: "T-041a",
  title: "a shell tab says it is attached and ready, hidden or not, after a reload and a restart",
  needs: { restart: true },
  run: async ({ server, openPage, runId }) => {
    const plain = await plainFolder(server.home, runId);
    const page = await openPage();
    let rpc = await connectRpc(server.origin, page);
    let stage = "setup";
    try {
      const shells = shellList(rpc.client);
      await setUp(page, [plain]);
      const hidden = await startShell(page, shells, plain);
      const shown = await startShell(page, shells, plain);
      const both = [hidden, shown];
      const readyBoth = async (target: typeof page, when: string) => {
        stage = when;
        for (const shell of both) await shellReady(target, shell.shellId);
      };

      // AC-6: the hidden tab stays mounted, attached and ready like the shown one.
      await readyBoth(page, "AC-6");
      check(
        (await shellPanel(page, hidden.shellId).getAttribute("hidden")) !== null,
        "The first shell's tab is not the hidden one (AC-6).",
      );

      // AC-4: after a reload, a server restart that reattaches the shells, and in a second client.
      await reloadShowing(page, "sparta");
      await readyBoth(page, "AC-4 reload");
      rpc = await restartAndReload(page, server, rpc);
      await readyBoth(page, "AC-4 restart");
      const other = await openPage();
      await reloadShowing(other, "sparta");
      await readyBoth(other, "AC-4 second client");
    } catch (error) {
      throw new Error(
        `T-041a failed at ${stage}: ${error instanceof Error ? error.message : error}`,
        {
          cause: error,
        },
      );
    } finally {
      await rpc.close();
    }
  },
};

export const layoutSignal: Scenario = {
  id: "T-041b",
  title: "the page says saved only once the server holds its last tab change",
  needs: {},
  run: async ({ server, openPage, runId }) => {
    const name = `sparta-${runId}`;
    const plain = await plainFolder(server.home, runId);
    const page = await openPage();
    await recordLayoutStates(page);
    const holder = await frameHolder(page);
    // Both apply from the next load on; the page opened already connected.
    await page.reload();
    await page.getByTestId("workspace-screen").waitFor();
    const rpc = await connectRpc(server.origin, page);
    let stage = "setup";
    try {
      const shells = shellList(rpc.client);
      await setUp(page, [plain], name);
      const started = [
        await startShell(page, shells, plain),
        await startShell(page, shells, plain),
        await startShell(page, shells, plain),
      ];
      await layoutSaved(page, name);

      // AC-11: quick tab changes show pending until the last save is confirmed. The saves are held
      // back so the changes are quicker than the saves on any machine.
      stage = "AC-11 quick changes";
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
      const held = await Effect.runPromise(rpc.client["workspace.open"]({ name }));
      check(
        held.tabs.active === started[0]!.shellId,
        `"saved" showed while the server held ${JSON.stringify(held.tabs)} (AC-11).`,
      );

      // AC-11: another client's tab change does not make this page pending.
      stage = "AC-11 second client";
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

      // AC-11: right after a reload, before any change, the page shows saved.
      stage = "AC-11 reload";
      await reloadShowing(page, name);
      await layoutState(page, "saved").waitFor();
      const afterReload = await layoutStates(page);
      check(
        !afterReload.includes("pending"),
        `After a reload with no change the page showed ${JSON.stringify(afterReload)} (AC-11).`,
      );
    } catch (error) {
      throw new Error(
        `T-041b failed at ${stage}: ${error instanceof Error ? error.message : error}`,
        {
          cause: error,
        },
      );
    } finally {
      await rpc.close();
    }
  },
};

export const layoutReload: Scenario = {
  id: "T-041c",
  title: "a reload after a tab change keeps the change only when it waits for saved",
  needs: {},
  run: async ({ server, openPage, runId }) => {
    const name = `sparta-${runId}`;
    const plain = await plainFolder(server.home, runId);
    const page = await openPage();
    const holder = await frameHolder(page);
    // The route applies from the next load on; the page opened already connected.
    await page.reload();
    await page.getByTestId("workspace-screen").waitFor();
    const rpc = await connectRpc(server.origin, page);
    let stage = "setup";
    const selected = async (shellId: string) =>
      (await shellTab(page, shellId).getAttribute("aria-selected")) === "true";
    try {
      const shells = shellList(rpc.client);
      await setUp(page, [plain], name);
      const first = await startShell(page, shells, plain);
      const second = await startShell(page, shells, plain);
      await layoutSaved(page, name);

      // Negative control (AC-12): a reload while the save is in flight brings the old tab back.
      stage = "AC-12 reload without waiting";
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

      // AC-12: the same change, waited for, survives the reload.
      stage = "AC-12 reload after saved";
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
    } catch (error) {
      throw new Error(
        `T-041c failed at ${stage}: ${error instanceof Error ? error.message : error}`,
        {
          cause: error,
        },
      );
    } finally {
      await rpc.close();
    }
  },
};
