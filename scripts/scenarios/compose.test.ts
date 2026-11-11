import { describe, expect, it } from "vite-plus/test";

import { runComposed, type ComposedStepRun } from "./compose.ts";
import { StageFailure } from "./lib/trail.ts";
import { defineCheck, defineComposed } from "./scenario.ts";

const file = "file:///repo/scripts/scenarios/selftest/compose.ts";
const workspace = (name: string) => ({ kind: "workspace" as const, name });

const T16 = defineCheck(file, {
  id: "T16",
  title: "returns a workspace",
  needs: {},
  returns: "workspace",
  run: async ({ runId }) => workspace(runId),
});
const T17 = defineCheck(file, {
  id: "T17",
  title: "takes a workspace",
  needs: {},
  takes: "workspace",
  run: async () => {},
});
const T18 = defineCheck(file, { id: "T18", title: "fails", needs: {}, run: async () => {} });

describe("runComposed", () => {
  it("runs the steps in order, handing each the value of the step it names", async () => {
    const c = defineComposed(file, {
      id: "T22",
      title: "hands workspaces on",
      steps: [
        { scenario: T16 },
        { scenario: T17, given: { from: 1 } },
        { scenario: T16 },
        { scenario: T17, given: { from: 3 } },
      ],
    });
    const runs: Array<Omit<ComposedStepRun, "scenario"> & { readonly id: string }> = [];
    const outcome = await runComposed(c, "r1", async ({ scenario, ...step }) => {
      runs.push({ id: scenario.id, ...step });
      return scenario.returns === "workspace"
        ? workspace(`${scenario.id}-${step.runId}`)
        : undefined;
    });
    expect(runs).toStrictEqual([
      { id: "T16", n: 1, given: undefined, runId: "r1s1" },
      { id: "T17", n: 2, given: workspace("T16-r1s1"), runId: "r1s2" },
      { id: "T16", n: 3, given: undefined, runId: "r1s3" },
      { id: "T17", n: 4, given: workspace("T16-r1s3"), runId: "r1s4" },
    ]);
    expect(outcome).toMatchObject({ ok: true, passed: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] });
  });

  it("stops at the failing step, naming its stage and the steps that did not run", async () => {
    const c = defineComposed(file, {
      id: "T21",
      title: "fails at step 2",
      steps: [{ scenario: T16 }, { scenario: T18 }, { scenario: T17, given: { from: 1 } }],
    });
    const ran: Array<string> = [];
    const failure = new StageFailure(
      "step-2 wrong state",
      new Error("the tree: expected 1, found 0"),
    );
    const outcome = await runComposed(c, "r", async ({ scenario }) => {
      ran.push(scenario.id);
      if (scenario.id === "T18") throw failure;
      return workspace("w");
    });
    expect(ran).toStrictEqual(["T16", "T18"]);
    expect(outcome).toMatchObject({
      ok: false,
      passed: [{ n: 1, scenario: T16 }],
      failed: { n: 2, scenario: T18, error: failure, stage: "step-2 wrong state" },
      notRun: [{ n: 3, scenario: T17 }],
      message: 'step 2 T18 at stage "step-2 wrong state": the tree: expected 1, found 0',
      notRunLines: ["not run: step 3 T17"],
    });
  });

  it("names a failure outside every stage without one", async () => {
    const c = defineComposed(file, { id: "T21", title: "c", steps: [{ scenario: T18 }] });
    const outcome = await runComposed(c, "r", async () => {
      throw new Error("boom");
    });
    expect(outcome).toMatchObject({ ok: false, message: "step 1 T18: boom", notRunLines: [] });
  });

  // AC-8: started with a wrong handover, nothing runs.
  it("runs no step of a composed scenario the registry rejects", async () => {
    const c = defineComposed(file, {
      id: "T21",
      title: "c",
      steps: [{ scenario: T18 }, { scenario: T17, given: { from: 1 } }],
    });
    const ran: Array<string> = [];
    await expect(
      runComposed(c, "r", async ({ scenario }) => {
        ran.push(scenario.id);
      }),
    ).rejects.toThrow(
      "T21 cannot run: T21 step 2 (T17) takes a workspace; step 1 (T18) returns nothing.",
    );
    expect(ran).toStrictEqual([]);
  });
});
