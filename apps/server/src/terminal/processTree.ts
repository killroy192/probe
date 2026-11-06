import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  /** The session id; null where `ps` cannot report it (macOS). */
  readonly sid: number | null;
}

const parseProcessTable = (raw: string): ReadonlyArray<ProcessRow> =>
  raw.split("\n").flatMap((line) => {
    const [pid, ppid, sid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return [];
    return [{ pid: pid!, ppid: ppid!, sid: Number.isInteger(sid) ? sid! : null }];
  });

/**
 * `root` and every process it started: its descendants, plus the members of the session it
 * leads, which catches a job that double-forked away from its parent. `spare` is never included.
 */
export function processTreeOf(
  table: ReadonlyArray<ProcessRow>,
  root: number,
  spare: ReadonlySet<number> = new Set(),
): ReadonlyArray<number> {
  const children = new Map<number, number[]>();
  for (const row of table) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) children.set(row.ppid, [row.pid]);
    else siblings.push(row.pid);
  }
  const found = new Set<number>([root]);
  for (const row of table) if (row.sid === root) found.add(row.pid);
  const pending = [...found];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    for (const child of children.get(pid) ?? []) {
      if (!found.has(child)) {
        found.add(child);
        pending.push(child);
      }
    }
  }
  return [...found].filter((pid) => pid > 1 && !spare.has(pid));
}

const PS_TIMEOUT = Duration.seconds(2);

/** Lists processes with `ps`; Windows has none, so a kill there reaches the shell only. */
export const makeReadProcessTable = Effect.fnUntraced(function* (platform: NodeJS.Platform) {
  const runner = yield* ProcessRunner.ProcessRunner;
  return Effect.suspend(() => {
    if (platform === "win32") return Effect.succeed<ReadonlyArray<ProcessRow>>([]);
    return runner
      .run({
        command: "ps",
        // Only Linux's ps reports the session id as a number.
        args: ["-A", "-o", platform === "linux" ? "pid=,ppid=,sid=" : "pid=,ppid="],
        timeout: PS_TIMEOUT,
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.map((result) => parseProcessTable(result.stdout)),
        Effect.orElseSucceed((): ReadonlyArray<ProcessRow> => []),
      );
  });
});

const signal = (signalName: "SIGSTOP" | "SIGKILL") => (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(pid, signalName);
    } catch {
      // Already gone, or never ours to signal.
    }
  });

/**
 * Force-kills `root` and what it started. The tree is stopped first, so nothing forks or is
 * reparented while it is read again; the second read catches children forked before the stop.
 */
export const killProcessTree = Effect.fnUntraced(function* (
  readTable: Effect.Effect<ReadonlyArray<ProcessRow>>,
  root: number,
) {
  const spare = new Set([process.pid, process.ppid]);
  const first = processTreeOf(yield* readTable, root, spare);
  yield* Effect.forEach(first, signal("SIGSTOP"), { discard: true });
  const all = new Set([...first, ...processTreeOf(yield* readTable, root, spare)]);
  yield* Effect.forEach(all, signal("SIGKILL"), { discard: true });
});
