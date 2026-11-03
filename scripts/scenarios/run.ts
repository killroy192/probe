#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Scenario runner owns host processes and directories directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { Browser } from "playwright-core";

import { launchBrowser, type PointerPage } from "./browser.ts";
import {
  createThrowawayHome,
  parseArgs,
  refusalReason,
  removeThrowawayHome,
  type RunOptions,
} from "./environment.ts";
import { scenarios, selftestScenarios } from "./registry.ts";
import type { Scenario } from "./scenario.ts";
import { REPO_ROOT, startServer } from "./server.ts";

const WEB_INDEX = NodePath.join(REPO_ROOT, "apps/web/dist/index.html");
const TOTAL = 8;

// Everything the run started, so an interrupt or a failure stops exactly that and nothing else.
const cleanups: Array<() => Promise<void>> = [];
let cleaningUp: Promise<void> | undefined;

function cleanupAll(): Promise<void> {
  cleaningUp ??= (async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup().catch(() => undefined);
    }
  })();
  return cleaningUp;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    void cleanupAll().then(() => NodeProcess.exit(130));
  });
}

async function ensureWebBundle(options: RunOptions): Promise<void> {
  if (!options.rebuild && NodeFS.existsSync(WEB_INDEX)) return;
  NodeProcess.stdout.write("scenarios: building the web bundle\n");
  await new Promise<void>((resolve, reject) => {
    const build = NodeChildProcess.spawn("vp", ["run", "--filter", "@t3tools/web", "build"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    build.once("error", (error) =>
      reject(new Error(`Could not run the web build: ${error.message}`)),
    );
    build.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`The web build failed (exit code ${String(code)}).`)),
    );
  });
}

async function runScenario(
  scenario: Scenario,
  browser: Browser,
  options: RunOptions,
): Promise<void> {
  const home = await createThrowawayHome();
  const server = await startServer({ home, serverBin: options.serverBin });
  const stopServer = async () => {
    await server.stop();
    await removeThrowawayHome(home);
  };
  cleanups.push(stopServer);
  NodeProcess.stdout.write(`scenarios: ${scenario.id} server pid=${server.pid()} home=${home}\n`);
  try {
    const newPage = async (signedIn: boolean): Promise<PointerPage> => {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (signedIn) {
        await page.goto(await server.pairingUrl());
        await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
      }
      return page;
    };
    await scenario.run!({
      server,
      openPage: () => newPage(true),
      openAnonymousPage: () => newPage(false),
    });
  } finally {
    cleanups.splice(cleanups.indexOf(stopServer), 1);
    await stopServer();
  }
}

async function main(): Promise<number> {
  const argv = NodeProcess.argv.slice(2);
  const refusal = refusalReason(argv, NodeProcess.env);
  if (refusal) {
    NodeProcess.stderr.write(`scenarios: refusing to run. ${refusal}\n`);
    return 2;
  }
  const options = parseArgs(argv);

  await ensureWebBundle(options);
  const browser = await launchBrowser(options.browser);
  cleanups.push(() => browser.close());
  NodeProcess.stdout.write("scenarios: ready\n");

  const selected = options.selftest ? selftestScenarios : scenarios;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const scenario of selected) {
    const label = `${scenario.id} ${scenario.title}`;
    if (!scenario.run) {
      pending += 1;
      NodeProcess.stdout.write(`PENDING ${label}\n`);
      continue;
    }
    try {
      await runScenario(scenario, browser, options);
      passed += 1;
      NodeProcess.stdout.write(`PASS    ${label}\n`);
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      NodeProcess.stdout.write(`FAIL    ${label}: ${reason}\n`);
    }
  }

  NodeProcess.stdout.write(
    options.selftest
      ? `scenarios: self-test ${passed} passed, ${failed} failed\n`
      : `scenarios: ${passed}/${TOTAL} passing, ${pending} pending, ${failed} failed\n`,
  );
  return failed > 0 ? 1 : 0;
}

main()
  .catch((error: unknown) => {
    NodeProcess.stderr.write(
      `scenarios: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  })
  .then(async (code) => {
    await cleanupAll();
    NodeProcess.exit(code);
  });
