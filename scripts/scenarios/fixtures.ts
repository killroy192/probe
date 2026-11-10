// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures in the throwaway home and reads the process's user.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import * as Effect from "effect/Effect";

import type { PointerPage } from "./browser.ts";
import { connectRpc, type WsClient } from "./rpc.ts";
import { issueBearerToken } from "./seam.ts";
import type { ServerEnv, ServerHandle } from "./server.ts";
import { check } from "./support.ts";
import { addProject, createWorkspace, gitOk, reloadShowing } from "./scenarios/workspaceUi.ts";

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

/** Creates the workspace "sparta" in the UI and adds `folders` to it. */
export async function setUp(page: PointerPage, folders: ReadonlyArray<string>) {
  await page.setViewportSize({ width: 1200, height: 800 });
  await createWorkspace(page, "sparta");
  for (const folder of folders) {
    check((await addProject(page, { import: folder })) === null, `Adding ${folder} failed.`);
  }
}

export type RpcConnection = Awaited<ReturnType<typeof connectRpc>>;

/** Restarts the server (a real restart), reloads the page onto "sparta" and connects again. */
export async function restartAndReload(
  page: PointerPage,
  server: ServerHandle,
  rpc: RpcConnection,
  env?: ServerEnv,
): Promise<RpcConnection> {
  await rpc.close();
  await server.restart(env === undefined ? undefined : { env });
  await reloadShowing(page, "sparta");
  return connectRpc(server.origin, page);
}

/** Runs `use` with a bearer-token client, closed afterwards. */
export async function withClient<A, E>(
  origin: string,
  bearerToken: string,
  use: (client: WsClient) => Effect.Effect<A, E>,
): Promise<A> {
  const rpc = await connectRpc(origin, { bearerToken });
  try {
    return await Effect.runPromise(use(rpc.client));
  } finally {
    await rpc.close();
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

/**
 * Runs a check that relies on file permissions, or says why it is skipped: root ignores
 * permission bits, so the failure the check provokes would never happen and it would pass vacuously.
 */
export async function unlessRoot(
  scenarioId: string,
  what: string,
  run: () => Promise<void>,
): Promise<void> {
  if (NodeProcess.getuid?.() === 0) {
    NodeProcess.stdout.write(
      `SKIP    ${scenarioId} ${what}: running as root, which ignores file permissions\n`,
    );
    return;
  }
  await run();
}

/**
 * Prints a value the run records and does not judge (FR-4). The time is the harness's, so it
 * includes the browser and the machine's load.
 */
export function metric(scenarioId: string, name: string, ms: number, note?: string) {
  NodeProcess.stdout.write(
    `METRIC  ${scenarioId} ${name} ms=${Math.round(ms)}${note === undefined ? "" : ` (${note})`}\n`,
  );
}

/**
 * Waits for a log entry `match` accepts. The harness reads the server's output through a pipe, so
 * an entry about something that just happened may not have arrived yet; never read it just once.
 */
export async function expectLogged(
  server: ServerHandle,
  message: string,
  match: (entry: string) => boolean,
): Promise<string> {
  return server.logged(message, match).catch(() => {
    throw new Error(message);
  });
}

/** The server's log entries; an entry starts with its time and continues on indented lines. */
export const logEntries = (server: ServerHandle) => server.logs().split(/\n(?=\S)/);

/**
 * The server's time from the start request to `shellId`'s first prompt mark. The page can draw the
 * prompt before the harness has read the server's log line, so this waits for the entry.
 */
export async function serverPromptMs(server: ServerHandle, shellId: string): Promise<number> {
  const entry = await server.logged(
    `the prompt time of ${shellId}`,
    (line) => line.includes("shell prompt ready") && line.includes(shellId),
  );
  const ms = /\bms\W+(\d+)/.exec(entry)?.[1];
  check(ms !== undefined, `The prompt time entry has no ms: ${entry}`);
  return Number(ms);
}

const PROMPT_MARK = "\u001b]133;B";
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// Stands in for the prompt mark once the other OSC sequences (titles, cwd) are removed.
const MARK = "\u0000";

/**
 * PRB.T-011 on a shell's raw output (`ServerHandle.rawOutput`): the agent command was typed once,
 * after the first prompt. A prompt may scroll and redraw the line, so the command's last word
 * stands for it and is not counted; a second typing shows as a second session or as the agent
 * echoing it.
 */
export function agentTypedOnceAfterPrompt(
  raw: string,
  command: string,
  agent: { readonly banner: string; readonly session: string; readonly echo: string },
): string | null {
  const text = raw.replace(OSC, (sequence) => (sequence.startsWith(PROMPT_MARK) ? MARK : ""));
  const word = command.trim().split(/[\s/]/).at(-1) ?? command;
  const markAt = text.indexOf(MARK);
  if (markAt === -1) return "no prompt mark in the output";
  if (text.slice(0, markAt).includes(word)) return "the command shows before the first prompt";
  const commandAt = text.indexOf(word, markAt);
  if (commandAt === -1) return "the command does not show after the first prompt";
  const bannerAt = text.indexOf(agent.banner);
  if (bannerAt === -1) return "the agent's banner never shows";
  if (bannerAt < commandAt) return "the agent's banner shows before the command";
  const sessions = text.split(agent.session).length - 1;
  if (sessions !== 1) return `the agent started ${sessions} times`;
  if (text.includes(`${agent.echo}${command.trim().split(/\s/)[0]}`)) {
    return "the command was typed again into the running agent";
  }
  return null;
}

/** The mock agent's own lines, for `agentTypedOnceAfterPrompt`. */
export const MOCK_AGENT_LINES = {
  banner: "Mock Agent v1",
  session: "session: mock-",
  echo: "echo: ",
} as const;
