// @effect-diagnostics nodeBuiltinImport:off - Writes run manifests into a scratch folder.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  abandonment,
  cleanLeftovers,
  openManifest,
  type ProcessIdentity,
  sandboxEnded,
} from "./cleanup.ts";

const worker = { pid: 101, startTime: "w" };
const launcher = { pid: 100, startTime: "l" };

describe("abandoned manifests", () => {
  it.each([
    { name: "live owner, no run", run: undefined, live: [worker], expected: "live" },
    {
      name: "live owner, live launcher",
      run: launcher,
      live: [worker, launcher],
      expected: "live",
    },
    { name: "dead owner, live launcher", run: launcher, live: [launcher], expected: "ownerDead" },
    { name: "dead owner, no run", run: undefined, live: [], expected: "ownerDead" },
    { name: "live owner, dead launcher", run: launcher, live: [worker], expected: "launcherDead" },
  ])("$name is $expected", ({ run, live, expected }) => {
    const isLive = (process: ProcessIdentity) =>
      live.some((known) => known.pid === process.pid && known.startTime === process.startTime);
    expect(abandonment({ runner: worker, ...(run ? { run } : {}) }, isLive)).toBe(expected);
  });

  it("records the run's launcher, and the sweep leaves its own manifest alone", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-runs-"));
    try {
      const deadLauncher = { pid: 2 ** 22 + 1, startTime: "gone" };
      const manifest = openManifest(dir, deadLauncher);
      const path = NodePath.join(dir, `${process.pid}.json`);
      expect(JSON.parse(NodeFS.readFileSync(path, "utf8"))).toMatchObject({
        runner: { pid: process.pid },
        run: deadLauncher,
      });
      const lines: Array<string> = [];
      cleanLeftovers((line) => lines.push(line), dir);
      expect(NodeFS.existsSync(path)).toBe(true);
      expect(lines).toEqual([]);
      manifest.close();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a sandbox counts as ended once it marks itself stopping, while its server still runs", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-runs-"));
    try {
      const manifest = openManifest(dir);
      manifest.describeSandbox({
        origin: "http://127.0.0.1:20000",
        home: dir,
        serverPid: process.pid,
        logFile: NodePath.join(dir, "server.log"),
        startedMs: 0,
        bundleBuiltMs: null,
      });
      expect(sandboxEnded(process.pid, dir)).toBe(false);
      manifest.markSandboxStopping();
      expect(sandboxEnded(process.pid, dir)).toBe(true);
      manifest.close();
      expect(sandboxEnded(process.pid, dir)).toBe(true);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
