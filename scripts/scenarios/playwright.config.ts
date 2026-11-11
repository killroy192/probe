// @effect-diagnostics nodeBuiltinImport:off - Playwright's main process signals itself when its launcher goes away.

import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { defineConfig } from "@playwright/test";

import { openManifest } from "./cleanup.ts";
import { defaultWorkers, readRunPlan } from "./environment.ts";
import { ACTION_MS } from "./lib/deadlines.ts";

const plan = readRunPlan(NodeProcess.env);

// Workers load this file too; only Playwright's main process is the launcher's child.
if (plan !== undefined && NodeProcess.ppid === plan.launcher.pid) {
  const manifest = openManifest(undefined, plan.launcher);
  NodeProcess.once("exit", () => manifest.close());
  // A launcher killed with SIGKILL closes the IPC channel; SIGINT is Playwright's graceful stop.
  NodeProcess.once("disconnect", () => NodeProcess.kill(NodeProcess.pid, "SIGINT"));
}

const outputRoot =
  plan?.artifactsRoot ?? NodePath.join(NodeOS.tmpdir(), "probe-scenario-artifacts", "unplanned");

export default defineConfig({
  testDir: ".",
  testMatch: "suite.spec.ts",
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  maxFailures: 0,
  fullyParallel: true,
  workers: plan?.workers ?? defaultWorkers(NodeOS.availableParallelism()),
  // The one hang ceiling; a stuck step fails first on the action and navigation timeouts below.
  timeout: 180_000,
  outputDir: NodePath.join(outputRoot, "playwright"),
  preserveOutput: "failures-only",
  reporter: [["./reporter.ts", plan?.reporter ?? {}]],
  use: {
    browserName: "chromium",
    headless: true,
    trace: "off",
    actionTimeout: ACTION_MS,
    navigationTimeout: ACTION_MS,
    ...(plan?.browser !== undefined && { launchOptions: { executablePath: plan.browser } }),
  },
});
