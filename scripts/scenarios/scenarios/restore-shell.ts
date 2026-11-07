// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures, moves one, and ends a shell's process from outside.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { ShellSummary } from "@t3tools/contracts";

import { connectRpc } from "../rpc.ts";
import type { PointerPage } from "../browser.ts";
import type { Scenario } from "../scenario.ts";
import { gone, pageFrames } from "../support.ts";
import {
  addProject,
  check,
  createWorkspace,
  history,
  killFromTree,
  leaveAgent,
  openFromTree,
  reloadShowing,
  shellList,
  shellRow,
  shellTab,
  startShell,
  typeLine,
} from "./workspaceUi.ts";

const endedRow = (page: PointerPage, shellId: string) =>
  page.locator(`[data-shell-id="${shellId}"][data-ended]`);

const restoreButton = (page: PointerPage, shellId: string) =>
  page.locator(`[data-shell-row="${shellId}"]`).getByRole("button", { name: /^Restore / });

/** Clicks the "Restore" a row offers once it has ended; the row must stop being ended. */
async function restoreFromTree(page: PointerPage, shellId: string) {
  await page.locator(`[data-shell-row="${shellId}"]`).hover();
  await restoreButton(page, shellId).click();
  await endedRow(page, shellId).waitFor({ state: "detached" });
}

export const restoreShell: Scenario = {
  id: "S8",
  title: "restore an ended shell in place, only when the user asks",
  run: async ({ server, openPage }) => {
    const folders = NodePath.join(server.home, "folders");
    const plain = NodePath.join(folders, "plain");
    const moved = NodePath.join(folders, "moved");
    for (const dir of [plain, moved]) await NodeFSP.mkdir(dir, { recursive: true });

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    const frames = pageFrames(page);
    let rpc = await connectRpc(server.origin, page);
    let shells = shellList(rpc.client);
    const latest = (shell: ShellSummary) =>
      shells.current().find((entry) => entry.shellId === shell.shellId);
    const signal = async (shell: ShellSummary) => {
      NodeProcess.kill(shell.pid!, "SIGKILL");
      check(await gone(shell.pid!), `Shell ${shell.shellId} survived SIGKILL.`);
      await endedRow(page, shell.shellId).waitFor();
    };
    let stage = "setup";

    try {
      await createWorkspace(page, "troy");
      for (const folder of [plain, moved]) {
        check((await addProject(page, { import: folder })) === null, `Adding ${folder} failed.`);
      }

      // A signal ends a shell: it stays listed, and only the user's Restore starts it again.

      stage = "restore after a signal";
      const first = await startShell(page, shells, plain);
      await openFromTree(page, first.shellId);
      await leaveAgent(page, rpc.client, first.shellId);
      await typeLine(page, "echo before-s8-$((40+2))");
      await frames.until("the first line", (frame) => frame.includes("before-s8-42"));
      await signal(first);
      check(
        latest(first)?.restored === false && (await shellTab(page, first.shellId).count()) === 0,
        "An ended shell restored itself or kept its tab.",
      );
      await restoreFromTree(page, first.shellId);
      const again = await shells.lists.until(
        "the shell to run again",
        (list) =>
          list.some((entry) => entry.shellId === first.shellId && entry.status === "running"),
        Math.max(0, shells.lists.seen.length - 1),
      );
      const restored = again.find((entry) => entry.shellId === first.shellId)!;
      check(
        restored.restored && restored.pid !== first.pid,
        "The restore did not start a new shell.",
      );
      check(restored.cwd === first.cwd, "The restored shell is in another folder.");
      await page.locator(`[data-shell-row="${first.shellId}"] [data-restored]`).waitFor();
      // Its tab was open when it ended, so it comes back; a closed tab would stay closed.
      await shellTab(page, first.shellId).waitFor();
      check(
        !(await history(rpc.client, first.shellId)).includes("before-s8-42"),
        "The restored shell shows the earlier output.",
      );
      await openFromTree(page, first.shellId);
      await typeLine(page, "echo after-s8-$((40+2))");
      await frames.until("the restored shell's line", (frame) => frame.includes("after-s8-42"));

      // A shell lost with the whole host (a reboot) is restorable the same way.

      stage = "restore after a restart";
      await rpc.close();
      await server.stop();
      await server.stopShellHost();
      await server.restart();
      await reloadShowing(page, "troy");
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);
      await shells.lists.until("the shell list after the restart", () => true);
      await endedRow(page, first.shellId).waitFor();
      await restoreFromTree(page, first.shellId);
      await openFromTree(page, first.shellId);
      await typeLine(page, "echo rebooted-s8-$((40+2))");
      await frames.until("the shell after the restart", (frame) =>
        frame.includes("rebooted-s8-42"),
      );

      // Shells that leave for good offer nothing to restore.

      stage = "no restore for exit or kill";
      const exited = await startShell(page, shells, plain);
      await openFromTree(page, exited.shellId);
      await leaveAgent(page, rpc.client, exited.shellId);
      await typeLine(page, "false; exit");
      await shellRow(page, exited.shellId).waitFor({ state: "detached" });
      const killed = await startShell(page, shells, plain);
      await killFromTree(page, killed.shellId);

      // A shell whose folder is gone is unavailable, not restorable.

      stage = "no restore for a moved folder";
      const inMoved = await startShell(page, shells, moved);
      await signal(inMoved);
      await NodeFSP.rename(moved, `${moved}-elsewhere`);
      await page.locator(`[data-shell-row="${inMoved.shellId}"] [data-missing]`).waitFor();
      await page.locator(`[data-shell-row="${inMoved.shellId}"]`).hover();
      check(
        (await restoreButton(page, inMoved.shellId).count()) === 0,
        "A shell in a moved folder offers Restore.",
      );

      // Removing a restored shell still works.

      stage = "remove after restore";
      await killFromTree(page, first.shellId);
      await killFromTree(page, inMoved.shellId);
      check(
        shells
          .current()
          .every((entry) => ![first.shellId, inMoved.shellId].includes(entry.shellId)),
        "A removed shell is still listed.",
      );
    } catch (error) {
      throw new Error(`S8 failed at ${stage}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};
