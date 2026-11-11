import type { ShellSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { PointerPage } from "../browser.ts";
import type { WsClient } from "./api.ts";
import { typeLine } from "./ui/terminal.ts";
import { alive, check, follow, gone, recorder } from "./waits.ts";

/** Waits until the list of shells has `count` entries for `cwd`. */
export async function shellsIn(
  list: ReturnType<typeof recorder<ReadonlyArray<ShellSummary>>>,
  cwd: string,
  count: number,
) {
  const current = await list.until(
    `${count} shells in ${cwd}`,
    (shells) => shells.filter((shell) => shell.cwd === cwd).length === count,
    // From the current list on: an older list describes a state that has passed.
    Math.max(0, list.mark() - 1),
  );
  return current.filter((shell) => shell.cwd === cwd);
}

/** Follows the server's shell list over `client`. */
export function shellList(client: WsClient) {
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

export async function history(client: WsClient, shellId: string): Promise<string> {
  const [first] = await Effect.runPromise(
    client["shell.attach"]({ shellId }).pipe(Stream.take(1), Stream.runCollect),
  );
  return first?.type === "snapshot" ? first.snapshot.history : "";
}

/** Waits until `count` running shells have `cwd`, judged from the current list on. */
export async function runningIn(
  list: ReturnType<typeof recorder<ReadonlyArray<ShellSummary>>>,
  cwd: string,
  count: number,
) {
  const running = (shells: ReadonlyArray<ShellSummary>) =>
    shells.filter((shell) => shell.cwd === cwd && shell.status === "running");
  const found = await list.until(
    `${count} running shells in ${cwd}`,
    (shells) => running(shells).length === count,
    Math.max(0, list.mark() - 1),
  );
  return running(found);
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
  shells: ReturnType<typeof shellList>,
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

/** Waits until the shell's mock agent runs, so a typed line reaches the agent, not the shell. */
export async function agentReady(client: WsClient, shellId: string) {
  const output = recorder<string>("agent output");
  const viewer = follow(client["shell.attach"]({ shellId }), (event) =>
    output.push(JSON.stringify(event)),
  );
  try {
    // A fresh attach: its snapshot holds the shell's whole history, which is what counts here.
    await output.until("the agent's banner", (event) => event.includes("Mock Agent v1"), 0);
  } finally {
    await Effect.runPromise(Fiber.interrupt(viewer));
  }
}

/**
 * Types `exit` into the shell's mock agent once it runs, and waits for its goodbye, so the next
 * line reaches the shell, not the agent's input buffer.
 */
export async function leaveAgent(page: PointerPage, client: WsClient, shellId: string) {
  const output = recorder<string>("agent output");
  const viewer = follow(client["shell.attach"]({ shellId }), (event) =>
    output.push(JSON.stringify(event)),
  );
  try {
    // A fresh attach: its snapshot holds the shell's whole history, which is what counts here.
    await output.until("the agent's banner", (event) => event.includes("Mock Agent v1"), 0);
    const typed = output.mark();
    await typeLine(page, "exit");
    // The shell reads the next line at its next prompt, which follows the goodbye (SU-1).
    const bye = await output.until(
      "the agent's goodbye",
      (event) => event.includes("mock-agent: bye"),
      typed,
    );
    const promptMark = JSON.stringify("\u001b]133;B").slice(1, -1);
    await output.until(
      "the shell's prompt after the agent's goodbye",
      (event) =>
        event.includes(promptMark) &&
        (event !== bye || event.indexOf(promptMark, event.indexOf("mock-agent: bye")) !== -1),
      output.seen.indexOf(bye, typed),
    );
  } finally {
    await Effect.runPromise(Fiber.interrupt(viewer));
  }
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
