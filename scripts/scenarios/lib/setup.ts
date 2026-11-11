// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import type { PointerPage } from "../browser.ts";
import type { ServerHandle } from "../server.ts";
import { type WsClient, withClient } from "./api.ts";
import { gitOk } from "./files.ts";
import { issueBearerToken } from "./seam.ts";
import { addProject } from "./ui/addProject.ts";
import { createWorkspace } from "./ui/workspacesMenu.ts";
import { check } from "./waits.ts";

/** Fixtures: a git project with a linked worktree, and a plain folder, in the server's home. */
export async function projects(server: ServerHandle) {
  const folders = NodePath.join(server.home, "folders");
  const repo = NodePath.join(folders, "repo");
  const linked = NodePath.join(folders, "linked");
  const plain = NodePath.join(folders, "plain");
  for (const dir of [repo, plain]) await NodeFSP.mkdir(dir, { recursive: true });
  await gitOk(repo, "init", "-q", "-b", "main");
  await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "first");
  await gitOk(repo, "worktree", "add", "-q", "-b", "topic", linked);
  return { repo, linked, plain };
}

/** Creates the workspace `name` in the UI and adds `folders` to it. */
export async function setUp(page: PointerPage, folders: ReadonlyArray<string>, name = "sparta") {
  await page.setViewportSize({ width: 1200, height: 800 });
  await createWorkspace(page, name);
  for (const folder of folders) {
    check((await addProject(page, { import: folder })) === null, `Adding ${folder} failed.`);
  }
}

/** Creates `name` on the server with one project folder inside that server's own home. */
type SeedError =
  | Effect.Error<ReturnType<WsClient["workspace.create"]>>
  | Effect.Error<ReturnType<WsClient["workspace.addProject"]>>;

// Annotated: the inferred type is too large to export.
export const seedWorkspace: (
  client: WsClient,
  home: string,
  name: string,
) => Effect.Effect<void, SeedError> = Effect.fn("scenarioFixtures.seedWorkspace")(function* (
  client: WsClient,
  home: string,
  name: string,
) {
  const folder = NodePath.join(home, `${name}-project`);
  yield* Effect.promise(() => NodeFSP.mkdir(folder, { recursive: true }));
  yield* client["workspace.create"]({ name });
  yield* client["workspace.addProject"]({ mode: "import", name, path: folder });
});

/** What a named fixture made; every name and folder in it carries the `runId` it was given. */
export interface FixtureState {
  readonly workspace: string;
  readonly project: string;
  readonly shellIds: ReadonlyArray<string>;
}

type Fixture = (server: ServerHandle, runId: string) => Promise<FixtureState>;

/** A workspace `fixture-<runId>` with one git project, made over the server API. */
async function gitWorkspace(server: ServerHandle, runId: string, shells: number) {
  const workspace = `fixture-${runId}`;
  const project = NodePath.join(server.home, "folders", runId, "project");
  await NodeFSP.mkdir(project, { recursive: true });
  await gitOk(project, "init", "-q", "-b", "main");
  await gitOk(project, "commit", "-q", "--allow-empty", "-m", "first");
  const shellIds = await withClient(server.origin, await issueBearerToken(server), (client) =>
    Effect.gen(function* () {
      yield* client["workspace.create"]({ name: workspace });
      yield* client["workspace.addProject"]({ mode: "import", name: workspace, path: project });
      const started: Array<string> = [];
      for (let index = 0; index < shells; index++) {
        const shell = yield* client["workspace.startShell"]({
          name: workspace,
          project,
          worktree: { kind: "checkout" },
          cols: 120,
          rows: 30,
        });
        started.push(shell.shellId);
      }
      return started;
    }),
  );
  return { workspace, project, shellIds };
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
