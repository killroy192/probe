// @effect-diagnostics nodeBuiltinImport:off - Runs the hook script with sh on scratch files.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, onTestFinished } from "vite-plus/test";

import { holdingHook } from "./files.ts";

describe("holdingHook", () => {
  it("passes at once without the hold, and gives up on a release that never comes", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-hook-"));
    onTestFinished(() => NodeFS.rmSync(dir, { recursive: true, force: true }));
    const hold = NodePath.join(dir, "hold");
    const hook = NodePath.join(dir, "post-checkout");
    NodeFS.writeFileSync(hook, holdingHook(hold, NodePath.join(dir, "release"), 2));
    const run = () => NodeChildProcess.spawnSync("sh", [hook], { encoding: "utf8" }).status;
    expect(run()).toBe(0);
    NodeFS.writeFileSync(hold, "");
    // Unbounded, this would wait for the release forever and the test would hit its ceiling.
    expect(run()).toBe(0);
  });
});
