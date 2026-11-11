// @effect-diagnostics nodeBuiltinImport:off - Checks fixture folders in the throwaway home and ends a shell's process from outside.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { openTab, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { expectLogged } from "../lib/serverLog.ts";
import { mockAgent, setupOn, type ShellResult } from "../lib/setup.ts";
import { agentReady, history, pidsRunning, running, shellEnded, survivors } from "../lib/shells.ts";
import { closeTab, shellTab } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { answerConfirm, askToKill, killFromTree, shellRow } from "../lib/ui/tree.ts";
import { removeWorkspace } from "../lib/ui/workspacesMenu.ts";
import { alive, check, waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";

export const killShell = defineCheck(import.meta.url, {
  id: "S6",
  title: "kill shells from the tree, from inside, and with their workspace",
  needs: { unshared: "it finds its shell's jobs by matching every process on the machine" },
  covers: [
    "S6 AC-7",
    "S6 AC-8",
    "S6 AC-9",
    "S6 AC-10",
    "S6 AC-11",
    "S6 AC-12",
    "S6 AC-13",
    "S6 AC-14",
    "S6 AC-15",
    "S6 AC-16",
    "S6 AC-17",
    "S6 AC-18",
    "S6 AC-20",
    "S6 AC-28",
  ],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const page = await ctx.openPage();
    const frames = pageFrames(page);
    const setup = await setupOn(ctx, { as: page });
    const { client, shells } = setup;
    const agent = { script: await mockAgent(client) };

    const ws = await setup.workspace("s6");
    const repo = await setup.project(ws, await setup.repo());
    const plain = await setup.project(ws, await setup.folder("plain"));
    const extra = await setup.project(ws, await setup.folder("extra"));
    await showWorkspace(page, ws);

    const isRunning = (shell: ShellResult) => running(shells, shell.shellId);
    const leftList = (shell: ShellResult) =>
      shells.lists.until(
        `shell ${shell.shellId} to leave the list`,
        (list) => list.every((entry) => entry.shellId !== shell.shellId),
        Math.max(0, shells.lists.mark() - 1),
      );
    /** Runs `line` in a plain shell from its tab and waits for `echo`. */
    const runInShell = async (shell: ShellResult, line: string, echo: string) => {
      await openTab(page, shell);
      const from = frames.mark();
      await typeLine(page, line);
      await frames
        .until(`"${echo}" in the shell`, (frame) => frame.includes(echo), from)
        .catch((error: unknown) => {
          // The raw output outlives the shell; the server forgets an ended one.
          const output = JSON.stringify(server.rawOutput(shell.shellId).slice(-600));
          const current = shells.current().find((entry) => entry.shellId === shell.shellId);
          const listed = JSON.stringify(current ?? "not listed");
          throw new Error(
            `${error instanceof Error ? error.message : error} The shell's output ends with ${output}; it is ${listed}.`,
          );
        });
    };
    const endedLogged = (shell: ShellResult, message: string) =>
      expectLogged(
        server,
        message,
        (entry) =>
          entry.includes("shell ended") &&
          entry.includes(shell.shellId) &&
          entry.includes(shell.cwd),
      );

    // AC-18: cancelling the confirmation keeps the shell.

    const withJobs = await trail.stage("AC-18", async () => {
      const shell = await setup.shell(plain);
      await askToKill(page, shell.shellId);
      await answerConfirm(page, "Cancel");
      check(isRunning(shell), "Cancelling the kill ended the shell (AC-18).");
      await waitFor(shellRow(page, shell.shellId), `the row of shell ${shell.shellId} to stay`);
      return shell;
    });

    // AC-7, AC-8, AC-9, AC-20: a kill from the tree ends the shell, its background job and a
    // double-forked job, and closes its open tab.

    await trail.stage("AC-7, AC-9", async () => {
      // No `$!`: zsh would read its `!` as a history expansion.
      await runInShell(withJobs, "sleep 1601 & (sleep 1602 &); echo jobs-started", "jobs-started");
      const jobs = await pidsRunning(/^sleep 160[12]$/);
      check(jobs.length === 2 && jobs.every(alive), `The shell's jobs did not start: ${jobs}.`);
      await killFromTree(page, withJobs.shellId);
      await leftList(withJobs);
      await shellEnded(shells, withJobs);
      // The jobs are not the server's to report on, so only a bounded check can see them end.
      const jobsLeft = await survivors(jobs);
      check(jobsLeft.length === 0, `The shell's jobs ${jobsLeft.join(", ")} survived (AC-9).`);
      check((await shellTab(page, withJobs.shellId).count()) === 0, "The tab stayed open (AC-8).");
      await endedLogged(withJobs, "The log has no end line with the id and folder (AC-20).");
    });

    // AC-8: a shell whose tab is closed only leaves the tree.

    await trail.stage("AC-8", async () => {
      const closed = await setup.shell(plain, agent);
      await openTab(page, closed);
      await closeTab(page, closed.shellId);
      await killFromTree(page, closed.shellId);
      await leftList(closed);
      await shellEnded(shells, closed);
    });

    // AC-12, AC-13, AC-10, AC-11: `probe kill` ends its own shell only; the worktree the
    // shell was forked into stays, and the other shell there keeps its output.

    const { worktree, neighbour } = await trail.stage("AC-12", async () => {
      const forked = await setup.shell(repo, {
        worktree: {
          fork: { from: { kind: "branch", name: "main" }, name: "probe-worktree-000006" },
        },
      });
      const worktree = forked.cwd;
      const neighbour = await setup.shell(repo, { ...agent, worktree: { existing: worktree } });
      await openTab(page, neighbour);
      await agentReady(client, neighbour.shellId);
      const typedNeighbour = frames.mark();
      await typeLine(page, "neighbour-line-s6");
      await frames.until(
        "the neighbour's line",
        (frame) => frame.includes("echo: neighbour-line-s6"),
        typedNeighbour,
      );
      await openTab(page, forked);
      await typeLine(page, 'probe kill || "$PROBE_BIN" kill');
      await leftList(forked).catch(async (error: unknown) => {
        const tail = (await history(client, forked.shellId)).slice(-600);
        throw new Error(`${error instanceof Error ? error.message : error} Shell shows: ${tail}`);
      });
      await shellEnded(shells, forked);
      check(isRunning(neighbour), "probe kill ended another shell (AC-13).");
      check(
        (await history(client, neighbour.shellId)).includes("echo: neighbour-line-s6"),
        "The other shell in the worktree lost its output (AC-11).",
      );
      await NodeFSP.access(worktree);
      await endedLogged(forked, "The log has no end line for probe kill (AC-20).");
      return { worktree, neighbour };
    });

    await trail.stage("AC-10", async () => {
      await killFromTree(page, neighbour.shellId);
      await leftList(neighbour);
      await NodeFSP.access(worktree);
    });

    // AC-14: a kill command that cannot reach the server says so; the shell runs on.

    const unreachable = await trail.stage("AC-14", async () => {
      const shell = await setup.shell(plain);
      await runInShell(
        shell,
        'PROBE_SHELL_ENDPOINT=http://127.0.0.1:9/ "$PROBE_BIN" kill; echo exit-$?-s6',
        "exit-1-s6",
      );
      check(
        (await history(client, shell.shellId)).includes("could not reach Probe"),
        "The kill command printed no reason (AC-14).",
      );
      check(isRunning(shell), "The unreachable kill ended the shell (AC-14).");
      return shell;
    });

    // AC-17: a shell that ended while its confirmation was open leaves without an error.

    await trail.stage("AC-17", async () => {
      const vanished = await setup.shell(plain, agent);
      await askToKill(page, vanished.shellId);
      NodeProcess.kill(vanished.pid!, "SIGKILL");
      await shellEnded(shells, vanished);
      await answerConfirm(page, "Confirm");
      await waitFor(
        page.locator(`[data-shell-row="${vanished.shellId}"]`),
        `the row of shell ${vanished.shellId} to leave the tree`,
        { state: "detached" },
      );
      check(
        (await page.getByRole("alert").count()) === 0,
        "Killing an ended shell showed an error.",
      );
    });

    // Removing a project kills its shells and keeps its folder and the other projects' shells.

    await trail.stage("remove project", async () => {
      const inExtra = [await setup.shell(extra, agent), await setup.shell(extra, agent)];
      const project = page.locator(`[data-project="${extra.path}"]`);
      const label = NodePath.basename(extra.path);
      await project.getByRole("treeitem", { level: 2 }).hover();
      await project.getByRole("button", { name: new RegExp(`^Remove ${label} from`) }).click();
      await waitFor(
        page.getByRole("alertdialog").getByText("Its 2 running shells are killed."),
        "the confirmation to name the project's 2 running shells",
      );
      await answerConfirm(page, "Confirm");
      await waitFor(project, `project ${extra.path} to leave the tree`, { state: "detached" });
      for (const shell of inExtra) await shellEnded(shells, shell);
      check(isRunning(unreachable), "Removing a project killed another project's shell.");
      await NodeFSP.access(extra.path);
    });

    // AC-15, AC-16: removing the workspace kills its running shells and keeps its folders.

    await trail.stage("AC-15", async () => {
      const last = await setup.shell(repo, agent);
      const ending = [unreachable, last];
      check(
        ending.every((shell) => alive(shell.pid!)),
        "A shell to be removed with the workspace is not running.",
      );
      await removeWorkspace(page, ws.name);
      await waitFor(
        page.getByTestId("workspace-screen").getByRole("button", { name: "Open workspace" }),
        "the start screen after removing the workspace",
      );
      for (const shell of ending) await shellEnded(shells, shell);
      for (const folder of [repo.path, plain.path, worktree]) await NodeFSP.access(folder);
    });
  },
});
