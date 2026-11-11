// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Makes folder fixtures in the throwaway home, ends a shell's process and times the start.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectionCutter, type PointerPage } from "../browser.ts";
import { addStartingScript, git } from "../lib/files.ts";
import { reloadShowing, restartAndReload } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { metric, unlessRoot } from "../lib/report.ts";
import { expectLogged } from "../lib/serverLog.ts";
import { setupOn } from "../lib/setup.ts";
import {
  agentTypedOnceAfterPrompt,
  MOCK_AGENT_LINES,
  history,
  shellEnded,
  shellsIn,
} from "../lib/shells.ts";
import { addProject, closeFolderList, folderList, openAddFolder } from "../lib/ui/addProject.ts";
import { dialog } from "../lib/ui/dialog.ts";
import {
  cancelModal,
  createShellButton,
  openModal,
  mode,
  modeButton,
  modeSwitch,
  selectedKey,
  startButton,
  startFromModal,
} from "../lib/ui/plusModal.ts";
import { tabs } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { shellNodes } from "../lib/ui/tree.ts";
import { createWorkspace } from "../lib/ui/workspacesMenu.ts";
import { check, follow, recorder } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";
import { MOCK_AGENT_COMMAND } from "../server.ts";

const CONNECTION_LOST =
  "The shell did not start: the connection to the server was lost. Try again.";

export const plusModal: Scenario = {
  id: "S2",
  title: "start a shell from the plus modal",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, openPage, trail } = ctx;
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const plain = NodePath.join(folders, "plain");
    const fresh = NodePath.join(folders, "fresh");
    const locked = NodePath.join(folders, "locked");
    const notes = NodePath.join(folders, "notes.txt");
    for (const dir of [repo, plain, locked]) await NodeFSP.mkdir(dir, { recursive: true });
    await NodeFSP.writeFile(notes, "not a folder");
    await NodeFSP.chmod(locked, 0o555);
    check((await git(repo, ["init", "-q"])).ok, "git init of the fixture failed.");
    const badGitConfig = NodePath.join(server.home, "broken-gitconfig");
    await NodeFSP.writeFile(badGitConfig, "[broken\n");

    const page = await openPage();
    const paths: Array<string> = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
    });
    const frames = pageFrames(page);
    let setup = await setupOn(ctx, { as: page });
    let shells = setup.shells;
    // After a restart the page connects again from a reload; the shown workspace is in memory only.
    const reopen = (target: PointerPage) => reloadShowing(target, "sparta");

    try {
      await createWorkspace(page, "sparta", { from: "start screen" });

      // AC-11: no project yet, so there is nothing to start a shell in.
      await trail.stage("AC-11", async () => {
        check(
          (await page
            .getByRole("tree")
            .getByRole("button", { name: /^Create shell in / })
            .count()) === 0,
          "A shell can be started with no project (AC-11).",
        );
        // Adding starts at the server's home; its folders show only once the field is clicked.
        await openAddFolder(page);
        const field = dialog(page).getByRole("combobox", { name: "Folder" });
        check((await field.inputValue()) === "~/", "The folder field does not start at ~/.");
        check((await folderList(page).count()) === 0, "The folder list shows before a click.");
        await field.click();
        await folderList(page).waitFor();
        // A click outside closes the list and leaves the modal open.
        await closeFolderList(page);
        check((await dialog(page).count()) === 1, "Closing the folder list closed the modal.");
      });

      // AC-17: a file, a denied create and a failed git init are refused with their reason.
      await trail.stage("AC-17", async () => {
        const fileReason = await addProject(page, { import: notes });
        check(fileReason?.includes("not a folder") === true, `File path: ${fileReason} (AC-17).`);
        await unlessRoot("S2", "AC-17 denied create", async () => {
          const deniedReason = await addProject(page, { parent: locked, name: "app" });
          check(
            deniedReason?.includes("may not create") === true,
            `Denied create: ${deniedReason} (AC-17).`,
          );
        });
        await cancelModal(page);
        check((await page.locator("[data-project]").count()) === 0, "A refused folder was added.");
      });

      // AC-1, AC-8: import an existing git folder; its "+" offers the git choices.
      await trail.stage("AC-1, AC-8", async () => {
        // The folder is picked by clicking it in the server folder browser, under its typed parent.
        check(
          (await addProject(page, { import: `${folders}/`, pick: "repo" })) === null,
          "Importing the git folder failed.",
        );
        check(shells.current().length === 0, "Adding a folder started a shell.");
        await openModal(page, repo);
        check(
          (await mode(page)) === "Existing" && (await selectedKey(page, "Start in")) === repo,
          "The imported folder's own worktree is not selected (AC-1, AC-8).",
        );
        check(await modeButton(page, "Fork").isDisabled(), "Fork is offered with no commit.");
      });

      // AC-2, AC-3, AC-21: one click starts a shell; its node appears within 1 s.
      const first = await trail.stage("AC-2, AC-3, AC-21", async () => {
        const framesBefore = frames.mark();
        // Clock reads below are recorded metrics (FR-4), never compared.
        // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
        const clickedAt = Date.now();
        await startButton(page).click();
        await shellNodes(page, repo).first().waitFor();
        // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
        metric("S2", "tree-node", Date.now() - clickedAt, "AC-3, was a 1000 ms gate");
        await frames.until(
          "the mock CLI banner",
          (frame) => frame.includes(MOCK_AGENT_LINES.banner),
          framesBefore,
        );
        // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
        metric("S2", "start-to-banner", Date.now() - clickedAt);
        await frames.until(
          "the mock CLI session id",
          (frame) => /session: mock-[0-9a-f]{8}/.test(frame),
          framesBefore,
        );
        await dialog(page).waitFor({ state: "detached" });
        const [started] = await shellsIn(shells.lists, repo, 1);
        check(
          started !== undefined && started.status === "running",
          "The started shell is not running.",
        );
        check((await tabs(page).count()) === 1, "Starting a shell did not open one tab (AC-2).");
        // A shell is named by its fixed number in the workspace, its folder and what runs in it.
        await tabs(page)
          .filter({ hasText: /^Shell 1 · repo · node$/ })
          .waitFor();
        await shellNodes(page, repo)
          .filter({ hasText: /^Shell 1 · node$/ })
          .waitFor();
        return started;
      });

      // AC-4: no chat thread exists and the tab shows no chat chrome.
      await trail.stage("AC-4", async () => {
        const [snapshot] = await Effect.runPromise(
          setup.client["orchestration.subscribeShell"]({}).pipe(
            Stream.filter((item) => item.kind === "snapshot"),
            Stream.take(1),
            Stream.runCollect,
          ),
        );
        check(snapshot?.kind === "snapshot", "No orchestration snapshot arrived.");
        check(
          snapshot.snapshot.threads.length === 0,
          "Starting a shell created a chat thread (AC-4).",
        );
        check(
          snapshot.snapshot.projects.some((project) => project.workspaceRoot === repo),
          "The added folder was not registered as a project.",
        );
        check(
          (await page.getByRole("button", { name: /^Send/ }).count()) === 0,
          "The shell tab shows a chat composer (AC-4).",
        );
      });

      // AC-5: a typed line is echoed by the mock CLI.
      await trail.stage("AC-5", async () => {
        const typedHello = frames.mark();
        await typeLine(page, "hello-probe");
        await frames.until(
          "the echoed line",
          (frame) => frame.includes("echo: hello-probe"),
          typedHello,
        );
      });

      // AC-6: after leaving the CLI, the shell's size equals the grid the view reports.
      await trail.stage("AC-6", async () => {
        const output = recorder<TerminalAttachStreamEvent>("attach events");
        follow(setup.client["shell.attach"]({ shellId: first.shellId }), output.push);
        await typeLine(page, "exit");
        await tabs(page)
          .filter({ hasText: /^Shell 1 · repo$/ })
          .waitFor();
        const resizedFrom = output.mark();
        await page.setViewportSize({ width: 900, height: 600 });
        const grid = await output.until(
          "the narrower grid",
          (event) => event.type === "activity" && event.cols !== undefined,
          resizedFrom,
        );
        check(grid.type === "activity", "No grid was reported.");
        const typedSize = frames.mark();
        await typeLine(page, "echo sz:$(stty size)");
        const size = await frames.until(
          "the shell's size",
          (frame) => /sz:\d+ \d+/.test(frame),
          typedSize,
        );
        const [, , cols] = /sz:(\d+) (\d+)/.exec(size)!;
        check(
          Number(cols) === grid.cols,
          `The shell has ${cols} columns, the view ${grid.cols} (AC-6).`,
        );
        await page.setViewportSize({ width: 1200, height: 800 });
      });

      // AC-7, AC-12, AC-24: the last choice is preselected; a double click starts exactly one shell.
      const second = await trail.stage("AC-7, AC-12, AC-24", async () => {
        await openModal(page, repo);
        check(
          (await selectedKey(page, "Start in")) === repo,
          "The last choice is not preselected (AC-7).",
        );
        const secondFrom = frames.mark();
        await startButton(page).dblclick();
        await dialog(page).waitFor({ state: "detached" });
        const two = await shellsIn(shells.lists, repo, 2);
        await shellNodes(page, repo).nth(1).waitFor();
        const started = two.find((shell) => shell.shellId !== first.shellId)!;
        check(started.title === "Shell 2", `The second shell is named ${started.title}.`);
        await frames.until(
          "the second banner",
          (frame) => frame.includes(MOCK_AGENT_LINES.banner),
          secondFrom,
        );
        check(
          shells.current().filter((shell) => shell.cwd === repo).length === 2 &&
            (await shellNodes(page, repo).count()) === 2 &&
            (await tabs(page).count()) === 2,
          "A double click did not start exactly one shell (AC-24).",
        );
        check(
          (await history(setup.client, first.shellId)).includes("echo: hello-probe") &&
            !(await history(setup.client, started.shellId)).includes("hello-probe"),
          "The two shells share output (AC-12).",
        );
        // PRB.T-011: the agent command is typed once, after the shell's first prompt. The output runs
        // on through the typed lines above, so a second typing would show by now.
        const raw = server.rawOutput(first.shellId);
        const problem = agentTypedOnceAfterPrompt(raw, MOCK_AGENT_COMMAND, MOCK_AGENT_LINES);
        check(
          problem === null,
          `The agent command was not typed once after the prompt (PRB.T-011): ${problem}: ${JSON.stringify(raw.slice(0, 600))}`,
        );
        return started;
      });

      // AC-9: a new folder gets git with no commit, and a shell starts in its own checkout.
      await trail.stage("AC-9", async () => {
        check(
          (await addProject(page, { parent: folders, name: "fresh" })) === null,
          "Create failed.",
        );
        check(
          (await git(fresh, ["rev-parse", "--git-dir"])).ok,
          "The new folder has no git (AC-9).",
        );
        check(!(await git(fresh, ["rev-parse", "HEAD"])).ok, "The new folder has a commit.");
        await openModal(page, fresh);
        await startButton(page).click();
        await shellNodes(page, fresh).first().waitFor();
        // A script start finishes, and opens its tab, when the shell's first prompt is in.
        await dialog(page).waitFor({ state: "detached" });
        await shellsIn(shells.lists, fresh, 1);
        const worktrees = await git(fresh, ["worktree", "list", "--porcelain"]);
        check(
          worktrees.stdout.split("\n").filter((line) => line.startsWith("worktree ")).length === 1,
          "Starting a shell created a worktree (AC-9).",
        );
      });

      // AC-10: a plain folder starts directly under its node.
      await trail.stage("AC-10", async () => {
        check(
          (await addProject(page, { import: plain })) === null,
          "Importing the plain folder failed.",
        );
        await openModal(page, plain);
        check((await modeSwitch(page).count()) === 0, "A plain folder offers worktrees (AC-10).");
        await startButton(page).click();
        await shellNodes(page, plain).first().waitFor();
        await dialog(page).waitFor({ state: "detached" });
        await shellsIn(shells.lists, plain, 1);
      });

      // AC-13: closing the modal without starting changes nothing.
      const before = await trail.stage("AC-13", async () => {
        const counts = { shells: shells.current().length, tabs: await tabs(page).count() };
        await openModal(page, repo);
        await cancelModal(page);
        check(
          shells.current().length === counts.shells && (await tabs(page).count()) === counts.tabs,
          "Closing the modal changed shells or tabs (AC-13).",
        );
        return counts;
      });

      // AC-14, AC-15: a deleted folder cannot start a shell.
      await trail.stage("AC-14, AC-15", async () => {
        // Deleted while the modal is open: starting there shows why and changes nothing.
        await openModal(page, plain);
        await NodeFSP.rm(plain, { recursive: true });
        const missing = await startFromModal(page);
        check(
          missing?.includes("no longer exists") === true,
          `Deleted folder: ${missing} (AC-15).`,
        );
        // The open modal hides the page behind it, so tabs are counted once it is closed.
        await cancelModal(page);
        check(
          shells.current().length === before.shells && (await tabs(page).count()) === before.tabs,
          "A start in a deleted folder left a shell or tab (AC-15).",
        );
        // Opening the modal reads the workspace again; the deleted folder is marked and has no "+".
        await openModal(page, repo);
        await cancelModal(page);
        await page
          .locator(
            `[data-project="${plain}"] [role="treeitem"][aria-label="${plain}"] [data-missing]`,
          )
          .waitFor();
        check(
          (await createShellButton(page, plain).count()) === 0,
          "A deleted folder can start (AC-14).",
        );
      });

      // AC-14: a last start in a folder removed from the workspace is not applied to another.
      await trail.stage("AC-14", async () => {
        const workspaceFile = NodePath.join(server.home, "userdata", "workspaces", "sparta.json");
        const saved = await NodeFSP.readFile(workspaceFile, "utf8");
        await NodeFSP.writeFile(
          workspaceFile,
          JSON.stringify({ version: 1, folders: [{ path: fresh }], lastFolder: repo }),
        );
        await openModal(page, fresh);
        check((await mode(page)) === "Existing", "Another folder's last start was applied.");
        await cancelModal(page);
        await page.locator(`[data-project="${repo}"]`).waitFor({ state: "detached" });
        await NodeFSP.writeFile(workspaceFile, saved);
      });

      // AC-19: start and end lines, the end caused from outside the app.
      await trail.stage("AC-19", async () => {
        const killed = shells.current().find((shell) => shell.shellId === second.shellId)!;
        check(killed.pid !== null, "The second shell has no pid.");
        const killedFrom = shells.lists.mark();
        NodeProcess.kill(killed.pid, "SIGKILL");
        await shells.lists.until(
          "the killed shell to end",
          (list) =>
            list.some((shell) => shell.shellId === killed.shellId && shell.status === "exited"),
          killedFrom,
        );
        await shellEnded(shells, killed);
        await expectLogged(
          server,
          "The log has no start line with the shell id and cwd (AC-19).",
          (line) =>
            line.includes("shell started") && line.includes(killed.shellId) && line.includes(repo),
        );
        await expectLogged(
          server,
          "The log has no end line for the killed shell (AC-19).",
          (line) => line.includes("shell ended") && line.includes(killed.shellId),
        );
      });

      // AC-16, AC-17: a starting script whose program is missing, and a restart with a git
      // config that makes `git init` fail; a second restart clears the git fault.
      await trail.stage("AC-16", async () => {
        // Shells outlive a restart (PRB.T-007); this check starts from none.
        for (const shell of shells.current()) {
          await Effect.runPromise(setup.client["shell.kill"]({ shellId: shell.shellId }));
        }
        await addStartingScript(server.home, {
          id: "unstartable",
          name: "unstartable",
          command: "no-such-agent-cli --start",
        });
        setup = await restartAndReload(ctx, page, "sparta", setup, {
          GIT_CONFIG_GLOBAL: badGitConfig,
        });
        shells = setup.shells;
        // A fresh subscription: its first list is the server's state after the restart.
        await shells.lists.until("the list after restart", () => true, 0);
        await shellNodes(page).first().waitFor({ state: "detached" });
        await openModal(page, repo, { script: "unstartable" });
        const unstartable = await startFromModal(page);
        check(
          unstartable?.includes("no-such-agent-cli") === true,
          `Unstartable CLI: ${unstartable} (AC-16).`,
        );
        await cancelModal(page);
        check(
          shells.current().length === 0 && (await shellNodes(page).count()) === 0,
          "An unstartable CLI left a shell or tree node (AC-16).",
        );
        await expectLogged(
          server,
          "The log has no failure line with the cwd (AC-16).",
          (line) => line.includes("shell failed to start") && line.includes(repo),
        );
      });

      // AC-17: git init fails; the half-made folder is gone and not in the workspace.
      await trail.stage("AC-17 git init fails", async () => {
        const initReason = await addProject(page, { parent: folders, name: "broken" });
        check(
          initReason?.startsWith("git init failed") === true,
          `git init: ${initReason} (AC-17).`,
        );
        check(
          !(await NodeFSP.stat(NodePath.join(folders, "broken")).catch(() => null)),
          "A folder whose git init failed was left on disk (AC-17).",
        );
        await cancelModal(page);
        check(
          (await page.locator(`[data-project="${NodePath.join(folders, "broken")}"]`).count()) ===
            0,
          "A folder whose git init failed was added (AC-17).",
        );
        setup = await restartAndReload(ctx, page, "sparta", setup);
        shells = setup.shells;
      });

      // AC-18: the connection drops during the start; nothing is shown and a retry works.
      await trail.stage("AC-18", async () => {
        const cut = await openPage();
        const cutter = await connectionCutter(cut);
        await reopen(cut);
        await openModal(cut, repo);
        const dropped = cutter.dropOn("workspace.startShell");
        await startButton(cut).click();
        const servedAtDrop = cutter.served();
        await dropped;
        const lost = await dialog(cut).getByRole("alert").textContent();
        check(lost === CONNECTION_LOST, `Dropped start: ${lost} (AC-18).`);
        check(shells.current().length === 0, "A dropped start left a shell on the server (AC-18).");
        // A retry works once the page has reconnected on its own and the server answered it.
        await cutter.servedMoreThan(servedAtDrop);
        const retry = await startFromModal(cut);
        check(retry === null, `The retry after a dropped start failed: ${retry} (AC-18).`);
        await shellsIn(shells.lists, repo, 1);
        check(
          (await tabs(cut).count()) === 1,
          "The retry after a dropped start did not open exactly one tab (AC-18).",
        );
      });

      // AC-25: another workspace starts without folders and without the other's last start.
      await trail.stage("AC-25", async () => {
        await createWorkspace(page, "athens");
        check(
          (await page
            .getByRole("tree")
            .getByRole("button", { name: /^Create shell in / })
            .count()) === 0,
          "A new workspace can start a shell with no folder (AC-25).",
        );
        check((await addProject(page, { import: repo })) === null, "Adding to athens failed.");
        await openModal(page, repo);
        check(
          (await mode(page)) === "Existing" && (await selectedKey(page, "Start in")) === repo,
          "Another workspace's last start is applied (AC-25).",
        );
        await cancelModal(page);
      });

      // AC-23: no chat route was opened at any point (AC-20 holds by PointerPage).
      await trail.stage("AC-23", async () => {
        const chatPaths = paths.filter((path) => path !== "/" && path !== "/pair");
        check(chatPaths.length === 0, `The flow opened ${JSON.stringify(chatPaths)} (AC-23).`);
      });
    } finally {
      await setup.close();
      await NodeFSP.chmod(locked, 0o755).catch(() => undefined);
    }
  },
};
