// @effect-diagnostics nodeBuiltinImport:off - Starts decoy processes outside every shell and ends them by their pid.

import * as NodeChildProcess from "node:child_process";

import type { ScenarioContext } from "../scenario.ts";
import { pidsRunning } from "./shells.ts";

// Far from the old fixed `sleep 1601` and `sleep 1602`, so no run's marker is one of them.
const MARKER_BASE = 100_000;
const MARKER_SPAN = 800_000;

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/**
 * `count` distinct `sleep` durations in seconds that only the run `runId` uses, so its jobs are
 * told from every other run's by their exact command line.
 */
export function jobMarkers(runId: string, count: number): ReadonlyArray<number> {
  const first = MARKER_BASE + (hash(runId) % (MARKER_SPAN - count));
  return Array.from({ length: count }, (_, index) => first + index);
}

/** A duration in the marker range that none of `own` is, as another run's job would have. */
export function otherRunMarker(runId: string, own: ReadonlyArray<number>): number {
  let marker = jobMarkers(`another-${runId}`, 1)[0]!;
  while (own.includes(marker)) marker += own.length;
  return marker;
}

/** The pids of every process whose whole command line is `sleep <seconds>`. */
export const jobPids = (seconds: number) => pidsRunning(new RegExp(`^sleep ${seconds}$`));

/**
 * Starts `sleep <seconds>` for each of `durations` outside every shell, as decoys a scenario's
 * process match must not take for its own. Each is ended by its own pid when the step ends.
 */
export async function startDecoys(
  ctx: Pick<ScenarioContext, "onStepEnd">,
  durations: ReadonlyArray<number>,
): Promise<ReadonlyArray<number>> {
  const pids: Array<number> = [];
  for (const seconds of durations) {
    const child = NodeChildProcess.spawn("sleep", [String(seconds)], { stdio: "ignore" });
    const pid = await new Promise<number>((resolve, reject) => {
      child.once("spawn", () => resolve(child.pid!));
      child.once("error", reject);
    });
    const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    ctx.onStepEnd(`the decoy sleep ${seconds} (pid ${pid})`, async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await ended;
    });
    pids.push(pid);
  }
  return pids;
}
