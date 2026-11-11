// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures in the throwaway home.

import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { StartingScriptChoice, WorkspaceStartingPoint } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { PointerPage } from "../browser.ts";
import type { ScenarioContext } from "../scenario.ts";
import type { ServerHandle } from "../server.ts";
import { call, connectApi, serverToken, type WsClient } from "./api.ts";
import { gitOk } from "./files.ts";
import { openTab, showWorkspace, type ShownPage } from "./navigate.ts";
import { followShells, shellEnded, type ShellFollower } from "./shells.ts";
import { createTrail, type Trail } from "./trail.ts";
import { addProject } from "./ui/addProject.ts";
import { createWorkspace } from "./ui/workspacesMenu.ts";
import { pageFrames } from "./network.ts";
import { check, follow, recorder } from "./waits.ts";

/** The names of the server's saved workspaces, sorted. */
export const workspaceNames = (client: WsClient) =>
  client.subscribeWorkspaces({}).pipe(
    Stream.runHead,
    Effect.map((first) =>
      Option.match(first, {
        onNone: () => [],
        onSome: ({ workspaces }) => workspaces.map(({ name }) => name).toSorted(),
      }),
    ),
  );

/** Follows the names of the server's saved workspaces over `client`, each list sorted. */
export function followWorkspaces(client: WsClient) {
  const names = recorder<ReadonlyArray<string>>("workspace names");
  follow(client.subscribeWorkspaces({}), ({ workspaces }) =>
    names.push(workspaces.map(({ name }) => name).toSorted()),
  );
  return names;
}

/** The project paths of the saved workspace `name`. */
export const projectPaths = (client: WsClient, name: string) =>
  client["workspace.open"]({ name }).pipe(
    Effect.map((detail) => detail.projects.map(({ path }) => path)),
  );

/** Creates the workspace `name` in the UI and adds `folders` to it. */
export async function setUp(page: PointerPage, folders: ReadonlyArray<string>, name = "sparta") {
  await page.setViewportSize({ width: 1200, height: 800 });
  await createWorkspace(page, name);
  for (const folder of folders) {
    check((await addProject(page, { import: folder })) === null, `Adding ${folder} failed.`);
  }
}

/** The harness's seeded "mock agent" starting script, as a start asks for it. */
export async function mockAgent(client: WsClient): Promise<StartingScriptChoice> {
  const { scripts } = await Effect.runPromise(client["startingScripts.list"]({}));
  const script = scripts.find((entry) => entry.name === "mock agent");
  check(script !== undefined, "The server lists no mock agent starting script.");
  return { id: script.id, name: script.name };
}

export interface FolderResult {
  readonly kind: "folder";
  readonly path: string;
}

export interface RepoResult {
  readonly kind: "repo";
  readonly path: string;
  readonly linked: ReadonlyArray<{ readonly path: string; readonly branch: string }>;
}

export interface WorkspaceResult {
  readonly kind: "workspace";
  readonly name: string;
}

export interface ProjectResult {
  readonly kind: "project";
  readonly workspace: string;
  /** The project's path as the server stores it. */
  readonly path: string;
  readonly isGit: boolean;
  /** The imported linked worktree when its repository was added instead. */
  readonly resolvedFrom: string | null;
}

export interface ShellResult {
  readonly kind: "shell";
  readonly shellId: string;
  readonly pid: number | null;
  readonly cwd: string;
  readonly workspace: string;
  readonly project: string;
}

export interface WorldResult {
  readonly kind: "world";
  readonly workspace: WorkspaceResult;
  readonly projects: ReadonlyArray<ProjectResult>;
  readonly shells: ReadonlyArray<ShellResult>;
  readonly setup: Setup;
  readonly shown?: ShownPage;
}

/**
 * A running shell whose tab was closed on a page that still shows its workspace: its row stays in
 * the tree. The step that made it closes its setup connection when it ends, so a step that takes
 * it connects again as `shown.page`.
 */
export interface ClosedTabShellResult {
  readonly kind: "closedTabShell";
  readonly shell: ShellResult;
  readonly shown: ShownPage;
}

/** Every value a setup step returns, by its `kind`. */
export interface SetupResults {
  readonly folder: FolderResult;
  readonly repo: RepoResult;
  readonly workspace: WorkspaceResult;
  readonly project: ProjectResult;
  readonly shell: ShellResult;
  readonly world: WorldResult;
  readonly page: ShownPage;
  readonly closedTabShell: ClosedTabShellResult;
}

/**
 * Where a shell starts in a git project; absent is the project's own checkout. A fork gets a
 * random name of the form the server accepts (`probe-worktree-<6 hex>`).
 */
export type ShellWorktree =
  | { readonly fork: { readonly from: WorkspaceStartingPoint } }
  | { readonly existing: string };

export interface ShellOptions {
  readonly worktree?: ShellWorktree;
  /** Absent for a plain shell. */
  readonly script?: StartingScriptChoice;
  readonly cols?: number;
  readonly rows?: number;
  /** Waits for the shell's first prompt, so nothing typed reaches it before; on by default. */
  readonly ready?: boolean;
}

/** What setup reads from a scenario's context; a sandbox fixture builds one of its own. */
export type SetupContext = Pick<ScenarioContext, "server" | "runId" | "trail"> &
  Partial<Pick<ScenarioContext, "onStepEnd">>;

const counters = new WeakMap<Trail, number>();

/** The next number on this trail, so a setup run twice under one `runId` names nothing twice. */
function nextSeq(trail: Trail): number {
  const seq = (counters.get(trail) ?? 0) + 1;
  counters.set(trail, seq);
  return seq;
}

// Annotated: the inferred type is too large to export.
export interface Setup {
  readonly client: WsClient;
  /** The server's shell list, followed for as long as the connection is open. */
  readonly shells: ShellFollower;
  readonly folder: (label?: string) => Promise<FolderResult>;
  readonly repo: (options?: {
    readonly label?: string | undefined;
    readonly linkedWorktree?: boolean | undefined;
  }) => Promise<RepoResult>;
  /** A workspace named `<label>-<runId>-<seq>`, or exactly `label` with `exact`. */
  readonly workspace: (
    label?: string,
    options?: { readonly exact?: boolean },
  ) => Promise<WorkspaceResult>;
  readonly project: (
    ws: WorkspaceResult,
    from: FolderResult | RepoResult,
  ) => Promise<ProjectResult>;
  readonly shell: (project: ProjectResult, options?: ShellOptions) => Promise<ShellResult>;
  /** Kills the shell over the API and waits for the server's end event. */
  readonly killShell: (shell: ShellResult) => Promise<void>;
  readonly removeProject: (project: ProjectResult) => Promise<void>;
  readonly removeWorkspace: (ws: WorkspaceResult) => Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * Setup over the server API, signed in as `as` (its cookie) or with the server's bearer token.
 * The connection closes when the scenario's step ends, or with `close`.
 */
export async function setupOn(
  ctx: SetupContext,
  { as }: { readonly as?: PointerPage } = {},
): Promise<Setup> {
  const { server, runId, trail } = ctx;
  const rpc = await connectApi(server, as ?? { bearerToken: await serverToken(server) });
  const client = rpc.client;
  const shells = followShells(client);
  ctx.onStepEnd?.("the setup connection", rpc.close);

  const named = (label: string) => `${label}-${runId}-${nextSeq(trail)}`;
  const folderPath = async (label: string) => {
    const path = NodePath.join(server.home, "folders", runId, `${label}-${nextSeq(trail)}`);
    await NodeFSP.mkdir(path, { recursive: true });
    return path;
  };

  const folder = async (label = "folder"): Promise<FolderResult> => {
    const path = await folderPath(label);
    trail.note({ call: "folder", asked: { label }, got: { path } });
    return { kind: "folder", path };
  };

  const repo = async ({
    label = "repo",
    linkedWorktree = false,
  }: {
    readonly label?: string | undefined;
    readonly linkedWorktree?: boolean | undefined;
  } = {}): Promise<RepoResult> => {
    const path = await folderPath(label);
    await gitOk(path, "init", "-q", "-b", "main");
    await gitOk(path, "commit", "-q", "--allow-empty", "-m", "first");
    const linked: Array<{ path: string; branch: string }> = [];
    if (linkedWorktree) {
      const branch = "topic";
      const linkedPath = `${path}-linked`;
      await gitOk(path, "worktree", "add", "-q", "-b", branch, linkedPath);
      linked.push({ path: linkedPath, branch });
    }
    trail.note({ call: "repo", asked: { label, linkedWorktree }, got: { path, linked } });
    return { kind: "repo", path, linked };
  };

  const workspace = async (
    label = "ws",
    { exact = false }: { readonly exact?: boolean } = {},
  ): Promise<WorkspaceResult> => {
    const name = exact ? label : named(label);
    await call(trail, "workspace.create", { name }, client["workspace.create"]({ name }));
    return { kind: "workspace", name };
  };

  const project = async (
    ws: WorkspaceResult,
    from: FolderResult | RepoResult,
  ): Promise<ProjectResult> => {
    const asked = { mode: "import", name: ws.name, path: from.path } as const;
    const added = await call(
      trail,
      "workspace.addProject",
      asked,
      client["workspace.addProject"](asked),
    );
    const stored = added.workspace.projects.find((entry) => entry.path === added.project);
    return {
      kind: "project",
      workspace: ws.name,
      path: added.project,
      isGit: stored?.isGitRepository ?? false,
      resolvedFrom: added.resolvedFrom,
    };
  };

  const shell = async (
    of: ProjectResult,
    { worktree, script, cols = 120, rows = 30, ready = true }: ShellOptions = {},
  ): Promise<ShellResult> => {
    const asked = {
      name: of.workspace,
      project: of.path,
      ...(worktree !== undefined
        ? {
            worktree:
              "fork" in worktree
                ? {
                    kind: "new" as const,
                    name: `probe-worktree-${NodeCrypto.randomBytes(3).toString("hex")}`,
                    startingPoint: worktree.fork.from,
                  }
                : { kind: "existing" as const, path: worktree.existing },
          }
        : of.isGit
          ? { worktree: { kind: "checkout" as const } }
          : {}),
      ...(script === undefined ? {} : { script }),
      cols,
      rows,
    };
    const started = await call(
      trail,
      "workspace.startShell",
      asked,
      client["workspace.startShell"](asked),
    );
    if (ready) {
      await shells.lists.until(
        `the first prompt of shell ${started.shellId}`,
        (list) => list.some((entry) => entry.shellId === started.shellId && entry.promptReady),
        0,
      );
    }
    return {
      kind: "shell",
      shellId: started.shellId,
      pid: started.pid,
      cwd: started.cwd,
      workspace: of.workspace,
      project: of.path,
    };
  };

  const killShell = async (of: ShellResult) => {
    const asked = { shellId: of.shellId };
    await call(trail, "shell.kill", asked, client["shell.kill"](asked));
    await shellEnded(shells, of);
  };

  const removeProject = async (of: ProjectResult) => {
    const asked = { name: of.workspace, project: of.path };
    await call(trail, "workspace.removeProject", asked, client["workspace.removeProject"](asked));
  };

  const removeWorkspace = async (ws: WorkspaceResult) => {
    const asked = { name: ws.name };
    await call(trail, "workspace.remove", asked, client["workspace.remove"](asked));
  };

  return {
    client,
    shells,
    folder,
    repo,
    workspace,
    project,
    shell,
    killShell,
    removeProject,
    removeWorkspace,
    close: rpc.close,
  };
}

export interface WorldSpec {
  readonly workspace?: string;
  readonly projects: ReadonlyArray<{
    readonly kind: "repo" | "folder";
    readonly label?: string;
    readonly linkedWorktree?: boolean;
  }>;
  readonly shells?: ReadonlyArray<
    { readonly project: number; readonly count?: number } & Omit<ShellOptions, "ready">
  >;
  /** Opens a signed-in page, sets up as it, and shows the workspace on it last. */
  readonly page?: true;
}

/** A workspace with its projects and shells, made over the API; the page, when asked, shows it last. */
export async function world(
  ctx: SetupContext & Pick<ScenarioContext, "openPage">,
  spec: WorldSpec,
): Promise<WorldResult> {
  const page = spec.page ? await ctx.openPage() : undefined;
  const setup = await setupOn(ctx, page === undefined ? {} : { as: page });
  const ws = await setup.workspace(spec.workspace);
  const projects: Array<ProjectResult> = [];
  for (const entry of spec.projects) {
    const made =
      entry.kind === "repo"
        ? await setup.repo({ label: entry.label, linkedWorktree: entry.linkedWorktree })
        : await setup.folder(entry.label);
    projects.push(await setup.project(ws, made));
  }
  const shells: Array<ShellResult> = [];
  for (const { project: index, count = 1, ...options } of spec.shells ?? []) {
    const of = projects[index];
    check(of !== undefined, `The world has no project ${index}.`);
    for (let n = 0; n < count; n++) shells.push(await setup.shell(of, options));
  }
  const shown = page === undefined ? undefined : await showWorkspace(page, ws);
  return {
    kind: "world",
    workspace: ws,
    projects,
    shells,
    setup,
    ...(shown === undefined ? {} : { shown }),
  };
}

/** A folder with `git init` and no commit, as a user's new repository is. */
export async function uncommittedRepo(setup: Setup, label = "repo"): Promise<FolderResult> {
  const made = await setup.folder(label);
  await gitOk(made.path, "init", "-q");
  return made;
}

/** A signed-in page whose websocket frames are recorded from its first load, with setup signed in as it. */
export async function framedPage(ctx: SetupContext & Pick<ScenarioContext, "openPage">) {
  const page = await ctx.openPage();
  const frames = pageFrames(page);
  const setup = await setupOn(ctx, { as: page });
  return { page, frames, setup };
}

/** `world` with a page whose websocket frames are recorded from its first load. */
export async function framedWorld(
  ctx: SetupContext & Pick<ScenarioContext, "openPage">,
  spec: Omit<WorldSpec, "page">,
): Promise<
  WorldResult & {
    readonly page: PointerPage;
    readonly frames: ReturnType<typeof pageFrames>;
    readonly shown: ShownPage;
  }
> {
  const page = await ctx.openPage();
  const frames = pageFrames(page);
  const made = await world({ ...ctx, openPage: async () => page }, { ...spec, page: true });
  return { ...made, page, frames, shown: { kind: "page", page, workspace: made.workspace } };
}

/** `framedWorld` with `count` plain shells in one folder, each with its tab opened from the tree. */
export async function plainTabs(
  ctx: SetupContext & Pick<ScenarioContext, "openPage">,
  count: number,
) {
  const made = await framedWorld(ctx, {
    projects: [{ kind: "folder", label: "plain" }],
    shells: [{ project: 0, count }],
  });
  for (const shell of made.shells) await openTab(made.page, shell);
  return made;
}

/**
 * The step input of kind `kind` when one was given, else the value `build` makes; a value of
 * another kind is a wiring error and fails naming both kinds.
 */
export async function given<K extends keyof SetupResults>(
  kind: K,
  value: { readonly kind: string } | undefined,
  build: () => Promise<SetupResults[K]>,
): Promise<SetupResults[K]> {
  if (value === undefined) return build();
  check(value.kind === kind, `This step takes a ${kind}, but it was given a ${value.kind}.`);
  return value as SetupResults[K];
}

/** What a named fixture made; every name and folder in it carries the `runId` it was given. */
export interface FixtureState {
  readonly workspace: string;
  readonly project: string;
  readonly shellIds: ReadonlyArray<string>;
}

type Fixture = (server: ServerHandle, runId: string) => Promise<FixtureState>;

/** A workspace `fixture-<runId>` with one git project and `count` plain shells, made by setup. */
async function gitWorkspace(server: ServerHandle, runId: string, count: number) {
  const setup = await setupOn({ server, runId, trail: createTrail() });
  try {
    const repo = await setup.repo({ label: "project" });
    // PRB.T-037's sandbox prints this exact name.
    const ws = await setup.workspace(`fixture-${runId}`, { exact: true });
    const project = await setup.project(ws, repo);
    const shellIds: Array<string> = [];
    for (let index = 0; index < count; index++) {
      shellIds.push((await setup.shell(project)).shellId);
    }
    return { workspace: ws.name, project: project.path, shellIds };
  } finally {
    await setup.close();
  }
}

/** The fixtures a sandbox can start with (`--fixture <name>`); later stories add theirs here. */
export const sandboxFixtures: Readonly<Record<string, Fixture>> = {
  workspace: (server, runId) => gitWorkspace(server, runId, 0),
  /** The workspace with two running plain shells. */
  shells: (server, runId) => gitWorkspace(server, runId, 2),
};

/** Self-test only, not listed: fails once the server holds part of it, to prove a sandbox cleans up. */
export const selftestFixtures: Readonly<Record<string, Fixture>> = {
  "selftest-fails": async (server, runId) => {
    await gitWorkspace(server, runId, 0);
    throw new Error("the self-test fixture fails after making its workspace");
  },
};
