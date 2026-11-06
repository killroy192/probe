// @effect-diagnostics nodeBuiltinImport:off - Makes fixtures in the throwaway home and ends a shell's process from outside.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { ShellSummary } from "@t3tools/contracts";

import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { alive, gone, pageFrames } from "../support.ts";
import {
  addFolder,
  allGone,
  answerKill,
  askToKill,
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

/** Pids of the processes whose command line matches. */
async function pidsRunning(command: RegExp) {
  const table = await new Promise<string>((resolve, reject) =>
    NodeChildProcess.execFile("ps", ["-A", "-o", "pid=,args="], (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    ),
  );
  return table.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match !== null && command.test(match[2]!.trim()) ? [Number(match[1])] : [];
  });
}

export const killShell: Scenario = {
  id: "S6",
  title: "kill shells from the tree, from inside, and with their workspace",
  run: async ({ server, openPage }) => {
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const plain = NodePath.join(folders, "plain");
    for (const dir of [repo, plain]) await NodeFSP.mkdir(dir, { recursive: true });
    await gitOk(repo, "init", "-q", "-b", "main");
    await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "one");

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const frames = pageFrames(page);
    const rpc = await connectRpc(server.origin, page);
    const shells = shellList(rpc.client);
    const latest = (shell: ShellSummary) =>
      shells.current().find((entry) => entry.shellId === shell.shellId);
    const isRunning = (shell: ShellSummary) => {
      const current = latest(shell);
      return current?.status === "running" && current.pid !== null && alive(current.pid);
    };
    const leftList = (shell: ShellSummary) =>
      shells.lists.until(
        `shell ${shell.shellId} to leave the list`,
        (list) => list.every((entry) => entry.shellId !== shell.shellId),
        Math.max(0, shells.lists.seen.length - 1),
      );
    /** Leaves the mock agent, then runs `line` in the shell itself and waits for `echo`. */
    const runInShell = async (shell: ShellSummary, line: string, echo: string) => {
      await openFromTree(page, shell.shellId);
      await leaveAgent(page, rpc.client, shell.shellId);
      const from = frames.seen.length;
      await typeLine(page, line);
      await frames
        .until(`"${echo}" in the shell`, (frame) => frame.includes(echo), from)
        .catch(async (error: unknown) => {
          const tail = (await history(rpc.client, shell.shellId)).slice(-400);
          throw new Error(`${error instanceof Error ? error.message : error} Shell shows: ${tail}`);
        });
    };
    const endedLog = (shell: ShellSummary) =>
      server
        .logs()
        .split(/\n(?=\S)/)
        .some(
          (entry) =>
            entry.includes("shell ended") &&
            entry.includes(shell.shellId) &&
            entry.includes(shell.cwd),
        );
    let stage = "setup";

    try {
      await createWorkspace(page, "sparta");
      for (const folder of [repo, plain]) {
        check((await addFolder(page, { import: folder })) === null, `Adding ${folder} failed.`);
      }

      // AC-18: cancelling the confirmation keeps the shell.

      stage = "AC-18";
      const withJobs = await startShell(page, shells, plain);
      await askToKill(page, withJobs.shellId);
      await answerKill(page, "Cancel");
      check(isRunning(withJobs), "Cancelling the kill ended the shell (AC-18).");
      await shellRow(page, withJobs.shellId).waitFor();

      // AC-7, AC-8, AC-9, AC-20: a kill from the tree ends the shell, its background job and a
      // double-forked job, and closes its open tab.

      stage = "AC-7, AC-9";
      // No `$!`: zsh would read its `!` as a history expansion.
      await runInShell(withJobs, "sleep 1601 & (sleep 1602 &); echo jobs-started", "jobs-started");
      const jobs = await pidsRunning(/^sleep 160[12]$/);
      check(jobs.length === 2 && jobs.every(alive), `The shell's jobs did not start: ${jobs}.`);
      const shellPid = latest(withJobs)!.pid!;
      await killFromTree(page, withJobs.shellId);
      await leftList(withJobs);
      check(await allGone([shellPid, ...jobs]), "The shell or one of its jobs survived (AC-9).");
      check((await shellTab(page, withJobs.shellId).count()) === 0, "The tab stayed open (AC-8).");
      check(endedLog(withJobs), "The log has no end line with the id and folder (AC-20).");

      // AC-8: a shell whose tab is closed only leaves the tree.

      stage = "AC-8";
      const closed = await startShell(page, shells, plain);
      await closeTab(page, closed.shellId);
      const closedPid = latest(closed)!.pid!;
      await killFromTree(page, closed.shellId);
      await leftList(closed);
      check(await gone(closedPid), "The shell with a closed tab survived its kill (AC-8).");

      // AC-12, AC-13, AC-10, AC-11: `probe kill` ends its own shell only; the worktree the
      // shell was forked into stays, and the other shell there keeps its output.

      stage = "AC-12";
      const forked = await startShell(page, shells, repo, { fork: true });
      const worktree = forked.cwd;
      const neighbour = await startShell(page, shells, repo, { existing: worktree });
      await openFromTree(page, neighbour.shellId);
      await typeLine(page, "neighbour-line-s6");
      await frames.until("the neighbour's line", (frame) =>
        frame.includes("echo: neighbour-line-s6"),
      );
      const forkedPid = latest(forked)!.pid!;
      await openFromTree(page, forked.shellId);
      await leaveAgent(page, rpc.client, forked.shellId);
      await typeLine(page, 'probe kill || "$PROBE_BIN" kill');
      await leftList(forked).catch(async (error: unknown) => {
        const tail = (await history(rpc.client, forked.shellId)).slice(-600);
        throw new Error(`${error instanceof Error ? error.message : error} Shell shows: ${tail}`);
      });
      check(await gone(forkedPid), "probe kill left its shell running (AC-12).");
      check(isRunning(neighbour), "probe kill ended another shell (AC-13).");
      check(
        (await history(rpc.client, neighbour.shellId)).includes("echo: neighbour-line-s6"),
        "The other shell in the worktree lost its output (AC-11).",
      );
      await NodeFSP.access(worktree);
      check(endedLog(forked), "The log has no end line for probe kill (AC-20).");

      stage = "AC-10";
      await killFromTree(page, neighbour.shellId);
      await leftList(neighbour);
      await NodeFSP.access(worktree);

      // AC-14: a kill command that cannot reach the server says so; the shell runs on.

      stage = "AC-14";
      const unreachable = await startShell(page, shells, plain);
      await runInShell(
        unreachable,
        'PROBE_SHELL_ENDPOINT=http://127.0.0.1:9/ "$PROBE_BIN" kill; echo exit-$?-s6',
        "exit-1-s6",
      );
      check(
        (await history(rpc.client, unreachable.shellId)).includes("could not reach Probe"),
        "The kill command printed no reason (AC-14).",
      );
      check(isRunning(unreachable), "The unreachable kill ended the shell (AC-14).");

      // AC-17: a shell that ended while its confirmation was open leaves without an error.

      stage = "AC-17";
      const vanished = await startShell(page, shells, plain);
      await askToKill(page, vanished.shellId);
      const vanishedPid = latest(vanished)!.pid!;
      NodeProcess.kill(vanishedPid, "SIGKILL");
      check(await gone(vanishedPid), "The shell ended from outside is still running.");
      await answerKill(page, "Confirm");
      await page.locator(`[data-shell-row="${vanished.shellId}"]`).waitFor({ state: "detached" });
      check(
        (await page.getByRole("alert").count()) === 0,
        "Killing an ended shell showed an error.",
      );

      // AC-15, AC-16: removing the workspace kills its running shells and keeps its folders.

      stage = "AC-15";
      const last = await startShell(page, shells, repo);
      const pids = [unreachable, last].map((shell) => latest(shell)!.pid!);
      check(pids.every(alive), "A shell to be removed with the workspace is not running.");
      await page.getByRole("button", { name: "Workspaces" }).click();
      await page.getByRole("menuitem", { name: "Remove workspace" }).click();
      await page.getByRole("menuitem", { name: "sparta", exact: true }).click();
      await page
        .getByTestId("workspace-screen")
        .getByRole("button", { name: "Open workspace" })
        .waitFor();
      check(await allGone(pids), "A shell of the removed workspace survived (AC-16).");
      for (const folder of [repo, plain, worktree]) await NodeFSP.access(folder);
    } catch (error) {
      throw new Error(`S6 failed at ${stage}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};
