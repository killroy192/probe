// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures, removes and moves them, and ends a shell from outside.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { ShellSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { connectRpc, type WsClient } from "../lib/api.ts";
import { gitOk } from "../lib/files.ts";
import { layoutSaved, layoutState } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { unlessRoot } from "../lib/report.ts";
import { expectLogged } from "../lib/serverLog.ts";
import {
  agentReady,
  history,
  leaveAgent,
  shellEnded,
  shellList,
  survivors,
} from "../lib/shells.ts";
import { addProject } from "../lib/ui/addProject.ts";
import { alert } from "../lib/ui/dialog.ts";
import {
  createShellButton,
  dropdownItems,
  cancelModal,
  openModal,
  startShell,
  modeButton,
} from "../lib/ui/plusModal.ts";
import { closeTab, shellTab } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import {
  endedRow,
  answerConfirm,
  askToKill,
  killFromTree,
  openFromTree,
  shellRow,
} from "../lib/ui/tree.ts";
import { createWorkspace, openWorkspace } from "../lib/ui/workspacesMenu.ts";
import { alive, check } from "../lib/waits.ts";
import type { PointerPage } from "../browser.ts";
import type { Scenario } from "../scenario.ts";

const openTabs = (page: PointerPage) =>
  page
    .getByRole("tablist", { name: "Shells" })
    .getByRole("tab")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-shell-id")));

const selectedTab = (page: PointerPage) =>
  page
    .getByRole("tablist", { name: "Shells" })
    .locator('[role="tab"][aria-selected="true"]')
    .getAttribute("data-shell-id");

/** Waits for the page to show `name` again after a reload or a restart. */
const shown = (page: PointerPage, name: string) =>
  page.getByRole("tree").getByRole("treeitem", { level: 1, name }).waitFor();

const missingMark = (page: PointerPage, shellId: string) =>
  page.locator(`[data-shell-row="${shellId}"] [data-missing]`);

const lastStartOf = async (client: WsClient, name: string) =>
  JSON.stringify((await Effect.runPromise(client["workspace.open"]({ name }))).lastStarts);

/** Removes an ended shell with the tree's "x" and waits for its row to leave. */
const removeFromTree = killFromTree;

export const restartSurvival: Scenario = {
  id: "S7",
  title: "keep shells, tabs and output across reloads and server restarts",
  needs: { restart: true },
  run: async ({ server, openPage }) => {
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const plain = NodePath.join(folders, "plain");
    const removed = NodePath.join(folders, "removed");
    const moved = NodePath.join(folders, "moved");
    const live = NodePath.join(folders, "live");
    const other = NodePath.join(folders, "other");
    for (const dir of [repo, plain, removed, moved, live, other]) {
      await NodeFSP.mkdir(dir, { recursive: true });
    }
    await gitOk(repo, "init", "-q", "-b", "main");
    await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "one");
    const stateDir = NodePath.join(server.home, "userdata");

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    const frames = pageFrames(page);
    let rpc = await connectRpc(server.origin, page);
    let shells = shellList(rpc.client);
    const latest = (shell: ShellSummary) =>
      shells.current().find((entry) => entry.shellId === shell.shellId);
    const unlisted = (shell: ShellSummary) =>
      shells.current().every((entry) => entry.shellId !== shell.shellId);
    /** Restarts the server (optionally ending the shell host while it is down) and reloads. */
    let reloadedFrom = 0;
    const restart = async (endHost = false) => {
      // A stop with a tab change still in flight would bring the old tab strip back.
      await layoutSaved(page, "sparta");
      await rpc.close();
      await server.stop();
      if (endHost) await server.stopShellHost();
      await server.restart();
      reloadedFrom = frames.mark();
      await page.reload();
      await shown(page, "sparta");
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);
      // A fresh subscription: its first list is the server's state after the restart.
      await shells.lists.until("the shell list after the restart", () => true, 0);
    };
    let stage = "setup";

    try {
      await createWorkspace(page, "sparta");
      for (const folder of [repo, plain, removed, moved, live]) {
        check((await addProject(page, { import: folder })) === null, `Adding ${folder} failed.`);
      }

      // Shells that must survive: an agent shell, a plain shell, a shell with a closed tab, and
      // a shell whose folder is removed while it runs.

      stage = "setup shells";
      const agent = await startShell(page, shells, repo);
      await openFromTree(page, agent.shellId);
      await agentReady(rpc.client, agent.shellId);
      const typedBefore = frames.mark();
      await typeLine(page, "before-restart-s7");
      await frames.until(
        "the agent's line",
        (frame) => frame.includes("echo: before-restart-s7"),
        typedBefore,
      );
      const plainShell = await startShell(page, shells, plain);
      await openFromTree(page, plainShell.shellId);
      await leaveAgent(page, rpc.client, plainShell.shellId);
      const typedPlain = frames.mark();
      await typeLine(page, "echo plain-$((40+2))-s7");
      await frames.until(
        "the plain shell's line",
        (frame) => frame.includes("plain-42-s7"),
        typedPlain,
      );
      const hidden = await startShell(page, shells, plain);
      await closeTab(page, hidden.shellId);
      const inLive = await startShell(page, shells, live);

      // Shells that must stay gone: killed from the tree in a forked worktree, killed with
      // `probe kill`, and two that exit on their own (status 0, and after a failed command).

      stage = "setup ends";
      const forked = await startShell(page, shells, repo, { fork: true });
      const forkedWorktree = forked.cwd;
      await killFromTree(page, forked.shellId);
      const byCommand = await startShell(page, shells, plain);
      await openFromTree(page, byCommand.shellId);
      await leaveAgent(page, rpc.client, byCommand.shellId);
      await typeLine(page, 'probe kill || "$PROBE_BIN" kill');
      const exitZero = await startShell(page, shells, plain);
      await openFromTree(page, exitZero.shellId);
      await leaveAgent(page, rpc.client, exitZero.shellId);
      await typeLine(page, "exit");
      const exitFailed = await startShell(page, shells, plain);
      await openFromTree(page, exitFailed.shellId);
      await leaveAgent(page, rpc.client, exitFailed.shellId);
      // Lists from before these shells started lack them too; the current one still has exitFailed.
      const endsFrom = shells.lists.mark();
      await typeLine(page, "false; exit");
      await shells.lists.until(
        "the killed and exited shells to leave the list",
        (list) =>
          [forked, byCommand, exitZero, exitFailed].every((shell) =>
            list.every((entry) => entry.shellId !== shell.shellId),
          ),
        endsFrom,
      );

      // Shells a signal ends, whose folders are then removed and moved.

      stage = "setup missing folders";
      const inRemoved = await startShell(page, shells, removed);
      const inMoved = await startShell(page, shells, moved);
      const signalledFrom = shells.lists.mark();
      for (const shell of [inRemoved, inMoved]) {
        NodeProcess.kill(shell.pid!, "SIGKILL");
      }
      await shells.lists.until(
        "the signalled shells to be listed as ended",
        (list) =>
          [inRemoved, inMoved].every((shell) =>
            list.some((entry) => entry.shellId === shell.shellId && entry.ended === "signal"),
          ),
        signalledFrom,
      );
      for (const shell of [inRemoved, inMoved]) await shellEnded(shells, shell);
      await NodeFSP.rm(removed, { recursive: true });
      await NodeFSP.rename(moved, `${moved}-elsewhere`);
      await NodeFSP.rm(live, { recursive: true });

      // AC-9: a second workspace, and switching back by name.

      stage = "AC-9";
      await createWorkspace(page, "athens");
      check(
        (await addProject(page, { import: other })) === null,
        "Adding the other folder failed.",
      );
      const elsewhere = await startShell(page, shells, other);
      await openWorkspace(page, "sparta");
      await shown(page, "sparta");
      await shellRow(page, agent.shellId).waitFor();
      check(
        isRunning(latest(agent)),
        "The shell stopped while another workspace was shown (AC-9).",
      );
      await openFromTree(page, agent.shellId);
      const tabsBefore = await openTabs(page);
      const startBefore = await lastStartOf(rpc.client, "sparta");
      const pids = new Map(
        [agent, plainShell, hidden, inLive, elsewhere].map((shell) => [shell.shellId, shell.pid!]),
      );

      // AC-6, AC-7, AC-8, AC-10, AC-31, AC-34, EC-1: after a restart every running shell is the
      // same process with its output, in its place, with the same tabs and modal defaults.

      stage = "AC-6";
      await restart();
      for (const [shellId, pid] of pids) {
        const entry = shells.current().find((shell) => shell.shellId === shellId);
        check(
          entry?.status === "running" && entry.pid === pid && alive(pid),
          `Shell ${shellId} is not the same running process after the restart (AC-6): ${JSON.stringify(entry)}.`,
        );
      }
      // The reopened tab is attached once its earlier output has arrived.
      await frames.until(
        "the agent's earlier output after the restart",
        (frame) => frame.includes("echo: before-restart-s7"),
        reloadedFrom,
      );
      const typedAfter = frames.mark();
      await typeLine(page, "after-restart-s7");
      await frames.until(
        "input after the restart",
        (frame) => frame.includes("echo: after-restart-s7"),
        typedAfter,
      );

      stage = "AC-7";
      check(
        (await history(rpc.client, agent.shellId)).includes("echo: before-restart-s7"),
        "The agent shell lost its output (AC-7).",
      );
      check(
        (await history(rpc.client, plainShell.shellId)).includes("plain-42-s7"),
        "The plain shell lost its output (AC-8).",
      );
      check(
        latest(agent)?.project === agent.project && latest(agent)?.worktree === agent.worktree,
        "The agent shell is not in its folder and worktree (AC-7).",
      );
      check(latest(agent)?.branch === "main", "The agent shell lost its branch (AC-7).");
      const tabsAfter = await openTabs(page);
      check(
        JSON.stringify(tabsAfter) === JSON.stringify(tabsBefore),
        `The tabs changed with the restart: ${JSON.stringify(tabsBefore)} -> ${JSON.stringify(tabsAfter)} (AC-7).`,
      );

      stage = "AC-31";
      check((await selectedTab(page)) === agent.shellId, "The selected tab changed (AC-31).");
      check(
        (await lastStartOf(rpc.client, "sparta")) === startBefore,
        "The modal defaults changed with the restart (AC-31).",
      );

      stage = "EC-1";
      check((await shellTab(page, hidden.shellId).count()) === 0, "A closed tab came back (EC-1).");
      await shellRow(page, hidden.shellId).waitFor();

      stage = "AC-34";
      await expectLogged(
        server,
        "The log has no reattach line with the shell id and folder (AC-34).",
        (entry) =>
          entry.includes("shell reattached") &&
          entry.includes(agent.shellId) &&
          entry.includes(repo),
      );

      // AC-12, AC-13, AC-14, AC-23: killed and exited shells stay gone; a killed shell's
      // worktree stays on disk and in the "+" picker.

      stage = "AC-12";
      for (const shell of [forked, byCommand, exitZero, exitFailed]) {
        check(
          unlisted(shell),
          `Shell ${shell.shellId} is back after the restart (AC-12 to AC-14).`,
        );
        check(!alive(shell.pid!), `Shell ${shell.shellId} is running after the restart.`);
      }
      stage = "AC-23";
      await NodeFSP.access(forkedWorktree);
      await openModal(page, repo);
      // The project's last start was the fork, so the modal opens on Fork.
      await modeButton(page, "Existing").click();
      const offered = (await dropdownItems(page, "Start in")).map(([key]) => key);
      await cancelModal(page);
      check(
        offered.includes(forkedWorktree),
        `The killed shell's worktree is not offered: ${JSON.stringify(offered)} (AC-23).`,
      );

      // AC-16, AC-22: a removed and a moved folder show as not found, keep their ended shells
      // as unavailable, and offer no new shell; the rest of the workspace works.

      stage = "AC-16";
      for (const [folder, shell] of [
        [removed, inRemoved],
        [moved, inMoved],
      ] as const) {
        const project = page.locator(`[data-project="${folder}"]`);
        await project.locator(`[role="treeitem"][aria-label="${folder}"] [data-missing]`).waitFor();
        check(
          (await createShellButton(page, folder).count()) === 0,
          `A shell can be started in the missing folder ${folder} (AC-16, AC-22).`,
        );
        await endedRow(page, shell.shellId, "signal").waitFor();
        await missingMark(page, shell.shellId).waitFor();
      }

      // AC-29: a live shell in a removed folder is reattached, warned about, and still works.

      stage = "AC-29";
      await missingMark(page, inLive.shellId).waitFor();
      check(
        (await page.locator(`[data-shell-row="${inLive.shellId}"] [data-elsewhere]`).count()) === 0,
        "A shell in a deleted folder is marked elsewhere (AC-29).",
      );
      await openFromTree(page, inLive.shellId);
      const typedLive = frames.mark();
      await typeLine(page, "still-here-s7");
      await frames.until(
        "the live shell's line",
        (frame) => frame.includes("echo: still-here-s7"),
        typedLive,
      );

      // AC-18: a removal that cannot be saved says why and keeps the entry.

      stage = "AC-18";
      const shellsDir = NodePath.join(stateDir, "shells");
      await unlessRoot("S7", "AC-18 removal that cannot be saved", async () => {
        await NodeFSP.chmod(shellsDir, 0o555);
        try {
          await askToKill(page, inMoved.shellId);
          await answerConfirm(page, "Confirm");
          await alert(page, "could not save its shells").waitFor();
          await endedRow(page, inMoved.shellId, "signal").waitFor();
        } finally {
          await NodeFSP.chmod(shellsDir, 0o755);
        }
      });

      // AC-17: removing the unavailable entries works, and they stay gone (checked below).

      stage = "AC-17";
      await removeFromTree(page, inMoved.shellId);
      await removeFromTree(page, inRemoved.shellId);
      // With their last shells removed, the projects whose folders are gone leave the workspace.
      for (const folder of [removed, moved]) {
        await page.locator(`[data-project="${folder}"]`).waitFor({ state: "detached" });
      }

      // AC-21: a layout that cannot be saved says so; shells keep running.

      stage = "AC-21";
      const workspacesDir = NodePath.join(stateDir, "workspaces");
      await unlessRoot("S7", "AC-21 layout that cannot be saved", async () => {
        await NodeFSP.chmod(workspacesDir, 0o555);
        try {
          await openFromTree(page, plainShell.shellId);
          await alert(page, "The layout is not being saved").waitFor();
          // The page says the save failed, never that it is saved.
          await layoutState(page, "failed").waitFor();
          check(isRunning(latest(plainShell)), "A layout save failure ended a shell (AC-21).");
        } finally {
          await NodeFSP.chmod(workspacesDir, 0o755);
        }
        await openFromTree(page, agent.shellId);
        await alert(page, "The layout is not being saved").waitFor({ state: "detached" });
        await layoutState(page, "saved").waitFor();
      });

      // AC-19: a workspace whose file became unreadable says why and changes nothing.

      stage = "AC-19";
      const athensFile = NodePath.join(workspacesDir, "athens.json");
      await unlessRoot("S7", "AC-19 unreadable workspace", async () => {
        await NodeFSP.chmod(athensFile, 0o000);
        try {
          await openWorkspace(page, "athens");
          await alert(page, "cannot be opened").waitFor();
          await shown(page, "sparta");
        } finally {
          await NodeFSP.chmod(athensFile, 0o644);
        }
      });

      // AC-10: the other workspace's shell runs on and comes back with its own layout.

      stage = "AC-10";
      await openWorkspace(page, "athens");
      await shown(page, "athens");
      await shellRow(page, elsewhere.shellId).waitFor();
      check(
        (await shellRow(page, agent.shellId).count()) === 0,
        "Another workspace's shell is shown (AC-10).",
      );
      await openWorkspace(page, "sparta");
      await shown(page, "sparta");

      // AC-20: a restart that lost the shell host shows its shells as ended, removable.

      stage = "AC-20";
      await restart(true);
      for (const shell of [agent, plainShell, hidden, inLive]) {
        await endedRow(page, shell.shellId, "lost").waitFor();
      }
      const left = await survivors([...pids.values()]);
      check(left.length === 0, `Shells ${left.join(", ")} survived the end of their shell host.`);
      await removeFromTree(page, hidden.shellId);

      // AC-17, AC-12: removed and killed shells stay gone after another restart.

      stage = "AC-17 after restart";
      await restart();
      for (const shell of [inRemoved, inMoved, hidden, forked, byCommand]) {
        check(unlisted(shell), `Shell ${shell.shellId} came back (AC-17).`);
      }
      await endedRow(page, agent.shellId, "lost").waitFor();

      // AC-33: a removed workspace is not offered again and its file is gone.

      stage = "AC-33";
      await page.getByRole("button", { name: "Workspaces" }).click();
      await page.getByRole("menuitem", { name: "Remove workspace" }).click();
      await page.getByRole("menuitem", { name: "athens", exact: true }).click();
      await page.getByRole("button", { name: "Workspaces" }).click();
      await page.getByRole("menuitem", { name: "Open workspace" }).click();
      await page.getByRole("menuitem", { name: "sparta", exact: true }).waitFor();
      check(
        (await page.getByRole("menuitem", { name: "athens", exact: true }).count()) === 0,
        "A removed workspace is still offered (AC-33).",
      );
      // Closes the menu with a click: choosing the workspace already shown changes nothing.
      await page.getByRole("menuitem", { name: "sparta", exact: true }).click();
      check(
        await NodeFSP.access(athensFile).then(
          () => false,
          () => true,
        ),
        "The removed workspace's file is still on disk (AC-33).",
      );
    } catch (error) {
      throw new Error(`S7 failed at ${stage}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};

function isRunning(shell: ShellSummary | undefined) {
  return shell?.status === "running" && shell.pid !== null && alive(shell.pid);
}
