// @effect-diagnostics nodeBuiltinImport:off - Reads the results file the reporter writes.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import ScenarioReporter, {
  type GateJudge,
  OUTCOME_ATTACHMENT,
  type ReporterOptions,
  type ScenarioOutcome,
} from "./reporter.ts";

type Status = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";

const result = (
  status: Status,
  outcome?: ScenarioOutcome,
  error?: string,
): Parameters<ScenarioReporter["onTestEnd"]>[1] => ({
  status,
  duration: 4321,
  attachments:
    outcome === undefined
      ? []
      : [
          {
            name: OUTCOME_ATTACHMENT,
            contentType: "application/json",
            body: Buffer.from(JSON.stringify(outcome)),
          },
        ],
  ...(error === undefined ? {} : { error: { message: error } }),
});

const atomic = (id: string, extra: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  id,
  durationMs: 2345,
  teardownMs: 81.6,
  freshServer: false,
  ...extra,
});

function reporter(options: ReporterOptions = {}, judgeGate?: GateJudge) {
  const out: Array<string> = [];
  const instance = new ScenarioReporter(options, {
    write: (text) => out.push(text),
    ...(judgeGate === undefined ? {} : { judgeGate }),
  });
  return { instance, lines: () => out.join("").split("\n").filter(Boolean) };
}

describe("scenario reporter", () => {
  it("prints PASS and FAIL lines in finish order, with artifacts and undos", () => {
    const { instance, lines } = reporter();
    instance.onTestEnd({ title: "T2 second" }, result("passed", atomic("T2")));
    instance.onTestEnd(
      { title: "T1 first" },
      result(
        "failed",
        atomic("T1", {
          failure: 'at stage "open tab": tab count: expected 2, found 1',
          artifacts: ["artifacts: /a/T1 (page-1.png)", "artifact missing: console"],
          undone: ["write access to /w/p"],
        }),
        "the fixture's rethrow",
      ),
    );
    expect(lines()).toEqual([
      "PASS    T2 second (2.3 s, teardown 82 ms)",
      'FAIL    T1 first (2.3 s, teardown 82 ms): at stage "open tab": tab count: expected 2, found 1',
      "        artifacts: /a/T1 (page-1.png)",
      "        artifact missing: console",
      "        undone: write access to /w/p",
    ]);
  });

  it("names the failing step of a composed scenario and the steps that did not run", () => {
    const steps = (failedAt?: number) =>
      ["T16", "T18", "T17"].map((id, index) => ({
        id,
        durationMs: 1000 * (index + 1),
        outcome:
          failedAt === undefined || index < failedAt
            ? ("passed" as const)
            : index === failedAt
              ? ("failed" as const)
              : ("not run" as const),
      }));
    const { instance, lines } = reporter();
    instance.onTestEnd(
      { title: "T21 composed" },
      result("passed", atomic("T21", { durationMs: 6000, steps: steps() })),
    );
    instance.onTestEnd(
      { title: "T21 composed" },
      result(
        "failed",
        atomic("T21", {
          durationMs: 3000,
          steps: steps(1),
          failure: 'at stage "wrong tab": tab: expected a, found b',
        }),
      ),
    );
    expect(lines()).toEqual([
      "PASS    T21 composed (composed, 3 steps, 6.0 s)",
      "        step 1 T16 (1.0 s)",
      "        step 2 T18 (2.0 s)",
      "        step 3 T17 (3.0 s)",
      'FAIL    T21 composed (composed, 3 steps, 3.0 s): step 2 T18 at stage "wrong tab": tab: expected a, found b',
      "        not run: step 3 T17",
    ]);
  });

  it("shows a worker crash or a timeout with Playwright's reason", async () => {
    const { instance, lines } = reporter();
    instance.onTestEnd(
      { title: "T29 crash" },
      result(
        "failed",
        undefined,
        "\u001b[31mWorker process exited unexpectedly (signal=SIGKILL)\u001b[39m",
      ),
    );
    instance.onTestEnd({ title: "T30 hang" }, result("interrupted"));
    await instance.onEnd({ duration: 9000 });
    expect(lines()).toEqual([
      "FAIL    T29 crash (4.3 s): Worker process exited unexpectedly (signal=SIGKILL)",
      "FAIL    T30 hang (4.3 s): interrupted",
      "scenarios: 2 ran, 0 passed, 2 failed, 0 checks skipped",
      "scenarios: total 9.0 s",
    ]);
  });

  it("passes worker output through and counts SKIP lines", async () => {
    const { instance, lines } = reporter();
    instance.onStdOut("SKIP    S7 revoke: running as root, which ignores file permissions\n");
    instance.onStdOut("METRIC  S2 open ms=40\nSKIP    S8 b: running as root\n");
    instance.onTestEnd({ title: "S7 x" }, result("passed", atomic("S7")));
    await instance.onEnd({ duration: 1000 });
    expect(lines()).toEqual([
      "SKIP    S7 revoke: running as root, which ignores file permissions",
      "METRIC  S2 open ms=40",
      "SKIP    S8 b: running as root",
      "PASS    S7 x (2.3 s, teardown 82 ms)",
      "scenarios: 1 ran, 1 passed, 0 failed, 2 checks skipped",
      "scenarios: total 1.0 s",
    ]);
  });

  it("announces named sets and prints a line per set with run members", async () => {
    const { instance, lines } = reporter({
      mode: "selftest",
      sets: [
        { name: "T-gate", members: ["T16", "T1", "T22"] },
        { name: "T-needs", members: ["T23", "T24"] },
      ],
      namedSets: ["T-gate"],
    });
    instance.onBegin();
    instance.onTestEnd({ title: "T16 returns" }, result("passed", atomic("T16")));
    instance.onTestEnd({ title: "T1 fails" }, result("failed", atomic("T1", { failure: "x" })));
    await instance.onEnd({ duration: 1000 });
    expect(lines()).toEqual([
      "scenarios: set T-gate: 3 members",
      "PASS    T16 returns (2.3 s, teardown 82 ms)",
      "FAIL    T1 fails (2.3 s, teardown 82 ms): x",
      "scenarios: self-test 2 ran, 1 passed, 1 failed, 0 checks skipped",
      "scenarios: set T-gate 1/3 passed",
      "scenarios: total 1.0 s",
    ]);
  });

  it("keeps the sandbox prefix in the summary", async () => {
    const { instance, lines } = reporter({ mode: "sandbox", sandboxPid: 4242 });
    await instance.onEnd({ duration: 0 });
    expect(lines()[0]).toBe(
      "scenarios: on sandbox 4242, 0 ran, 0 passed, 0 failed, 0 checks skipped",
    );
  });

  it("prints each perf verdict and counts the misses in the perf run's summary", async () => {
    const { instance, lines } = reporter({ mode: "perf" });
    const within = "PERF PASS perf-a a 120 ms, limit 700 ms (PRB.E-002 NFR-1)";
    const over = "PERF FAIL perf-b b 900 ms, limit 700 ms (PRB.E-002 NFR-1)";
    instance.onTestEnd(
      { title: "perf-a a" },
      result("passed", atomic("perf-a", { perf: { line: within, pass: true } })),
    );
    instance.onTestEnd(
      { title: "perf-b b" },
      result("failed", atomic("perf-b", { perf: { line: over, pass: false }, failure: over })),
    );
    await instance.onEnd({ duration: 1000 });
    expect(lines()).toEqual([
      "PASS    perf-a a (2.3 s, teardown 82 ms)",
      `        ${within}`,
      `FAIL    perf-b b (2.3 s, teardown 82 ms): ${over}`,
      "perf: 2 measured, 1 over the limit",
      "scenarios: perf 2 ran, 1 passed, 1 failed, 0 checks skipped",
      "scenarios: total 1.0 s",
    ]);
  });

  it("hands timed rows to the gate judge, lists composed ones as not timed, and fails the run on its verdict", async () => {
    const seen: Array<unknown> = [];
    const judge: GateJudge = (rows, capMs) => {
      seen.push({ rows, capMs });
      return { lines: ["GATE FAIL T1 21.0 s (server start included), cap 20 s"], over: ["T1"] };
    };
    const { instance, lines } = reporter({ gate: { capMs: 20_000, notTimed: ["T22"] } }, judge);
    instance.onTestEnd({ title: "T16 a" }, result("passed", atomic("T16")));
    instance.onTestEnd(
      { title: "T1 b" },
      result("passed", atomic("T1", { durationMs: 21_000, freshServer: true })),
    );
    instance.onTestEnd({ title: "T29 crash" }, result("failed", undefined, "crash"));
    expect(await instance.onEnd({ duration: 0 })).toEqual({ status: "failed" });
    expect(seen).toEqual([
      {
        rows: [
          { id: "T16", ms: 2345, freshServer: false },
          { id: "T1", ms: 21_000, freshServer: true },
        ],
        capMs: 20_000,
      },
    ]);
    expect(lines().slice(3, 5)).toEqual([
      "NOT TIMED T22: composed; its steps are timed alone",
      "GATE FAIL T1 21.0 s (server start included), cap 20 s",
    ]);
  });

  it("stays silent under --list, so Playwright prints its own listing", async () => {
    const { instance, lines } = reporter({ _mode: "list" });
    expect(instance.printsToStdio()).toBe(false);
    instance.onBegin();
    await instance.onEnd({ duration: 0 });
    expect(lines()).toEqual([]);
  });

  it("judges the gate with the gate's own rule when given no judge", async () => {
    const { instance, lines } = reporter({ gate: { capMs: 20_000, notTimed: [] } });
    instance.onTestEnd({ title: "T16 a" }, result("passed", atomic("T16")));
    expect(await instance.onEnd({ duration: 0 })).toBeUndefined();
    expect(lines().slice(1, 3)).toEqual([
      "GATE PASS T16 2.345 s (server start excluded), cap 20 s",
      "gate: 1 timed, 0 over the cap",
    ]);
  });

  it("writes each id's outcome and time to results.json", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "probe-reporter-"));
    try {
      const resultsPath = NodePath.join(dir, "results.json");
      const { instance } = reporter({ resultsPath });
      instance.onStdOut("SKIP    S7 x: root\n");
      instance.onTestEnd({ title: "S1 boot" }, result("passed", atomic("S1")));
      instance.onTestEnd({ title: "T29 crash" }, result("failed", undefined, "crash"));
      await instance.onEnd({ duration: 0 });
      expect(JSON.parse(NodeFS.readFileSync(resultsPath, "utf8"))).toEqual({
        scenarios: [
          {
            id: "S1",
            title: "S1 boot",
            outcome: "passed",
            durationMs: 2345,
            teardownMs: 81.6,
            freshServer: false,
          },
          { id: "T29", title: "T29 crash", outcome: "failed", durationMs: 4321 },
        ],
        skipped: 1,
      });
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
