// @effect-diagnostics nodeBuiltinImport:off - Lists the machine's processes for a shell's background jobs.

import * as NodeChildProcess from "node:child_process";

import type { ShellSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { PointerPage } from "../browser.ts";
import type { WsClient } from "./api.ts";
import { typeLine } from "./ui/terminal.ts";
import { alive, check, follow, gone, recorder } from "./waits.ts";

/** OSC 133;B, which Probe's zsh and bash wrappers print when the line editor first reads input. */
export const PROMPT_MARK = "\u001b]133;B";
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** `text` without its OSC sequences (prompt marks, titles, cwd). */
export const stripOsc = (text: string) => text.replace(OSC, "");
// Stands in for the prompt mark once the other OSC sequences (titles, cwd) are removed.
const MARK = "\u0000";

/** The mock agent's own lines, for `agentTypedOnceAfterPrompt` and the agent waits. */
export const MOCK_AGENT_LINES = {
  banner: "Mock Agent v1",
  session: "session: mock-",
  echo: "echo: ",
} as const;

/** Follows the server's shell list over `client`. */
export function followShells(client: WsClient) {
  const lists = recorder<ReadonlyArray<ShellSummary>>("shell lists");
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

export type ShellFollower = ReturnType<typeof followShells>;
type ShellLists = ShellFollower["lists"];

/**
 * Follows one shell's output from a fresh attach, whose snapshot holds the shell's whole history;
 * each event is recorded as its JSON. `stop` ends the attach.
 */
export function followOutput(client: WsClient, shellId: string) {
  const output = recorder<string>(`output of ${shellId}`);
  const viewer = follow(client["shell.attach"]({ shellId }), (event) =>
    output.push(JSON.stringify(event)),
  );
  return { output, stop: () => Effect.runPromise(Fiber.interrupt(viewer)).then(() => undefined) };
}

/** Waits until the list of shells has `count` entries for `cwd`. */
export async function shellsIn(list: ShellLists, cwd: string, count: number) {
  const current = await list.until(
    `${count} shells in ${cwd}`,
    (shells) => shells.filter((shell) => shell.cwd === cwd).length === count,
    // From the current list on: an older list describes a state that has passed.
    Math.max(0, list.mark() - 1),
  );
  return current.filter((shell) => shell.cwd === cwd);
}

export async function history(client: WsClient, shellId: string): Promise<string> {
  const [first] = await Effect.runPromise(
    client["shell.attach"]({ shellId }).pipe(Stream.take(1), Stream.runCollect),
  );
  return first?.type === "snapshot" ? first.snapshot.history : "";
}

/** Waits until `count` running shells have `cwd`, judged from the current list on. */
export async function runningIn(list: ShellLists, cwd: string, count: number) {
  const running = (shells: ReadonlyArray<ShellSummary>) =>
    shells.filter((shell) => shell.cwd === cwd && shell.status === "running");
  const found = await list.until(
    `${count} running shells in ${cwd}`,
    (shells) => running(shells).length === count,
    Math.max(0, list.mark() - 1),
  );
  return running(found);
}

/** Whether the server lists `shell` as running and its process runs. */
export const isRunning = (shell: ShellSummary | undefined) =>
  shell?.status === "running" && shell.pid !== null && alive(shell.pid);

/** Whether the current list has `shellId` running, with its process alive. */
export const running = (shells: ShellFollower, shellId: string) =>
  isRunning(shells.current().find((entry) => entry.shellId === shellId));

/** Opens a standalone shell in `cwd`, outside any workspace. */
export const openShell = (
  client: WsClient,
  cwd: string,
  { cols = 80, rows = 24 }: { readonly cols?: number; readonly rows?: number } = {},
): Promise<ShellSummary> => Effect.runPromise(client["shell.open"]({ cwd, cols, rows }));

/** The workspace's remembered last starts, as JSON, for comparing two moments. */
export const lastStartOf = async (client: WsClient, name: string) =>
  JSON.stringify((await Effect.runPromise(client["workspace.open"]({ name }))).lastStarts);

/**
 * The pids of every process on the machine whose command line matches `command`, for a shell's
 * background jobs, which the server does not list.
 */
export async function pidsRunning(command: RegExp) {
  const table = await new Promise<string>((resolve, reject) =>
    NodeChildProcess.execFile("ps", ["-A", "-o", "pid=,args="], (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    ),
  );
  return table.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match !== null && command.test(match[2]!.trim()) ? [Number(match[1])] : [];
  });
}

/**
 * Waits for the shell's first prompt in the server's list, then writes `text` and a newline into
 * it over the API, so nothing reaches the shell before its line editor reads.
 */
export async function writeLine(
  client: WsClient,
  shells: ShellFollower,
  shellId: string,
  text: string,
) {
  await shells.lists.until(
    `the first prompt of shell ${shellId}`,
    (list) => list.some((entry) => entry.shellId === shellId && entry.promptReady === true),
    // Each list is the whole state, so the current one already counts.
    Math.max(0, shells.lists.mark() - 1),
  );
  await Effect.runPromise(client["shell.write"]({ shellId, data: `${text}\r` }));
}

/** Writes `line` into the shell over the API and waits for its output to hold `printed`. */
export async function printedAfter(
  setup: { readonly client: WsClient; readonly shells: ShellFollower },
  shellId: string,
  line: string,
  printed: string,
) {
  const { output, stop } = followOutput(setup.client, shellId);
  try {
    const from = output.mark();
    await writeLine(setup.client, setup.shells, shellId, line);
    await output.until(
      `shell ${shellId} to print ${printed}`,
      (event) => event.includes(printed),
      from,
    );
  } finally {
    await stop();
  }
}

/**
 * The pids still running after the bounded wait, for processes the server does not own (a shell's background jobs,
 * shells whose host was stopped), which have no end event; see `gone`.
 */
export async function survivors(pids: ReadonlyArray<number>) {
  const results = await Promise.all(pids.map((pid) => gone(pid)));
  return pids.filter((_, index) => !results[index]);
}

/**
 * Waits for the server's end event of a shell it owns (it leaves the list, or is listed as ended)
 * and then checks its pid once: the server sends the event only after the process ended.
 */
export async function shellEnded(
  shells: ShellFollower,
  shell: Pick<ShellSummary, "shellId" | "pid">,
) {
  await shells.lists.until(
    `the end of shell ${shell.shellId}`,
    (list) => !list.some((entry) => entry.shellId === shell.shellId && entry.ended === null),
    // Each list is the whole state, so the current one already counts; older ones have passed.
    Math.max(0, shells.lists.mark() - 1),
  );
  check(
    shell.pid === null || !alive(shell.pid),
    `Shell ${shell.shellId} (pid ${shell.pid}) still runs after the server reported its end.`,
  );
}

const agentBanner = (output: ReturnType<typeof followOutput>["output"]) =>
  output.until("the agent's banner", (event) => event.includes(MOCK_AGENT_LINES.banner), 0);

/** Waits until the shell's mock agent runs, so a typed line reaches the agent, not the shell. */
export async function agentReady(client: WsClient, shellId: string) {
  const { output, stop } = followOutput(client, shellId);
  try {
    await agentBanner(output);
  } finally {
    await stop();
  }
}

/**
 * Types `exit` into the shell's mock agent once it runs, and waits for its goodbye, so the next
 * line reaches the shell, not the agent's input buffer.
 */
export async function leaveAgent(page: PointerPage, client: WsClient, shellId: string) {
  const { output, stop } = followOutput(client, shellId);
  try {
    await agentBanner(output);
    const typed = output.mark();
    await typeLine(page, "exit");
    // The shell reads the next line at its next prompt, which follows the goodbye (SU-1).
    const bye = await output.until(
      "the agent's goodbye",
      (event) => event.includes("mock-agent: bye"),
      typed,
    );
    const promptMark = JSON.stringify(PROMPT_MARK).slice(1, -1);
    await output.until(
      "the shell's prompt after the agent's goodbye",
      (event) =>
        event.includes(promptMark) &&
        (event !== bye || event.indexOf(promptMark, event.indexOf("mock-agent: bye")) !== -1),
      output.seen.indexOf(bye, typed),
    );
  } finally {
    await stop();
  }
}

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
