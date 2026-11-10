// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Makes folder fixtures in the throwaway home, ends a shell's process and times the start.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectionCutter, type PointerPage } from "../browser.ts";
import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import {
  agentTypedOnceAfterPrompt,
  expectLogged,
  shellOutput,
  metric,
  MOCK_AGENT_LINES,
  unlessRoot,
} from "../fixtures.ts";
import { MOCK_AGENT_COMMAND } from "../server.ts";
import { check, follow, gone, pageFrames, recorder } from "../support.ts";
import {
  addProject,
  addStartingScript,
  cancelModal,
  closeFolderList,
  createWorkspace,
  dialog,
  folderList,
  createShellButton,
  git,
  history,
  openAddFolder,
  openModal,
  mode,
  modeButton,
  modeSwitch,
  selectedKey,
  shellList,
  shellNodes,
  shellsIn,
  startButton,
  tabs,
  typeLine,
  reloadShowing,
} from "./workspaceUi.ts";

const CONNECTION_LOST =
  "The shell did not start: the connection to the server was lost. Try again.";

export const plusModal: Scenario = {
  id: "S2",
  title: "start a shell from the plus modal",
  run: async ({ server, openPage }) => {
    const folders = NodePath.join(server.home, "folders");
    const repo = NodePath.join(folders, "repo");
    const plain = NodePath.join(folders, "plain");
    const locked = NodePath.join(folders, "locked");
    const notes = NodePath.join(folders, "notes.txt");
    for (const dir of [repo, plain, locked]) await NodeFSP.mkdir(dir, { recursive: true });
    await NodeFSP.writeFile(notes, "not a folder");
    await NodeFSP.chmod(locked, 0o555);
    check((await git(repo, ["init", "-q"])).ok, "git init of the fixture failed.");
    const badGitConfig = NodePath.join(server.home, "broken-gitconfig");
    await NodeFSP.writeFile(badGitConfig, "[broken\n");

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const paths: Array<string> = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
    });
    const frames = pageFrames(page);
    let rpc = await connectRpc(server.origin, page);
    let shells = shellList(rpc.client);
    let stage = "setup";
    // After a restart the page connects again from a reload; the shown workspace is in memory only.
    const reopen = (target: PointerPage) => reloadShowing(target, "sparta");

    try {
      await page.getByRole("button", { name: "Create workspace" }).click();
      await dialog(page).getByRole("textbox").fill("sparta");
      await dialog(page).getByRole("button", { name: "Create" }).click();
      await page.getByRole("tree").getByRole("treeitem", { level: 1, name: "sparta" }).waitFor();

      // AC-11: no project yet, so there is nothing to start a shell in.

      stage = "AC-11";
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

      // AC-17: a file, a denied create and a failed git init are refused with their reason.

      stage = "AC-17";
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

      // AC-1, AC-8: import an existing git folder; its "+" offers the git choices.

      stage = "AC-1, AC-8";
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

      // AC-2, AC-3, AC-21: one click starts a shell; its node appears within 1 s.

      stage = "AC-2, AC-3, AC-21";
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
        (frame) => frame.includes("Mock Agent v1"),
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
      const [first] = await shellsIn(shells.lists, repo, 1);
      check(first !== undefined && first.status === "running", "The started shell is not running.");
      check((await tabs(page).count()) === 1, "Starting a shell did not open one tab (AC-2).");
      // A shell is named by its fixed number in the workspace, its folder and what runs in it.
      await tabs(page)
        .filter({ hasText: /^Shell 1 · repo · node$/ })
        .waitFor();
      await shellNodes(page, repo)
        .filter({ hasText: /^Shell 1 · node$/ })
        .waitFor();

      // AC-4: no chat thread exists and the tab shows no chat chrome.

      stage = "AC-4";
      const [snapshot] = await Effect.runPromise(
        rpc.client["orchestration.subscribeShell"]({}).pipe(
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

      // AC-5: a typed line is echoed by the mock CLI.

      stage = "AC-5";
      const typedHello = frames.mark();
      await typeLine(page, "hello-probe");
      await frames.until(
        "the echoed line",
        (frame) => frame.includes("echo: hello-probe"),
        typedHello,
      );

      // AC-6: after leaving the CLI, the shell's size equals the grid the view reports.

      stage = "AC-6";
      const output = recorder<TerminalAttachStreamEvent>("attach events");
      follow(rpc.client["shell.attach"]({ shellId: first.shellId }), output.push);
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

      // AC-7, AC-12, AC-24: the last choice is preselected; a double click starts exactly one shell.

      stage = "AC-7, AC-12, AC-24";
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
      const second = two.find((shell) => shell.shellId !== first.shellId)!;
      check(second.title === "Shell 2", `The second shell is named ${second.title}.`);
      await frames.until(
        "the second banner",
        (frame) => frame.includes("Mock Agent v1"),
        secondFrom,
      );
      check(
        shells.current().filter((shell) => shell.cwd === repo).length === 2 &&
          (await shellNodes(page, repo).count()) === 2 &&
          (await tabs(page).count()) === 2,
        "A double click did not start exactly one shell (AC-24).",
      );
      check(
        (await history(rpc.client, first.shellId)).includes("echo: hello-probe") &&
          !(await history(rpc.client, second.shellId)).includes("hello-probe"),
        "The two shells share output (AC-12).",
      );
      // PRB.T-011: the agent command is typed once, after the shell's first prompt. The output runs
      // on through the typed lines above, so a second typing would show by now.
      const raw = shellOutput(frames.seen.slice(framesBefore), first.shellId);
      const problem = agentTypedOnceAfterPrompt(raw, MOCK_AGENT_COMMAND, MOCK_AGENT_LINES);
      check(
        problem === null,
        `The agent command was not typed once after the prompt (PRB.T-011): ${problem}: ${JSON.stringify(raw.slice(0, 600))}`,
      );

      // AC-9: a new folder gets git with no commit, and a shell starts in its own checkout.

      stage = "AC-9";
      const fresh = NodePath.join(folders, "fresh");
      check(
        (await addProject(page, { parent: folders, name: "fresh" })) === null,
        "Create failed.",
      );
      check((await git(fresh, ["rev-parse", "--git-dir"])).ok, "The new folder has no git (AC-9).");
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

      // AC-10: a plain folder starts directly under its node.

      stage = "AC-10";
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

      // AC-13: closing the modal without starting changes nothing.

      stage = "AC-13";
      const before = { shells: shells.current().length, tabs: await tabs(page).count() };
      await openModal(page, repo);
      await cancelModal(page);
      check(
        shells.current().length === before.shells && (await tabs(page).count()) === before.tabs,
        "Closing the modal changed shells or tabs (AC-13).",
      );

      // AC-14, AC-15: a deleted folder cannot start a shell.

      stage = "AC-14, AC-15";
      // Deleted while the modal is open: starting there shows why and changes nothing.
      await openModal(page, plain);
      await NodeFSP.rm(plain, { recursive: true });
      await startButton(page).click();
      const missing = await dialog(page).getByRole("alert").textContent();
      check(missing?.includes("no longer exists") === true, `Deleted folder: ${missing} (AC-15).`);
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

      // AC-14: a last start in a folder removed from the workspace is not applied to another.

      stage = "AC-14";
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

      // AC-19: start and end lines, the end caused from outside the app.

      stage = "AC-19";
      const killed = shells.current().find((shell) => shell.shellId === second.shellId)!;
      check(killed.pid !== null, "The second shell has no pid.");
      const killedFrom = shells.lists.mark();
      NodeProcess.kill(killed.pid, "SIGKILL");
      check(await gone(killed.pid), "The killed shell's process is still running.");
      await shells.lists.until(
        "the killed shell to end",
        (list) =>
          list.some((shell) => shell.shellId === killed.shellId && shell.status === "exited"),
        killedFrom,
      );
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

      // AC-16, AC-17: a starting script whose program is missing, and a restart with a git
      // config that makes `git init` fail; a second restart clears the git fault.

      stage = "AC-16";
      // Shells outlive a restart (PRB.T-007); this check starts from none.
      for (const shell of shells.current()) {
        await Effect.runPromise(rpc.client["shell.kill"]({ shellId: shell.shellId }));
      }
      await rpc.close();
      await addStartingScript(server.home, {
        id: "unstartable",
        name: "unstartable",
        command: "no-such-agent-cli --start",
      });
      await server.restart({ env: { GIT_CONFIG_GLOBAL: badGitConfig } });
      await reopen(page);
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);
      // A fresh subscription: its first list is the server's state after the restart.
      await shells.lists.until("the list after restart", () => true, 0);
      await shellNodes(page).first().waitFor({ state: "detached" });
      await openModal(page, repo, { script: "unstartable" });
      await startButton(page).click();
      const unstartable = await dialog(page).getByRole("alert").textContent();
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

      // AC-17: git init fails; the half-made folder is gone and not in the workspace.

      stage = "AC-17";
      const initReason = await addProject(page, { parent: folders, name: "broken" });
      check(initReason?.startsWith("git init failed") === true, `git init: ${initReason} (AC-17).`);
      check(
        !(await NodeFSP.stat(NodePath.join(folders, "broken")).catch(() => null)),
        "A folder whose git init failed was left on disk (AC-17).",
      );
      await cancelModal(page);
      check(
        (await page.locator(`[data-project="${NodePath.join(folders, "broken")}"]`).count()) === 0,
        "A folder whose git init failed was added (AC-17).",
      );
      await rpc.close();
      await server.restart();
      await reopen(page);
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);

      // AC-18: the connection drops during the start; nothing is shown and a retry works.

      stage = "AC-18";
      const cut = await openPage();
      await cut.setViewportSize({ width: 1200, height: 800 });
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
      const lastAttempt = await dialog(cut).getByRole("alert").getAttribute("data-attempt");
      await startButton(cut).click();
      const retryAlert = dialog(cut).locator(`[role="alert"]:not([data-attempt="${lastAttempt}"])`);
      await Promise.race([dialog(cut).waitFor({ state: "detached" }), retryAlert.waitFor()]);
      if (await dialog(cut).count()) {
        const reason = await retryAlert.textContent();
        throw new Error(`The retry after a dropped start failed: ${reason} (AC-18).`);
      }
      await shellsIn(shells.lists, repo, 1);
      check(
        (await tabs(cut).count()) === 1,
        "The retry after a dropped start did not open exactly one tab (AC-18).",
      );

      // AC-25: another workspace starts without folders and without the other's last start.

      stage = "AC-25";
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

      // AC-23: no chat route was opened at any point (AC-20 holds by PointerPage).

      stage = "AC-23";
      const chatPaths = paths.filter((path) => path !== "/" && path !== "/pair");
      check(chatPaths.length === 0, `The flow opened ${JSON.stringify(chatPaths)} (AC-23).`);
    } catch (error) {
      throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
      await NodeFSP.chmod(locked, 0o755).catch(() => undefined);
    }
  },
};
