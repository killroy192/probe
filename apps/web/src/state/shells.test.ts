import type { ShellSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { nextRestoredMarks } from "./shells";

const shell = (shellId: string, change: Partial<ShellSummary> = {}): ShellSummary => ({
  shellId,
  cwd: "/repo",
  status: "running",
  pid: 1,
  exitCode: null,
  exitSignal: null,
  label: "zsh",
  title: null,
  process: null,
  project: "/repo",
  worktree: null,
  branch: null,
  elsewhere: null,
  ended: null,
  missing: false,
  restored: false,
  promptReady: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...change,
});

describe("nextRestoredMarks", () => {
  it("marks only the restores the page saw happen, until the server clears them", () => {
    // The list is still loading at first; the first list that arrives is the page's baseline.
    const loading = nextRestoredMarks(null, null);
    const first = nextRestoredMarks(loading, [
      shell("before", { restored: true }),
      shell("later"),
    ])!;
    expect([...first.shown]).toEqual([]);

    const restored = nextRestoredMarks(first, [
      shell("before", { restored: true }),
      shell("later", { restored: true }),
    ])!;
    expect([...restored.shown]).toEqual(["later"]);

    const cleared = nextRestoredMarks(restored, [shell("before"), shell("later")])!;
    expect([...cleared.shown]).toEqual([]);
    // Once cleared, a new restore of a shell that was restored before the page loaded shows.
    expect([
      ...nextRestoredMarks(cleared, [shell("before", { restored: true }), shell("later")])!.shown,
    ]).toEqual(["before"]);
  });

  it("marks a shell restored before the page loaded once it ends and is restored again", () => {
    const first = nextRestoredMarks(null, [shell("one", { restored: true })]);
    const ended = nextRestoredMarks(first, [
      shell("one", { restored: true, status: "exited", ended: "signal" }),
    ])!;
    expect([...ended.shown]).toEqual([]);
    expect([...nextRestoredMarks(ended, [shell("one", { restored: true })])!.shown]).toEqual([
      "one",
    ]);
  });
});
