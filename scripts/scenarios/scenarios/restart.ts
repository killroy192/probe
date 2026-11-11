// @effect-diagnostics nodeBuiltinImport:off - Removes and moves fixture folders.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { expected } from "../lib/expect.ts";
import { revokeWrite } from "../lib/files.ts";
import {
  layoutSaved,
  layoutState,
  openTab,
  restartAndReload,
  showWorkspace,
} from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { expectMenuOffers } from "../lib/scoped.ts";
import { expectLogged } from "../lib/serverLog.ts";
import { mockAgent, type Setup, setupOn, type ShellResult } from "../lib/setup.ts";
import {
  agentReady,
  history,
  lastStartOf,
  listedShell,
  running,
  signalShells,
  survivors,
} from "../lib/shells.ts";
import { alert } from "../lib/ui/dialog.ts";
import {
  cancelModal,
  createShellButton,
  dropdownItems,
  modeButton,
  openModal,
  startShell,
} from "../lib/ui/plusModal.ts";
import { closeTab, selectedTab, shellTab, tabIds } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import {
  answerConfirm,
  askToKill,
  endedRow,
  killFromTree,
  missingMark,
  projectMissing,
  shellRow,
  workspaceShown,
} from "../lib/ui/tree.ts";
import { openWorkspace, removeWorkspace } from "../lib/ui/workspacesMenu.ts";
import { alive, waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

const widePage = async (ctx: ScenarioContext) => {
  const page = await ctx.openPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  return page;
};

const workspaceFile = (ctx: ScenarioContext, name: string) =>
  NodePath.join(ctx.server.home, "userdata", "workspaces", `${name}.json`);

const listed = (setup: Setup, shell: Pick<ShellResult, "shellId">) =>
  listedShell(setup.shells, shell.shellId);

/** Judged on the first list after a restart, which is the restarted server's whole state. */
const unlistedAfterRestart = (setup: Setup, shells: ReadonlyArray<ShellResult>, what: string) =>
  expected({
    what,
    expected: [],
    found: shells.filter((shell) => listed(setup, shell) !== undefined).map((s) => s.shellId),
  });

export const surviveRestart = defineCheck(import.meta.url, {
  id: "S7.survive-restart",
  title: "a restart keeps every running shell, its output, its place, the tabs and modal defaults",
  needs: { restart: true },
  // One restart: every kind of running state is judged after the same restart (EC-3).
  covers: [
    "S7 AC-6",
    "S7 AC-7",
    "S7 AC-8",
    "S7 AC-10",
    "S7 AC-31",
    "S7 AC-34",
    "S7 EC-1",
    "S7 AC-29",
  ],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const page = await widePage(ctx);
    const frames = pageFrames(page);
    let setup = await setupOn(ctx, { as: page });

    const before = await trail.stage("setup", async () => {
      const agentScript = { script: await mockAgent(setup.client) };
      const sparta = await setup.workspace("sparta");
      const repo = await setup.project(sparta, await setup.repo());
      const plain = await setup.project(sparta, await setup.folder("plain"));
      const live = await setup.project(sparta, await setup.folder("live"));
      const athens = await setup.workspace("athens");
      const other = await setup.project(athens, await setup.folder("other"));

      const agent = await setup.shell(repo, agentScript);
      const plainShell = await setup.shell(plain);
      const hidden = await setup.shell(plain);
      const inLive = await setup.shell(live);
      const elsewhere = await setup.shell(other);

      await showWorkspace(page, sparta);
      await openTab(page, agent);
      await agentReady(setup.client, agent.shellId);
      const typedAgent = frames.mark();
      await typeLine(page, "before-restart-s7");
      await frames.until(
        "the agent's line",
        (frame) => frame.includes("echo: before-restart-s7"),
        typedAgent,
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
      // The page remembers only the starts it made, so the repo's last start is a modal fork.
      const forked = await startShell(page, setup.shells, repo.path, { fork: true });
      await NodeFSP.rm(live.path, { recursive: true });
      await openTab(page, agent);
      const agentBefore = listed(setup, agent);
      expected({
        what: `shell ${agent.shellId} listed before the restart`,
        expected: true,
        found: agentBefore !== undefined,
      });
      const pids = new Map(
        [agent, plainShell, hidden, inLive, elsewhere, forked].map(
          (shell) => [shell.shellId, shell.pid!] as const,
        ),
      );
      const startBefore = await lastStartOf(setup.client, sparta.name);
      // Without the fork's entry, an empty record before and after would pass AC-31.
      expected({
        what: `the last start of ${repo.path} before the restart`,
        expected: "new",
        found: startBefore[repo.path]?.worktree.kind ?? "none",
      });
      return {
        sparta,
        athens,
        repo,
        agent,
        agentBefore: agentBefore!,
        plainShell,
        hidden,
        inLive,
        elsewhere,
        pids,
        tabsBefore: await tabIds(page),
        startBefore,
      };
    });
    const { sparta, agent, plainShell, hidden, inLive, elsewhere } = before;

    let reloadedFrom = 0;
    await trail.stage("restart", async () => {
      reloadedFrom = frames.mark();
      setup = await restartAndReload(ctx, page, sparta, setup);
    });

    await trail.stage("AC-6", async () => {
      for (const [shellId, pid] of before.pids) {
        const entry = listed(setup, { shellId });
        expected({
          what: `shell ${shellId} after the restart`,
          expected: { status: "running", pid, alive: true },
          found: { status: entry?.status, pid: entry?.pid, alive: alive(pid) },
        });
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
      expected({
        what: "the agent shell's history holds its line from before the restart",
        expected: true,
        found: (await history(setup.client, agent.shellId)).includes("echo: before-restart-s7"),
      });
      const after = listed(setup, agent);
      expected({
        what: "the agent shell's folder, worktree and branch after the restart",
        expected: {
          project: before.agentBefore.project,
          worktree: before.agentBefore.worktree,
          branch: "main",
        },
        found: { project: after?.project, worktree: after?.worktree, branch: after?.branch },
      });
      expected({
        what: "the tabs after the restart",
        expected: before.tabsBefore,
        found: await tabIds(page),
      });
    });

    await trail.stage("AC-8", async () =>
      expected({
        what: "the plain shell's history holds its line from before the restart",
        expected: true,
        found: (await history(setup.client, plainShell.shellId)).includes("plain-42-s7"),
      }),
    );

    await trail.stage("AC-31", async () => {
      expected({
        what: "the selected tab after the restart",
        expected: agent.shellId,
        found: await selectedTab(page),
      });
      expected({
        what: "the workspace's last start (the modal defaults) after the restart",
        expected: before.startBefore,
        found: await lastStartOf(setup.client, sparta.name),
      });
    });

    await trail.stage("EC-1", async () => {
      // The row shows once the tree is back, so a closed tab would have come back with it.
      await waitFor(shellRow(page, hidden.shellId), `the row of shell ${hidden.shellId}`);
      expected({
        what: `tabs of the shell whose tab was closed (${hidden.shellId})`,
        expected: 0,
        found: await shellTab(page, hidden.shellId).count(),
      });
    });

    await trail.stage("AC-34", () =>
      expectLogged(
        server,
        "The log has no reattach line with the shell id and folder (AC-34).",
        (entry) =>
          entry.includes("shell reattached") &&
          entry.includes(agent.shellId) &&
          entry.includes(before.repo.path),
      ),
    );

    await trail.stage("AC-29", async () => {
      await waitFor(
        missingMark(page, inLive.shellId),
        `shell ${inLive.shellId} to show as missing`,
      );
      expected({
        what: "elsewhere marks on the shell whose folder was deleted",
        expected: 0,
        found: await page.locator(`[data-shell-row="${inLive.shellId}"] [data-elsewhere]`).count(),
      });
      await openTab(page, inLive);
      const typedLive = frames.mark();
      await typeLine(page, "echo still-$((1+1))-here-s7");
      await frames.until(
        "the live shell's line",
        (frame) => frame.includes("still-2-here-s7"),
        typedLive,
      );
    });

    await trail.stage("AC-10", async () => {
      await openWorkspace(page, before.athens.name);
      await workspaceShown(page, before.athens.name);
      await waitFor(shellRow(page, elsewhere.shellId), `the row of shell ${elsewhere.shellId}`);
      expected({
        what: `rows of ${sparta.name}'s shell while ${before.athens.name} is shown`,
        expected: 0,
        found: await shellRow(page, agent.shellId).count(),
      });
      await openWorkspace(page, sparta.name);
      await workspaceShown(page, sparta.name);
    });
  },
});

export const endedAfterRestart = defineCheck(import.meta.url, {
  id: "S7.ended-after-restart",
  title: "killed and exited shells stay gone after a restart, and missing folders show as such",
  needs: { restart: true },
  // One restart: each is how the restarted server shows a shell that ended before it.
  covers: ["S7 AC-12", "S7 AC-13", "S7 AC-14", "S7 AC-23", "S7 AC-16", "S7 AC-22"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    let setup = await setupOn(ctx, { as: page });

    const made = await trail.stage("setup", async () => {
      const agentScript = { script: await mockAgent(setup.client) };
      const sparta = await setup.workspace("sparta");
      const repo = await setup.project(sparta, await setup.repo());
      const plain = await setup.project(sparta, await setup.folder("plain"));
      const removed = await setup.project(sparta, await setup.folder("removed"));
      const moved = await setup.project(sparta, await setup.folder("moved"));
      await showWorkspace(page, sparta);

      // The fork is the repo's last start, which stage AC-23 reads back, so it starts from the modal.
      const fork = await startShell(page, setup.shells, repo.path, { fork: true });
      const forked: ShellResult = {
        kind: "shell",
        shellId: fork.shellId,
        pid: fork.pid,
        cwd: fork.cwd,
        workspace: sparta.name,
        project: repo.path,
      };
      await setup.killShell(forked);
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
      const ended = [forked, byCommand, exitZero, exitFailed];
      await setup.shells.lists.until(
        "the killed and exited shells to leave the list",
        (list) => ended.every((shell) => list.every((entry) => entry.shellId !== shell.shellId)),
        endsFrom,
      );

      const inRemoved = await setup.shell(removed, agentScript);
      const inMoved = await setup.shell(moved, agentScript);
      await signalShells(setup.shells, [inRemoved, inMoved]);
      await NodeFSP.rm(removed.path, { recursive: true });
      await NodeFSP.rename(moved.path, `${moved.path}-elsewhere`);
      const missing = [
        [removed.path, inRemoved],
        [moved.path, inMoved],
      ] as const;
      return { sparta, repo, forked, ended, missing };
    });

    await trail.stage("restart", async () => {
      setup = await restartAndReload(ctx, page, made.sparta, setup);
    });

    await trail.stage("AC-12", async () => {
      unlistedAfterRestart(setup, made.ended, "killed and exited shells listed after the restart");
      expected({
        what: "killed and exited shells still running after the restart",
        expected: [],
        found: made.ended.filter((shell) => alive(shell.pid!)).map((shell) => shell.shellId),
      });
    });

    await trail.stage("AC-23", async () => {
      await NodeFSP.access(made.forked.cwd);
      await openModal(page, made.repo.path);
      // The project's last start was the fork, so the modal opens on Fork.
      await modeButton(page, "Existing").click();
      const offered = (await dropdownItems(page, "Start in")).map(([key]) => key);
      await cancelModal(page);
      expected({
        what: `the killed shell's worktree ${made.forked.cwd} among the offered places`,
        expected: true,
        found: offered.includes(made.forked.cwd),
      });
    });

    await trail.stage("AC-16", async () => {
      for (const [folder, shell] of made.missing) {
        await waitFor(projectMissing(page, folder), `project ${folder} to show as not found`);
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

    await trail.stage("AC-22", async () => {
      // The projects show as not found (stage AC-16), so their buttons have settled.
      for (const [folder] of made.missing) {
        expected({
          what: `"Create shell" buttons in the missing folder ${folder}`,
          expected: 0,
          found: await createShellButton(page, folder).count(),
        });
      }
    });
  },
});

export const removedStayGone = defineCheck(import.meta.url, {
  id: "S7.removed-stay-gone",
  title: "removing unavailable entries works, and they stay gone after a restart",
  needs: { restart: true },
  // The removal, then the same entries after a restart.
  covers: ["S7 AC-17", "S7 AC-17 after restart"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    let setup = await setupOn(ctx, { as: page });

    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const kept = await setup.project(sparta, await setup.folder("kept"));
      const removed = await setup.project(sparta, await setup.folder("removed"));
      const moved = await setup.project(sparta, await setup.folder("moved"));
      const keptShell = await setup.shell(kept);
      const inRemoved = await setup.shell(removed);
      const inMoved = await setup.shell(moved);
      await signalShells(setup.shells, [inRemoved, inMoved]);
      await NodeFSP.rm(removed.path, { recursive: true });
      await NodeFSP.rename(moved.path, `${moved.path}-elsewhere`);
      await showWorkspace(page, sparta);
      return {
        sparta,
        keptShell,
        gone: [inRemoved, inMoved],
        folders: [removed.path, moved.path],
      };
    });

    await trail.stage("AC-17", async () => {
      for (const shell of made.gone) await killFromTree(page, shell.shellId);
      // With their last shells removed, the projects whose folders are gone leave the workspace.
      for (const folder of made.folders) {
        await waitFor(page.locator(`[data-project="${folder}"]`), `project ${folder} to leave`, {
          state: "detached",
        });
      }
    });

    await trail.stage("AC-17 after restart", async () => {
      setup = await restartAndReload(ctx, page, made.sparta, setup);
      unlistedAfterRestart(setup, made.gone, "removed shells listed after the restart");
      // The kept shell's row shows once the tree is back, so a removed project would show with it.
      await waitFor(
        shellRow(page, made.keptShell.shellId),
        `the row of shell ${made.keptShell.shellId}`,
      );
      const shown: Array<string> = [];
      for (const folder of made.folders) {
        if ((await page.locator(`[data-project="${folder}"]`).count()) > 0) shown.push(folder);
      }
      expected({ what: "removed projects shown after the restart", expected: [], found: shown });
    });
  },
});

export const lostHost = defineCheck(import.meta.url, {
  id: "S7.lost-host",
  title: "a restart that lost the shell host shows its shells as lost, and removed ones stay gone",
  // Two restarts (D10): the first loses the host, the second proves what was removed stays gone.
  needs: { restart: true },
  // The lost host, then a second restart: the lost entries it removed stay gone (plan D10).
  covers: ["S7 AC-20", "S7 AC-17 after restart"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    let setup = await setupOn(ctx, { as: page });

    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const plain = await setup.project(sparta, await setup.folder("plain"));
      const agent = await setup.shell(plain, { script: await mockAgent(setup.client) });
      const plainShell = await setup.shell(plain);
      await showWorkspace(page, sparta);
      await openTab(page, agent);
      return { sparta, agent, plainShell };
    });

    await trail.stage("AC-20", async () => {
      setup = await restartAndReload(ctx, page, made.sparta, setup, { lostHost: true });
      for (const shell of [made.agent, made.plainShell]) {
        await waitFor(
          endedRow(page, shell.shellId, "lost"),
          `shell ${shell.shellId} to show as lost`,
        );
      }
      expected({
        what: "shell processes left after their shell host ended",
        expected: [],
        found: await survivors([made.agent.pid!, made.plainShell.pid!]),
      });
      await killFromTree(page, made.plainShell.shellId);
    });

    await trail.stage("AC-17 after restart", async () => {
      setup = await restartAndReload(ctx, page, made.sparta, setup);
      unlistedAfterRestart(
        setup,
        [made.plainShell],
        "removed lost shells listed after the restart",
      );
      await waitFor(
        endedRow(page, made.agent.shellId, "lost"),
        `shell ${made.agent.shellId} to stay lost`,
      );
    });
  },
});

export const switchWorkspace = defineCheck(import.meta.url, {
  id: "S7.switch-workspace",
  title: "a shell keeps running while another workspace is shown, and switching back finds it",
  needs: {},
  covers: ["S7 AC-9"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    const setup = await setupOn(ctx, { as: page });
    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const shell = await setup.shell(await setup.project(sparta, await setup.folder("plain")));
      const athens = await setup.workspace("athens");
      await setup.project(athens, await setup.folder("other"));
      await showWorkspace(page, sparta);
      return { sparta, shell, athens };
    });

    await trail.stage("AC-9", async () => {
      await showWorkspace(page, made.athens);
      await openWorkspace(page, made.sparta.name);
      await workspaceShown(page, made.sparta.name, " after switching back");
      await waitFor(shellRow(page, made.shell.shellId), `the row of shell ${made.shell.shellId}`);
      expected({
        what: `shell ${made.shell.shellId} running after another workspace was shown`,
        expected: true,
        found: running(setup.shells, made.shell.shellId),
      });
    });
  },
});

export const unreadableWorkspace = defineCheck(import.meta.url, {
  id: "S7.unreadable-workspace",
  title: "a workspace whose file became unreadable says why and changes nothing",
  needs: {},
  covers: ["S7 AC-19"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    const setup = await setupOn(ctx, { as: page });
    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const athens = await setup.workspace("athens");
      await showWorkspace(page, sparta);
      return { sparta, athens };
    });

    await trail.stage("AC-19", () =>
      revokeWrite(
        ctx,
        workspaceFile(ctx, made.athens.name),
        "AC-19 unreadable workspace",
        async () => {
          await openWorkspace(page, made.athens.name);
          await waitFor(
            alert(page, "cannot be opened"),
            "the alert that the workspace cannot be opened",
          );
          await workspaceShown(page, made.sparta.name, " after the refused open");
        },
        { unreadable: true },
      ),
    );
  },
});

export const removeWorkspaceByMenu = defineCheck(import.meta.url, {
  id: "S7.remove-workspace",
  title: "a removed workspace is not offered again and its file is gone",
  needs: {},
  covers: ["S7 AC-33"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    const setup = await setupOn(ctx, { as: page });
    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const athens = await setup.workspace("athens");
      await showWorkspace(page, sparta);
      return { sparta, athens };
    });

    await trail.stage("AC-33", async () => {
      await removeWorkspace(page, made.athens.name);
      await expectMenuOffers(page, "Open workspace", {
        includes: [made.sparta.name],
        excludes: [made.athens.name],
      });
      expected({
        what: "the removed workspace's file on disk",
        expected: false,
        found: await NodeFSP.access(workspaceFile(ctx, made.athens.name)).then(
          () => true,
          () => false,
        ),
      });
    });
  },
});

export const removeUnsaveable = defineCheck(import.meta.url, {
  id: "S7.remove-unsaveable",
  title: "a removal that cannot be saved says why and keeps the entry",
  needs: { serverWide: "makes the state folder read-only" },
  covers: ["S7 AC-18"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    const setup = await setupOn(ctx, { as: page });
    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const shell = await setup.shell(await setup.project(sparta, await setup.folder("plain")));
      await signalShells(setup.shells, [shell]);
      await showWorkspace(page, sparta);
      await waitFor(
        endedRow(page, shell.shellId, "signal"),
        `shell ${shell.shellId} to show as ended by a signal`,
      );
      return { shell };
    });

    await trail.stage("AC-18", () =>
      revokeWrite(
        ctx,
        NodePath.join(ctx.server.home, "userdata", "shells"),
        "AC-18 removal that cannot be saved",
        async () => {
          await askToKill(page, made.shell.shellId);
          await answerConfirm(page, "Confirm");
          await waitFor(
            alert(page, "could not save its shells"),
            "the alert that shells could not be saved",
          );
          await waitFor(
            endedRow(page, made.shell.shellId, "signal"),
            `shell ${made.shell.shellId} to stay as ended by a signal`,
          );
        },
      ),
    );
  },
});

export const layoutUnsaveable = defineCheck(import.meta.url, {
  id: "S7.layout-unsaveable",
  title: "a layout that cannot be saved says so, shells keep running, and saving resumes",
  needs: { serverWide: "makes the state folder read-only" },
  covers: ["S7 AC-21"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await widePage(ctx);
    const setup = await setupOn(ctx, { as: page });
    const made = await trail.stage("setup", async () => {
      const sparta = await setup.workspace("sparta");
      const plain = await setup.project(sparta, await setup.folder("plain"));
      const first = await setup.shell(plain);
      const second = await setup.shell(plain);
      await showWorkspace(page, sparta);
      await openTab(page, first);
      await layoutSaved(page, sparta.name);
      return { first, second };
    });

    await trail.stage("AC-21", async () => {
      const workspacesDir = NodePath.join(ctx.server.home, "userdata", "workspaces");
      const mode = (await NodeFSP.stat(workspacesDir)).mode & 0o777;
      await revokeWrite(ctx, workspacesDir, "AC-21 layout that cannot be saved", async () => {
        await openTab(page, made.second);
        await waitFor(
          alert(page, "The layout is not being saved"),
          "the alert that the layout is not being saved",
        );
        // The page says the save failed, never that it is saved.
        await waitFor(layoutState(page, "failed"), "the layout save to show as failed");
        expected({
          what: `shell ${made.second.shellId} running after the layout save failed`,
          expected: true,
          found: running(setup.shells, made.second.shellId),
        });
        // Write access comes back before the step's own undo, to see saving resume.
        await NodeFSP.chmod(workspacesDir, mode);
        await openTab(page, made.first);
        await waitFor(alert(page, "The layout is not being saved"), "the layout alert to leave", {
          state: "detached",
        });
        await waitFor(layoutState(page, "saved"), "the layout save to show as saved");
      });
    });
  },
});

export const successors = [
  surviveRestart,
  endedAfterRestart,
  removedStayGone,
  lostHost,
  switchWorkspace,
  unreadableWorkspace,
  removeWorkspaceByMenu,
  removeUnsaveable,
  layoutUnsaveable,
];
