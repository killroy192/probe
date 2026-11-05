// @effect-diagnostics globalTimers:off globalDate:off - Waits for processes and page frames in real time.

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { PointerPage } from "./browser.ts";

const WAIT_MS = 20_000;

/** Values seen so far, and a wait for the first one (from `from` on) that matches. */
export function recorder<A>() {
  const seen: Array<A> = [];
  const waiters = new Set<() => void>();
  return {
    seen,
    push: (value: A) => {
      seen.push(value);
      for (const wake of waiters) wake();
    },
    until: (what: string, match: (value: A) => boolean, from = 0) =>
      new Promise<A>((resolve, reject) => {
        const check = () => {
          const found = seen.slice(from).find(match);
          if (found === undefined) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`Timed out waiting for ${what}.`));
        }, WAIT_MS);
        waiters.add(check);
        check();
      }),
  };
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Ending a shell sends SIGTERM and escalates after a grace period, so the process leaves a little later.
export async function gone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

export const follow = <A, E>(stream: Stream.Stream<A, E>, onValue: (value: A) => void) =>
  Effect.runFork(Stream.runForEach(stream, (value) => Effect.sync(() => onValue(value))));

/** Text the page received over its websockets, which is what its canvas terminal draws. */
export function pageFrames(page: PointerPage) {
  const frames = recorder<string>();
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") frames.push(payload);
    }),
  );
  return frames;
}
