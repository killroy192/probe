import type { ServerHandle } from "../server.ts";
import { check } from "./waits.ts";

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
