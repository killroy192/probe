// @effect-diagnostics nodeBuiltinImport:off - Moves a project folder.

import * as NodeFSP from "node:fs/promises";

import type { PointerPage } from "../browser.ts";
import { expected } from "../lib/expect.ts";
import { openTab, restartAndReload, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { framedPage, type Setup, type ShellResult } from "../lib/setup.ts";
import { history, listedShell, signalShells } from "../lib/shells.ts";
import { shellTab } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import {
  endedRow,
  missingMark,
  openFromTree,
  restoreButton,
  restoreFromTree,
  shellRow,
} from "../lib/ui/tree.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

/**
 * A page showing a new workspace with one folder project per label and `shells[i]` plain shells
 * in project `i`, started before the page shows the workspace so each row is there.
 */
async function prepare(
  ctx: ScenarioContext,
  folders: ReadonlyArray<string>,
  shells: ReadonlyArray<number>,
) {
  const { page, frames, setup } = await framedPage(ctx);
  await page.setViewportSize({ width: 1200, height: 900 });
  const ws = await setup.workspace("s8");
  const projects = [];
  const paths = [];
  for (const label of folders) {
    const folder = await setup.folder(label);
    paths.push(folder.path);
    projects.push(await setup.project(ws, folder));
  }
  const started: Array<ShellResult> = [];
  for (const [index, count] of shells.entries()) {
    for (let n = 0; n < count; n++) started.push(await setup.shell(projects[index]!));
  }
  await showWorkspace(page, ws);
  return { page, frames, setup, ws, projects, paths, shells: started };
}

const latest = (setup: Setup, shell: Pick<ShellResult, "shellId">) =>
  listedShell(setup.shells, shell.shellId);

/** Ends the shell's process with SIGKILL from outside and waits for its ended row. */
async function signal(page: PointerPage, setup: Setup, shell: ShellResult) {
  await signalShells(setup.shells, [shell]);
  await waitFor(endedRow(page, shell.shellId), `the row of shell ${shell.shellId} as ended`);
}

/** Restores the shell from its row and returns its entry once the list shows it running again. */
async function restore(page: PointerPage, setup: Setup, shell: ShellResult) {
  // Lists from before the signal show it running too; only lists after the restore count.
  const from = setup.shells.lists.mark();
  await restoreFromTree(page, shell.shellId);
  const list = await setup.shells.lists.until(
    `shell ${shell.shellId} to run again as restored`,
    (entries) =>
      entries.some(
        (entry) => entry.shellId === shell.shellId && entry.status === "running" && entry.restored,
      ),
    from,
  );
  return list.find((entry) => entry.shellId === shell.shellId)!;
}

/** Waits until a list from `from` on no longer holds the shell, then for its row to leave. */
async function left(page: PointerPage, setup: Setup, shell: ShellResult, from: number) {
  await setup.shells.lists.until(
    `shell ${shell.shellId} to leave the list`,
    (entries) => entries.every((entry) => entry.shellId !== shell.shellId),
    from,
  );
  await waitFor(shellRow(page, shell.shellId), `the row of shell ${shell.shellId} to leave`, {
    state: "detached",
  });
}

/** Types an echo whose output, `<label>-<runId>-42`, the typed line never spells. */
async function echoes(
  ctx: ScenarioContext,
  page: PointerPage,
  frames: ReturnType<typeof pageFrames>,
  label: string,
) {
  const marker = `${label}-${ctx.runId}`;
  const from = frames.mark();
  await typeLine(page, `echo ${marker}-$((40+2))`);
  await frames.until(`the line ${marker}-42`, (frame) => frame.includes(`${marker}-42`), from);
  return `${marker}-42`;
}

export const restoreAfterSignal = defineCheck(import.meta.url, {
  id: "S8.restore-after-signal",
  title: "a shell a signal ended stays listed and runs again only on the user's Restore",
  needs: {},
  // The S8 behavior is the E-001 requirement: the restore is the user's, never automatic.
  covers: ["S8 restore after a signal", "S8 PRB.E-001 FR-17"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, frames, setup, shells } = await prepare(ctx, ["plain"], [1]);
    const shell = shells[0]!;

    const earlier = await trail.stage("ended by a signal", async () => {
      await openTab(page, shell);
      const earlier = await echoes(ctx, page, frames, "before");
      await signal(page, setup, shell);
      await waitFor(shellTab(page, shell.shellId), `the tab of shell ${shell.shellId} to close`, {
        state: "detached",
      });
      expected({
        what: `shell ${shell.shellId} after the signal`,
        expected: { ended: "signal", restored: false },
        found: {
          ended: latest(setup, shell)?.ended ?? null,
          restored: latest(setup, shell)?.restored ?? null,
        },
      });
      return earlier;
    });

    await trail.stage("restore after a signal", async () => {
      const restored = await restore(page, setup, shell);
      expected({
        what: `shell ${shell.shellId} after the restore`,
        expected: { newProcess: true, cwd: shell.cwd },
        found: {
          newProcess: restored.pid !== null && restored.pid !== shell.pid,
          cwd: restored.cwd,
        },
      });
      await waitFor(
        page.locator(`[data-shell-row="${shell.shellId}"] [data-restored]`),
        `the row of shell ${shell.shellId} as restored`,
      );
      // Its tab was open when it ended, so it comes back; a closed tab would stay closed.
      await waitFor(shellTab(page, shell.shellId), `the tab of shell ${shell.shellId} to return`);
      expected({
        what: "the restored shell's history holds the line from before the signal",
        expected: false,
        found: (await history(setup.client, shell.shellId)).includes(earlier),
      });
      await openFromTree(page, shell.shellId);
      await echoes(ctx, page, frames, "after");
    });
  },
});

export const noRestoreExitKill = defineCheck(import.meta.url, {
  id: "S8.no-restore-exit-kill",
  title: "a shell that exits or is killed leaves the list and offers nothing to restore",
  needs: {},
  // An exit and a kill are the two ways a shell leaves for good, which FR-19 names.
  covers: ["S8 no restore for exit or kill", "S8 PRB.E-001 FR-19"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, setup, shells } = await prepare(ctx, ["plain"], [2]);
    const [exited, killed] = shells as [ShellResult, ShellResult];

    await trail.stage("no restore after an exit", async () => {
      await openTab(page, exited);
      const from = setup.shells.lists.mark();
      await typeLine(page, "false; exit");
      await left(page, setup, exited, from);
    });

    await trail.stage("no restore after a kill", async () => {
      const from = setup.shells.lists.mark();
      await setup.killShell(killed);
      await left(page, setup, killed, from);
    });
  },
});

export const noRestoreMovedFolder = defineCheck(import.meta.url, {
  id: "S8.no-restore-moved-folder",
  title: "an ended shell whose folder is gone offers no Restore and can be removed",
  needs: {},
  // A missing folder is the other case FR-19 rules out of a restore.
  covers: ["S8 no restore for a moved folder", "S8 PRB.E-001 FR-19"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, setup, paths, shells } = await prepare(ctx, ["moved"], [1]);
    const shell = shells[0]!;
    const path = paths[0]!;

    await trail.stage("no restore for a moved folder", async () => {
      await signal(page, setup, shell);
      await NodeFSP.rename(path, `${path}-elsewhere`);
      await waitFor(
        missingMark(page, shell.shellId),
        `the row of shell ${shell.shellId} as missing its folder`,
      );
      await page.locator(`[data-shell-row="${shell.shellId}"]`).hover();
      expected({
        what: `the Restore buttons the row of shell ${shell.shellId} offers with its folder gone`,
        expected: 0,
        found: await restoreButton(page, shell.shellId).count(),
      });
    });

    await trail.stage("remove a shell missing its folder", async () => {
      const from = setup.shells.lists.mark();
      await setup.killShell({ ...shell, pid: latest(setup, shell)?.pid ?? null });
      await left(page, setup, shell, from);
    });
  },
});

export const removeRestored = defineCheck(import.meta.url, {
  id: "S8.remove-restored",
  title: "a restored shell can be removed",
  needs: {},
  covers: ["S8 remove after restore"],
  run: async (ctx) => {
    const { trail } = ctx;
    const { page, setup, shells } = await prepare(ctx, ["plain"], [1]);
    const shell = shells[0]!;

    const restored = await trail.stage("restored", async () => {
      await signal(page, setup, shell);
      return restore(page, setup, shell);
    });

    await trail.stage("remove after restore", async () => {
      const from = setup.shells.lists.mark();
      // A restore starts a new process, so the pid to see end is the restored one.
      await setup.killShell({ ...shell, pid: restored.pid });
      await left(page, setup, shell, from);
    });
  },
});

export const restoreAfterLostHost = defineCheck(import.meta.url, {
  id: "S8.restore-after-lost-host",
  title: "a shell lost with its shell host is listed as lost after a restart and restores in place",
  needs: { restart: true },
  // One lost host proves the restore (FR-17) and that the lost shell keeps its number (PRB.T-015).
  covers: ["S8 restore after a restart", "S8 PRB.T-015 numbering", "S8 PRB.E-001 FR-17"],
  run: async (ctx) => {
    const { trail } = ctx;
    const prepared = await prepare(ctx, ["plain"], [1]);
    const { page, frames, ws, projects } = prepared;
    const first = prepared.shells[0]!;
    let setup = prepared.setup;

    await trail.stage("lost with the host", async () => {
      setup = await restartAndReload(ctx, page, ws, setup, { lostHost: true });
      await waitFor(
        endedRow(page, first.shellId, "lost"),
        `the row of shell ${first.shellId} as lost`,
      );
    });

    await trail.stage("PRB.T-015 numbering", async () => {
      const next = await setup.shell(projects[0]!);
      await waitFor(shellRow(page, next.shellId), `the tree row of shell ${next.shellId}`);
      expected({
        what: "the titles of the lost shell and of one started after the restart",
        expected: ["Shell 1", "Shell 2"],
        found: [latest(setup, first)?.title ?? null, latest(setup, next)?.title ?? null],
      });
      await restore(page, setup, first);
      for (const [shell, title] of [
        [first, "Shell 1"],
        [next, "Shell 2"],
      ] as const) {
        const row = (await shellRow(page, shell.shellId).textContent()) ?? "";
        expected({
          what: `the tree row of shell ${shell.shellId} shows its title`,
          expected: title,
          found: row.includes(title) ? title : row,
        });
      }
    });

    await trail.stage("restore after a restart", async () => {
      await openFromTree(page, first.shellId);
      await echoes(ctx, page, frames, "rebooted");
    });
  },
});

export const successors = [
  restoreAfterSignal,
  noRestoreExitKill,
  noRestoreMovedFolder,
  removeRestored,
  restoreAfterLostHost,
];
