// @effect-diagnostics nodeBuiltinImport:off - Removes and moves fixture folders, and ends a shell from outside.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { StartingScriptChoice } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { WsClient } from "../lib/api.ts";
import { layoutSaved, layoutState, openTab, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { unlessRoot } from "../lib/report.ts";
import { expectLogged } from "../lib/serverLog.ts";
import { type Setup, setupOn, type ShellResult } from "../lib/setup.ts";
import { agentReady, history, lastStartOf, running, shellEnded, survivors } from "../lib/shells.ts";
import { alert } from "../lib/ui/dialog.ts";
import {
  createShellButton,
  dropdownItems,
  cancelModal,
  openModal,
  startShell,
  modeButton,
} from "../lib/ui/plusModal.ts";
import { closeTab, selectedTab, shellTab, tabIds } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import {
  endedRow,
  answerConfirm,
  askToKill,
  killFromTree,
  shellRow,
  workspaceShown,
} from "../lib/ui/tree.ts";
import { openWorkspace, openWorkspacesMenu, removeWorkspace } from "../lib/ui/workspacesMenu.ts";
import { alive, check, waitFor } from "../lib/waits.ts";
import type { PointerPage } from "../browser.ts";
import type { Scenario } from "../scenario.ts";

const missingMark = (page: PointerPage, shellId: string) =>
  page.locator(`[data-shell-row="${shellId}"] [data-missing]`);

/** The harness's seeded "mock agent" starting script, as a start asks for it. */
async function mockAgent(client: WsClient): Promise<StartingScriptChoice> {
  const { scripts } = await Effect.runPromise(client["startingScripts.list"]({}));
  const script = scripts.find((entry) => entry.name === "mock agent");
  check(script !== undefined, "The server lists no mock agent starting script.");
  return { id: script.id, name: script.name };
}

export const restartSurvival: Scenario = {
  id: "S7",
  title: "keep shells, tabs and output across reloads and server restarts",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, trail } = ctx;
    const stateDir = NodePath.join(server.home, "userdata");
    const page = await ctx.openPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    const frames = pageFrames(page);
    let setup: Setup = await setupOn(ctx, { as: page });
    const agentScript = { script: await mockAgent(setup.client) };

    const sparta = await setup.workspace("sparta");
    const repoFolder = await setup.repo();
    const repo = await setup.project(sparta, repoFolder);
    const plain = await setup.project(sparta, await setup.folder("plain"));
    const removed = await setup.project(sparta, await setup.folder("removed"));
    const moved = await setup.project(sparta, await setup.folder("moved"));
    const live = await setup.project(sparta, await setup.folder("live"));

    const latest = (shell: Pick<ShellResult, "shellId">) =>
      setup.shells.current().find((entry) => entry.shellId === shell.shellId);
    const unlisted = (shell: Pick<ShellResult, "shellId">) =>
      setup.shells.current().every((entry) => entry.shellId !== shell.shellId);
    /** Restarts the server (optionally ending the shell host while it is down) and reloads. */
    let reloadedFrom = 0;
    const restart = async (endHost = false) => {
      // A stop with a tab change still in flight would bring the old tab strip back.
      await layoutSaved(page, sparta.name);
      await setup.close();
      await server.stop();
      if (endHost) await server.stopShellHost();
      await server.restart();
      reloadedFrom = frames.mark();
      await page.reload();
      await workspaceShown(page, sparta.name, " after the restart");
      setup = await setupOn(ctx, { as: page });
      // A fresh subscription: its first list is the server's state after the restart.
      await setup.shells.lists.until("the shell list after the restart", () => true, 0);
    };

    // Shells that must survive: an agent shell, a plain shell, a shell with a closed tab, and
    // a shell whose folder is removed while it runs.

    const { agent, agentBefore, plainShell, hidden, inLive } = await trail.stage(
      "setup shells",
      async () => {
        const agent = await setup.shell(repo, agentScript);
        const plainShell = await setup.shell(plain);
        const hidden = await setup.shell(plain, agentScript);
        const inLive = await setup.shell(live, agentScript);
        await showWorkspace(page, sparta);
        await openTab(page, agent);
        await agentReady(setup.client, agent.shellId);
        const typedBefore = frames.mark();
        await typeLine(page, "before-restart-s7");
        await frames.until(
          "the agent's line",
          (frame) => frame.includes("echo: before-restart-s7"),
          typedBefore,
        );
        await openTab(page, plainShell);
        const typedPlain = frames.mark();
        await typeLine(page, "echo plain-$((40+2))-s7");
        await frames.until(
          "the plain shell's line",
          (frame) => frame.includes("plain-42-s7"),
          typedPlain,
        );
        await openTab(page, hidden);
        await closeTab(page, hidden.shellId);
        const agentBefore = latest(agent);
        check(agentBefore !== undefined, `Shell ${agent.shellId} is not listed.`);
        return { agent, agentBefore, plainShell, hidden, inLive };
      },
    );

    // Shells that must stay gone: killed in a forked worktree, killed with `probe kill`, and two
    // that exit on their own (status 0, and after a failed command). The fork is the repo's last
    // start, which stage AC-31 compares and stage AC-23 reads back, so it starts from the modal.

    const { forked, byCommand, exitZero, exitFailed } = await trail.stage(
      "setup ends",
      async () => {
        const forked = await startShell(page, setup.shells, repo.path, { fork: true });
        await setup.killShell({
          kind: "shell",
          shellId: forked.shellId,
          pid: forked.pid,
          cwd: forked.cwd,
          workspace: sparta.name,
          project: repo.path,
        });
        const byCommand = await setup.shell(plain);
        await openTab(page, byCommand);
        await typeLine(page, 'probe kill || "$PROBE_BIN" kill');
        const exitZero = await setup.shell(plain);
        await openTab(page, exitZero);
        await typeLine(page, "exit");
        const exitFailed = await setup.shell(plain);
        await openTab(page, exitFailed);
        // Lists from before these shells started lack them too; the current one still has exitFailed.
        const endsFrom = setup.shells.lists.mark();
        await typeLine(page, "false; exit");
        await setup.shells.lists.until(
          "the killed and exited shells to leave the list",
          (list) =>
            [forked, byCommand, exitZero, exitFailed].every((shell) =>
              list.every((entry) => entry.shellId !== shell.shellId),
            ),
          endsFrom,
        );
        return { forked, byCommand, exitZero, exitFailed };
      },
    );
    const forkedWorktree = forked.cwd;

    // Shells a signal ends, whose folders are then removed and moved.

    const { inRemoved, inMoved } = await trail.stage("setup missing folders", async () => {
      const inRemoved = await setup.shell(removed, agentScript);
      const inMoved = await setup.shell(moved, agentScript);
      const signalledFrom = setup.shells.lists.mark();
      for (const shell of [inRemoved, inMoved]) {
        NodeProcess.kill(shell.pid!, "SIGKILL");
      }
      await setup.shells.lists.until(
        "the signalled shells to be listed as ended",
        (list) =>
          [inRemoved, inMoved].every((shell) =>
            list.some((entry) => entry.shellId === shell.shellId && entry.ended === "signal"),
          ),
        signalledFrom,
      );
      for (const shell of [inRemoved, inMoved]) await shellEnded(setup.shells, shell);
      await NodeFSP.rm(removed.path, { recursive: true });
      await NodeFSP.rename(moved.path, `${moved.path}-elsewhere`);
      await NodeFSP.rm(live.path, { recursive: true });
      return { inRemoved, inMoved };
    });

    // AC-9: a second workspace, and switching back by name.

    const { athens, elsewhere, tabsBefore, startBefore, pids } = await trail.stage(
      "AC-9",
      async () => {
        const athens = await setup.workspace("athens");
        const other = await setup.project(athens, await setup.folder("other"));
        const elsewhere = await setup.shell(other, agentScript);
        await showWorkspace(page, athens);
        await openWorkspace(page, sparta.name);
        await workspaceShown(page, sparta.name, " after switching back");
        await waitFor(shellRow(page, agent.shellId), `the row of shell ${agent.shellId}`);
        check(
          running(setup.shells, agent.shellId),
          "The shell stopped while another workspace was shown (AC-9).",
        );
        await openTab(page, agent);
        const tabsBefore = await tabIds(page);
        const startBefore = await lastStartOf(setup.client, sparta.name);
        const pids = new Map(
          [agent, plainShell, hidden, inLive, elsewhere].map((shell) => [
            shell.shellId,
            shell.pid!,
          ]),
        );
        return { athens, elsewhere, tabsBefore, startBefore, pids };
      },
    );

    // AC-6, AC-7, AC-8, AC-10, AC-31, AC-34, EC-1: after a restart every running shell is the
    // same process with its output, in its place, with the same tabs and modal defaults.

    await trail.stage("AC-6", async () => {
      await restart();
      for (const [shellId, pid] of pids) {
        const entry = setup.shells.current().find((shell) => shell.shellId === shellId);
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
    });

    await trail.stage("AC-7", async () => {
      check(
        (await history(setup.client, agent.shellId)).includes("echo: before-restart-s7"),
        "The agent shell lost its output (AC-7).",
      );
      check(
        (await history(setup.client, plainShell.shellId)).includes("plain-42-s7"),
        "The plain shell lost its output (AC-8).",
      );
      check(
        latest(agent)?.project === agentBefore.project &&
          latest(agent)?.worktree === agentBefore.worktree,
        "The agent shell is not in its folder and worktree (AC-7).",
      );
      check(latest(agent)?.branch === "main", "The agent shell lost its branch (AC-7).");
      const tabsAfter = await tabIds(page);
      check(
        JSON.stringify(tabsAfter) === JSON.stringify(tabsBefore),
        `The tabs changed with the restart: ${JSON.stringify(tabsBefore)} -> ${JSON.stringify(tabsAfter)} (AC-7).`,
      );
    });

    await trail.stage("AC-31", async () => {
      check((await selectedTab(page)) === agent.shellId, "The selected tab changed (AC-31).");
      check(
        (await lastStartOf(setup.client, sparta.name)) === startBefore,
        "The modal defaults changed with the restart (AC-31).",
      );
    });

    await trail.stage("EC-1", async () => {
      check((await shellTab(page, hidden.shellId).count()) === 0, "A closed tab came back (EC-1).");
      await waitFor(shellRow(page, hidden.shellId), `the row of shell ${hidden.shellId}`);
    });

    await trail.stage("AC-34", () =>
      expectLogged(
        server,
        "The log has no reattach line with the shell id and folder (AC-34).",
        (entry) =>
          entry.includes("shell reattached") &&
          entry.includes(agent.shellId) &&
          entry.includes(repo.path),
      ),
    );

    // AC-12, AC-13, AC-14, AC-23: killed and exited shells stay gone; a killed shell's
    // worktree stays on disk and in the "+" picker.

    await trail.stage("AC-12", async () => {
      for (const shell of [forked, byCommand, exitZero, exitFailed]) {
        check(
          unlisted(shell),
          `Shell ${shell.shellId} is back after the restart (AC-12 to AC-14).`,
        );
        check(!alive(shell.pid!), `Shell ${shell.shellId} is running after the restart.`);
      }
    });

    await trail.stage("AC-23", async () => {
      await NodeFSP.access(forkedWorktree);
      await openModal(page, repo.path);
      // The project's last start was the fork, so the modal opens on Fork.
      await modeButton(page, "Existing").click();
      const offered = (await dropdownItems(page, "Start in")).map(([key]) => key);
      await cancelModal(page);
      check(
        offered.includes(forkedWorktree),
        `The killed shell's worktree is not offered: ${JSON.stringify(offered)} (AC-23).`,
      );
    });

    // AC-16, AC-22: a removed and a moved folder show as not found, keep their ended shells
    // as unavailable, and offer no new shell; the rest of the workspace works.

    await trail.stage("AC-16", async () => {
      for (const [folder, shell] of [
        [removed.path, inRemoved],
        [moved.path, inMoved],
      ] as const) {
        const project = page.locator(`[data-project="${folder}"]`);
        await waitFor(
          project.locator(`[role="treeitem"][aria-label="${folder}"] [data-missing]`),
          `project ${folder} to show as not found`,
        );
        check(
          (await createShellButton(page, folder).count()) === 0,
          `A shell can be started in the missing folder ${folder} (AC-16, AC-22).`,
        );
        await waitFor(
          endedRow(page, shell.shellId, "signal"),
          `shell ${shell.shellId} to show as ended by a signal`,
        );
        await waitFor(
          missingMark(page, shell.shellId),
          `shell ${shell.shellId} to show as missing`,
        );
      }
    });

    // AC-29: a live shell in a removed folder is reattached, warned about, and still works.

    await trail.stage("AC-29", async () => {
      await waitFor(
        missingMark(page, inLive.shellId),
        `shell ${inLive.shellId} to show as missing`,
      );
      check(
        (await page.locator(`[data-shell-row="${inLive.shellId}"] [data-elsewhere]`).count()) === 0,
        "A shell in a deleted folder is marked elsewhere (AC-29).",
      );
      await openTab(page, inLive);
      const typedLive = frames.mark();
      await typeLine(page, "still-here-s7");
      await frames.until(
        "the live shell's line",
        (frame) => frame.includes("echo: still-here-s7"),
        typedLive,
      );
    });

    // AC-18: a removal that cannot be saved says why and keeps the entry.

    await trail.stage("AC-18", async () => {
      const shellsDir = NodePath.join(stateDir, "shells");
      await unlessRoot("S7", "AC-18 removal that cannot be saved", async () => {
        await NodeFSP.chmod(shellsDir, 0o555);
        try {
          await askToKill(page, inMoved.shellId);
          await answerConfirm(page, "Confirm");
          await waitFor(
            alert(page, "could not save its shells"),
            "the alert that shells could not be saved",
          );
          await waitFor(
            endedRow(page, inMoved.shellId, "signal"),
            `shell ${inMoved.shellId} to stay as ended by a signal`,
          );
        } finally {
          await NodeFSP.chmod(shellsDir, 0o755);
        }
      });
    });

    // AC-17: removing the unavailable entries works, and they stay gone (checked below).

    await trail.stage("AC-17", async () => {
      await killFromTree(page, inMoved.shellId);
      await killFromTree(page, inRemoved.shellId);
      // With their last shells removed, the projects whose folders are gone leave the workspace.
      for (const folder of [removed.path, moved.path]) {
        await waitFor(page.locator(`[data-project="${folder}"]`), `project ${folder} to leave`, {
          state: "detached",
        });
      }
    });

    // AC-21: a layout that cannot be saved says so; shells keep running.

    const workspacesDir = NodePath.join(stateDir, "workspaces");
    await trail.stage("AC-21", async () => {
      await unlessRoot("S7", "AC-21 layout that cannot be saved", async () => {
        await NodeFSP.chmod(workspacesDir, 0o555);
        try {
          await openTab(page, plainShell);
          await waitFor(
            alert(page, "The layout is not being saved"),
            "the alert that the layout is not being saved",
          );
          // The page says the save failed, never that it is saved.
          await waitFor(layoutState(page, "failed"), "the layout save to show as failed");
          check(
            running(setup.shells, plainShell.shellId),
            "A layout save failure ended a shell (AC-21).",
          );
        } finally {
          await NodeFSP.chmod(workspacesDir, 0o755);
        }
        await openTab(page, agent);
        await waitFor(alert(page, "The layout is not being saved"), "the layout alert to leave", {
          state: "detached",
        });
        await waitFor(layoutState(page, "saved"), "the layout save to show as saved");
      });
    });

    // AC-19: a workspace whose file became unreadable says why and changes nothing.

    const athensFile = NodePath.join(workspacesDir, `${athens.name}.json`);
    await trail.stage("AC-19", async () => {
      await unlessRoot("S7", "AC-19 unreadable workspace", async () => {
        await NodeFSP.chmod(athensFile, 0o000);
        try {
          await openWorkspace(page, athens.name);
          await waitFor(
            alert(page, "cannot be opened"),
            "the alert that the workspace cannot be opened",
          );
          await workspaceShown(page, sparta.name, " after the refused open");
        } finally {
          await NodeFSP.chmod(athensFile, 0o644);
        }
      });
    });

    // AC-10: the other workspace's shell runs on and comes back with its own layout.

    await trail.stage("AC-10", async () => {
      await openWorkspace(page, athens.name);
      await workspaceShown(page, athens.name);
      await waitFor(shellRow(page, elsewhere.shellId), `the row of shell ${elsewhere.shellId}`);
      check(
        (await shellRow(page, agent.shellId).count()) === 0,
        "Another workspace's shell is shown (AC-10).",
      );
      await openWorkspace(page, sparta.name);
      await workspaceShown(page, sparta.name);
    });

    // AC-20: a restart that lost the shell host shows its shells as ended, removable.

    await trail.stage("AC-20", async () => {
      await restart(true);
      for (const shell of [agent, plainShell, hidden, inLive]) {
        await waitFor(
          endedRow(page, shell.shellId, "lost"),
          `shell ${shell.shellId} to show as lost`,
        );
      }
      const left = await survivors([...pids.values()]);
      check(left.length === 0, `Shells ${left.join(", ")} survived the end of their shell host.`);
      await killFromTree(page, hidden.shellId);
    });

    // AC-17, AC-12: removed and killed shells stay gone after another restart.

    await trail.stage("AC-17 after restart", async () => {
      await restart();
      for (const shell of [inRemoved, inMoved, hidden, forked, byCommand]) {
        check(unlisted(shell), `Shell ${shell.shellId} came back (AC-17).`);
      }
      await waitFor(endedRow(page, agent.shellId, "lost"), `shell ${agent.shellId} to stay lost`);
    });

    // AC-33: a removed workspace is not offered again and its file is gone.

    await trail.stage("AC-33", async () => {
      await removeWorkspace(page, athens.name);
      await openWorkspacesMenu(page, "Open workspace");
      const shownItem = page.getByRole("menuitem", { name: sparta.name, exact: true });
      await waitFor(shownItem, `"Open workspace" to offer ${sparta.name}`);
      check(
        (await page.getByRole("menuitem", { name: athens.name, exact: true }).count()) === 0,
        "A removed workspace is still offered (AC-33).",
      );
      // Closes the menu with a click: choosing the workspace already shown changes nothing.
      await shownItem.click();
      check(
        await NodeFSP.access(athensFile).then(
          () => false,
          () => true,
        ),
        "The removed workspace's file is still on disk (AC-33).",
      );
    });
  },
};
