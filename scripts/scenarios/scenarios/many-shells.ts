// @effect-diagnostics nodeBuiltinImport:off - Makes git fixtures in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import * as Effect from "effect/Effect";

import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { alive, gone, pageFrames } from "../support.ts";
import {
  addProject,
  check,
  closeTab,
  createWorkspace,
  gitOk,
  history,
  killFromTree,
  leaveAgent,
  openFromTree,
  shellList,
  shellRow,
  shellTab,
  startShell,
  typeLine,
} from "./workspaceUi.ts";

export const manyShells: Scenario = {
  id: "S4",
  title: "run many shells, each with its own output",
  run: async ({ server, openPage }) => {
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const second = NodePath.join(folders, "second");
    const plain = NodePath.join(folders, "plain");
    const linked = NodePath.join(folders, "linked");
    for (const dir of [repo, second, plain]) await NodeFSP.mkdir(dir, { recursive: true });
    for (const dir of [repo, second]) {
      await gitOk(dir, "init", "-q", "-b", "main");
      await gitOk(dir, "commit", "-q", "--allow-empty", "-m", "one");
    }
    await gitOk(repo, "worktree", "add", "-q", "-b", "linked", linked);

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const frames = pageFrames(page);
    const rpc = await connectRpc(server.origin, page);
    const shells = shellList(rpc.client);
    let stage = "setup";

    try {
      await createWorkspace(page, "sparta");
      for (const folder of [repo, second, plain]) {
        check((await addProject(page, { import: folder })) === null, `Adding ${folder} failed.`);
      }

      // AC-1: two git projects, one plain project, an existing and a forked worktree of one
      // project, and a second shell in one worktree.

      stage = "AC-1";
      const started = [
        await startShell(page, shells, repo),
        await startShell(page, shells, second),
        await startShell(page, shells, plain),
        await startShell(page, shells, repo, { existing: linked }),
        await startShell(page, shells, repo, { fork: true }),
        await startShell(page, shells, repo, { existing: linked }),
      ];
      const forked = started[4]!.cwd;
      check(
        forked.startsWith(NodePath.join(server.home, "worktrees", "repo")),
        `The fork started in ${forked}, not in a new worktree.`,
      );
      check(
        (await page.getByRole("tablist", { name: "Shells" }).getByRole("tab").count()) === 6,
        "Not every shell has a tab.",
      );

      // Each line goes to the shell whose tab is shown, so every marker lands in one shell only.
      for (const [index, shell] of started.entries()) {
        await openFromTree(page, shell.shellId);
        await typeLine(page, `marker-${index}-s4`);
        await frames.until(`shell ${index} to echo its marker`, (frame) =>
          frame.includes(`echo: marker-${index}-s4`),
        );
      }
      for (const [index, shell] of started.entries()) {
        const text = await history(rpc.client, shell.shellId);
        check(
          text.includes(`echo: marker-${index}-s4`),
          `Shell ${index} lost its own line (AC-1).`,
        );
        const foreign = started
          .map((_, other) => `marker-${other}-s4`)
          .filter((marker, other) => other !== index && text.includes(marker));
        check(foreign.length === 0, `Shell ${index} shows other shells' lines: ${foreign} (AC-1).`);
      }

      // AC-2: clicking another tab shows that shell; the one left keeps running.

      stage = "AC-2";
      await shellTab(page, started[0]!.shellId).click();
      await page.getByRole("tabpanel", { name: /./ }).filter({ visible: true }).waitFor();
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
      await page.locator('[role="tabpanel"]:not([hidden]) :focus').waitFor();
      check(
        shells.current().find((shell) => shell.shellId === started[0]!.shellId)?.status ===
          "running",
        "The shell whose tab was left stopped running (AC-2).",
      );

      // PRB.T-007: set up a closed tab, a killed shell, a shell a signal ends, a shell that exits
      // after a failed command, and output that arrives while the page reloads.

      stage = "PRB.T-007 setup";
      const [first, plainShell, inPlain, signalled, killed, closed] = started as [
        (typeof started)[number],
        (typeof started)[number],
        (typeof started)[number],
        (typeof started)[number],
        (typeof started)[number],
        (typeof started)[number],
      ];
      await closeTab(page, closed.shellId);
      await killFromTree(page, killed.shellId);
      await openFromTree(page, inPlain.shellId);
      await leaveAgent(page, rpc.client, inPlain.shellId);
      await typeLine(page, "false; exit");
      await shells.lists.until("the exited shell to leave the list", (list) =>
        list.every((shell) => shell.shellId !== inPlain.shellId),
      );
      NodeProcess.kill(signalled.pid!, "SIGKILL");
      check(await gone(signalled.pid!), "The shell killed by a signal is still running.");
      await shells.lists.until("the signalled shell to be listed as ended", (list) =>
        list.some((shell) => shell.shellId === signalled.shellId && shell.ended === "signal"),
      );
      // A shell with no agent left in it (EC-3) shows output that arrives during the reload.
      await openFromTree(page, plainShell.shellId);
      await leaveAgent(page, rpc.client, plainShell.shellId);
      await Effect.runPromise(
        rpc.client["shell.write"]({
          shellId: plainShell.shellId,
          data: "sleep 2; echo during-$((1+1))-s4\r",
        }),
      );

      // AC-32, AC-1, AC-31, AC-5: a reload shows the same workspace, tree, tabs and selection.

      stage = "AC-32";
      const reloadedFrom = frames.seen.length;
      await page.reload();
      await page.getByRole("tree").getByRole("treeitem", { level: 1, name: "sparta" }).waitFor();

      stage = "AC-1";
      for (const shell of [first, plainShell, closed])
        await shellRow(page, shell.shellId).waitFor();
      const tabIds = await page
        .getByRole("tablist", { name: "Shells" })
        .getByRole("tab")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-shell-id")));
      check(
        JSON.stringify(tabIds) === JSON.stringify([first.shellId, plainShell.shellId]),
        `The open tabs after the reload are ${JSON.stringify(tabIds)} (AC-1).`,
      );

      stage = "AC-31";
      check(
        (await shellTab(page, plainShell.shellId).getAttribute("aria-selected")) === "true",
        "The selected tab changed with the reload (AC-31).",
      );

      stage = "AC-4";
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

      stage = "AC-5";
      check(
        (await shellTab(page, closed.shellId).count()) === 0,
        "A tab closed before the reload is open again (AC-5).",
      );
      check(alive(closed.pid!), "The shell with a closed tab is not running (AC-5).");

      // AC-2, AC-3: a reopened tab shows the earlier output once, and input still reaches it.

      stage = "AC-2";
      const reopenedFrom = frames.seen.length;
      await openFromTree(page, closed.shellId);
      await frames.until(
        "the closed shell's earlier output",
        (frame) => frame.includes("echo: marker-5-s4"),
        reopenedFrom,
      );
      await typeLine(page, "after-reload-s4");
      await frames.until("input after the reload", (frame) =>
        frame.includes("echo: after-reload-s4"),
      );

      stage = "AC-3";
      const markerCount = frames.seen
        .slice(reloadedFrom)
        .reduce((sum, frame) => sum + frame.split("echo: marker-0-s4").length - 1, 0);
      check(markerCount === 1, `Shell 0's earlier line arrived ${markerCount} times (AC-3).`);

      // AC-11, AC-28, AC-15: the killed and the exited shell stay gone; the signalled one is
      // listed as ended.

      stage = "AC-11";
      for (const shell of [killed, inPlain]) {
        check(
          (await shellRow(page, shell.shellId).count()) === 0,
          `Shell ${shell.shellId} is back in the tree after the reload (AC-11, AC-28).`,
        );
      }
      stage = "AC-15";
      await page.locator(`[data-shell-id="${signalled.shellId}"][data-ended="signal"]`).waitFor();
      check(
        (await shellTab(page, signalled.shellId).count()) === 0,
        "An ended shell still has a tab (AC-15).",
      );
    } catch (error) {
      throw new Error(`S4 failed at ${stage}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};
