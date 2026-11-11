import { describe, expect, it } from "vite-plus/test";

import { runComposed } from "./compose.ts";
import { StageFailure } from "./lib/trail.ts";
import { defineCheck, defineComposed } from "./scenario.ts";
import {
  artifactLines,
  artifactsDir,
  composedSteps,
  describeExit,
  failureMessage,
  guardShared,
  raceServerExit,
  runUndos,
} from "./scenarioRun.ts";
import type { ServerHandle } from "./server.ts";

const file = "file:///repo/scripts/scenarios/selftest/run.ts";
const check = (id: string) => defineCheck(file, { id, title: id, needs: {}, run: async () => {} });

function deferred<A>() {
  let resolve: (value: A) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<A>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("raceServerExit", () => {
  it("fails at the stage running when the server exits, not with the scenario's later failure", async () => {
    const running = deferred<string>();
    const exited = deferred<string>();
    let stage = "open a page";
    const raced = raceServerExit(running.promise, exited.promise, () => stage);
    stage = "kill the server mid-stage";
    exited.resolve("the server (pid 7) exited unexpectedly with SIGKILL");
    running.reject(new Error("a locator timed out"));
    const error = await raced.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StageFailure);
    expect((error as StageFailure).message).toBe(
      'at stage "kill the server mid-stage": the server (pid 7) exited unexpectedly with SIGKILL',
    );
  });

  it("settles with the scenario when it ends before an exit", async () => {
    const exited = deferred<string>();
    const raced = raceServerExit(Promise.resolve("done"), exited.promise, () => "setup");
    await expect(raced).resolves.toBe("done");
    exited.resolve("a later exit");
    await expect(raced).resolves.toBe("done");
  });
});

describe("runUndos", () => {
  it("runs the last registered first, keeps going past a failure and reports the first", async () => {
    const ran: Array<string> = [];
    const undo = (what: string, fails = false) => ({
      what,
      undo: async () => {
        ran.push(what);
        if (fails) throw new Error(`${what} is busy`);
      },
    });
    const result = await runUndos([undo("a"), undo("b", true), undo("c", true), undo("d")]);
    expect(ran).toStrictEqual(["d", "c", "b", "a"]);
    expect(result.undone).toStrictEqual(["d", "a"]);
    expect(result.failure?.message).toBe("Undoing c failed: c is busy");
  });
});

describe("failureMessage", () => {
  it.each([
    [
      "a step's own prefix is taken off",
      new StageFailure("step 2: count", new Error("x")),
      "step 2",
      'at stage "count": x',
    ],
    [
      "another step's prefix stays",
      new StageFailure("step 1: count", new Error("x")),
      "step 2",
      'at stage "step 1: count": x',
    ],
    [
      "an atomic check keeps its stage",
      new StageFailure("count", new Error("x")),
      undefined,
      'at stage "count": x',
    ],
    ["a plain error is its message", new Error("cannot run"), undefined, "cannot run"],
  ])("%s", (_, error, prefix, message) => {
    expect(failureMessage(error, prefix)).toBe(message);
  });
});

describe("composedSteps", () => {
  const c = defineComposed(file, {
    id: "T21",
    title: "fails at step two",
    steps: [{ scenario: check("T16") }, { scenario: check("T18") }, { scenario: check("T17") }],
  });

  it("marks the steps before the failure passed, it failed and the rest not run", async () => {
    const outcome = await runComposed(c, "r", async ({ n }) => {
      if (n === 2) throw new Error("wrong");
    });
    expect(
      composedSteps(
        c,
        outcome,
        new Map([
          [1, 40],
          [2, 15],
        ]),
      ),
    ).toStrictEqual([
      { id: "T16", durationMs: 40, outcome: "passed" },
      { id: "T18", durationMs: 15, outcome: "failed" },
      { id: "T17", durationMs: 0, outcome: "not run" },
    ]);
  });

  it("marks every step not run when the composed scenario never started", () => {
    expect(composedSteps(c, undefined, new Map()).map(({ outcome }) => outcome)).toStrictEqual([
      "not run",
      "not run",
      "not run",
    ]);
  });
});

describe("artifacts", () => {
  it("go into <id>/ or <id>/step-<n>-<stepId>/, and name what is missing", () => {
    expect(artifactsDir("/a", "T18")).toBe("/a/T18");
    expect(artifactsDir("/a", "T21", { n: 2, id: "T18" })).toBe("/a/T21/step-2-T18");
    expect(
      artifactLines("/a/T18", ["error.txt", "trace-1.zip"], ["page-1.png: closed"]),
    ).toStrictEqual([
      "artifacts: /a/T18 (error.txt, trace-1.zip)",
      "artifact missing: page-1.png: closed",
    ]);
  });
});

describe("describeExit", () => {
  it("names the server, how it ended and its last lines", () => {
    const tail = ["one", "two", "", "three", "four", "  █▀▀▀█ ▄▄", "five", "six"].join("\n");
    expect(describeExit("shared server", 42, { code: null, signal: "SIGKILL", tail })).toBe(
      [
        "the shared server (pid 42) exited unexpectedly with SIGKILL; its last lines:",
        "    two",
        "    three",
        "    four",
        "    five",
        "    six",
      ].join("\n"),
    );
  });
});

describe("guardShared", () => {
  it("refuses whatever would end or replace the shared server, naming the need", async () => {
    const calls: Array<string> = [];
    const server = {
      origin: "http://127.0.0.1:20001",
      restart: async () => void calls.push("restart"),
      stop: async () => void calls.push("stop"),
      kill: async () => void calls.push("kill"),
      stopShellHost: async () => void calls.push("stopShellHost"),
    } as unknown as ServerHandle;
    const guarded = guardShared(server, "T5");
    await expect(guarded.restart()).rejects.toThrow(
      "T5 tried a restart on the shared server, a need it did not state.",
    );
    await expect(guarded.stop()).rejects.toThrow("T5 tried a server stop");
    await expect(guarded.kill()).rejects.toThrow("T5 tried a server stop");
    await expect(guarded.stopShellHost()).rejects.toThrow("T5 tried stopping the shell host");
    expect(calls).toStrictEqual([]);
    expect(guarded.origin).toBe(server.origin);
  });
});
