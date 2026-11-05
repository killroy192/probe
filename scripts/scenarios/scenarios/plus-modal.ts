// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Makes folder fixtures in the throwaway home, ends a shell's process and times the start.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { ShellSummary, TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectionCutter, type PointerPage } from "../browser.ts";
import { connectRpc, type WsClient } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { follow, gone, pageFrames, recorder } from "../support.ts";

const CONNECTION_LOST =
  "The shell did not start: the connection to the server was lost. Try again.";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const git = (cwd: string, args: ReadonlyArray<string>) =>
  new Promise<{ readonly ok: boolean; readonly stdout: string }>((resolve) => {
    NodeChildProcess.execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout) =>
      resolve({ ok: error === null, stdout }),
    );
  });

const dialog = (page: PointerPage) => page.getByRole("dialog");
const startButton = (page: PointerPage) =>
  dialog(page).getByRole("button", { name: "Start shell", exact: true });
const folderRadio = (page: PointerPage, path: string) =>
  // The label holds the path and the git badge; no fixture path is a prefix of another.
  dialog(page).getByRole("radio", { name: path });
const shellNodes = (page: PointerPage, folder?: string) =>
  (folder === undefined
    ? page.getByRole("tree")
    : page.locator(`[data-folder="${folder}"]`)
  ).getByRole("treeitem", { level: 3 });
const tabs = (page: PointerPage) => page.getByRole("tablist", { name: "Shells" }).getByRole("tab");

/** Opens the "+" modal and waits for its folder step. */
async function openModal(page: PointerPage) {
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Start shell", exact: true })
    .click();
  await dialog(page).getByText("Pick a folder in").waitFor();
}

async function cancelModal(page: PointerPage) {
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).last().click();
  await dialog(page).waitFor({ state: "detached" });
}

/** The checked folder in the open modal, or null. */
async function preselected(page: PointerPage): Promise<string | null> {
  const radios = dialog(page).getByRole("radio");
  for (let index = 0; index < (await radios.count()); index++) {
    const radio = radios.nth(index);
    if ((await radio.getAttribute("aria-checked")) === "true") {
      return radio.getAttribute("aria-label");
    }
  }
  return null;
}

/**
 * Adds a folder from the open modal; returns the refusal, or null once the folder is listed.
 * The add-folder panel stays open after a refusal, so the next call reuses it.
 */
async function addFolder(
  page: PointerPage,
  request:
    | { readonly import: string; readonly pick?: string }
    | { readonly parent: string; readonly name: string },
): Promise<string | null> {
  const panel = dialog(page).getByTestId("add-folder");
  if (!(await panel.count())) {
    await dialog(page).getByRole("button", { name: "Add folder", exact: true }).click();
  }
  const isImport = "import" in request;
  await panel
    .getByRole("button", { name: isImport ? "Import existing folder" : "Create new folder" })
    .click();
  await panel
    .getByRole("textbox", { name: isImport ? "Folder" : "Create it in" })
    .fill(isImport ? request.import : request.parent);
  if (!isImport) await panel.getByRole("textbox", { name: "New folder name" }).fill(request.name);
  if (isImport && request.pick !== undefined) {
    // Picks a folder in the server folder browser, which lists the folder the field points at.
    await panel
      .getByRole("list", { name: "Folders on the server" })
      .getByRole("button", { name: request.pick, exact: true })
      .click();
  }
  const shown = dialog(page).getByRole("alert");
  const previous = (await shown.count()) ? await shown.getAttribute("data-attempt") : "none";
  await panel.getByRole("button", { name: isImport ? "Add folder" : "Create folder" }).click();
  const alert = dialog(page).locator(`[role="alert"]:not([data-attempt="${previous}"])`);
  await Promise.race([panel.waitFor({ state: "detached" }), alert.waitFor()]);
  if (await panel.count()) return alert.textContent();
  return null;
}

/** Waits until the list of shells has `count` entries for `cwd`. */
async function shellsIn(
  list: ReturnType<typeof recorder<ReadonlyArray<ShellSummary>>>,
  cwd: string,
  count: number,
) {
  const current = await list.until(
    `${count} shells in ${cwd}`,
    (shells) => shells.filter((shell) => shell.cwd === cwd).length === count,
  );
  return current.filter((shell) => shell.cwd === cwd);
}

/** Follows the server's shell list over `client`. */
function shellList(client: WsClient) {
  const lists = recorder<ReadonlyArray<ShellSummary>>();
  let list: ReadonlyArray<ShellSummary> = [];
  follow(client.subscribeShells({}), (event) => {
    if (event.type === "snapshot") list = event.shells;
    else if (event.type === "remove")
      list = list.filter((shell) => shell.shellId !== event.shellId);
    else list = [...list.filter((shell) => shell.shellId !== event.shell.shellId), event.shell];
    lists.push(list);
  });
  return { lists, current: () => list };
}

async function history(client: WsClient, shellId: string): Promise<string> {
  const [first] = await Effect.runPromise(
    client["shell.attach"]({ shellId }).pipe(Stream.take(1), Stream.runCollect),
  );
  return first?.type === "snapshot" ? first.snapshot.history : "";
}

/** Types into the active tab's terminal the way a user does, then submits the line. */
async function typeLine(page: PointerPage, text: string) {
  const input = page.getByRole("tabpanel").filter({ visible: true }).locator("textarea");
  await input.click({ force: true });
  await input.pressSequentially(text);
  await input.press("Enter");
}

async function createWorkspace(page: PointerPage, name: string) {
  await page.getByRole("button", { name: "Workspaces" }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  await dialog(page).getByRole("textbox").fill(name);
  await dialog(page).getByRole("button", { name: "Create" }).click();
  await dialog(page).waitFor({ state: "detached" });
  await page.getByRole("tree").getByRole("treeitem", { level: 1, name }).waitFor();
}

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
    const reopen = async (target: PointerPage) => {
      await target.reload();
      await target
        .getByTestId("workspace-screen")
        .getByRole("button", { name: "Open workspace" })
        .click();
      await target.getByRole("menuitem", { name: "sparta", exact: true }).click();
      await target.getByRole("tree").getByRole("treeitem", { level: 1, name: "sparta" }).waitFor();
    };

    try {
      await page.getByRole("button", { name: "Create workspace" }).click();
      await dialog(page).getByRole("textbox").fill("sparta");
      await dialog(page).getByRole("button", { name: "Create" }).click();
      await page.getByRole("tree").getByRole("treeitem", { level: 1, name: "sparta" }).waitFor();

      // AC-11: no folder yet, so the up-arrow is disabled.

      stage = "AC-11";
      await openModal(page);
      check(await startButton(page).isDisabled(), "Start is enabled with no folder (AC-11).");

      // AC-17: a file, a denied create and a failed git init are refused with their reason.

      stage = "AC-17";
      const fileReason = await addFolder(page, { import: notes });
      check(fileReason?.includes("not a folder") === true, `File path: ${fileReason} (AC-17).`);
      const deniedReason = await addFolder(page, { parent: locked, name: "app" });
      check(
        deniedReason?.includes("may not create") === true,
        `Denied create: ${deniedReason} (AC-17).`,
      );
      check((await dialog(page).getByRole("radio").count()) === 0, "A refused folder was added.");

      // AC-1, AC-8: import an existing git folder; it is selected and has the git badge.

      stage = "AC-1, AC-8";
      // The folder is picked by clicking it in the server folder browser, under its typed parent.
      check(
        (await addFolder(page, { import: `${folders}/`, pick: "repo" })) === null,
        "Importing the git folder failed.",
      );
      await folderRadio(page, repo).click();
      check(
        (await folderRadio(page, repo).getAttribute("aria-checked")) === "true",
        "The imported folder is not selected (AC-1, AC-8).",
      );
      check(
        (await dialog(page).getByText("git", { exact: true }).count()) === 1,
        "The git folder has no git badge.",
      );
      check(
        (await dialog(page)
          .getByText(/worktree|branch/i)
          .count()) === 0,
        "The modal offers worktree or branch controls (AC-10).",
      );

      // AC-2, AC-3, AC-21: one click starts a shell; its node appears within 1 s.

      stage = "AC-2, AC-3, AC-21";
      const framesBefore = frames.seen.length;
      const clickedAt = Date.now();
      await startButton(page).click();
      await shellNodes(page, repo).first().waitFor();
      const nodeMs = Date.now() - clickedAt;
      check(nodeMs <= 1_000, `The tree node took ${nodeMs} ms (AC-3 needs 1000).`);
      await frames.until(
        "the mock CLI banner",
        (frame) => frame.includes("Mock Agent v1"),
        framesBefore,
      );
      const bannerMs = Date.now() - clickedAt;
      await frames.until(
        "the mock CLI session id",
        (frame) => /session: mock-[0-9a-f]{8}/.test(frame),
        framesBefore,
      );
      NodeProcess.stdout.write(
        `scenarios: S2 start-to-banner ms=${bannerMs} (provisional limit 2000, not enforced)\n`,
      );
      await dialog(page).waitFor({ state: "detached" });
      const [first] = await shellsIn(shells.lists, repo, 1);
      check(first !== undefined && first.status === "running", "The started shell is not running.");
      check((await tabs(page).count()) === 1, "Starting a shell did not open one tab (AC-2).");

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
      await typeLine(page, "hello-probe");
      await frames.until("the echoed line", (frame) => frame.includes("echo: hello-probe"));

      // AC-6: after leaving the CLI, the shell's size equals the grid the view reports.

      stage = "AC-6";
      const output = recorder<TerminalAttachStreamEvent>();
      follow(rpc.client["shell.attach"]({ shellId: first.shellId }), output.push);
      await typeLine(page, "exit");
      const resizedFrom = output.seen.length;
      await page.setViewportSize({ width: 900, height: 600 });
      const grid = await output.until(
        "the narrower grid",
        (event) => event.type === "activity" && event.cols !== undefined,
        resizedFrom,
      );
      check(grid.type === "activity", "No grid was reported.");
      await typeLine(page, "echo sz:$(stty size)");
      const size = await frames.until("the shell's size", (frame) => /sz:\d+ \d+/.test(frame));
      const [, , cols] = /sz:(\d+) (\d+)/.exec(size)!;
      check(
        Number(cols) === grid.cols,
        `The shell has ${cols} columns, the view ${grid.cols} (AC-6).`,
      );
      await page.setViewportSize({ width: 1200, height: 800 });

      // AC-7, AC-12, AC-24: the folder is preselected; a double click starts exactly one shell.

      stage = "AC-7, AC-12, AC-24";
      await openModal(page);
      check((await preselected(page)) === repo, "The last folder is not preselected (AC-7).");
      await startButton(page).dblclick();
      await dialog(page).waitFor({ state: "detached" });
      const two = await shellsIn(shells.lists, repo, 2);
      await shellNodes(page, repo).nth(1).waitFor();
      const second = two.find((shell) => shell.shellId !== first.shellId)!;
      await frames.until("the second banner", (frame) => frame.includes("Mock Agent v1"));
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

      // AC-9: a new folder gets git with no commit, and a shell starts in its own checkout.

      stage = "AC-9";
      const fresh = NodePath.join(folders, "fresh");
      await openModal(page);
      check((await addFolder(page, { parent: folders, name: "fresh" })) === null, "Create failed.");
      check((await preselected(page)) === fresh, "The created folder is not selected (AC-9).");
      check((await git(fresh, ["rev-parse", "--git-dir"])).ok, "The new folder has no git (AC-9).");
      check(!(await git(fresh, ["rev-parse", "HEAD"])).ok, "The new folder has a commit.");
      await startButton(page).click();
      await shellNodes(page, fresh).first().waitFor();
      await shellsIn(shells.lists, fresh, 1);
      const worktrees = await git(fresh, ["worktree", "list", "--porcelain"]);
      check(
        worktrees.stdout.split("\n").filter((line) => line.startsWith("worktree ")).length === 1,
        "Starting a shell created a worktree (AC-9).",
      );

      // AC-10: a plain folder starts directly under its node.

      stage = "AC-10";
      await openModal(page);
      check(
        (await addFolder(page, { import: plain })) === null,
        "Importing the plain folder failed.",
      );
      await startButton(page).click();
      await shellNodes(page, plain).first().waitFor();
      await shellsIn(shells.lists, plain, 1);

      // AC-13: closing the modal without starting changes nothing.

      stage = "AC-13";
      const before = { shells: shells.current().length, tabs: await tabs(page).count() };
      await openModal(page);
      await cancelModal(page);
      check(
        shells.current().length === before.shells && (await tabs(page).count()) === before.tabs,
        "Closing the modal changed shells or tabs (AC-13).",
      );

      // AC-14, AC-15: a deleted last folder is not preselected and cannot start.

      stage = "AC-14, AC-15";
      await NodeFSP.rm(plain, { recursive: true });
      await openModal(page);
      await dialog(page).getByRole("radio").first().waitFor();
      check((await preselected(page)) === null, "A deleted folder is preselected (AC-14).");
      await folderRadio(page, plain).click();
      await startButton(page).click();
      const missing = await dialog(page).getByRole("alert").textContent();
      check(missing?.includes("no longer exists") === true, `Deleted folder: ${missing} (AC-15).`);
      // The open modal hides the page behind it, so tabs are counted once it is closed.
      await cancelModal(page);
      check(
        shells.current().length === before.shells && (await tabs(page).count()) === before.tabs,
        "A start in a deleted folder left a shell or tab (AC-15).",
      );

      // AC-14: a last folder removed from the workspace is not preselected either.

      stage = "AC-14";
      const workspaceFile = NodePath.join(server.home, "userdata", "workspaces", "sparta.json");
      const saved = await NodeFSP.readFile(workspaceFile, "utf8");
      await NodeFSP.writeFile(
        workspaceFile,
        JSON.stringify({ version: 1, folders: [{ path: fresh }], lastFolder: repo }),
      );
      await openModal(page);
      await folderRadio(page, fresh).waitFor();
      check((await preselected(page)) === null, "A folder outside the workspace is preselected.");
      await cancelModal(page);
      await NodeFSP.writeFile(workspaceFile, saved);

      // AC-19: start and end lines, the end caused from outside the app.

      stage = "AC-19";
      const killed = shells.current().find((shell) => shell.shellId === second.shellId)!;
      check(killed.pid !== null, "The second shell has no pid.");
      NodeProcess.kill(killed.pid, "SIGKILL");
      check(await gone(killed.pid), "The killed shell's process is still running.");
      await shells.lists.until("the killed shell to end", (list) =>
        list.some((shell) => shell.shellId === killed.shellId && shell.status === "exited"),
      );
      // An entry starts with its time and continues with its fields on indented lines.
      const logLines = () => server.logs().split(/\n(?=\S)/);
      check(
        logLines().some(
          (line) =>
            line.includes("shell started") && line.includes(killed.shellId) && line.includes(repo),
        ),
        "The log has no start line with the shell id and cwd (AC-19).",
      );
      check(
        logLines().some((line) => line.includes("shell ended") && line.includes(killed.shellId)),
        "The log has no end line for the killed shell (AC-19).",
      );

      // AC-16, AC-17: one restart carries both faults, an agent command that cannot start
      // and a git config that makes `git init` fail; a second restart clears them.

      stage = "AC-16";
      await rpc.close();
      await server.restart({
        env: { PROBE_AGENT_COMMAND: "no-such-agent-cli --start", GIT_CONFIG_GLOBAL: badGitConfig },
      });
      await reopen(page);
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);
      await shells.lists.until("the list after restart", () => true);
      await shellNodes(page).first().waitFor({ state: "detached" });
      await openModal(page);
      await folderRadio(page, repo).click();
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
      check(
        logLines().some((line) => line.includes("shell failed to start") && line.includes(repo)),
        "The log has no failure line with the cwd (AC-16).",
      );

      // AC-17: git init fails; the half-made folder is gone and not in the workspace.

      stage = "AC-17";
      await openModal(page);
      const initReason = await addFolder(page, { parent: folders, name: "broken" });
      check(initReason?.startsWith("git init failed") === true, `git init: ${initReason} (AC-17).`);
      check(
        !(await NodeFSP.stat(NodePath.join(folders, "broken")).catch(() => null)),
        "A folder whose git init failed was left on disk (AC-17).",
      );
      check(
        (await dialog(page)
          .getByRole("radio", { name: /broken/ })
          .count()) === 0,
        "A folder whose git init failed was added (AC-17).",
      );
      await cancelModal(page);
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
      await openModal(cut);
      await folderRadio(cut, repo).click();
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

      // AC-25: another workspace has no preselected folder, even one it shares.

      stage = "AC-25";
      await createWorkspace(page, "athens");
      await openModal(page);
      check(await startButton(page).isDisabled(), "Start is enabled in a new workspace (AC-25).");
      check((await addFolder(page, { import: repo })) === null, "Adding to athens failed.");
      await cancelModal(page);
      await openModal(page);
      check(
        (await preselected(page)) === null,
        "Another workspace's folder is preselected (AC-25).",
      );
      check(await startButton(page).isDisabled(), "Start is enabled with nothing chosen (AC-25).");
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
