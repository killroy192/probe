// @effect-diagnostics nodeBuiltinImport:off - Spawns real process trees to kill.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vite-plus/test";

// oxlint-disable-next-line t3code/no-global-process-runtime -- the skips need the real platform before any Effect runs, as the processes spawned here are real.
const platform = process.platform;

import * as ProcessRunner from "../processRunner.ts";
import { killProcessTree, makeReadProcessTable, processTreeOf } from "./processTree.ts";

describe("processTreeOf", () => {
  it("takes descendants and session members, and spares the rest", () => {
    const table = [
      { pid: 10, ppid: 1, sid: 10 }, // the shell, leading its session
      { pid: 11, ppid: 10, sid: 10 }, // a background job
      { pid: 12, ppid: 11, sid: 12 }, // a job's child that started its own session
      { pid: 13, ppid: 1, sid: 10 }, // double-forked, now under init
      { pid: 20, ppid: 1, sid: 20 }, // someone else's
      { pid: 30, ppid: 10, sid: 10 }, // spared (the server, say)
    ];
    expect([...processTreeOf(table, 10, new Set([30]))].toSorted()).toEqual([10, 11, 12, 13]);
  });

  it("stops at a ppid cycle and never returns init", () => {
    const table = [
      { pid: 1, ppid: 0, sid: 1 },
      { pid: 5, ppid: 6, sid: null },
      { pid: 6, ppid: 5, sid: null },
    ];
    expect([...processTreeOf(table, 5)].toSorted()).toEqual([5, 6]);
    expect(processTreeOf(table, 1)).toEqual([]);
  });
});

// A session leader like a pty shell, with a background job and a double-forked job. Both jobs
// keep the stdout pipe open, so "close" fires only once every one of them is gone.
const spawnShellWithJobs = () =>
  Effect.callback<{ readonly child: NodeChildProcess.ChildProcess; readonly jobs: number[] }>(
    (resume) => {
      const child = NodeChildProcess.spawn(
        "sh",
        ["-c", "sleep 1000 & echo $!; (sleep 1001 & echo $!); echo ready; wait"],
        { detached: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        if (out.includes("ready")) {
          const jobs = out
            .split("\n")
            .map(Number)
            .filter((pid) => pid > 0);
          resume(Effect.succeed({ child, jobs }));
        }
      });
    },
  );

const closed = (child: NodeChildProcess.ChildProcess) =>
  Effect.callback<void>((resume) => {
    if (child.stdout?.readableEnded && child.exitCode !== null) resume(Effect.void);
    else child.once("close", () => resume(Effect.void));
  });

const exited = (child: NodeChildProcess.ChildProcess) =>
  Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) resume(Effect.void);
    else child.once("exit", () => resume(Effect.void));
  });

const isRunning = (pid: number) => {
  const result = NodeChildProcess.spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const state = result.stdout.trim();
  return state.length > 0 && !state.startsWith("Z");
};

it.layer(
  Layer.merge(NodeServices.layer, ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
  { excludeTestServices: true },
)("killProcessTree", (it) => {
  it.effect.skipIf(platform === "win32")(
    "a SIGKILL to the shell alone leaves its jobs running (SA-2)",
    () =>
      Effect.gen(function* () {
        const readTable = yield* makeReadProcessTable(platform);
        const { child, jobs } = yield* spawnShellWithJobs();
        // Ends the jobs should an expectation fail; they stay reachable by their session id.
        yield* Effect.addFinalizer(() => killProcessTree(readTable, child.pid!));
        process.kill(child.pid!, "SIGKILL");
        yield* exited(child);
        expect(jobs.filter(isRunning)).toEqual(jobs);
        for (const job of jobs) process.kill(job, "SIGKILL");
        yield* closed(child);
      }),
  );

  // macOS's ps has no session id, so a job that double-forked before the kill escapes there.
  it.effect.skipIf(platform !== "linux")("ends the shell and every job it started", () =>
    Effect.gen(function* () {
      const readTable = yield* makeReadProcessTable(platform);
      const { child, jobs } = yield* spawnShellWithJobs();
      expect(jobs).toHaveLength(2);

      yield* killProcessTree(readTable, child.pid!);

      yield* closed(child);
      expect(child.signalCode).toBe("SIGKILL");
      expect(jobs.filter(isRunning)).toEqual([]);
    }),
  );
});
