// @effect-diagnostics nodeBuiltinImport:off - Moves a project folder and ends a shell's process from outside.

import * as NodeFSP from "node:fs/promises";
import * as NodeProcess from "node:process";

import { layoutSaved, openTab, reloadShowing, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn, type ShellResult } from "../lib/setup.ts";
import { history, shellEnded } from "../lib/shells.ts";
import { shellTab } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import {
  endedRow,
  openFromTree,
  restoreButton,
  restoreFromTree,
  shellRow,
} from "../lib/ui/tree.ts";
import { check, waitFor } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";

export const restoreShell: Scenario = {
  id: "S8",
  title: "restore an ended shell in place, only when the user asks",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, trail } = ctx;
    const page = await ctx.openPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    const frames = pageFrames(page);
    let setup = await setupOn(ctx, { as: page });
    const latest = (shell: Pick<ShellResult, "shellId">) =>
      setup.shells.current().find((entry) => entry.shellId === shell.shellId);
    const rowShown = (shell: ShellResult) =>
      waitFor(shellRow(page, shell.shellId), `the tree row of shell ${shell.shellId}`);
    const signal = async (shell: ShellResult) => {
      NodeProcess.kill(shell.pid!, "SIGKILL");
      await shellEnded(setup.shells, shell);
      await waitFor(endedRow(page, shell.shellId), `the row of shell ${shell.shellId} as ended`);
    };
    // A kill over the API; S6 owns the kill from the tree.
    const removed = async (shell: ShellResult) => {
      // A restore starts a new process, so the pid to see end is the one listed now.
      await setup.killShell({ ...shell, pid: latest(shell)?.pid ?? null });
      await waitFor(shellRow(page, shell.shellId), `the row of shell ${shell.shellId} to leave`, {
        state: "detached",
      });
    };

    const { ws, plain, moved } = await trail.stage("setup", async () => {
      const ws = await setup.workspace("s8");
      const plainFolder = await setup.folder("plain");
      const movedFolder = await setup.folder("moved");
      const plain = await setup.project(ws, plainFolder);
      const moved = await setup.project(ws, movedFolder);
      await showWorkspace(page, ws);
      return { ws, plain, moved: { project: moved, path: movedFolder.path } };
    });

    // A signal ends a shell: it stays listed, and only the user's Restore starts it again.

    const first = await trail.stage("restore after a signal", async () => {
      const first = await setup.shell(plain);
      await openTab(page, first);
      const typedFirst = frames.mark();
      await typeLine(page, "echo before-s8-$((40+2))");
      await frames.until("the first line", (frame) => frame.includes("before-s8-42"), typedFirst);
      await signal(first);
      check(
        latest(first)?.restored === false && (await shellTab(page, first.shellId).count()) === 0,
        "An ended shell restored itself or kept its tab.",
      );
      // Lists from before the signal show it running too; only lists after the restore count.
      const restoredFrom = setup.shells.lists.mark();
      await restoreFromTree(page, first.shellId);
      const again = await setup.shells.lists.until(
        "the shell to run again",
        (list) =>
          list.some(
            (entry) =>
              entry.shellId === first.shellId && entry.status === "running" && entry.restored,
          ),
        restoredFrom,
      );
      const restored = again.find((entry) => entry.shellId === first.shellId)!;
      check(
        restored.restored && restored.pid !== first.pid,
        "The restore did not start a new shell.",
      );
      check(restored.cwd === first.cwd, "The restored shell is in another folder.");
      await waitFor(
        page.locator(`[data-shell-row="${first.shellId}"] [data-restored]`),
        `the row of shell ${first.shellId} as restored`,
      );
      // Its tab was open when it ended, so it comes back; a closed tab would stay closed.
      await waitFor(shellTab(page, first.shellId), `the tab of shell ${first.shellId} to return`);
      check(
        !(await history(setup.client, first.shellId)).includes("before-s8-42"),
        "The restored shell shows the earlier output.",
      );
      await openFromTree(page, first.shellId);
      const typedAfter = frames.mark();
      await typeLine(page, "echo after-s8-$((40+2))");
      await frames.until(
        "the restored shell's line",
        (frame) => frame.includes("after-s8-42"),
        typedAfter,
      );
      return first;
    });

    // A shell lost with the whole host (a reboot) is restorable the same way.

    await trail.stage("restore after a restart", async () => {
      await layoutSaved(page, ws.name);
      await setup.close();
      await server.stop();
      await server.stopShellHost();
      await server.restart();
      await reloadShowing(page, ws.name);
      setup = await setupOn(ctx, { as: page });
      // A fresh subscription: its first list is the server's state after the restart.
      await setup.shells.lists.until("the shell list after the restart", () => true, 0);
      await waitFor(endedRow(page, first.shellId), `the row of shell ${first.shellId} as ended`);
      // The ended shell keeps its number, so a new one does not take it (PRB.T-015).
      const next = await setup.shell(plain);
      await rowShown(next);
      const titles = new Map(
        [first, next].map((shell) => [shell.shellId, latest(shell)?.title] as const),
      );
      check(
        titles.get(first.shellId) === "Shell 1" && titles.get(next.shellId) === "Shell 2",
        `A shell started after the restart is "${titles.get(next.shellId)}", next to "${titles.get(first.shellId)}".`,
      );
      await restoreFromTree(page, first.shellId);
      for (const shell of [first, next]) {
        const title = titles.get(shell.shellId)!;
        const row = (await shellRow(page, shell.shellId).textContent()) ?? "";
        check(row.includes(title), `The tree shows "${row}" for ${title}.`);
      }
      await openFromTree(page, first.shellId);
      const typedRebooted = frames.mark();
      await typeLine(page, "echo rebooted-s8-$((40+2))");
      await frames.until(
        "the shell after the restart",
        (frame) => frame.includes("rebooted-s8-42"),
        typedRebooted,
      );
    });

    // Shells that leave for good offer nothing to restore.

    await trail.stage("no restore for exit or kill", async () => {
      const exited = await setup.shell(plain);
      await openTab(page, exited);
      await typeLine(page, "false; exit");
      await waitFor(shellRow(page, exited.shellId), `the row of shell ${exited.shellId} to leave`, {
        state: "detached",
      });
      const killed = await setup.shell(plain);
      await rowShown(killed);
      await removed(killed);
    });

    // A shell whose folder is gone is unavailable, not restorable.

    const inMoved = await trail.stage("no restore for a moved folder", async () => {
      const inMoved = await setup.shell(moved.project);
      await rowShown(inMoved);
      await signal(inMoved);
      await NodeFSP.rename(moved.path, `${moved.path}-elsewhere`);
      await waitFor(
        page.locator(`[data-shell-row="${inMoved.shellId}"] [data-missing]`),
        `the row of shell ${inMoved.shellId} as missing its folder`,
      );
      await page.locator(`[data-shell-row="${inMoved.shellId}"]`).hover();
      check(
        (await restoreButton(page, inMoved.shellId).count()) === 0,
        "A shell in a moved folder offers Restore.",
      );
      return inMoved;
    });

    // Removing a restored shell still works.

    await trail.stage("remove after restore", async () => {
      await removed(first);
      await removed(inMoved);
      const ids = [first.shellId, inMoved.shellId];
      await setup.shells.lists.until(
        "the removed shells to leave the list",
        (list) => list.every((entry) => !ids.includes(entry.shellId)),
        Math.max(0, setup.shells.lists.mark() - 1),
      );
    });
  },
};
