// @effect-diagnostics nodeBuiltinImport:off - Ends a shell's process from outside.

import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { Deadline } from "../lib/deadlines.ts";
import { expected } from "../lib/expect.ts";
import { layoutSaved, openTab, showWorkspace } from "../lib/navigate.ts";
import { timesSeen } from "../lib/network.ts";
import { holdOutput, type ReleaseTiming, reloadReleasing } from "../lib/reloadRelease.ts";
import { framedPage, plainTabs } from "../lib/setup.ts";
import { history, printedAfter, running, shellEnded, writeLine } from "../lib/shells.ts";
import { closeTab, selectedShellTab, selectedTab, shellTab, tabIds } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { endedRow, openFromTree, shellRow, workspaceShown } from "../lib/ui/tree.ts";
import { alive, waitFor } from "../lib/waits.ts";
import { type CheckScenario, defineCheck } from "../scenario.ts";

export const manyShellsCheck = defineCheck(import.meta.url, {
  id: "S4.many-shells",
  title: "shells in projects, worktrees and a fork each keep their own output",
  needs: {},
  covers: ["S4 AC-1"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const { page, frames, setup } = await framedPage(ctx);

    // Two git projects, one plain project, an existing and a forked worktree of one project,
    // and a second shell in one worktree.
    const { inRepo, started } = await trail.stage("setup", async () => {
      const ws = await setup.workspace("s4");
      const repo = await setup.repo({ label: "repo", linkedWorktree: true });
      const linked = repo.linked[0]!.path;
      const inRepo = await setup.project(ws, repo);
      const inSecond = await setup.project(ws, await setup.repo({ label: "second" }));
      const inPlain = await setup.project(ws, await setup.folder("plain"));
      const fork = { from: { kind: "branch", name: "main" }, name: `fork-${ctx.runId}` } as const;
      const started = [
        await setup.shell(inRepo),
        await setup.shell(inSecond),
        await setup.shell(inPlain),
        await setup.shell(inRepo, { worktree: { existing: linked } }),
        await setup.shell(inRepo, { worktree: { fork } }),
        await setup.shell(inRepo, { worktree: { existing: linked } }),
      ];
      await showWorkspace(page, ws);
      for (const shell of started) await openTab(page, shell);
      return { inRepo, started };
    });

    await trail.stage("AC-1", async () => {
      expected({
        what: "the folder the fork started in",
        expected: NodePath.join(server.home, "worktrees", NodePath.basename(inRepo.path)),
        found: NodePath.dirname(started[4]!.cwd),
      });
      expected({
        what: "the shells with an open tab",
        expected: started.map((shell) => shell.shellId).toSorted(),
        found: (await tabIds(page)).toSorted(),
      });
      // Each line goes to the shell whose tab is shown, so every marker lands in one shell only.
      for (const [index, shell] of started.entries()) {
        await openFromTree(page, shell.shellId);
        const typed = frames.mark();
        await typeLine(page, `echo marker-$((${index}))-s4`);
        await frames.until(
          `shell ${index} to echo its marker`,
          (frame) => frame.includes(`marker-${index}-s4`),
          typed,
        );
      }
      const markers = started.map((_, index) => `marker-${index}-s4`);
      for (const [index, shell] of started.entries()) {
        const text = await history(setup.client, shell.shellId);
        expected({
          what: `the markers in the history of shell ${index}`,
          expected: [markers[index]],
          found: markers.filter((marker) => text.includes(marker)),
        });
      }
    });
  },
});

export const switchTabs = defineCheck(import.meta.url, {
  id: "S4.switch-tabs",
  title: "clicking another tab shows that shell and the one left keeps running",
  needs: {},
  covers: ["S4 AC-2"],
  run: async (ctx) => {
    const { page, shells, setup } = await ctx.trail.stage("setup", () => plainTabs(ctx, 2));
    const [left, shown] = shells as [(typeof shells)[number], (typeof shells)[number]];

    await ctx.trail.stage("AC-2", async () => {
      await shellTab(page, left.shellId).click();
      await waitFor(selectedShellTab(page, left.shellId), `the clicked tab of ${left.shellId}`);
      await shellTab(page, shown.shellId).click();
      await waitFor(selectedShellTab(page, shown.shellId), `the clicked tab of ${shown.shellId}`);
      // Switching tabs puts the keyboard in the shown shell, not on the tab.
      await waitFor(
        page.locator(`[role="tabpanel"][data-shell-id="${shown.shellId}"]:not([hidden]) :focus`),
        "the keyboard in the shown shell",
      );
      expected({
        what: `shell ${left.shellId}, whose tab was left, running`,
        expected: true,
        found: running(setup.shells, left.shellId),
      });
    });
  },
});

export const reloadLayout = defineCheck(import.meta.url, {
  id: "S4.reload-layout",
  title: "a reload shows the same workspace, tree, tabs and selected tab",
  needs: {},
  // One reload proves them: the workspace, its rows, the open tabs, the selection, the closed tab.
  covers: ["S4 AC-32", "S4 AC-1", "S4 AC-31", "S4 AC-5"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, workspace, shells, setup } = await trail.stage("setup", () => plainTabs(ctx, 3));
    const [first, selected, closed] = shells as [
      (typeof shells)[number],
      (typeof shells)[number],
      (typeof shells)[number],
    ];

    await trail.stage("AC-32", async () => {
      await closeTab(page, closed.shellId);
      await openFromTree(page, selected.shellId);
      await layoutSaved(page, workspace.name);
      await page.reload();
      await workspaceShown(page, workspace.name, " after the reload");
    });

    await trail.stage("AC-1", async () => {
      for (const shell of shells) {
        await waitFor(shellRow(page, shell.shellId), `the tree row of shell ${shell.shellId}`);
      }
      for (const shell of [first, selected]) {
        await waitFor(shellTab(page, shell.shellId), `the tab of shell ${shell.shellId}`);
      }
      expected({
        what: "the open tabs after the reload",
        expected: [first.shellId, selected.shellId],
        found: await tabIds(page),
      });
    });

    await trail.stage("AC-31", async () => {
      expected({
        what: "the selected tab after the reload",
        expected: selected.shellId,
        found: await selectedTab(page),
      });
    });

    await trail.stage("AC-5", async () => {
      expected({
        what: "tabs of the shell whose tab was closed before the reload",
        expected: 0,
        found: await shellTab(page, closed.shellId).count(),
      });
      expected({
        what: `shell ${closed.shellId}, whose tab was closed, running`,
        expected: true,
        found: closed.pid !== null && alive(closed.pid) && running(setup.shells, closed.shellId),
      });
    });
  },
});

/**
 * A plain shell holds its output and lets it go at `release` while the page reloads; the page
 * must show it exactly once after the reload.
 */
export function outputDuringReload(
  url: string,
  spec: {
    readonly id: string;
    readonly title: string;
    readonly covers?: ReadonlyArray<string>;
    readonly release: ReleaseTiming;
    readonly deadline?: Deadline;
  },
): CheckScenario {
  const { release, deadline, ...named } = spec;
  return defineCheck(url, {
    ...named,
    needs: {},
    run: async (ctx) => {
      const { trail } = ctx;
      const { page, frames, workspace, shells, setup } = await trail.stage("setup", () =>
        plainTabs(ctx, 1),
      );
      const shell = shells[0]!;
      const held = await trail.stage("hold the output", () =>
        holdOutput(setup.client, setup.shells, shell.shellId, `during-${ctx.runId}-s4`),
      );
      const reloadedFrom = await trail.stage("reload while the output is held", () =>
        reloadReleasing(
          { page, server: ctx.server, client: setup.client, frames, workspace },
          held,
          release,
          deadline === undefined ? {} : { deadline },
        ),
      );
      await trail.stage("AC-4", async () => {
        expected({
          what: "times the output made during the reload reached the page after it",
          expected: 1,
          found: timesSeen(frames, held.marker, reloadedFrom),
        });
      });
    },
  });
}

export const outputDuringReloadCheck = outputDuringReload(import.meta.url, {
  id: "S4.output-during-reload",
  title: "output a plain shell makes during a reload shows once after it",
  // One held output proves them: shown once (AC-4), held with no sleep (AC-26), a plain shell (EC-3).
  covers: ["S4 AC-4", "S4 AC-26", "S4 EC-3"],
  release: "after-reload",
});

export const reopenAfterReload = defineCheck(import.meta.url, {
  id: "S4.reopen-after-reload",
  title: "after a reload a reopened tab shows its earlier output once and takes input",
  needs: {},
  // One reload proves them: the reopened tab (AC-2) and the open one (AC-3) show earlier output once.
  covers: ["S4 AC-2", "S4 AC-3"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, frames, workspace, shells, setup } = await trail.stage("setup", async () => {
      const made = await plainTabs(ctx, 2);
      for (const [index, shell] of made.shells.entries()) {
        const line = `echo early-$((${index}))-s4`;
        await printedAfter(made.setup, shell.shellId, line, `early-${index}-s4`);
      }
      return made;
    });
    const [open, reopened] = shells as [(typeof shells)[number], (typeof shells)[number]];

    const reloadedFrom = await trail.stage("reload with one tab closed", async () => {
      await closeTab(page, reopened.shellId);
      await layoutSaved(page, workspace.name);
      const reloadedFrom = frames.mark();
      await page.reload();
      await workspaceShown(page, workspace.name, " after the reload");
      await frames.until(
        "the open tab's earlier output after the reload",
        (frame) => frame.includes("early-0-s4"),
        reloadedFrom,
      );
      return reloadedFrom;
    });

    await trail.stage("AC-2", async () => {
      const reopenedFrom = frames.mark();
      await openFromTree(page, reopened.shellId);
      await frames.until(
        "the reopened tab's earlier output",
        (frame) => frame.includes("early-1-s4"),
        reopenedFrom,
      );
      const typed = frames.mark();
      await typeLine(page, "echo after-reload-$((0+1))-s4");
      await frames.until(
        "input to the reopened tab after the reload",
        (frame) => frame.includes("after-reload-1-s4"),
        typed,
      );
      expected({
        what: "times the reopened tab's earlier output arrived after the reload",
        expected: 1,
        found: timesSeen(frames, "early-1-s4", reloadedFrom),
      });
      expected({
        what: `shell ${reopened.shellId} running after the reopen`,
        expected: true,
        found: running(setup.shells, reopened.shellId),
      });
    });

    await trail.stage("AC-3", async () => {
      expected({
        what: `times the earlier output of shell ${open.shellId} arrived after the reload`,
        expected: 1,
        found: timesSeen(frames, "early-0-s4", reloadedFrom),
      });
    });
  },
});

export const endedAfterReload = defineCheck(import.meta.url, {
  id: "S4.ended-after-reload",
  title: "after a reload killed and exited shells stay gone and a signalled one shows as ended",
  needs: {},
  // One reload proves them: killed and exited shells stay gone, the signalled one shows ended.
  covers: ["S4 AC-11", "S4 AC-28", "S4 AC-15"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, workspace, shells, setup } = await trail.stage("setup", () => plainTabs(ctx, 4));
    const [kept, killed, exited, signalled] = shells as [
      (typeof shells)[number],
      (typeof shells)[number],
      (typeof shells)[number],
      (typeof shells)[number],
    ];

    await trail.stage("end three shells and reload", async () => {
      await setup.killShell(killed);
      const exitedFrom = setup.shells.lists.mark();
      await writeLine(setup.client, setup.shells, exited.shellId, "false; exit");
      await setup.shells.lists.until(
        `shell ${exited.shellId} to leave the list after it exited`,
        (list) => list.every((shell) => shell.shellId !== exited.shellId),
        exitedFrom,
      );
      const signalledFrom = setup.shells.lists.mark();
      NodeProcess.kill(signalled.pid!, "SIGKILL");
      await setup.shells.lists.until(
        `shell ${signalled.shellId} to be listed as ended by a signal`,
        (list) =>
          list.some((shell) => shell.shellId === signalled.shellId && shell.ended === "signal"),
        signalledFrom,
      );
      await shellEnded(setup.shells, signalled);
      await layoutSaved(page, workspace.name);
      await page.reload();
      await workspaceShown(page, workspace.name, " after the reload");
      await waitFor(shellRow(page, kept.shellId), `the tree row of shell ${kept.shellId}`);
    });

    await trail.stage("AC-11", async () => {
      for (const shell of [killed, exited]) {
        expected({
          what: `tree rows of shell ${shell.shellId} after the reload`,
          expected: 0,
          found: await shellRow(page, shell.shellId).count(),
        });
      }
    });

    await trail.stage("AC-15", async () => {
      await waitFor(
        endedRow(page, signalled.shellId, "signal"),
        `the row of shell ${signalled.shellId} ended by a signal`,
      );
      expected({
        what: `tabs of the ended shell ${signalled.shellId}`,
        expected: 0,
        found: await shellTab(page, signalled.shellId).count(),
      });
    });
  },
});

export const successors: ReadonlyArray<CheckScenario> = [
  manyShellsCheck,
  switchTabs,
  reloadLayout,
  outputDuringReloadCheck,
  reopenAfterReload,
  endedAfterReload,
];
