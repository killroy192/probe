// @effect-diagnostics nodeBuiltinImport:off - Makes git fixtures in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ShellSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PointerPage } from "../browser.ts";
import { expected } from "../lib/expect.ts";
import { addStartingScript, gitOk, holdingHook } from "../lib/files.ts";
import { showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { shellsOf, worktreeNodes } from "../lib/scoped.ts";
import { expectLogged } from "../lib/serverLog.ts";
import {
  framedPage,
  projectPaths,
  type ProjectResult,
  type Setup,
  type ShellResult,
  type WorkspaceResult,
} from "../lib/setup.ts";
import { MOCK_AGENT_LINES, runningIn } from "../lib/shells.ts";
import { addProject } from "../lib/ui/addProject.ts";
import { dialog } from "../lib/ui/dialog.ts";
import {
  cancelModal,
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
import { shellTab, tabs } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { shellRow } from "../lib/ui/tree.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

const NAME = /^probe-worktree-[0-9a-f]{6}$/;
const NAME_FORM = "probe-worktree-<6 hex digits>";

const worktreeNode = (page: PointerPage, path: string) => page.locator(`[data-worktree="${path}"]`);
const worktreeNodeLabel = (page: PointerPage, path: string) =>
  worktreeNode(page, path).getByRole("treeitem", { level: 3 });

/** The one entry of `found`, which a library wait already counted. */
function sole<T>(found: ReadonlyArray<T>, what: string): T {
  expected({ what, expected: 1, found: found.length });
  return found[0] as T;
}

/** The generated name the modal shows for a fork. */
async function proposedName(page: PointerPage) {
  const line = dialog(page).locator("p", { hasText: "New worktree and branch:" });
  await waitFor(line, "the modal's new worktree name");
  const name = ((await line.textContent()) ?? "").replace("New worktree and branch:", "").trim();
  expected({
    what: "the worktree name the modal shows",
    expected: NAME_FORM,
    found: NAME.test(name) ? NAME_FORM : name,
  });
  return name;
}

async function expectStarted(page: PointerPage, what: string) {
  expected({ what: `the refusal of ${what}`, expected: null, found: await startFromModal(page) });
}

/** `true` when `refusal` names `name`, else the refusal itself, for an expected/found message. */
const names = (refusal: string | null, name: string) =>
  refusal?.includes(name) === true ? true : refusal;

interface GitFixture {
  readonly repo: string;
  readonly linked: string;
  readonly detached: string;
  readonly wkt: string;
  readonly otherHead: string;
  /** Where the server puts this repository's forks; other runs' forks of a `repo` share it. */
  readonly forks: string;
  readonly hold: string;
  readonly release: string;
}

/**
 * A repository `repo` in a folder of this run, with the branches other, doomed, doomed2 and wkt at
 * its first commit, main one commit later, and linked, detached and wkt worktrees at other.
 */
async function gitFixture(
  ctx: ScenarioContext,
  setup: Setup,
  { holdForks = false }: { readonly holdForks?: boolean } = {},
): Promise<GitFixture> {
  const base = (await setup.folder("git")).path;
  const repo = NodePath.join(base, "repo");
  const linked = NodePath.join(base, "linked");
  const detached = NodePath.join(base, "detached");
  const wkt = NodePath.join(base, "wkt");
  const hold = NodePath.join(base, "hold-fork");
  const release = NodePath.join(base, "release-fork");
  await NodeFSP.mkdir(repo, { recursive: true });
  await gitOk(repo, "init", "-q", "-b", "main");
  await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "one");
  for (const branch of ["other", "doomed", "doomed2", "wkt"]) await gitOk(repo, "branch", branch);
  await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "two");
  await gitOk(repo, "worktree", "add", "-q", "-b", "linked", linked, "other");
  await gitOk(repo, "worktree", "add", "-q", "--detach", detached, "other");
  // A worktree whose folder name is also a branch it does not have checked out.
  await gitOk(repo, "worktree", "add", "-q", "-b", "wkt-new", wkt, "other");
  if (holdForks) {
    // Holds a fork open while the hold file exists, so a second click lands mid-start.
    const hooks = NodePath.join(repo, ".git", "hooks");
    await NodeFSP.writeFile(NodePath.join(hooks, "post-checkout"), holdingHook(hold, release), {
      mode: 0o755,
    });
    await gitOk(repo, "config", "core.hooksPath", hooks);
  }
  return {
    repo,
    linked,
    detached,
    wkt,
    otherHead: await gitOk(repo, "rev-parse", "other"),
    forks: NodePath.join(ctx.server.home, "worktrees", "repo"),
    hold,
    release,
  };
}

/** The repository's branches and registered worktrees, which a fork changes. */
const gitState = async (git: GitFixture) => ({
  branches: await gitOk(git.repo, "branch", "--format=%(refname:short)"),
  worktrees: await gitOk(git.repo, "worktree", "list", "--porcelain"),
});

const exists = (path: string) =>
  NodeFSP.stat(path).then(
    () => true,
    () => false,
  );

type Extra = "second" | "empty" | "plain";

interface S3Page {
  readonly page: PointerPage;
  readonly frames: ReturnType<typeof pageFrames>;
  readonly setup: Setup;
  readonly ws: WorkspaceResult;
  readonly git: GitFixture;
  readonly extras: Readonly<Record<Extra, ProjectResult | undefined>>;
}

interface S3World extends S3Page {
  readonly project: ProjectResult;
}

/**
 * A page showing a workspace of this run with the extra projects asked for: `second` a git
 * repository with a commit, `empty` one with none, `plain` no repository.
 */
async function s3Page(
  ctx: ScenarioContext,
  {
    extras = [],
    holdForks = false,
    before = async () => {},
  }: {
    readonly extras?: ReadonlyArray<Extra>;
    readonly holdForks?: boolean;
    readonly before?: (setup: Setup, ws: WorkspaceResult, git: GitFixture) => Promise<void>;
  } = {},
): Promise<S3Page> {
  const { page, frames, setup } = await framedPage(ctx);
  const ws = await setup.workspace("worktrees");
  const git = await gitFixture(ctx, setup, { holdForks });
  await before(setup, ws, git);
  const made: Record<Extra, ProjectResult | undefined> = {
    second: undefined,
    empty: undefined,
    plain: undefined,
  };
  for (const extra of extras) {
    if (extra === "second") {
      made.second = await setup.project(ws, await setup.repo({ label: "second" }));
    } else {
      const folder = await setup.folder(extra);
      if (extra === "empty") await gitOk(folder.path, "init", "-q", "-b", "main");
      made[extra] = await setup.project(ws, folder);
    }
  }
  await showWorkspace(page, ws);
  return { page, frames, setup, ws, git, extras: made };
}

/** `s3Page` with the git fixture added as a project over the API. */
async function repoWorld(
  ctx: ScenarioContext,
  options: { readonly extras?: ReadonlyArray<Extra>; readonly holdForks?: boolean } = {},
): Promise<S3World> {
  let project: ProjectResult | undefined;
  const made = await s3Page(ctx, {
    ...options,
    before: async (setup, ws, git) => {
      project = await setup.project(ws, { kind: "folder", path: git.repo });
    },
  });
  if (project === undefined) throw new Error("The repository was not added.");
  return { ...made, project };
}

function extra(world: S3Page, which: Extra): ProjectResult {
  const project = world.extras[which];
  if (project === undefined) throw new Error(`The world has no ${which} project.`);
  return project;
}

/** Starts a shell from the "+" modal in an existing worktree; returns the running ones there. */
async function startExisting(
  world: S3World,
  path: string,
  count: number,
  script: string | null = "mock agent",
) {
  const { page, setup, git } = world;
  await openModal(page, git.repo, { script });
  if ((await mode(page)) !== "Existing") await modeButton(page, "Existing").click();
  await pickItem(page, "Start in", path);
  await expectStarted(page, `the start in ${path}`);
  return runningIn(setup.shells.lists, path, count);
}

/** Forks from `origin` in the "+" modal and returns the fork's name, folder and shell. */
async function forkFromModal(world: S3World, origin: string) {
  const { page, setup, git } = world;
  await openModal(page, git.repo);
  if ((await mode(page)) !== "Fork") await modeButton(page, "Fork").click();
  await pickItem(page, "Fork from", origin);
  const name = await proposedName(page);
  await expectStarted(page, `the fork from ${origin}`);
  const path = NodePath.join(git.forks, name);
  const shell = sole(await runningIn(setup.shells.lists, path, 1), `running shells in ${path}`);
  return { name, path, shell };
}

const asShell = (world: S3World, shell: ShellSummary): ShellResult => ({
  kind: "shell",
  shellId: shell.shellId,
  pid: shell.pid,
  cwd: shell.cwd,
  workspace: world.ws.name,
  project: world.project.path,
});

async function expectNoAlert(page: PointerPage, when: string) {
  expected({
    what: `alerts in "Create shell" ${when}`,
    expected: 0,
    found: await dialog(page).getByRole("alert").count(),
  });
}

export const importLinked = defineCheck(import.meta.url, {
  id: "S3.import-linked",
  title: "importing a linked worktree adds its repository once and shows no worktree under it",
  needs: {},
  verifies: ["projects/FR-12", "projects/FR-13", "worktrees/FR-29", "workspaces/FR-25"],
  run: async (ctx) => {
    const { page, setup, ws, git } = await s3Page(ctx);
    await ctx.trail.stage("import linked", async () => {
      expected({
        what: "the refusal of importing the linked worktree",
        expected: null,
        found: await addProject(page, { import: git.linked }),
      });
      await waitFor(page.getByText("Added the project of this worktree"), "the import notice");
      await waitFor(page.locator(`[data-project="${git.repo}"]`), "the repository's project row");
      expected({
        what: "project rows of the linked worktree, and worktree nodes in the repository",
        expected: { linked: 0, worktrees: 0 },
        found: {
          linked: await page.locator(`[data-project="${git.linked}"]`).count(),
          worktrees: await worktreeNodes(page, git.repo).count(),
        },
      });
    });
    await ctx.trail.stage("duplicate add", async () => {
      await setup.project(ws, { kind: "folder", path: git.repo });
      expected({
        what: "the workspace's projects after adding the repository again over the API",
        expected: [git.repo],
        found: await Effect.runPromise(projectPaths(setup.client, ws.name)),
      });
      expected({
        what: "project rows of the repository",
        expected: 1,
        found: await page.locator(`[data-project="${git.repo}"]`).count(),
      });
    });
  },
});

export const existingPrimary = defineCheck(import.meta.url, {
  id: "S3.existing-primary",
  title: "Existing in the primary worktree is the default, and is remembered for the next shell",
  needs: {},
  // One start in the primary checks its default, the list and its label; the repeat, that it stays.
  verifies: [
    "worktrees/FR-2",
    "worktrees/FR-3",
    "worktrees/FR-4",
    "worktrees/FR-7",
    "workspaces/FR-25",
  ],
  run: async (ctx) => {
    const { page, setup, git } = await repoWorld(ctx);
    await ctx.trail.stage("primary default", async () => {
      await openModal(page, git.repo, { script: "Plain shell" });
      expected({
        what: "the preselected worktree choice",
        expected: { mode: "Existing", startIn: git.repo },
        found: { mode: await mode(page), startIn: await selectedKey(page, "Start in") },
      });
      expected({
        what: '"Start in" items',
        expected: [
          [git.repo, "branch", "main", ""],
          [git.detached, "worktree", git.otherHead.slice(0, 7), "detached worktree"],
          [git.linked, "worktree", "linked", "linked worktree"],
          [git.wkt, "worktree", "wkt-new", "wkt worktree"],
        ],
        found: await dropdownItems(page, "Start in"),
      });
      await expectStarted(page, "the primary start");
      const started = sole(
        await runningIn(setup.shells.lists, git.repo, 1),
        `running shells in ${git.repo}`,
      );
      await waitFor(
        worktreeNodeLabel(page, git.repo).filter({ hasText: /^primary · main$/ }),
        "the primary node labelled primary · main",
      );
      await waitFor(
        worktreeNode(page, git.repo).locator(`[data-shell-id="${started.shellId}"]`),
        "the shell under the primary node",
      );
    });
    await ctx.trail.stage("primary remembered", async () => {
      await openModal(page, git.repo);
      expected({
        what: '"Start in" after a start in the primary',
        expected: git.repo,
        found: await selectedKey(page, "Start in"),
      });
      await expectStarted(page, "the second primary start");
      await runningIn(setup.shells.lists, git.repo, 2);
    });
  },
});

export const branchRelabel = defineCheck(import.meta.url, {
  id: "S3.branch-relabel",
  title: "a branch switch in a shell relabels its worktree node and keeps its shells under it",
  needs: {},
  verifies: ["worktrees/FR-31", "worktrees/FR-6", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, git } = world;
    const shellA = sole(
      await startExisting(world, git.repo, 1, "Plain shell"),
      `running shells in ${git.repo}`,
    );
    const shellB = sole(
      (await startExisting(world, git.repo, 2, "Plain shell")).filter(
        (shell) => shell.shellId !== shellA.shellId,
      ),
      `the second shell in ${git.repo}`,
    );
    await ctx.trail.stage("branch relabel", async () => {
      await shellRow(page, shellA.shellId).click();
      await waitFor(tabs(page).filter({ hasText: /^Shell 1 · repo$/ }), "the tab Shell 1 · repo");
      await typeLine(page, "git switch -q other");
      await waitFor(
        worktreeNodeLabel(page, git.repo).filter({ hasText: /^primary · other$/ }),
        "the primary node relabelled primary · other",
      );
      for (const shell of [shellA, shellB]) {
        await waitFor(
          worktreeNode(page, git.repo).locator(`[data-shell-id="${shell.shellId}"]`),
          `shell ${shell.shellId} under the primary node`,
        );
      }
      expected({
        what: "shells under the primary node after the switch",
        expected: 2,
        found: await worktreeNode(page, git.repo).locator("[data-shell-id]").count(),
      });
    });
  },
});

export const leaveWorktree = defineCheck(import.meta.url, {
  id: "S3.leave-worktree",
  title: "a shell that leaves its worktree is marked and stays under its node, and unmarked back",
  needs: {},
  // One cd out of the worktree, into a folder the scenario owns.
  verifies: ["worktrees/FR-32", "worktrees/FR-33", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, setup, git } = world;
    const shell = sole(
      await startExisting(world, git.repo, 1, "Plain shell"),
      `running shells in ${git.repo}`,
    );
    const elsewhere = await setup.folder("elsewhere");
    await ctx.trail.stage("leave and return", async () => {
      await waitFor(shellTab(page, shell.shellId), "the shell's tab");
      await typeLine(page, `cd ${elsewhere.path}`);
      await waitFor(
        shellRow(page, shell.shellId).locator(`[data-elsewhere="${elsewhere.path}"]`),
        "the shell row marked as elsewhere",
      );
      expected({
        what: "the shell's rows under the primary node after it left",
        expected: 1,
        found: await worktreeNode(page, git.repo)
          .locator(`[data-shell-id="${shell.shellId}"]`)
          .count(),
      });
      await typeLine(page, `cd ${git.repo}`);
      await waitFor(
        shellRow(page, shell.shellId).locator("[data-elsewhere]"),
        "the elsewhere mark to go once the shell is back",
        { state: "detached" },
      );
    });
  },
});

export const noWorktreeChoice = defineCheck(import.meta.url, {
  id: "S3.no-worktree-choice",
  title: "a plain project has no worktree choice, and a repository with no commit cannot fork",
  needs: {},
  // Two projects without a forkable checkout, each opened and started once.
  verifies: ["worktrees/FR-26", "worktrees/FR-27", "worktrees/FR-28", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx, { extras: ["plain", "empty"] });
    const { page, setup } = world;
    const plain = extra(world, "plain");
    const empty = extra(world, "empty");
    await ctx.trail.stage("plain project", async () => {
      await openModal(page, plain.path);
      expected({
        what: "worktree switches for a plain project",
        expected: 0,
        found: await modeSwitch(page).count(),
      });
      await expectStarted(page, "the plain start");
      const started = sole(
        await runningIn(setup.shells.lists, plain.path, 1),
        `running shells in ${plain.path}`,
      );
      await waitFor(
        page.locator(`[data-project="${plain.path}"] [data-shell-id="${started.shellId}"]`),
        "the plain project's shell row",
      );
      expected({
        what: "worktree nodes in the plain project",
        expected: 0,
        found: await worktreeNodes(page, plain.path).count(),
      });
    });
    await ctx.trail.stage("no commit", async () => {
      await openModal(page, empty.path);
      expected({
        what: "whether Fork is disabled with no commit",
        expected: true,
        found: await modeButton(page, "Fork").isDisabled(),
      });
      await expectStarted(page, "the start with no commit");
      await runningIn(setup.shells.lists, empty.path, 1);
    });
  },
});

export const existingLinked = defineCheck(import.meta.url, {
  id: "S3.existing-linked",
  title: "a linked worktree starts shells under its node and is remembered",
  needs: {},
  // A start in the linked worktree, then the repeat its remembered choice preselects.
  verifies: ["worktrees/FR-5", "worktrees/FR-6", "worktrees/FR-7", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, setup, git } = world;
    await ctx.trail.stage("linked start", async () => {
      await startExisting(world, git.linked, 1);
      await waitFor(
        worktreeNodeLabel(page, git.linked).filter({ hasText: /^linked$/ }),
        "the linked node labelled linked",
      );
    });
    await ctx.trail.stage("linked remembered", async () => {
      await openModal(page, git.repo);
      expected({
        what: '"Start in" after a start in the linked worktree',
        expected: git.linked,
        found: await selectedKey(page, "Start in"),
      });
      await expectStarted(page, "the second linked start");
      const started = await runningIn(setup.shells.lists, git.linked, 2);
      for (const shell of started) {
        await waitFor(
          worktreeNode(page, git.linked).locator(`[data-shell-id="${shell.shellId}"]`),
          `shell ${shell.shellId} under the linked node`,
        );
      }
      expected({
        what: "shells under the linked node",
        expected: 2,
        found: await worktreeNode(page, git.linked).locator("[data-shell-id]").count(),
      });
    });
  },
});

export const forkBranch = defineCheck(import.meta.url, {
  id: "S3.fork-branch",
  title: "a fork from a branch is named as the modal showed, opens a tab and is logged",
  needs: {},
  // The origins list, then the one fork it starts and that fork's log line.
  verifies: [
    "worktrees/FR-1",
    "worktrees/FR-9",
    "worktrees/FR-10",
    "worktrees/FR-11",
    "worktrees/FR-12",
    "worktrees/FR-14",
    "worktrees/FR-15",
    "workspaces/FR-25",
  ],
  run: async (ctx) => {
    const { page, frames, setup, git } = await repoWorld(ctx);
    const tabsBefore = await ctx.trail.stage("fork origins", async () => {
      // The open modal hides the page behind it, so tabs are counted before it opens.
      const counted = await tabs(page).count();
      await openModal(page, git.repo);
      await modeButton(page, "Fork").click();
      expected({
        what: 'the default "Fork from"',
        expected: "branch:main",
        found: await selectedKey(page, "Fork from"),
      });
      expected({
        what: '"Fork from" items',
        expected: [
          [`worktree:${git.detached}`, "worktree", git.otherHead.slice(0, 7), "detached worktree"],
          [`worktree:${git.linked}`, "worktree", "linked", "linked worktree"],
          [`worktree:${git.wkt}`, "worktree", "wkt-new", "wkt worktree"],
          ["branch:wkt", "worktree", "wkt", "wkt worktree"],
          ["branch:main", "branch", "main (current)", ""],
          ["branch:doomed", "branch", "doomed", ""],
          ["branch:doomed2", "branch", "doomed2", ""],
          ["branch:other", "branch", "other", ""],
        ],
        found: await dropdownItems(page, "Fork from"),
      });
      return counted;
    });
    await ctx.trail.stage("fork and log", async () => {
      await pickItem(page, "Fork from", "branch:other");
      const name = await proposedName(page);
      const framesBefore = frames.mark();
      await expectStarted(page, "the fork");
      const path = NodePath.join(git.forks, name);
      const shell = sole(await runningIn(setup.shells.lists, path, 1), `running shells in ${path}`);
      await frames.until(
        "the mock CLI banner",
        (frame) => frame.includes(MOCK_AGENT_LINES.banner),
        framesBefore,
      );
      expected({
        what: "the fork's branch and commit",
        expected: { branch: name, head: git.otherHead },
        found: {
          branch: await gitOk(path, "branch", "--show-current"),
          head: await gitOk(git.repo, "rev-parse", name),
        },
      });
      await waitFor(shellTab(page, shell.shellId), "the fork's tab");
      expected({
        what: "tabs after the fork",
        expected: tabsBefore + 1,
        found: await tabs(page).count(),
      });
      await waitFor(
        worktreeNodeLabel(page, path).filter({ hasText: name }),
        "the fork's node label",
      );
      await expectLogged(
        ctx.server,
        "The log has no start line with the worktree and branch.",
        (line) =>
          line.includes("shell started") &&
          line.includes(shell.shellId) &&
          line.includes(path) &&
          // Once in the worktree path and once as the branch.
          line.split(name).length >= 3,
      );
    });
  },
});

export const forkRemembered = defineCheck(import.meta.url, {
  id: "S3.fork-remembered",
  title: "a fork is remembered, and one click makes another, differently named one",
  needs: {},
  // The repeat the remembered fork preselects is the one-click fork.
  verifies: ["worktrees/FR-7", "worktrees/FR-16", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, setup, git } = world;
    const first = await forkFromModal(world, "branch:other");
    await ctx.trail.stage("one-click fork", async () => {
      await openModal(page, git.repo);
      expected({
        what: "the preselected choice after a fork from other",
        expected: { mode: "Fork", from: "branch:other" },
        found: { mode: await mode(page), from: await selectedKey(page, "Fork from") },
      });
      const name = await proposedName(page);
      expected({
        what: "the second fork's name next to the first",
        expected: "a different name",
        found: name !== first.name ? "a different name" : name,
      });
      await expectStarted(page, "the repeated fork");
      await runningIn(setup.shells.lists, NodePath.join(git.forks, name), 1);
    });
  },
});

export const cancelKeepsChoice = defineCheck(import.meta.url, {
  id: "S3.cancel-keeps-choice",
  title: "closing the modal after choosing changes nothing and keeps the remembered choice",
  needs: {},
  verifies: ["worktrees/FR-19", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, git } = world;
    await forkFromModal(world, "branch:main");
    await ctx.trail.stage("cancel keeps choice", async () => {
      const before = await gitState(git);
      await openModal(page, git.repo);
      const offered = await proposedName(page);
      await modeButton(page, "Existing").click();
      await cancelModal(page);
      expected({
        what: "the repository after closing the modal",
        expected: { ...before, offeredFolder: false },
        found: {
          ...(await gitState(git)),
          offeredFolder: await exists(NodePath.join(git.forks, offered)),
        },
      });
      await openModal(page, git.repo);
      expected({
        what: "the remembered mode after closing",
        expected: "Fork",
        found: await mode(page),
      });
      await cancelModal(page);
    });
  },
});

export const choicePerProject = defineCheck(import.meta.url, {
  id: "S3.choice-per-project",
  title: "another git project does not get this project's remembered choice",
  needs: {},
  verifies: ["worktrees/FR-8", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx, { extras: ["second"] });
    const { page } = world;
    const second = extra(world, "second");
    await forkFromModal(world, "branch:main");
    await ctx.trail.stage("other project default", async () => {
      await openModal(page, second.path);
      expected({
        what: "the other project's preselected choice",
        expected: { mode: "Existing", startIn: second.path },
        found: { mode: await mode(page), startIn: await selectedKey(page, "Start in") },
      });
      await cancelModal(page);
    });
  },
});

export const forkDetached = defineCheck(import.meta.url, {
  id: "S3.fork-detached",
  title: "a fork from a detached worktree starts at its commit",
  needs: {},
  verifies: ["worktrees/FR-13", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { git } = world;
    await ctx.trail.stage("fork detached", async () => {
      const fork = await forkFromModal(world, `worktree:${git.detached}`);
      expected({
        what: "the commit of the fork from the detached worktree",
        expected: git.otherHead,
        found: await gitOk(git.repo, "rev-parse", fork.name),
      });
    });
  },
});

export const originGoneFallback = defineCheck(import.meta.url, {
  id: "S3.origin-gone-fallback",
  title: "a remembered origin that is gone falls back to the current branch",
  needs: {},
  verifies: ["worktrees/FR-20", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, git } = world;
    await forkFromModal(world, `worktree:${git.detached}`);
    await ctx.trail.stage("origin gone", async () => {
      await gitOk(git.repo, "worktree", "remove", "--force", git.detached);
      await openModal(page, git.repo);
      expected({
        what: "the preselected choice once the remembered origin is gone",
        expected: { mode: "Fork", from: "branch:main" },
        found: { mode: await mode(page), from: await selectedKey(page, "Fork from") },
      });
      await expectNoAlert(page, "with the origin gone");
    });
  },
});

export const originDeleted = defineCheck(import.meta.url, {
  id: "S3.origin-deleted",
  title: "an origin deleted before the click fails cleanly, is not remembered, and a retry works",
  needs: {},
  // One refused fork: what it leaves, what it starts and what it remembers.
  verifies: ["worktrees/FR-22", "worktrees/FR-23", "worktrees/FR-24", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, setup, git, project } = world;
    await forkFromModal(world, "branch:main");
    await ctx.trail.stage("refused fork", async () => {
      await openModal(page, git.repo);
      await pickItem(page, "Fork from", "branch:doomed");
      const offered = await proposedName(page);
      await gitOk(git.repo, "branch", "-D", "doomed");
      const before = await gitState(git);
      const projectShells = () =>
        shellsOf(setup.shells.current(), [project]).map(({ shellId }) => shellId);
      const shellIds = projectShells();
      expected({
        what: "whether the refusal names the deleted origin",
        expected: true,
        found: names(await startFromModal(page), "doomed"),
      });
      expected({
        what: "the repository after the refused fork",
        expected: { ...before, offeredFolder: false },
        found: {
          ...(await gitState(git)),
          offeredFolder: await exists(NodePath.join(git.forks, offered)),
        },
      });
      await cancelModal(page);
      expected({
        what: "the project's shells after the refused fork",
        expected: shellIds,
        found: projectShells(),
      });
    });
    await ctx.trail.stage("not remembered and retry", async () => {
      await openModal(page, git.repo);
      expected({
        what: "the preselected choice after a refused fork",
        expected: { mode: "Fork", from: "branch:main" },
        found: { mode: await mode(page), from: await selectedKey(page, "Fork from") },
      });
      await pickItem(page, "Fork from", "branch:doomed2");
      await gitOk(git.repo, "branch", "-D", "doomed2");
      expected({
        what: "whether the second refusal names its deleted origin",
        expected: true,
        found: names(await startFromModal(page), "doomed2"),
      });
      await pickItem(page, "Fork from", "branch:main");
      const name = await proposedName(page);
      await expectStarted(page, "the retry after a refused fork");
      await runningIn(setup.shells.lists, NodePath.join(git.forks, name), 1);
    });
  },
});

export const endedWorktree = defineCheck(import.meta.url, {
  id: "S3.ended-worktree",
  title: "a worktree whose shells ended leaves the tree, and a removed one is not preselected",
  needs: {},
  // The linked worktree's shells end, then the worktree itself goes.
  verifies: ["worktrees/FR-29", "worktrees/FR-30", "worktrees/FR-21", "workspaces/FR-25"],
  run: async (ctx) => {
    const world = await repoWorld(ctx);
    const { page, setup, git } = world;
    await startExisting(world, git.linked, 1);
    const linkedShells = await startExisting(world, git.linked, 2);
    const again = await ctx.trail.stage("ended worktree offered", async () => {
      for (const shell of linkedShells) await setup.killShell(asShell(world, shell));
      await waitFor(worktreeNode(page, git.linked), "the linked node to leave the tree", {
        state: "detached",
      });
      await openModal(page, git.repo);
      await modeButton(page, "Existing").click();
      expected({
        what: "whether a worktree without shells is offered",
        expected: true,
        found: (await dropdownItems(page, "Start in")).some(([key]) => key === git.linked),
      });
      await pickItem(page, "Start in", git.linked);
      await expectStarted(page, "the start in the freed worktree");
      return sole(
        await runningIn(setup.shells.lists, git.linked, 1),
        `running shells in ${git.linked}`,
      );
    });
    await ctx.trail.stage("removed worktree fallback", async () => {
      await setup.killShell(asShell(world, again));
      await gitOk(git.repo, "worktree", "remove", "--force", git.linked);
      await openModal(page, git.repo);
      expected({
        what: "the preselected choice once the remembered worktree is removed",
        expected: { mode: "Existing", startIn: git.repo },
        found: { mode: await mode(page), startIn: await selectedKey(page, "Start in") },
      });
      await expectNoAlert(page, "with the remembered worktree removed");
    });
  },
});

export const forkDoubleClick = defineCheck(import.meta.url, {
  id: "S3.fork-double-click",
  title: "a second click while a fork runs is ignored, and the modal says what it creates",
  needs: {},
  verifies: ["worktrees/FR-17", "worktrees/FR-18", "workspaces/FR-25"],
  run: async (ctx) => {
    const { page, setup, git } = await repoWorld(ctx, { holdForks: true });
    await ctx.trail.stage("double click", async () => {
      const worktreeCount = async () =>
        (await gitOk(git.repo, "worktree", "list")).split("\n").length;
      await openModal(page, git.repo);
      await modeButton(page, "Fork").click();
      await pickItem(page, "Fork from", "branch:main");
      const held = await proposedName(page);
      const before = await worktreeCount();
      await NodeFSP.writeFile(git.hold, "");
      ctx.onStepEnd("the held fork", () => NodeFSP.writeFile(git.release, ""));
      await startButton(page).dblclick();
      await waitFor(dialog(page).getByText(`Creating ${held}…`), "the modal's creating line");
      expected({
        what: "whether the up-arrow is disabled while forking",
        expected: true,
        found: await startButton(page).isDisabled(),
      });
      await NodeFSP.writeFile(git.release, "");
      await waitFor(dialog(page), '"Create shell" to close after the fork', { state: "detached" });
      await runningIn(setup.shells.lists, NodePath.join(git.forks, held), 1);
      expected({
        what: "worktrees the double click added",
        expected: 1,
        found: (await worktreeCount()) - before,
      });
    });
  },
});

export const unstartableInWorktree = defineCheck(import.meta.url, {
  id: "S3.unstartable-in-worktree",
  title: "a fork whose shell cannot start keeps its worktree, which is offered again",
  needs: { serverWide: "adds a starting script" },
  verifies: [
    "worktrees/FR-25",
    "starting-scripts/FR-18",
    "starting-scripts/FR-20",
    "workspaces/FR-25",
  ],
  run: async (ctx) => {
    await addStartingScript(ctx.server.home, {
      id: "unstartable",
      name: "unstartable",
      command: "no-such-agent-cli --start",
    });
    const world = await repoWorld(ctx);
    const { page, setup, git } = world;
    await forkFromModal(world, "branch:main");
    await ctx.trail.stage("unstartable keeps worktree", async () => {
      await openModal(page, git.repo, { script: "unstartable" });
      expected({ what: "the preselected mode", expected: "Fork", found: await mode(page) });
      const kept = await proposedName(page);
      const keptPath = NodePath.join(git.forks, kept);
      expected({
        what: "whether the refusal names the missing program",
        expected: true,
        found: names(await startFromModal(page), "no-such-agent-cli"),
      });
      expected({
        what: "the made branch and folder after the refused start",
        expected: { branch: true, folder: true },
        found: {
          branch: (await gitOk(git.repo, "branch", "--list", kept)).length > 0,
          folder: await exists(keptPath),
        },
      });
      await cancelModal(page);
      await openModal(page, git.repo);
      expected({
        what: "the mode after a refused start",
        expected: "Fork",
        found: await mode(page),
      });
      await modeButton(page, "Existing").click();
      expected({
        what: "whether the kept worktree is offered",
        expected: true,
        found: (await dropdownItems(page, "Start in")).some(([key]) => key === keptPath),
      });
      await cancelModal(page);
      expected({
        what: "shells in the kept worktree",
        expected: [],
        found: setup.shells
          .current()
          .filter((shell) => shell.cwd === keptPath)
          .map(({ shellId }) => shellId),
      });
    });
  },
});

export const successors = [
  importLinked,
  existingPrimary,
  branchRelabel,
  leaveWorktree,
  noWorktreeChoice,
  existingLinked,
  forkBranch,
  forkRemembered,
  cancelKeepsChoice,
  choicePerProject,
  forkDetached,
  originGoneFallback,
  originDeleted,
  endedWorktree,
  forkDoubleClick,
  unstartableInWorktree,
];
