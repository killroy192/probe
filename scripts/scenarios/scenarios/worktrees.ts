// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Makes git fixtures in the throwaway home, ends shells' processes and times the start.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { ShellSummary } from "@t3tools/contracts";

import type { PointerPage } from "../browser.ts";
import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { gone, pageFrames, type recorder } from "../support.ts";
import {
  addFolder,
  cancelModal,
  check,
  dialog,
  folderRadio,
  git,
  openModal,
  preselected,
  shellList,
  startButton,
  startFromModal,
  tabs,
  typeLine,
} from "./workspaceUi.ts";

const NAME = /^probe-worktree-[0-9a-f]{6}$/;

const worktreeStep = (page: PointerPage) =>
  dialog(page).getByRole("radiogroup", { name: "Worktree" });
const worktreeRadio = (page: PointerPage, label: string) =>
  worktreeStep(page).locator(`[role="radio"][aria-label="${label}"]`);
const startingPoint = (page: PointerPage) =>
  dialog(page).getByRole("combobox", { name: "Starting point" });
const worktreeNode = (page: PointerPage, path: string) => page.locator(`[data-worktree="${path}"]`);
const worktreeNodeLabel = (page: PointerPage, path: string) =>
  worktreeNode(page, path).getByRole("treeitem", { level: 3 });

/** The worktree step's choices, by label, once it has loaded. */
async function worktreeChoices(page: PointerPage) {
  await worktreeStep(page).waitFor();
  const radios = worktreeStep(page).getByRole("radio");
  const labels: Array<string> = [];
  let checked: string | null = null;
  for (let index = 0; index < (await radios.count()); index++) {
    const label = (await radios.nth(index).getAttribute("aria-label")) ?? "";
    labels.push(label);
    if ((await radios.nth(index).getAttribute("aria-checked")) === "true") checked = label;
  }
  return { labels, checked };
}

async function pickStartingPoint(page: PointerPage, label: string) {
  await startingPoint(page).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await startingPoint(page).filter({ hasText: label }).waitFor();
}

/** The generated name the modal shows for a new worktree. */
async function proposedName(page: PointerPage) {
  const line = dialog(page).locator("p", { hasText: "New worktree and branch:" });
  const name = ((await line.textContent()) ?? "").replace("New worktree and branch:", "").trim();
  check(NAME.test(name), `The modal shows no worktree name: ${name}.`);
  return name;
}

/** Waits until `count` running shells have `cwd`, judged from the current list on. */
async function runningIn(
  list: ReturnType<typeof recorder<ReadonlyArray<ShellSummary>>>,
  cwd: string,
  count: number,
) {
  const running = (shells: ReadonlyArray<ShellSummary>) =>
    shells.filter((shell) => shell.cwd === cwd && shell.status === "running");
  const found = await list.until(
    `${count} running shells in ${cwd}`,
    (shells) => running(shells).length === count,
    Math.max(0, list.seen.length - 1),
  );
  return running(found);
}

export const worktrees: Scenario = {
  id: "S3",
  title: "start shells in new and existing worktrees",
  run: async ({ server, openPage }) => {
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const repo2 = NodePath.join(folders, "second");
    const empty = NodePath.join(folders, "empty");
    const plain = NodePath.join(folders, "plain");
    const linked = NodePath.join(folders, "linked");
    const busy = NodePath.join(folders, "busy");
    const detached = NodePath.join(folders, "detached");
    const repoWorktrees = NodePath.join(server.home, "worktrees", "repo");
    const hold = NodePath.join(server.home, "hold-fork");
    const release = NodePath.join(server.home, "release-fork");
    for (const dir of [repo, repo2, empty, plain]) await NodeFSP.mkdir(dir, { recursive: true });

    const run = async (cwd: string, ...args: Array<string>) => {
      const result = await git(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
      check(result.ok, `git ${args.join(" ")} failed in the fixture.`);
      return result.stdout.trim();
    };
    await run(repo, "init", "-q", "-b", "main");
    await run(repo, "commit", "-q", "--allow-empty", "-m", "one");
    for (const branch of ["other", "doomed", "doomed2"]) await run(repo, "branch", branch);
    await run(repo, "commit", "-q", "--allow-empty", "-m", "two");
    await run(repo, "worktree", "add", "-q", "-b", "linked", linked, "other");
    await run(repo, "worktree", "add", "-q", "-b", "busy", busy, "main");
    await run(repo, "worktree", "add", "-q", "--detach", detached, "other");
    // Holds a fork open while the hold file exists, so a second click lands mid-start (AC-26).
    const hooks = NodePath.join(repo, ".git", "hooks");
    await NodeFSP.writeFile(
      NodePath.join(hooks, "post-checkout"),
      `#!/bin/sh\n[ -f "${hold}" ] || exit 0\nwhile [ ! -f "${release}" ]; do sleep 0.05; done\n`,
      { mode: 0o755 },
    );
    await run(repo, "config", "core.hooksPath", hooks);
    await run(repo2, "init", "-q", "-b", "main");
    await run(repo2, "commit", "-q", "--allow-empty", "-m", "one");
    await run(empty, "init", "-q", "-b", "main");
    const otherHead = await run(repo, "rev-parse", "other");
    const detachedLabel = `detached · ${otherHead.slice(0, 7)}`;
    const gitState = async () => ({
      branches: await run(repo, "branch", "--format=%(refname:short)"),
      worktrees: await run(repo, "worktree", "list", "--porcelain"),
      folders: (await NodeFSP.readdir(repoWorktrees).catch(() => [])).toSorted().join(","),
    });

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const frames = pageFrames(page);
    let rpc = await connectRpc(server.origin, page);
    let shells = shellList(rpc.client);
    let stage = "setup";
    const logLines = () => server.logs().split(/\n(?=\S)/);
    const reopen = async () => {
      await page.reload();
      await page
        .getByTestId("workspace-screen")
        .getByRole("button", { name: "Open workspace" })
        .click();
      await page.getByRole("menuitem", { name: "sparta", exact: true }).click();
      await page.getByRole("tree").getByRole("treeitem", { level: 1, name: "sparta" }).waitFor();
    };
    const killShell = async (shell: ShellSummary) => {
      const latest = shells.current().find((entry) => entry.shellId === shell.shellId);
      const pid = latest?.pid ?? null;
      check(pid !== null, `The shell has no pid: ${JSON.stringify(latest)}.`);
      NodeProcess.kill(pid, "SIGKILL");
      check(await gone(pid), "The killed shell's process is still running.");
      await shells.lists.until("the killed shell to end", (list) =>
        list.some((entry) => entry.shellId === shell.shellId && entry.status !== "running"),
      );
    };

    try {
      await page.getByRole("button", { name: "Create workspace" }).click();
      await dialog(page).getByRole("textbox").fill("sparta");
      await dialog(page).getByRole("button", { name: "Create" }).click();
      await page.getByRole("tree").getByRole("treeitem", { level: 1, name: "sparta" }).waitFor();
      for (const folder of [repo, repo2, empty, plain]) {
        check((await addFolder(page, { import: folder })) === null, `Adding ${folder} failed.`);
      }

      // AC-11, AC-6, AC-28: the first start preselects the checkout and skips the starting point.

      stage = "AC-11";
      await openModal(page);
      await folderRadio(page, repo).click();
      const first = await worktreeChoices(page);
      check(first.checked === "Checkout · main", `Preselected ${first.checked} (AC-11).`);
      check(
        JSON.stringify(first.labels) ===
          JSON.stringify(["Checkout · main", "busy", detachedLabel, "linked", "New worktree"]),
        `The worktree step offers ${JSON.stringify(first.labels)} (AC-6).`,
      );
      check(
        (await startingPoint(page).count()) === 0,
        "The starting point shows for the checkout.",
      );
      check((await startFromModal(page)) === null, "The checkout start failed (AC-11).");
      const [shellA] = await runningIn(shells.lists, repo, 1);
      await worktreeNodeLabel(page, repo)
        .filter({ hasText: /^checkout · main$/ })
        .waitFor();
      await worktreeNode(page, repo).locator(`[data-shell-id="${shellA!.shellId}"]`).waitFor();

      // AC-12, AC-24: "none" is remembered and starts more shells in the checkout.

      stage = "AC-12, AC-24";
      for (const count of [2, 3]) {
        await openModal(page);
        check((await preselected(page)) === repo, "The folder is not preselected (AC-12).");
        const again = await worktreeChoices(page);
        check(again.checked === "Checkout · main", `Preselected ${again.checked} (AC-12, AC-24).`);
        check((await startFromModal(page)) === null, "A checkout start failed (AC-24).");
        await runningIn(shells.lists, repo, count);
      }

      // AC-29, AC-30: a branch switch in one shell moves the node; leaving the worktree marks it.

      stage = "AC-29, AC-30";
      await page.getByRole("tree").locator(`[data-shell-id="${shellA!.shellId}"]`).click();
      await typeLine(page, "exit");
      await tabs(page)
        .filter({ hasText: /^Shell 1 · repo$/ })
        .waitFor();
      const switchedAt = Date.now();
      await typeLine(page, "git switch -q other");
      await worktreeNodeLabel(page, repo)
        .filter({ hasText: /^checkout · other$/ })
        .waitFor();
      const switchMs = Date.now() - switchedAt;
      check(switchMs <= 4_000, `The branch label took ${switchMs} ms (AC-29 needs about 2000).`);
      check(
        (await worktreeNode(page, repo).locator("[data-shell-id]").count()) === 3,
        "The checkout's shells did not all stay under its node (AC-29).",
      );
      const rowA = page.getByRole("tree").locator(`[data-shell-id="${shellA!.shellId}"]`);
      await typeLine(page, "cd /tmp");
      await rowA.locator('[data-elsewhere="/tmp"]').waitFor();
      check(
        (await worktreeNode(page, repo).locator(`[data-shell-id="${shellA!.shellId}"]`).count()) ===
          1,
        "A shell that left its worktree moved in the tree (AC-30).",
      );
      await typeLine(page, `cd ${repo} && git switch -q main`);
      await rowA.locator("[data-elsewhere]").waitFor({ state: "detached" });
      await worktreeNodeLabel(page, repo)
        .filter({ hasText: /^checkout · main$/ })
        .waitFor();

      // AC-16, AC-17: a plain folder has no worktree step; one with no commit has no new worktree.

      stage = "AC-16, AC-17";
      await openModal(page);
      await folderRadio(page, plain).click();
      check(
        (await worktreeStep(page).count()) === 0,
        "A plain folder has a worktree step (AC-16).",
      );
      check((await startFromModal(page)) === null, "The plain start failed (AC-16).");
      await runningIn(shells.lists, plain, 1);
      check(
        (await page.locator(`[data-folder="${plain}"] [data-worktree]`).count()) === 0,
        "A plain folder's shell sits under a worktree node.",
      );
      await openModal(page);
      await folderRadio(page, empty).click();
      const noCommit = await worktreeChoices(page);
      check(
        !noCommit.labels.includes("New worktree"),
        "New worktree is offered with no commit (AC-17).",
      );
      check(
        (await startFromModal(page)) === null,
        "The checkout start with no commit failed (AC-17).",
      );
      await runningIn(shells.lists, empty, 1);

      // AC-2: an existing worktree starts without the starting-point step.

      stage = "AC-2";
      await openModal(page);
      await folderRadio(page, repo).click();
      await worktreeRadio(page, "busy").click();
      check(
        (await startingPoint(page).count()) === 0,
        "The starting point shows for a worktree (AC-2).",
      );
      check((await startFromModal(page)) === null, "The existing worktree start failed (AC-2).");
      await runningIn(shells.lists, busy, 1);
      await worktreeNodeLabel(page, busy)
        .filter({ hasText: /^busy$/ })
        .waitFor();

      // AC-1, AC-10, AC-24: a worktree with a shell is not offered, and not preselected.

      stage = "AC-1, AC-10";
      // The open modal hides the page behind it, so tabs are counted before it opens.
      const tabsBefore = await tabs(page).count();
      await openModal(page);
      const withBusy = await worktreeChoices(page);
      check(withBusy.checked === "Checkout · main", `Preselected ${withBusy.checked} (AC-10).`);
      check(
        JSON.stringify(withBusy.labels) ===
          JSON.stringify(["Checkout · main", detachedLabel, "linked", "New worktree"]),
        `The worktree step offers ${JSON.stringify(withBusy.labels)} (AC-1, AC-24).`,
      );

      // AC-3, AC-4, AC-8: a new worktree from a branch, named as the modal showed.

      stage = "AC-3, AC-4, AC-8";
      await worktreeRadio(page, "New worktree").click();
      await startingPoint(page)
        .filter({ hasText: /^main$/ })
        .waitFor();
      const name1 = await proposedName(page);
      await startingPoint(page).click();
      await page.getByRole("option", { name: "other", exact: true }).waitFor();
      const options = await page.getByRole("option").allTextContents();
      check(
        ["main", "other", "linked", "busy", `Worktree ${detachedLabel}`].every((option) =>
          options.includes(option),
        ) && !options.some((option) => option.includes("/")),
        `The starting points are ${JSON.stringify(options)} (AC-3).`,
      );
      await page.getByRole("option", { name: "other", exact: true }).click();
      const framesBefore = frames.seen.length;
      const clickedAt = Date.now();
      check((await startFromModal(page)) === null, "The new worktree start failed (AC-4).");
      const path1 = NodePath.join(repoWorktrees, name1);
      const [shell1] = await runningIn(shells.lists, path1, 1);
      await frames.until(
        "the mock CLI banner",
        (frame) => frame.includes("Mock Agent v1"),
        framesBefore,
      );
      NodeProcess.stdout.write(
        `scenarios: S3 worktree start-to-banner ms=${Date.now() - clickedAt} (SU-1, not enforced)\n`,
      );
      check(
        (await run(path1, "branch", "--show-current")) === name1,
        "The branch is not named as shown.",
      );
      check(
        (await run(repo, "rev-parse", name1)) === otherHead,
        "The branch is not at other (AC-4).",
      );
      check(
        (await tabs(page).count()) === tabsBefore + 1,
        "No tab opened for the new worktree (AC-4).",
      );
      await worktreeNodeLabel(page, path1).filter({ hasText: name1 }).waitFor();
      check(
        logLines().some(
          (line) =>
            line.includes("shell started") &&
            line.includes(shell1!.shellId) &&
            line.includes(path1) &&
            // Once in the worktree path and once as the branch.
            line.split(name1).length >= 3,
        ),
        "The log has no start line with the worktree and branch (AC-8).",
      );

      // AC-9, AC-7: the choice is remembered and one click makes another, differently named worktree.

      stage = "AC-9, AC-7";
      await openModal(page);
      const remembered = await worktreeChoices(page);
      check(remembered.checked === "New worktree", `Preselected ${remembered.checked} (AC-9).`);
      await startingPoint(page)
        .filter({ hasText: /^other$/ })
        .waitFor();
      const name2 = await proposedName(page);
      check(name2 !== name1, "The second worktree got the first one's name (AC-7).");
      check((await startFromModal(page)) === null, "The repeated start failed (AC-9).");
      await runningIn(shells.lists, NodePath.join(repoWorktrees, name2), 1);

      // AC-27: closing the modal after choosing changes nothing and keeps the remembered choice.

      stage = "AC-27";
      const beforeClose = await gitState();
      await openModal(page);
      await worktreeRadio(page, "Checkout · main").click();
      await cancelModal(page);
      check(
        JSON.stringify(await gitState()) === JSON.stringify(beforeClose),
        "Closing created a worktree (AC-27).",
      );
      await openModal(page);
      check(
        (await worktreeChoices(page)).checked === "New worktree",
        "Closing changed the remembered choice (AC-27).",
      );

      // AC-15: another git folder does not get this folder's choices.

      stage = "AC-15";
      await folderRadio(page, repo2).click();
      const second = await worktreeChoices(page);
      check(
        second.checked === "Checkout · main",
        `The other folder preselected ${second.checked} (AC-15).`,
      );
      check(
        (await startingPoint(page).count()) === 0,
        "The other folder shows a starting point (AC-15).",
      );
      await cancelModal(page);

      // AC-5, AC-6: a new worktree forks from a detached worktree's commit.

      stage = "AC-5";
      await openModal(page);
      await worktreeChoices(page);
      await pickStartingPoint(page, `Worktree ${detachedLabel}`);
      const name3 = await proposedName(page);
      check((await startFromModal(page)) === null, "The start from a worktree failed (AC-5).");
      await runningIn(shells.lists, NodePath.join(repoWorktrees, name3), 1);
      check(
        (await run(repo, "rev-parse", name3)) === otherHead,
        "The fork is not at the detached commit (AC-5).",
      );

      // AC-14: a remembered starting point that is gone falls back to the current branch.

      stage = "AC-14";
      await run(repo, "worktree", "remove", "--force", detached);
      await openModal(page);
      check(
        (await worktreeChoices(page)).checked === "New worktree",
        "New worktree is not preselected (AC-14).",
      );
      await startingPoint(page)
        .filter({ hasText: /^main$/ })
        .waitFor();
      check(
        (await dialog(page).getByRole("alert").count()) === 0,
        "The modal shows an error (AC-14).",
      );

      // AC-18, AC-19, AC-20, AC-21: a starting point deleted before the click fails cleanly.

      stage = "AC-18, AC-19";
      await pickStartingPoint(page, "doomed");
      await run(repo, "branch", "-D", "doomed");
      const beforeFail = await gitState();
      const shellCount = shells.current().length;
      const failed = await startFromModal(page);
      check(failed?.includes("doomed") === true, `Failed fork: ${failed} (AC-18).`);
      check(
        JSON.stringify(await gitState()) === JSON.stringify(beforeFail),
        "The failed fork left something (AC-19).",
      );
      await cancelModal(page);
      check(shells.current().length === shellCount, "A failed fork started a shell (AC-18).");
      stage = "AC-20, AC-21";
      await openModal(page);
      check(
        (await worktreeChoices(page)).checked === "New worktree",
        "A failed fork changed the choice (AC-20).",
      );
      await startingPoint(page)
        .filter({ hasText: /^main$/ })
        .waitFor();
      await pickStartingPoint(page, "doomed2");
      await run(repo, "branch", "-D", "doomed2");
      check(
        (await startFromModal(page))?.includes("doomed2") === true,
        "The second fork did not fail.",
      );
      await pickStartingPoint(page, "main");
      const name4 = await proposedName(page);
      check((await startFromModal(page)) === null, "The retry after a failed fork failed (AC-21).");
      await runningIn(shells.lists, NodePath.join(repoWorktrees, name4), 1);

      // AC-31, AC-10, AC-13: an ended shell frees its worktree; a removed one is not preselected.

      stage = "AC-31";
      await openModal(page);
      await worktreeRadio(page, "linked").click();
      check((await startFromModal(page)) === null, "The linked worktree start failed.");
      const [linkedShell] = await runningIn(shells.lists, linked, 1);
      await worktreeNode(page, linked).waitFor();
      await killShell(linkedShell!);
      await worktreeNode(page, linked).waitFor({ state: "detached" });
      stage = "AC-10";
      await openModal(page);
      check(
        (await worktreeChoices(page)).checked === "linked",
        "The freed worktree is not preselected (AC-10).",
      );
      const worktreesBefore = await gitState();
      check(
        (await startFromModal(page)) === null,
        "The one-click start in the worktree failed (AC-10).",
      );
      const [linkedAgain] = await runningIn(shells.lists, linked, 1);
      check(linkedAgain!.shellId !== linkedShell!.shellId, "The ended shell counts as running.");
      check(
        (await gitState()).folders === worktreesBefore.folders,
        "Starting in an existing worktree created one (AC-10).",
      );
      stage = "AC-13";
      await killShell(linkedAgain!);
      await run(repo, "worktree", "remove", "--force", linked);
      await openModal(page);
      check(
        (await worktreeChoices(page)).checked === "Checkout · main",
        "A removed worktree is preselected (AC-13).",
      );
      check(
        (await dialog(page).getByRole("alert").count()) === 0,
        "The modal shows an error (AC-13).",
      );

      // AC-26: a second click while the fork runs is ignored; the modal says what it creates.

      stage = "AC-26";
      await worktreeRadio(page, "New worktree").click();
      await pickStartingPoint(page, "main");
      const held = await proposedName(page);
      const heldBefore = await gitState();
      await NodeFSP.writeFile(hold, "");
      await startButton(page).dblclick();
      await dialog(page).getByText(`Creating ${held}…`).waitFor();
      check(await startButton(page).isDisabled(), "The up-arrow is enabled while forking (AC-26).");
      await NodeFSP.writeFile(release, "");
      await dialog(page).waitFor({ state: "detached" });
      await NodeFSP.rm(hold);
      await NodeFSP.rm(release);
      await runningIn(shells.lists, NodePath.join(repoWorktrees, held), 1);
      const heldAfter = (await gitState()).folders.split(",");
      check(
        heldAfter.length === heldBefore.folders.split(",").length + 1,
        `A double click made ${heldAfter.length - heldBefore.folders.split(",").length} worktrees (AC-26).`,
      );

      // AC-25: the worktree is made but its shell cannot start; it is kept and offered again.

      stage = "AC-25";
      await rpc.close();
      await server.restart({ env: { PROBE_AGENT_COMMAND: "no-such-agent-cli --start" } });
      await reopen();
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);
      await openModal(page);
      check(
        (await worktreeChoices(page)).checked === "New worktree",
        "The last choice is not preselected.",
      );
      const kept = await proposedName(page);
      const unstartable = await startFromModal(page);
      check(
        unstartable?.includes("no-such-agent-cli") === true,
        `Unstartable shell: ${unstartable} (AC-25).`,
      );
      check(
        (await run(repo, "rev-parse", "--verify", kept)).length > 0,
        "The kept branch is gone (AC-25).",
      );
      check(
        (await NodeFSP.stat(NodePath.join(repoWorktrees, kept)).catch(() => null)) !== null,
        "The created worktree was removed (AC-25).",
      );
      await cancelModal(page);
      await openModal(page);
      const afterKept = await worktreeChoices(page);
      check(afterKept.checked === "New worktree", "A failed start changed the choice (AC-25).");
      check(afterKept.labels.includes(kept), "The kept worktree is not offered (AC-25).");
      await cancelModal(page);
      check(shells.current().length === 0, "An unstartable shell was left on the server (AC-25).");
    } catch (error) {
      throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};
