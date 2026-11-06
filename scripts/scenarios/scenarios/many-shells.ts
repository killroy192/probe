// @effect-diagnostics nodeBuiltinImport:off - Makes git fixtures in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { pageFrames } from "../support.ts";
import {
  addFolder,
  check,
  createWorkspace,
  gitOk,
  history,
  openFromTree,
  shellList,
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
        check((await addFolder(page, { import: folder })) === null, `Adding ${folder} failed.`);
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
      check(
        shells.current().find((shell) => shell.shellId === started[0]!.shellId)?.status ===
          "running",
        "The shell whose tab was left stopped running (AC-2).",
      );
      // Reload and restart survival join S4 with PRB.T-007.
    } catch (error) {
      throw new Error(`S4 failed at ${stage}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};
