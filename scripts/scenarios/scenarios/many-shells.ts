// @effect-diagnostics nodeBuiltinImport:off - Ends a shell's process from outside.

import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { layoutSaved, openTab, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn } from "../lib/setup.ts";
import { history, shellEnded, writeLine } from "../lib/shells.ts";
import { closeTab, shellTab, tabIds, tabs } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { endedRow, openFromTree, shellRow, workspaceShown } from "../lib/ui/tree.ts";
import { alive, check, waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";

export const manyShells = defineCheck(import.meta.url, {
  id: "S4",
  title: "run many shells, each with its own output",
  needs: {},
  covers: [
    "S4 AC-1",
    "S4 AC-2",
    "S4 AC-3",
    "S4 AC-4",
    "S4 AC-5",
    "S4 AC-11",
    "S4 AC-15",
    "S4 AC-26",
    "S4 AC-28",
    "S4 AC-31",
    "S4 AC-32",
    "S4 EC-3",
  ],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const page = await ctx.openPage();
    const frames = pageFrames(page);
    const setup = await setupOn(ctx, { as: page });
    const { client, shells } = setup;

    // AC-1: two git projects, one plain project, an existing and a forked worktree of one
    // project, and a second shell in one worktree.

    const { ws, started } = await trail.stage("setup", async () => {
      const ws = await setup.workspace("s4");
      const repo = await setup.repo({ label: "repo", linkedWorktree: true });
      const linked = repo.linked[0]!.path;
      const inRepo = await setup.project(ws, repo);
      const inSecond = await setup.project(ws, await setup.repo({ label: "second" }));
      const inPlain = await setup.project(ws, await setup.folder("plain"));
      const started = [
        await setup.shell(inRepo),
        await setup.shell(inSecond),
        await setup.shell(inPlain),
        await setup.shell(inRepo, { worktree: { existing: linked } }),
        await setup.shell(inRepo, {
          worktree: { fork: { from: { kind: "branch", name: "main" }, name: "fork-s4" } },
        }),
        await setup.shell(inRepo, { worktree: { existing: linked } }),
      ];
      await showWorkspace(page, ws);
      for (const shell of started) await openTab(page, shell);
      return { ws, started };
    });
    const name = ws.name;

    await trail.stage("AC-1", async () => {
      const forked = started[4]!.cwd;
      check(
        forked.startsWith(NodePath.join(server.home, "worktrees", "repo")),
        `The fork started in ${forked}, not in a new worktree.`,
      );
      check((await tabs(page).count()) === 6, "Not every shell has a tab.");

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
      for (const [index, shell] of started.entries()) {
        const text = await history(client, shell.shellId);
        check(text.includes(`marker-${index}-s4`), `Shell ${index} lost its own line (AC-1).`);
        const foreign = started
          .map((_, other) => `marker-${other}-s4`)
          .filter((marker, other) => other !== index && text.includes(marker));
        check(foreign.length === 0, `Shell ${index} shows other shells' lines: ${foreign} (AC-1).`);
      }
    });

    // AC-2: clicking another tab shows that shell; the one left keeps running.

    await trail.stage("AC-2", async () => {
      await shellTab(page, started[0]!.shellId).click();
      await waitFor(
        page.getByRole("tabpanel", { name: /./ }).filter({ visible: true }),
        "the clicked tab's terminal",
      );
      check(
        (await shellTab(page, started[0]!.shellId).getAttribute("aria-selected")) === "true",
        "The clicked tab is not shown (AC-2).",
      );
      await shellTab(page, started[1]!.shellId).click();
      check(
        (await shellTab(page, started[1]!.shellId).getAttribute("aria-selected")) === "true",
        "The second clicked tab is not shown (AC-2).",
      );
      // Switching tabs puts the keyboard in the shown shell, not on the tab.
      await waitFor(
        page.locator('[role="tabpanel"]:not([hidden]) :focus'),
        "the keyboard in the shown shell",
      );
      check(
        shells.current().find((shell) => shell.shellId === started[0]!.shellId)?.status ===
          "running",
        "The shell whose tab was left stopped running (AC-2).",
      );
    });

    // PRB.T-007: set up a closed tab, a killed shell, a shell a signal ends, a shell that exits
    // after a failed command, and output that arrives while the page reloads.

    const [first, plainShell, inPlain, signalled, killed, closed] = started as [
      (typeof started)[number],
      (typeof started)[number],
      (typeof started)[number],
      (typeof started)[number],
      (typeof started)[number],
      (typeof started)[number],
    ];
    await trail.stage("PRB.T-007 setup", async () => {
      await closeTab(page, closed.shellId);
      await setup.killShell(killed);
      await openFromTree(page, inPlain.shellId);
      // Lists from before the shell started also lack it; only later ones count.
      const exitedFrom = shells.lists.mark();
      await typeLine(page, "false; exit");
      await shells.lists.until(
        "the exited shell to leave the list",
        (list) => list.every((shell) => shell.shellId !== inPlain.shellId),
        exitedFrom,
      );
      const signalledFrom = shells.lists.mark();
      NodeProcess.kill(signalled.pid!, "SIGKILL");
      await shells.lists.until(
        "the signalled shell to be listed as ended",
        (list) =>
          list.some((shell) => shell.shellId === signalled.shellId && shell.ended === "signal"),
        signalledFrom,
      );
      await shellEnded(shells, signalled);
      // A plain shell (EC-3) shows output that arrives during the reload; its tab stays selected.
      await openFromTree(page, plainShell.shellId);
      await writeLine(client, shells, plainShell.shellId, "sleep 2; echo during-$((1+1))-s4");
    });

    // AC-32, AC-1, AC-31, AC-5: a reload shows the same workspace, tree, tabs and selection.

    const reloadedFrom = await trail.stage("AC-32", async () => {
      const reloadedFrom = frames.mark();
      // The tab changes above are saved before the reload, so the strip comes back as they left it.
      await layoutSaved(page, name);
      await page.reload();
      await workspaceShown(page, name, " after the reload");
      return reloadedFrom;
    });

    await trail.stage("AC-1", async () => {
      for (const shell of [first, plainShell, closed]) {
        await waitFor(shellRow(page, shell.shellId), `the tree row of shell ${shell.shellId}`);
      }
      const open = await tabIds(page);
      check(
        JSON.stringify(open) === JSON.stringify([first.shellId, plainShell.shellId]),
        `The open tabs after the reload are ${JSON.stringify(open)} (AC-1).`,
      );
    });

    await trail.stage("AC-31", async () => {
      check(
        (await shellTab(page, plainShell.shellId).getAttribute("aria-selected")) === "true",
        "The selected tab changed with the reload (AC-31).",
      );
    });

    await trail.stage("AC-4", async () => {
      await frames.until(
        "output made during the reload",
        (frame) => frame.includes("during-2-s4"),
        reloadedFrom,
      );
      const duringCount = frames.seen
        .slice(reloadedFrom)
        .reduce((sum, frame) => sum + frame.split("during-2-s4").length - 1, 0);
      check(
        duringCount === 1,
        `Output made during the reload arrived ${duringCount} times (AC-4).`,
      );
    });

    await trail.stage("AC-5", async () => {
      check(
        (await shellTab(page, closed.shellId).count()) === 0,
        "A tab closed before the reload is open again (AC-5).",
      );
      check(alive(closed.pid!), "The shell with a closed tab is not running (AC-5).");
    });

    // AC-2, AC-3: a reopened tab shows the earlier output once, and input still reaches it.

    await trail.stage("AC-2", async () => {
      const reopenedFrom = frames.mark();
      await openFromTree(page, closed.shellId);
      await frames.until(
        "the closed shell's earlier output",
        (frame) => frame.includes("marker-5-s4"),
        reopenedFrom,
      );
      const typedAfter = frames.mark();
      await typeLine(page, "echo after-reload-$((0+1))-s4");
      await frames.until(
        "input after the reload",
        (frame) => frame.includes("after-reload-1-s4"),
        typedAfter,
      );
    });

    await trail.stage("AC-3", async () => {
      const markerCount = frames.seen
        .slice(reloadedFrom)
        .reduce((sum, frame) => sum + frame.split("marker-0-s4").length - 1, 0);
      check(markerCount === 1, `Shell 0's earlier line arrived ${markerCount} times (AC-3).`);
    });

    // AC-11, AC-28, AC-15: the killed and the exited shell stay gone; the signalled one is
    // listed as ended.

    await trail.stage("AC-11", async () => {
      for (const shell of [killed, inPlain]) {
        check(
          (await shellRow(page, shell.shellId).count()) === 0,
          `Shell ${shell.shellId} is back in the tree after the reload (AC-11, AC-28).`,
        );
      }
    });

    await trail.stage("AC-15", async () => {
      await waitFor(
        endedRow(page, signalled.shellId, "signal"),
        `the row of shell ${signalled.shellId} ended by a signal`,
      );
      check(
        (await shellTab(page, signalled.shellId).count()) === 0,
        "An ended shell still has a tab (AC-15).",
      );
    });
  },
});
