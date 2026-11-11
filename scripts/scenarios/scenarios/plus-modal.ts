// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures in the throwaway home and ends a shell's process.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectionCutter } from "../browser.ts";
import { watchRoutes } from "../lib/chatRoutes.ts";
import { expected } from "../lib/expect.ts";
import { addStartingScript, git, revokeWrite } from "../lib/files.ts";
import { showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { shellCountOf, shellsOf } from "../lib/scoped.ts";
import { expectLogged } from "../lib/serverLog.ts";
import { type FolderResult, projectPaths, setupOn } from "../lib/setup.ts";
import {
  agentReady,
  agentTypedOnceAfterPrompt,
  history,
  MOCK_AGENT_LINES,
  shellEnded,
  shellsIn,
} from "../lib/shells.ts";
import { expectText, uncommittedRepo } from "../lib/t039-2.ts";
import { addProject, closeFolderList, folderList, openAddFolder } from "../lib/ui/addProject.ts";
import { dialog } from "../lib/ui/dialog.ts";
import {
  cancelModal,
  createShellButton,
  mode,
  modeButton,
  modeSwitch,
  openModal,
  selectedKey,
  startButton,
  startFromModal,
} from "../lib/ui/plusModal.ts";
import { shellTab, tabs } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { shellNodes } from "../lib/ui/tree.ts";
import { follow, recorder, waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";
import { MOCK_AGENT_COMMAND } from "../server.ts";

const CONNECTION_LOST =
  "The shell did not start: the connection to the server was lost. Try again.";

// Every successor that drives the page holds AC-20 (a PointerPage) and checks AC-23 last.
const UI = ["S2 AC-20", "S2 AC-23"] as const;

/** A signed-in page watched for chat routes, and a workspace of the scenario's own, not shown yet. */
async function begin(ctx: ScenarioContext, label: string) {
  const page = await ctx.openPage();
  const routes = watchRoutes(page);
  const frames = pageFrames(page);
  const setup = await setupOn(ctx, { as: page });
  const ws = await setup.workspace(label);
  return { page, routes, frames, setup, ws };
}

type Begun = Awaited<ReturnType<typeof begin>>;

const createButtons = (page: Begun["page"]) =>
  page.getByRole("tree").getByRole("button", { name: /^Create shell in / });

const projectsOf = (setup: Begun["setup"], name: string) =>
  Effect.runPromise(projectPaths(setup.client, name));

const mine = (...folders: ReadonlyArray<FolderResult>) => folders.map(({ path }) => ({ path }));

/** Starts the preselected script from `folder`'s "+" and waits for the shell and its tab. */
async function startThroughModal(begun: Begun, folder: FolderResult, script?: string) {
  const { page, setup } = begun;
  const before = shellsOf(setup.shells.current(), mine(folder));
  await openModal(page, folder.path, script === undefined ? {} : { script });
  expected({ what: "the start's refusal", expected: null, found: await startFromModal(page) });
  const known = new Set(before.map(({ shellId }) => shellId));
  const listed = await shellCountOf(setup.shells, mine(folder), before.length + 1);
  const started = listed.find(({ shellId }) => !known.has(shellId))!;
  await waitFor(shellTab(page, started.shellId), `the tab of shell ${started.shellId}`);
  return started;
}

export const noProject = defineCheck(import.meta.url, {
  id: "S2.no-project",
  title: "a workspace with no project offers no start, and adding starts at the server's home",
  needs: {},
  covers: ["S2 AC-11", ...UI],
  run: async (ctx) => {
    const { page, routes, ws } = await begin(ctx, "no-project");
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-11", async () => {
      expected({
        what: "the tree's Create shell buttons in a workspace with no project",
        expected: 0,
        found: await createButtons(page).count(),
      });
      await openAddFolder(page);
      const field = dialog(page).getByRole("combobox", { name: "Folder" });
      expected({
        what: "the Add project folder field's first value",
        expected: "~/",
        found: await field.inputValue(),
      });
      expected({
        what: "folder lists shown before the field is clicked",
        expected: 0,
        found: await folderList(page).count(),
      });
      await field.click();
      await waitFor(folderList(page), "the folder list after a click on the field");
      await closeFolderList(page);
      expected({
        what: "open dialogs after a click outside the folder list",
        expected: 1,
        found: await dialog(page).count(),
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.no-project"));
  },
});

export const addRefusals = defineCheck(import.meta.url, {
  id: "S2.add-refusals",
  title: "adding a file, or a folder that may not be created, is refused with its reason",
  needs: {},
  covers: ["S2 AC-17", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "add-refusals");
    const files = await setup.folder("files");
    const notes = NodePath.join(files.path, "notes.txt");
    await NodeFSP.writeFile(notes, "not a folder");
    const locked = await setup.folder("locked");
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-17 file", async () => {
      expectText(
        "the refusal to add a file",
        await addProject(page, { import: notes }),
        "not a folder",
      );
    });
    await ctx.trail.stage("AC-17 denied create", () =>
      revokeWrite(ctx, locked.path, "AC-17 denied create", async () => {
        expectText(
          "the refusal to create a folder inside a read-only one",
          await addProject(page, { parent: locked.path, name: "app" }),
          "may not create",
        );
      }),
    );
    await ctx.trail.stage("AC-17 nothing added", async () => {
      await cancelModal(page);
      expected({
        what: `the projects of ${ws.name} after the refusals`,
        expected: [],
        found: await projectsOf(setup, ws.name),
      });
      expected({
        what: "project rows in the tree after the refusals",
        expected: 0,
        found: await page.locator("[data-project]").count(),
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.add-refusals"));
  },
});

export const importGit = defineCheck(import.meta.url, {
  id: "S2.import-git",
  title: "an imported git folder starts nothing and its + offers its own checkout",
  needs: {},
  // One import: the folder picked in the server's folder browser, then what its "+" offers.
  covers: ["S2 AC-1", "S2 AC-8", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "import-git");
    const repo = await uncommittedRepo(setup);
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-1", async () => {
      expected({
        what: "the refusal to import a git folder picked in the folder browser",
        expected: null,
        found: await addProject(page, {
          import: `${NodePath.dirname(repo.path)}/`,
          pick: NodePath.basename(repo.path),
        }),
      });
    });
    await ctx.trail.stage("AC-8", async () => {
      await openModal(page, repo.path);
      expected({
        what: "the imported folder's preselected start",
        expected: { mode: "Existing", startIn: repo.path },
        found: { mode: await mode(page), startIn: await selectedKey(page, "Start in") },
      });
      expected({
        what: "Fork disabled for a repository with no commit",
        expected: true,
        found: await modeButton(page, "Fork").isDisabled(),
      });
      expected({
        what: "shells started by adding the folder",
        expected: 0,
        found: shellsOf(setup.shells.current(), mine(repo)).length,
      });
      await cancelModal(page);
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.import-git"));
  },
});

export const oneClickStart = defineCheck(import.meta.url, {
  id: "S2.one-click-start",
  title: "one click starts a running shell with one tab, named by number, folder and program",
  needs: {},
  // One click on Create shell: its node, its single tab and its names all follow from that start.
  covers: ["S2 AC-2", "S2 AC-3", "S2 AC-21", ...UI],
  run: async (ctx) => {
    const { page, routes, frames, setup, ws } = await begin(ctx, "one-click");
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    const base = NodePath.basename(repo.path);
    await ctx.trail.stage("AC-2", async () => {
      await openModal(page, repo.path);
      const from = frames.mark();
      await startButton(page).click();
      await waitFor(shellNodes(page, repo.path).first(), `the tree node of the shell in ${base}`);
      await frames.until(
        "the mock CLI banner",
        (frame) => frame.includes(MOCK_AGENT_LINES.banner),
        from,
      );
      await frames.until(
        "the mock CLI session id",
        (frame) => /session: mock-[0-9a-f]{8}/.test(frame),
        from,
      );
      await waitFor(dialog(page), '"Create shell" to close on the start', { state: "detached" });
      const [started] = await shellsIn(setup.shells.lists, repo.path, 1);
      expected({
        what: "the status of the started shell",
        expected: "running",
        found: started?.status,
      });
      await waitFor(
        tabs(page).filter({ hasText: new RegExp(`^Shell 1 · ${base} · node$`) }),
        `the tab "Shell 1 · ${base} · node"`,
      );
      expected({ what: "tabs after one start", expected: 1, found: await tabs(page).count() });
    });
    await ctx.trail.stage("AC-3", () =>
      waitFor(
        shellNodes(page, repo.path).filter({ hasText: /^Shell 1 · node$/ }),
        'the tree node "Shell 1 · node"',
      ),
    );
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.one-click-start"));
  },
});

export const noChatChrome = defineCheck(import.meta.url, {
  id: "S2.no-chat-chrome",
  title: "a started shell makes no chat thread and its tab shows no composer",
  needs: {},
  covers: ["S2 AC-4", ...UI],
  run: async (ctx) => {
    const begun = await begin(ctx, "no-chat");
    const { page, routes, setup, ws } = begun;
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    const shell = await ctx.trail.stage("start", () => startThroughModal(begun, repo));
    await ctx.trail.stage("AC-4", async () => {
      const [item] = await Effect.runPromise(
        setup.client["orchestration.subscribeShell"]({}).pipe(
          Stream.filter((entry) => entry.kind === "snapshot"),
          Stream.take(1),
          Stream.runCollect,
        ),
      );
      const snapshot = item?.kind === "snapshot" ? item.snapshot : undefined;
      const project = snapshot?.projects.find((entry) => entry.workspaceRoot === repo.path);
      expected({
        what: `an orchestration project for ${repo.path}`,
        expected: true,
        found: project !== undefined,
      });
      expected({
        what: `chat threads of ${repo.path} after starting shell ${shell.shellId}`,
        expected: [],
        found: (snapshot?.threads ?? [])
          .filter((thread) => thread.projectId === project?.id)
          .map((thread) => thread.id),
      });
      expected({
        what: "chat composers on the shell tab",
        expected: 0,
        found: await page.getByRole("button", { name: /^Send/ }).count(),
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.no-chat-chrome"));
  },
});

export const agentEcho = defineCheck(import.meta.url, {
  id: "S2.agent-echo",
  title: "a line typed into a mock agent started from the modal is echoed",
  needs: {},
  covers: ["S2 AC-5", ...UI],
  run: async (ctx) => {
    const begun = await begin(ctx, "agent-echo");
    const { page, routes, frames, setup, ws } = begun;
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    const shell = await ctx.trail.stage("start", () => startThroughModal(begun, repo));
    await ctx.trail.stage("AC-5", async () => {
      await agentReady(setup.client, shell.shellId);
      const line = `hello-${ctx.runId}`;
      const typed = frames.mark();
      await typeLine(page, line);
      await frames.until("the echoed line", (frame) => frame.includes(`echo: ${line}`), typed);
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.agent-echo"));
  },
});

export const gridSize = defineCheck(import.meta.url, {
  id: "S2.grid-size",
  title: "a shell started from the modal has the columns its view reports",
  needs: {},
  covers: ["S2 AC-6", ...UI],
  run: async (ctx) => {
    const begun = await begin(ctx, "grid-size");
    const { page, routes, frames, setup, ws } = begun;
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    const shell = await ctx.trail.stage("start a plain shell", () =>
      startThroughModal(begun, repo, "Plain shell"),
    );
    await ctx.trail.stage("AC-6", async () => {
      const events = recorder<TerminalAttachStreamEvent>("attach events");
      follow(setup.client["shell.attach"]({ shellId: shell.shellId }), events.push);
      const resized = events.mark();
      await page.setViewportSize({ width: 900, height: 600 });
      const grid = await events.until(
        "the narrower grid",
        (event) => event.type === "activity" && event.cols !== undefined,
        resized,
      );
      const typed = frames.mark();
      await typeLine(page, "echo sz:$(stty size)");
      const size = await frames.until(
        "the shell's size",
        (frame) => /sz:\d+ \d+/.test(frame),
        typed,
      );
      expected({
        what: "the shell's columns against the view's grid",
        expected: grid.type === "activity" ? grid.cols : "an activity event",
        found: Number(/sz:\d+ (\d+)/.exec(size)?.[1]),
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.grid-size"));
  },
});

export const repeatStart = defineCheck(import.meta.url, {
  id: "S2.repeat-start",
  title: "a second start preselects the last choice and a double click starts exactly one shell",
  needs: {},
  // One second start: its preselection, its single shell and its own output follow from it.
  covers: ["S2 AC-7", "S2 AC-12", "S2 AC-24", ...UI],
  run: async (ctx) => {
    const begun = await begin(ctx, "repeat-start");
    const { page, routes, frames, setup, ws } = begun;
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    const line = `hello-${ctx.runId}`;
    const first = await ctx.trail.stage("the earlier start", async () => {
      const started = await startThroughModal(begun, repo);
      await agentReady(setup.client, started.shellId);
      const typed = frames.mark();
      await typeLine(page, line);
      await frames.until("the echoed line", (frame) => frame.includes(`echo: ${line}`), typed);
      return started;
    });
    await ctx.trail.stage("AC-7", async () => {
      await openModal(page, repo.path);
      expected({
        what: "the preselected Start in of the second start",
        expected: repo.path,
        found: await selectedKey(page, "Start in"),
      });
    });
    const second = await ctx.trail.stage("AC-24", async () => {
      const from = frames.mark();
      await startButton(page).dblclick();
      await waitFor(dialog(page), '"Create shell" to close on the double click', {
        state: "detached",
      });
      const two = await shellsIn(setup.shells.lists, repo.path, 2);
      const started = two.find((entry) => entry.shellId !== first.shellId)!;
      await waitFor(shellTab(page, started.shellId), "the second shell's tab");
      await frames.until(
        "the second banner",
        (frame) => frame.includes(MOCK_AGENT_LINES.banner),
        from,
      );
      expected({ what: "the second shell's title", expected: "Shell 2", found: started.title });
      expected({
        what: "shells, tree nodes and tabs after a double click",
        expected: { shells: 2, nodes: 2, tabs: 2 },
        found: {
          shells: shellsOf(setup.shells.current(), mine(repo)).length,
          nodes: await shellNodes(page, repo.path).count(),
          tabs: await tabs(page).count(),
        },
      });
      return started;
    });
    await ctx.trail.stage("AC-12", async () => {
      expected({
        what: "the typed line in each shell's history",
        expected: { first: true, second: false },
        found: {
          first: (await history(setup.client, first.shellId)).includes(`echo: ${line}`),
          second: (await history(setup.client, second.shellId)).includes(line),
        },
      });
    });
    await ctx.trail.stage("PRB.T-011", async () => {
      // The output runs on through the typed line above, so a second typing would show by now.
      const once = "once, after the first prompt";
      const problem = agentTypedOnceAfterPrompt(
        ctx.server.rawOutput(first.shellId),
        MOCK_AGENT_COMMAND,
        MOCK_AGENT_LINES,
      );
      expected({
        what: "how the agent command was typed into the first shell",
        expected: once,
        found: problem ?? once,
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.repeat-start"));
  },
});

export const newFolderGit = defineCheck(import.meta.url, {
  id: "S2.new-folder-git",
  title: "a new folder gets git with no commit and a shell starts in its own checkout",
  needs: {},
  covers: ["S2 AC-9", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "new-folder");
    const parent = await setup.folder("parent");
    const fresh = NodePath.join(parent.path, "fresh");
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-9 create", async () => {
      expected({
        what: "the refusal to create a new folder",
        expected: null,
        found: await addProject(page, { parent: parent.path, name: "fresh" }),
      });
      expected({
        what: "git in the new folder",
        expected: { gitDir: true, commit: false },
        found: {
          gitDir: (await git(fresh, ["rev-parse", "--git-dir"])).ok,
          commit: (await git(fresh, ["rev-parse", "HEAD"])).ok,
        },
      });
    });
    await ctx.trail.stage("AC-9 start", async () => {
      await openModal(page, fresh);
      expected({ what: "the start's refusal", expected: null, found: await startFromModal(page) });
      await waitFor(shellNodes(page, fresh).first(), "the shell's node under the new folder");
      await shellsIn(setup.shells.lists, fresh, 1);
      const worktrees = await git(fresh, ["worktree", "list", "--porcelain"]);
      expected({
        what: "worktrees of the new folder after the start",
        expected: 1,
        found: worktrees.stdout.split("\n").filter((entry) => entry.startsWith("worktree ")).length,
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.new-folder-git"));
  },
});

export const plainFolder = defineCheck(import.meta.url, {
  id: "S2.plain-folder",
  title: "a plain folder offers no worktree choice and starts under its node",
  needs: {},
  covers: ["S2 AC-10", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "plain-folder");
    const plain = await setup.folder("plain");
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-10", async () => {
      expected({
        what: "the refusal to import a plain folder",
        expected: null,
        found: await addProject(page, { import: plain.path }),
      });
      await openModal(page, plain.path);
      expected({
        what: "worktree switches for a plain folder",
        expected: 0,
        found: await modeSwitch(page).count(),
      });
      expected({ what: "the start's refusal", expected: null, found: await startFromModal(page) });
      await waitFor(
        shellNodes(page, plain.path).first(),
        "the shell's node under the plain folder",
      );
      await shellsIn(setup.shells.lists, plain.path, 1);
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.plain-folder"));
  },
});

export const cancelWithoutStart = defineCheck(import.meta.url, {
  id: "S2.cancel-modal",
  title: "closing the modal without starting changes no shell or tab",
  needs: {},
  covers: ["S2 AC-13", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "cancel-modal");
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-13", async () => {
      const counts = async () => ({
        shells: shellsOf(setup.shells.current(), mine(repo)).length,
        tabs: await tabs(page).count(),
      });
      const before = await counts();
      await openModal(page, repo.path);
      await cancelModal(page);
      expected({ what: "shells and tabs after Cancel", expected: before, found: await counts() });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.cancel-modal"));
  },
});

export const deletedFolder = defineCheck(import.meta.url, {
  id: "S2.deleted-folder",
  title: "a folder deleted on disk refuses a start and is marked without a +",
  needs: {},
  // One deletion: the refused start in the open modal, then the mark the next read shows.
  covers: ["S2 AC-14", "S2 AC-15", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "deleted-folder");
    const plain = await setup.folder("plain");
    const other = await setup.folder("other");
    await setup.project(ws, plain);
    await setup.project(ws, other);
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-15", async () => {
      const counts = async () => ({
        shells: shellsOf(setup.shells.current(), mine(plain, other)).length,
        tabs: await tabs(page).count(),
      });
      const before = await counts();
      await openModal(page, plain.path);
      await NodeFSP.rm(plain.path, { recursive: true });
      expectText(
        "the refusal to start in a deleted folder",
        await startFromModal(page),
        "no longer exists",
      );
      await cancelModal(page);
      expected({
        what: "shells and tabs after a start in a deleted folder",
        expected: before,
        found: await counts(),
      });
    });
    await ctx.trail.stage("AC-14", async () => {
      // Opening the modal reads the workspace again; the deleted folder is then marked.
      await openModal(page, other.path);
      await cancelModal(page);
      await waitFor(
        page.locator(
          `[data-project="${plain.path}"] [role="treeitem"][aria-label="${plain.path}"] [data-missing]`,
        ),
        "the deleted folder's missing mark",
      );
      expected({
        what: "Create shell buttons on the deleted folder",
        expected: 0,
        found: await createShellButton(page, plain.path).count(),
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.deleted-folder"));
  },
});

export const removedFolderLastStart = defineCheck(import.meta.url, {
  id: "S2.removed-folder-last-start",
  title: "a last start in a folder removed from the workspace is not applied to another",
  needs: {},
  covers: ["S2 AC-14b", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "removed-last-start");
    const removed = await uncommittedRepo(setup, "removed");
    const kept = await uncommittedRepo(setup, "kept");
    await setup.project(ws, removed);
    await setup.project(ws, kept);
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-14b", async () => {
      // An edit outside Probe: the workspace keeps only `kept`, with `removed` as its last start.
      const file = NodePath.join(ctx.server.home, "userdata", "workspaces", `${ws.name}.json`);
      await NodeFSP.writeFile(
        file,
        JSON.stringify({ version: 1, folders: [{ path: kept.path }], lastFolder: removed.path }),
      );
      await openModal(page, kept.path);
      expected({
        what: "the mode preselected in the kept folder",
        expected: "Existing",
        found: await mode(page),
      });
      await cancelModal(page);
      await waitFor(
        page.locator(`[data-project="${removed.path}"]`),
        "the removed folder's row to leave the tree",
        { state: "detached" },
      );
    });
    await ctx.trail.stage("AC-23", async () =>
      routes.expectNoChatRoute("S2.removed-folder-last-start"),
    );
  },
});

export const startEndLines = defineCheck(import.meta.url, {
  id: "S2.start-end-lines",
  title: "the log has a start line and an end line for a shell killed from outside",
  needs: {},
  covers: ["S2 AC-19"],
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const ws = await setup.workspace("start-end");
    const folder = await setup.folder("lines");
    const shell = await setup.shell(await setup.project(ws, folder));
    await ctx.trail.stage("AC-19", async () => {
      expected({ what: "the started shell's pid", expected: "a pid", found: shell.pid ?? "none" });
      NodeProcess.kill(shell.pid!, "SIGKILL");
      await shellEnded(setup.shells, shell);
      await expectLogged(
        ctx.server,
        `a "shell started" log line with ${shell.shellId} and ${folder.path}`,
        (entry) =>
          entry.includes("shell started") &&
          entry.includes(shell.shellId) &&
          entry.includes(folder.path),
      );
      await expectLogged(
        ctx.server,
        `a "shell ended" log line with ${shell.shellId}`,
        (entry) => entry.includes("shell ended") && entry.includes(shell.shellId),
      );
    });
  },
});

export const connectionDrop = defineCheck(import.meta.url, {
  id: "S2.connection-drop",
  title: "a start whose connection drops shows why, leaves nothing, and a retry works",
  needs: {},
  covers: ["S2 AC-18", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "connection-drop");
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    // The cutter routes only sockets opened after it, so the page connects again.
    const cutter = await connectionCutter(page);
    await page.reload();
    await showWorkspace(page, ws);
    const servedAtDrop = await ctx.trail.stage("AC-18 drop", async () => {
      await openModal(page, repo.path);
      const dropped = cutter.dropOn("workspace.startShell");
      await startButton(page).click();
      const served = cutter.served();
      await dropped;
      const alert = dialog(page).getByRole("alert");
      await waitFor(alert, "the refusal of the dropped start");
      expected({
        what: "the dropped start's refusal",
        expected: CONNECTION_LOST,
        found: await alert.textContent(),
      });
      expected({
        what: "shells on the server after a dropped start",
        expected: 0,
        found: shellsOf(setup.shells.current(), mine(repo)).length,
      });
      return served;
    });
    await ctx.trail.stage("AC-18 retry", async () => {
      // A retry works once the page has reconnected on its own and the server answered it.
      await cutter.servedMoreThan(servedAtDrop);
      expected({ what: "the retry's refusal", expected: null, found: await startFromModal(page) });
      await shellCountOf(setup.shells, mine(repo), 1);
      await waitFor(tabs(page).first(), "the retried shell's tab");
      expected({ what: "tabs after the retry", expected: 1, found: await tabs(page).count() });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.connection-drop"));
  },
});

export const otherWorkspace = defineCheck(import.meta.url, {
  id: "S2.other-workspace",
  title: "another workspace starts with no folder and without the first one's last start",
  needs: {},
  covers: ["S2 AC-25", ...UI],
  run: async (ctx) => {
    const begun = await begin(ctx, "first-ws");
    const { page, routes, setup, ws } = begun;
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    const other = await setup.workspace("other-ws");
    await showWorkspace(page, ws);
    await ctx.trail.stage("the first workspace's start", () => startThroughModal(begun, repo));
    await ctx.trail.stage("AC-25", async () => {
      await showWorkspace(page, other);
      expected({
        what: `Create shell buttons in ${other.name} with no folder`,
        expected: 0,
        found: await createButtons(page).count(),
      });
      expected({
        what: `the refusal to add ${repo.path} to ${other.name}`,
        expected: null,
        found: await addProject(page, { import: repo.path }),
      });
      await openModal(page, repo.path);
      expected({
        what: `the preselected start in ${other.name}`,
        expected: { mode: "Existing", startIn: repo.path },
        found: { mode: await mode(page), startIn: await selectedKey(page, "Start in") },
      });
      await cancelModal(page);
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.other-workspace"));
  },
});

export const unstartableScript = defineCheck(import.meta.url, {
  id: "S2.unstartable-script",
  title: "a starting script whose program is missing is refused and leaves no shell",
  needs: { serverWide: "adds a starting script" },
  covers: ["S2 AC-16", ...UI],
  run: async (ctx) => {
    const name = `unstartable-${ctx.runId}`;
    await addStartingScript(ctx.server.home, {
      id: name,
      name,
      command: "no-such-agent-cli --start",
    });
    const { page, routes, setup, ws } = await begin(ctx, "unstartable");
    const repo = await uncommittedRepo(setup);
    await setup.project(ws, repo);
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-16", async () => {
      await openModal(page, repo.path, { script: name });
      expectText(
        "the refusal of the unstartable script",
        await startFromModal(page),
        "no-such-agent-cli",
      );
      await cancelModal(page);
      expected({
        what: "shells and tree nodes after the refused start",
        expected: { shells: 0, nodes: 0 },
        found: {
          shells: shellsOf(setup.shells.current(), mine(repo)).length,
          nodes: await shellNodes(page, repo.path).count(),
        },
      });
      await expectLogged(
        ctx.server,
        `a "shell failed to start" log line with ${repo.path}`,
        (entry) => entry.includes("shell failed to start") && entry.includes(repo.path),
      );
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.unstartable-script"));
  },
});

export const gitInitFails = defineCheck(import.meta.url, {
  id: "S2.git-init-fails",
  title: "a new folder whose git init fails is refused, removed and not added",
  needs: {
    condition: {
      why: "git reads a broken global config",
      env: async (home) => {
        const path = NodePath.join(home, "broken-gitconfig");
        await NodeFSP.mkdir(home, { recursive: true });
        await NodeFSP.writeFile(path, "[broken\n");
        return { GIT_CONFIG_GLOBAL: path };
      },
    },
  },
  covers: ["S2 AC-17 git init", ...UI],
  run: async (ctx) => {
    const { page, routes, setup, ws } = await begin(ctx, "git-init");
    const parent = await setup.folder("parent");
    const broken = NodePath.join(parent.path, "broken");
    await showWorkspace(page, ws);
    await ctx.trail.stage("AC-17 git init", async () => {
      expectText(
        "the refusal to create a folder whose git init fails",
        await addProject(page, { parent: parent.path, name: "broken" }),
        "git init failed",
        { atStart: true },
      );
      expected({
        what: "the half-made folder on disk",
        expected: "absent",
        found: (await NodeFSP.stat(broken).catch(() => null)) === null ? "absent" : "present",
      });
      await cancelModal(page);
      expected({
        what: `the projects of ${ws.name} after the failed create`,
        expected: [],
        found: await projectsOf(setup, ws.name),
      });
    });
    await ctx.trail.stage("AC-23", async () => routes.expectNoChatRoute("S2.git-init-fails"));
  },
});

export const successors = [
  noProject,
  addRefusals,
  importGit,
  oneClickStart,
  noChatChrome,
  agentEcho,
  gridSize,
  repeatStart,
  newFolderGit,
  plainFolder,
  cancelWithoutStart,
  deletedFolder,
  removedFolderLastStart,
  startEndLines,
  connectionDrop,
  otherWorkspace,
  unstartableScript,
  gitInitFails,
];

// temporary: PRB.T-039 10A removes this alias.
export const plusModal = noProject;
