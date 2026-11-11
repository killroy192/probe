// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Waits for processes and recorded values in real time.

import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Locator } from "playwright-core";

import {
  ACTION_MS,
  type Deadline,
  PROCESS_END_MS,
  PROCESS_END_STEP_MS,
  seconds,
  WAIT_MS,
} from "./deadlines.ts";

/** Fails the scenario with `message` unless `condition` holds. */
export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The recorders of the running scenario, so a failure can save their last values. */
const live = new Set<{ readonly label: string; readonly seen: ReadonlyArray<unknown> }>();

/** Forgets the recorders of the scenario that just ended; the runner calls it between scenarios. */
export function resetRecorders() {
  live.clear();
}

/** The last `count` values of each recorder of the running scenario, by label. */
export function recorderTails(count = 20): Record<string, ReadonlyArray<unknown>> {
  const tails: Record<string, ReadonlyArray<unknown>> = {};
  for (const { label, seen } of live) {
    let key = label;
    for (let n = 2; key in tails; n++) key = `${label} ${n}`;
    tails[key] = seen.slice(-count);
  }
  return tails;
}

/**
 * Waits for `locator` to reach `state` (Playwright's default, visible). A failure names `what`, the
 * milestone awaited, and the deadline, instead of Playwright's selector and call log.
 */
export async function waitFor(
  locator: Locator,
  what: string,
  {
    state = "visible",
    deadline = ACTION_MS,
  }: {
    readonly state?: "attached" | "detached" | "visible" | "hidden";
    readonly deadline?: Deadline;
  } = {},
) {
  try {
    await locator.waitFor({ state, timeout: deadline });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(
      timedOut
        ? `Timed out after ${seconds(deadline)} waiting for ${what} (${state}).`
        : `Waiting for ${what} failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Values seen so far. `until` waits for the first one from offset `from` on that matches; pass
 * `mark()` taken before the action whose result you wait for, so an earlier value cannot answer.
 */
export function recorder<A>(label = "values") {
  const seen: Array<A> = [];
  const waiters = new Set<() => void>();
  live.add({ label, seen });
  const until = (
    what: string,
    match: (value: A) => boolean,
    from: number,
    { deadline = WAIT_MS }: { readonly deadline?: Deadline } = {},
  ) =>
    new Promise<A>((resolve, reject) => {
      const check = () => {
        const found = seen.slice(from).find(match);
        if (found === undefined) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve(found);
      };
      // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (b): deadline raced against the value, named in the failure
      const timer = setTimeout(() => {
        waiters.delete(check);
        const since = Math.max(0, seen.length - from);
        reject(
          new Error(
            `Timed out after ${seconds(deadline)} waiting for ${what} (${label} from offset ${from}, ${since} ${since === 1 ? "value" : "values"} seen since).`,
          ),
        );
      }, deadline);
      waiters.add(check);
      check();
    });
  return {
    seen,
    push: (value: A) => {
      seen.push(value);
      for (const wake of waiters) wake();
    },
    /** The offset of the next value. */
    mark: () => seen.length,
    until,
    /**
     * Fails if a value matching `match` arrived from `from` on, judged once `fence` arrives: a
     * later value that proves the stream is live, so an idle or dead stream never passes.
     */
    nothingSince: async (
      what: string,
      match: (value: A) => boolean,
      from: number,
      fence: { readonly what: string; readonly match: (value: A) => boolean },
    ) => {
      const fenced = await until(fence.what, fence.match, from);
      const between = seen.slice(from, seen.indexOf(fenced, from) + 1);
      const found = between.find(match);
      if (found !== undefined) {
        throw new Error(`${what} arrived before ${fence.what}: ${JSON.stringify(found)}`);
      }
    },
  };
}

/** Whether `pid` runs; a zombie (ended, not yet reaped) counts as gone. */
export const alive = (pid: number) => {
  try {
    NodeProcess.kill(pid, 0);
  } catch {
    return false;
  }
  if (NodeProcess.platform !== "linux") return true;
  try {
    // The state follows the command name in parentheses, which may itself contain spaces.
    const stat = NodeFS.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
};

/**
 * Whether a process the server does not own has ended within `PROCESS_END_MS`. A shell the server
 * owns has an end event instead: wait for it with `shellEnded`.
 */
export async function gone(pid: number): Promise<boolean> {
  // oxlint-disable-next-line t3code/no-polling-loop-in-tests -- permanent (c): nothing reports the end of a process the server does not own
  for (let attempt = 0; alive(pid); attempt++) {
    if (attempt === PROCESS_END_MS / PROCESS_END_STEP_MS) return false;
    // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (c): nothing reports the end of a process the server does not own
    await new Promise((resolve) => setTimeout(resolve, PROCESS_END_STEP_MS));
  }
  return true;
}

export const follow = <A, E>(stream: Stream.Stream<A, E>, onValue: (value: A) => void) =>
  Effect.runFork(Stream.runForEach(stream, (value) => Effect.sync(() => onValue(value))));
