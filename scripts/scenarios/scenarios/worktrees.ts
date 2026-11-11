// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Makes git fixtures in the throwaway home, ends shells' processes and times the start.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ShellSummary } from "@t3tools/contracts";

import type { PointerPage } from "../browser.ts";
import { addStartingScript, gitOk } from "../lib/files.ts";
import { restartAndReload, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { metric } from "../lib/report.ts";
import { expectLogged } from "../lib/serverLog.ts";
import { setupOn, type ProjectResult } from "../lib/setup.ts";
import { MOCK_AGENT_LINES, runningIn } from "../lib/shells.ts";
import { addProject } from "../lib/ui/addProject.ts";
import { dialog } from "../lib/ui/dialog.ts";
import {
  cancelModal,
  createShellButton,
  dropdownItems,
  mode,
  modeButton,
  modeSwitch,
  openModal,
  pickItem,
  selectedKey,
  startButton,
  startFromModal,
} from "../lib/ui/plusModal.ts";
import { tabs } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { shellRow } from "../lib/ui/tree.ts";
import { check, waitFor } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";

const NAME = /^probe-worktree-[0-9a-f]{6}$/;

const worktreeNode = (page: PointerPage, path: string) => page.locator(`[data-worktree="${path}"]`);
const worktreeNodeLabel = (page: PointerPage, path: string) =>
  worktreeNode(page, path).getByRole("treeitem", { level: 3 });

/** The generated name the modal shows for a fork. */
async function proposedName(page: PointerPage) {
  const line = dialog(page).locator("p", { hasText: "New worktree and branch:" });
  const name = ((await line.textContent()) ?? "").replace("New worktree and branch:", "").trim();
  check(NAME.test(name), `The modal shows no worktree name: ${name}.`);
  return name;
}

export const worktrees: Scenario = {
  id: "S3",
  title: "start shells in existing and forked worktrees",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, openPage, trail } = ctx;
    const stage = trail.stage;
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const repo2 = NodePath.join(folders, "second");
    const empty = NodePath.join(folders, "empty");
    const plain = NodePath.join(folders, "plain");
    const linked = NodePath.join(folders, "linked");
    const detached = NodePath.join(folders, "detached");
    const wkt = NodePath.join(folders, "wkt");
    const repoWorktrees = NodePath.join(server.home, "worktrees", "repo");
    const hold = NodePath.join(server.home, "hold-fork");
    const release = NodePath.join(server.home, "release-fork");
    for (const dir of [repo, repo2, empty, plain]) await NodeFSP.mkdir(dir, { recursive: true });

    await gitOk(repo, "init", "-q", "-b", "main");
    await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "one");
    for (const branch of ["other", "doomed", "doomed2", "wkt"]) await gitOk(repo, "branch", branch);
    await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "two");
    await gitOk(repo, "worktree", "add", "-q", "-b", "linked", linked, "other");
    await gitOk(repo, "worktree", "add", "-q", "--detach", detached, "other");
    // A worktree whose folder name is also a branch it does not have checked out (AC-4).
    await gitOk(repo, "worktree", "add", "-q", "-b", "wkt-new", wkt, "other");
    // Holds a fork open while the hold file exists, so a second click lands mid-start (AC-23).
    const hooks = NodePath.join(repo, ".git", "hooks");
    await NodeFSP.writeFile(
      NodePath.join(hooks, "post-checkout"),
      `#!/bin/sh\n[ -f "${hold}" ] || exit 0\nwhile [ ! -f "${release}" ]; do sleep 0.05; done\n`,
      { mode: 0o755 },
    );
    await gitOk(repo, "config", "core.hooksPath", hooks);
    await gitOk(repo2, "init", "-q", "-b", "main");
    await gitOk(repo2, "commit", "-q", "--allow-empty", "-m", "one");
    await gitOk(empty, "init", "-q", "-b", "main");
    const otherHead = await gitOk(repo, "rev-parse", "other");
    const gitState = async () => ({
      branches: await gitOk(repo, "branch", "--format=%(refname:short)"),
      worktrees: await gitOk(repo, "worktree", "list", "--porcelain"),
      folders: (await NodeFSP.readdir(repoWorktrees).catch(() => [])).toSorted().join(","),
    });

    const page = await openPage();
    const frames = pageFrames(page);
    let setup = await setupOn(ctx, { as: page });
    const ws = await setup.workspace("worktrees");
    await showWorkspace(page, ws);
    let repoProject: ProjectResult | undefined;
    const killShell = async (shell: ShellSummary) => {
      check(repoProject !== undefined, "The repository was never added.");
      const latest = setup.shells.current().find((entry) => entry.shellId === shell.shellId);
      const pid = latest?.pid ?? null;
      check(pid !== null, `The shell has no pid: ${JSON.stringify(latest)}.`);
      await setup.killShell({
        kind: "shell",
        shellId: shell.shellId,
        pid,
        cwd: shell.cwd,
        workspace: ws.name,
        project: repoProject.path,
      });
      // A Probe kill removes the shell; one a signal ended would stay listed (PRB.T-007).
      await setup.shells.lists.until(
        "the killed shell to leave the list",
        (list) => list.every((entry) => entry.shellId !== shell.shellId),
        Math.max(0, setup.shells.lists.mark() - 1),
      );
    };

    // AC-29: importing a linked worktree adds its repository and shows nothing under it.

    await stage("AC-29", async () => {
      check(
        (await addProject(page, { import: linked })) === null,
        "Importing the worktree failed.",
      );
      await page.getByText("Added the project of this worktree").waitFor();
      await page.locator(`[data-project="${repo}"]`).waitFor();
      check(
        (await page.locator(`[data-project="${linked}"]`).count()) === 0 &&
          (await page.locator("[data-worktree]").count()) === 0,
        "The worktree was added as its own project, or worktrees show without shells (AC-29).",
      );
      for (const path of [repo, repo2, empty, plain]) {
        const added = await setup.project(ws, { kind: "folder", path });
        if (path === repo) repoProject = added;
        await waitFor(page.locator(`[data-project="${added.path}"]`), `the project ${path}`);
      }
      check(
        (await page.locator(`[data-project="${repo}"]`).count()) === 1,
        "The repository was added twice.",
      );
    });

    // AC-11, AC-1, AC-25: Existing in the primary worktree is the default.

    const shellA = await stage("AC-11, AC-1", async () => {
      // A plain shell, so the lines typed in AC-26 reach the shell, not an agent.
      await openModal(page, repo, { script: "Plain shell" });
      check((await mode(page)) === "Existing", "Existing is not preselected (AC-11).");
      check((await selectedKey(page, "Start in")) === repo, "The primary is not preselected.");
      const existing = await dropdownItems(page, "Start in");
      const expectedExisting = [
        [repo, "branch", "main", ""],
        [detached, "worktree", otherHead.slice(0, 7), "detached worktree"],
        [linked, "worktree", "linked", "linked worktree"],
        [wkt, "worktree", "wkt-new", "wkt worktree"],
      ];
      check(
        JSON.stringify(existing) === JSON.stringify(expectedExisting),
        `Start in lists ${JSON.stringify(existing)} (AC-1).`,
      );
      check((await startFromModal(page)) === null, "The primary start failed (AC-11).");
      const [started] = await runningIn(setup.shells.lists, repo, 1);
      check(started !== undefined, "The primary shell is not listed (AC-11).");
      await worktreeNodeLabel(page, repo)
        .filter({ hasText: /^primary · main$/ })
        .waitFor();
      await worktreeNode(page, repo).locator(`[data-shell-id="${started.shellId}"]`).waitFor();
      return started;
    });

    // AC-3, AC-10: the primary is remembered and takes a second shell.

    await stage("AC-3", async () => {
      await openModal(page, repo);
      check((await selectedKey(page, "Start in")) === repo, "The last choice is not preselected.");
      check((await startFromModal(page)) === null, "The second primary start failed (AC-3).");
      await runningIn(setup.shells.lists, repo, 2);
    });

    // AC-26, AC-27: a branch switch relabels the node; leaving the worktree marks the shell.

    await stage("AC-26, AC-27", async () => {
      await shellRow(page, shellA.shellId).click();
      await tabs(page)
        .filter({ hasText: /^Shell 1 · repo$/ })
        .waitFor();
      // A recorded metric (FR-4), never compared.
      // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
      const switchedAt = Date.now();
      await typeLine(page, "git switch -q other");
      await worktreeNodeLabel(page, repo)
        .filter({ hasText: /^primary · other$/ })
        .waitFor();
      // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
      metric("S3", "branch-label", Date.now() - switchedAt, "AC-26, was a 4000 ms gate");
      check(
        (await worktreeNode(page, repo).locator("[data-shell-id]").count()) === 2,
        "The worktree's shells did not both stay under its node (AC-26).",
      );
      await typeLine(page, "cd /tmp");
      await shellRow(page, shellA.shellId).locator('[data-elsewhere="/tmp"]').waitFor();
      check(
        (await worktreeNode(page, repo).locator(`[data-shell-id="${shellA.shellId}"]`).count()) ===
          1,
        "A shell that left its worktree moved in the tree (AC-27).",
      );
      await typeLine(page, `cd ${repo} && git switch -q main`);
      await shellRow(page, shellA.shellId)
        .locator("[data-elsewhere]")
        .waitFor({ state: "detached" });
      await worktreeNodeLabel(page, repo)
        .filter({ hasText: /^primary · main$/ })
        .waitFor();
    });

    // AC-15, AC-16: a plain project has no worktree choice; one with no commit cannot fork.

    await stage("AC-15, AC-16", async () => {
      await openModal(page, plain);
      check((await modeSwitch(page).count()) === 0, "A plain project offers worktrees (AC-15).");
      check((await startFromModal(page)) === null, "The plain start failed (AC-15).");
      await runningIn(setup.shells.lists, plain, 1);
      check(
        (await page.locator(`[data-project="${plain}"] [data-worktree]`).count()) === 0,
        "A plain project's shell sits under a worktree node.",
      );
      await openModal(page, empty);
      check(await modeButton(page, "Fork").isDisabled(), "Fork is enabled with no commit (AC-16).");
      check((await startFromModal(page)) === null, "The start with no commit failed (AC-16).");
      await runningIn(setup.shells.lists, empty, 1);
    });

    // AC-2, AC-3, AC-10: a linked worktree starts shells and is remembered.

    await stage("AC-2", async () => {
      await openModal(page, repo);
      await pickItem(page, "Start in", linked);
      check((await startFromModal(page)) === null, "The linked worktree start failed (AC-2).");
      await runningIn(setup.shells.lists, linked, 1);
      await worktreeNodeLabel(page, linked)
        .filter({ hasText: /^linked$/ })
        .waitFor();
    });
    const linkedShells = await stage("AC-10, AC-3", async () => {
      await openModal(page, repo);
      check(
        (await selectedKey(page, "Start in")) === linked,
        "The worktree is not preselected (AC-10).",
      );
      check((await startFromModal(page)) === null, "The second linked start failed (AC-3).");
      const started = await runningIn(setup.shells.lists, linked, 2);
      check(
        (await worktreeNode(page, linked).locator("[data-shell-id]").count()) === 2,
        "A worktree's second shell is not under the same node (AC-3).",
      );
      return started;
    });

    // AC-4, AC-5, AC-8: fork from a branch, named as the modal showed.

    const tabsBefore = await stage("AC-4", async () => {
      // The open modal hides the page behind it, so tabs are counted before it opens.
      const counted = await tabs(page).count();
      await openModal(page, repo);
      await modeButton(page, "Fork").click();
      check((await selectedKey(page, "Fork from")) === "branch:main", "main is not the default.");
      const origins = await dropdownItems(page, "Fork from");
      const expectedOrigins = [
        [`worktree:${detached}`, "worktree", otherHead.slice(0, 7), "detached worktree"],
        [`worktree:${linked}`, "worktree", "linked", "linked worktree"],
        [`worktree:${wkt}`, "worktree", "wkt-new", "wkt worktree"],
        ["branch:wkt", "worktree", "wkt", "wkt worktree"],
        ["branch:main", "branch", "main (current)", ""],
        ["branch:doomed", "branch", "doomed", ""],
        ["branch:doomed2", "branch", "doomed2", ""],
        ["branch:other", "branch", "other", ""],
      ];
      check(
        JSON.stringify(origins) === JSON.stringify(expectedOrigins),
        `Fork from lists ${JSON.stringify(origins)} (AC-4).`,
      );
      return counted;
    });
    const name1 = await stage("AC-5, AC-8", async () => {
      await pickItem(page, "Fork from", "branch:other");
      const name = await proposedName(page);
      const framesBefore = frames.mark();
      // A recorded metric (FR-4), never compared.
      // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
      const clickedAt = Date.now();
      check((await startFromModal(page)) === null, "The fork failed (AC-5).");
      const path1 = NodePath.join(repoWorktrees, name);
      const [shell1] = await runningIn(setup.shells.lists, path1, 1);
      check(shell1 !== undefined, "The fork's shell is not listed (AC-5).");
      await frames.until(
        "the mock CLI banner",
        (frame) => frame.includes(MOCK_AGENT_LINES.banner),
        framesBefore,
      );
      // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
      metric("S3", "fork-start-to-banner", Date.now() - clickedAt);
      check(
        (await gitOk(path1, "branch", "--show-current")) === name,
        "The branch is not named as shown.",
      );
      check(
        (await gitOk(repo, "rev-parse", name)) === otherHead,
        "The fork is not at other (AC-5).",
      );
      check((await tabs(page).count()) === tabsBefore + 1, "No tab opened for the fork (AC-5).");
      await worktreeNodeLabel(page, path1).filter({ hasText: name }).waitFor();
      await expectLogged(
        server,
        "The log has no start line with the worktree and branch (AC-8).",
        (line) =>
          line.includes("shell started") &&
          line.includes(shell1.shellId) &&
          line.includes(path1) &&
          // Once in the worktree path and once as the branch.
          line.split(name).length >= 3,
      );
      return name;
    });

    // AC-9, AC-7: the fork is remembered and one click makes another, differently named one.

    await stage("AC-9, AC-7", async () => {
      await openModal(page, repo);
      check((await mode(page)) === "Fork", "Fork is not preselected (AC-9).");
      check((await selectedKey(page, "Fork from")) === "branch:other", "The origin is not kept.");
      const name2 = await proposedName(page);
      check(name2 !== name1, "The second fork got the first one's name (AC-7).");
      check((await startFromModal(page)) === null, "The repeated fork failed (AC-9).");
      await runningIn(setup.shells.lists, NodePath.join(repoWorktrees, name2), 1);
    });

    // AC-24: closing the modal after choosing changes nothing and keeps the remembered choice.

    await stage("AC-24", async () => {
      const beforeClose = await gitState();
      await openModal(page, repo);
      await modeButton(page, "Existing").click();
      await cancelModal(page);
      check(
        JSON.stringify(await gitState()) === JSON.stringify(beforeClose),
        "Closing created a worktree (AC-24).",
      );
      await openModal(page, repo);
      check((await mode(page)) === "Fork", "Closing changed the remembered choice (AC-24).");
      await cancelModal(page);
    });

    // AC-14: another git project does not get this project's choice.

    await stage("AC-14", async () => {
      await openModal(page, repo2);
      check((await mode(page)) === "Existing", "The other project preselected Fork (AC-14).");
      check(
        (await selectedKey(page, "Start in")) === repo2,
        "The other project's primary is not selected.",
      );
      await cancelModal(page);
    });

    // AC-6: a fork from a detached worktree starts at its commit.

    await stage("AC-6", async () => {
      await openModal(page, repo);
      await pickItem(page, "Fork from", `worktree:${detached}`);
      const name3 = await proposedName(page);
      check((await startFromModal(page)) === null, "The fork from a worktree failed (AC-6).");
      await runningIn(setup.shells.lists, NodePath.join(repoWorktrees, name3), 1);
      check(
        (await gitOk(repo, "rev-parse", name3)) === otherHead,
        "The fork is not at the detached commit (AC-6).",
      );
    });

    // AC-13: a remembered origin that is gone falls back to the current branch.

    await stage("AC-13", async () => {
      await gitOk(repo, "worktree", "remove", "--force", detached);
      await openModal(page, repo);
      check((await mode(page)) === "Fork", "Fork is not preselected (AC-13).");
      check(
        (await selectedKey(page, "Fork from")) === "branch:main",
        "main is not the fallback (AC-13).",
      );
      check(
        (await dialog(page).getByRole("alert").count()) === 0,
        "The modal shows an error (AC-13).",
      );
    });

    // AC-17, AC-18, AC-19: an origin deleted before the click fails cleanly.

    await stage("AC-17, AC-18", async () => {
      await pickItem(page, "Fork from", "branch:doomed");
      await gitOk(repo, "branch", "-D", "doomed");
      const beforeFail = await gitState();
      const shellCount = setup.shells.current().length;
      const failed = await startFromModal(page);
      check(failed?.includes("doomed") === true, `Failed fork: ${failed} (AC-17).`);
      check(
        JSON.stringify(await gitState()) === JSON.stringify(beforeFail),
        "The failed fork left something (AC-18).",
      );
      await cancelModal(page);
      check(setup.shells.current().length === shellCount, "A failed fork started a shell (AC-17).");
    });
    await stage("AC-19", async () => {
      await openModal(page, repo);
      check((await mode(page)) === "Fork", "A failed fork changed the choice (AC-19).");
      check(
        (await selectedKey(page, "Fork from")) === "branch:main",
        "A failed fork was remembered.",
      );
      await pickItem(page, "Fork from", "branch:doomed2");
      await gitOk(repo, "branch", "-D", "doomed2");
      check(
        (await startFromModal(page))?.includes("doomed2") === true,
        "The second fork did not fail.",
      );
      await pickItem(page, "Fork from", "branch:main");
      const name4 = await proposedName(page);
      check((await startFromModal(page)) === null, "The retry after a failed fork failed (AC-19).");
      await runningIn(setup.shells.lists, NodePath.join(repoWorktrees, name4), 1);
    });

    // AC-28, AC-12: an ended worktree leaves the tree; a removed one is not preselected.

    const linkedAgain = await stage("AC-28", async () => {
      for (const shell of linkedShells) await killShell(shell);
      await worktreeNode(page, linked).waitFor({ state: "detached" });
      await openModal(page, repo);
      await modeButton(page, "Existing").click();
      check(
        (await dropdownItems(page, "Start in")).some(([key]) => key === linked),
        "A worktree without shells is not offered (AC-28).",
      );
      await pickItem(page, "Start in", linked);
      check((await startFromModal(page)) === null, "The start in the freed worktree failed.");
      const [started] = await runningIn(setup.shells.lists, linked, 1);
      check(started !== undefined, "The shell in the freed worktree is not listed.");
      return started;
    });
    await stage("AC-12", async () => {
      await killShell(linkedAgain);
      await gitOk(repo, "worktree", "remove", "--force", linked);
      await openModal(page, repo);
      check((await mode(page)) === "Existing", "Existing is not preselected (AC-12).");
      check(
        (await selectedKey(page, "Start in")) === repo,
        "A removed worktree is preselected (AC-12).",
      );
      check(
        (await dialog(page).getByRole("alert").count()) === 0,
        "The modal shows an error (AC-12).",
      );
    });

    // AC-23: a second click while the fork runs is ignored; the modal says what it creates.

    await stage("AC-23", async () => {
      await modeButton(page, "Fork").click();
      await pickItem(page, "Fork from", "branch:main");
      const held = await proposedName(page);
      const heldBefore = (await gitState()).folders.split(",").length;
      await NodeFSP.writeFile(hold, "");
      await startButton(page).dblclick();
      await dialog(page).getByText(`Creating ${held}…`).waitFor();
      check(await startButton(page).isDisabled(), "The up-arrow is enabled while forking (AC-23).");
      await NodeFSP.writeFile(release, "");
      await dialog(page).waitFor({ state: "detached" });
      await NodeFSP.rm(hold);
      await NodeFSP.rm(release);
      await runningIn(setup.shells.lists, NodePath.join(repoWorktrees, held), 1);
      const heldAfter = (await gitState()).folders.split(",").length;
      check(
        heldAfter === heldBefore + 1,
        `A double click made ${heldAfter - heldBefore} worktrees (AC-23).`,
      );
    });

    // AC-22: the worktree is made but its shell cannot start; it is kept and offered again.

    await stage("AC-22", async () => {
      await addStartingScript(server.home, {
        id: "unstartable",
        name: "unstartable",
        command: "no-such-agent-cli --start",
      });
      setup = await restartAndReload(ctx, page, ws, setup);
      check((await createShellButton(page, repo).count()) === 1, "The project has no +.");
      await openModal(page, repo, { script: "unstartable" });
      check((await mode(page)) === "Fork", "The last choice is not preselected.");
      const kept = await proposedName(page);
      const unstartable = await startFromModal(page);
      check(
        unstartable?.includes("no-such-agent-cli") === true,
        `Unstartable shell: ${unstartable} (AC-22).`,
      );
      check(
        (await gitOk(repo, "rev-parse", "--verify", kept)).length > 0,
        "The kept branch is gone (AC-22).",
      );
      check(
        (await NodeFSP.stat(NodePath.join(repoWorktrees, kept)).catch(() => null)) !== null,
        "The created worktree was removed (AC-22).",
      );
      await cancelModal(page);
      await openModal(page, repo);
      check((await mode(page)) === "Fork", "A failed start changed the choice (AC-22).");
      await modeButton(page, "Existing").click();
      check(
        (await dropdownItems(page, "Start in")).some(
          ([key]) => key === NodePath.join(repoWorktrees, kept),
        ),
        "The kept worktree is not offered (AC-22).",
      );
      await cancelModal(page);
      // Shells from before the restart run on (PRB.T-007); none may be in the kept worktree.
      check(
        setup.shells.current().every((shell) => shell.cwd !== NodePath.join(repoWorktrees, kept)),
        "An unstartable shell was left on the server (AC-22).",
      );
    });
  },
};
