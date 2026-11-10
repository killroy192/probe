#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Scenario runner owns host processes and directories directly, and times its own runs.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { Browser, BrowserContext } from "playwright-core";

import { launchBrowser, type PointerPage } from "./browser.ts";
import { bundleState } from "./bundle.ts";
import {
  cleanLeftovers,
  killServerTree,
  type ManifestEntry,
  openManifest,
  processStartTime,
} from "./cleanup.ts";
import {
  createThrowawayHome,
  defaultArtifactsDir,
  parseArgs,
  refusalReason,
  removeThrowawayHome,
  type RunOptions,
} from "./environment.ts";
import { scenarioShell } from "./isolation.ts";
import {
  pickedSelftestScenarios,
  scenarios,
  selftestScenarios,
  storyScenarios,
} from "./registry.ts";
import type { Scenario } from "./scenario.ts";
import { REPO_ROOT, startServer, type ServerHandle } from "./server.ts";
import { recorderTails, resetRecorders } from "./support.ts";

const TOTAL = 8;
const ACTION_TIMEOUT_MS = 10_000;
const LOG_TAIL_LINES = 200;

// Everything the run started, so an interrupt or a failure stops exactly that and nothing else.
const cleanups: Array<() => Promise<void>> = [];
let cleaningUp: Promise<void> | undefined;
let manifest: ReturnType<typeof openManifest> | undefined;

function cleanupAll(): Promise<void> {
  cleaningUp ??= (async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup().catch(() => undefined);
    }
    manifest?.close();
  })();
  return cleaningUp;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    void cleanupAll().then(() => NodeProcess.exit(130));
  });
}

const write = (line: string) => NodeProcess.stdout.write(`${line}\n`);
// Run and scenario durations are printed, never judged (NFR-6).
const seconds = (fromMs: number) => `${((performance.now() - fromMs) / 1000).toFixed(1)} s`;
const fromRepo = (path: string) => NodePath.relative(REPO_ROOT, path);

/** Rebuilds the web bundle when it is missing, older than its sources or `--rebuild` asks. */
async function ensureWebBundle(options: RunOptions): Promise<void> {
  const before = bundleState(REPO_ROOT);
  const reason = options.rebuild
    ? "--rebuild"
    : before.state === "missing"
      ? "no bundle yet"
      : before.state === "stale" && before.newest !== null
        ? `${fromRepo(before.newest.path)} is newer`
        : null;
  if (reason !== null) {
    write(`scenarios: building the web bundle (${reason})`);
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
  const after = bundleState(REPO_ROOT);
  const built = after.builtMs === null ? "never" : new Date(after.builtMs).toISOString();
  write(
    `scenarios: web bundle ${reason === null ? "current, reused" : "rebuilt"}, built ${built}${
      after.state === "stale" ? " (a source changed during the build; run again to rebuild)" : ""
    }`,
  );
}

interface Owned {
  readonly label: string;
  handle: ServerHandle | undefined;
  readonly stop: () => Promise<void>;
}

/** Saves what a failure leaves; each piece on its own, so one that fails never hides the error. */
async function saveArtifacts(
  dir: string,
  error: unknown,
  pages: ReadonlyArray<PointerPage>,
  servers: ReadonlyArray<Owned>,
): Promise<{ readonly saved: ReadonlyArray<string>; readonly missing: ReadonlyArray<string> }> {
  const saved: Array<string> = [];
  const missing: Array<string> = [];
  const attempt = async (name: string, save: (path: string) => Promise<unknown>) => {
    const path = NodePath.join(dir, name);
    try {
      await save(path);
      saved.push(name);
    } catch (cause) {
      missing.push(`${name}: ${cause instanceof Error ? cause.message.split("\n")[0] : cause}`);
    }
  };
  try {
    await NodeFSP.mkdir(dir, { recursive: true });
  } catch (cause) {
    return {
      saved,
      missing: [`${dir}: ${cause instanceof Error ? cause.message.split("\n")[0] : cause}`],
    };
  }
  await attempt("error.txt", (path) =>
    NodeFSP.writeFile(
      path,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
  );
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    await attempt(`page-${index + 1}.png`, (path) =>
      page.screenshot({ path, fullPage: true, timeout: 5_000 }),
    );
  }
  for (const { label, handle } of servers) {
    if (handle === undefined) continue;
    await attempt(`${label.replace(/\s+/g, "-")}-log-tail.txt`, (path) =>
      NodeFSP.writeFile(path, handle.logs().split("\n").slice(-LOG_TAIL_LINES).join("\n")),
    );
  }
  await attempt("recorders.json", (path) =>
    NodeFSP.writeFile(path, JSON.stringify(recorderTails(), null, 2)),
  );
  return { saved, missing };
}

interface Outcome {
  readonly error: unknown;
  readonly durationMs: number;
  readonly teardownMs: number;
  readonly artifacts: string | undefined;
}

async function runScenario(
  scenario: Scenario,
  browser: Browser,
  options: RunOptions,
  artifactsRoot: string,
): Promise<Outcome> {
  const startedMs = performance.now();
  resetRecorders();
  const owned: Array<Owned> = [];
  const pages: Array<PointerPage> = [];
  const contexts: Array<BrowserContext> = [];
  const startOwnedServer = async (label: string, serverBin: string | undefined) => {
    const homeCreatedMs = Date.now();
    const home = await createThrowawayHome();
    let entry: ManifestEntry | undefined;
    const record = (pid: number) => {
      if (entry !== undefined) manifest?.remove(entry.pid);
      entry = { kind: "server", pid, startTime: processStartTime(pid) ?? "", home, homeCreatedMs };
      manifest?.add(entry);
    };
    const server: Owned = {
      label,
      handle: undefined,
      stop: async () => {
        await server.handle?.kill();
        // The server is gone; its shell host and shells go with the home.
        if (entry === undefined) await removeThrowawayHome(home);
        else {
          killServerTree(entry);
          manifest?.remove(entry.pid);
        }
      },
    };
    cleanups.push(server.stop);
    owned.push(server);
    server.handle = await startServer({
      home,
      serverBin,
      isolateShell: !options.ownShellConfig,
      onSpawn: record,
    });
    write(`scenarios: ${scenario.id} ${label} pid=${server.handle.pid()} home=${home}`);
    return server.handle;
  };

  let error: unknown;
  let artifacts: string | undefined;
  try {
    const server = await startOwnedServer("server", options.serverBin);
    // One login per server run: the first signed-in page pairs, later ones reuse its session.
    let session: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
    const signIn = async (page: PointerPage, context: BrowserContext) => {
      await page.goto(await server.pairingUrl());
      await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
      session = await context.storageState();
    };
    const newPage = async (signedIn: boolean): Promise<PointerPage> => {
      const context = await browser.newContext(
        signedIn && session !== undefined ? { storageState: session } : {},
      );
      contexts.push(context);
      // A broken step should fail in seconds; Playwright's 30 s default makes each failure slow.
      context.setDefaultTimeout(ACTION_TIMEOUT_MS);
      const page = await context.newPage();
      pages.push(page);
      if (!signedIn) return page;
      if (session === undefined) {
        await signIn(page, context);
        return page;
      }
      await page.goto(server.origin);
      // A session the server no longer knows sends the page to pairing; sign in once more.
      if (new URL(page.url()).pathname.startsWith("/pair")) await signIn(page, context);
      return page;
    };
    await scenario.run!({
      server,
      openPage: () => newPage(true),
      openAnonymousPage: () => newPage(false),
      startSecondServer: (secondOptions) =>
        startOwnedServer("second server", secondOptions?.serverBin ?? options.serverBin),
    });
  } catch (caught) {
    error = caught;
    const dir = NodePath.join(artifactsRoot, scenario.id);
    const { saved, missing } = await saveArtifacts(dir, caught, pages, owned);
    artifacts = [
      `artifacts: ${dir}${saved.length > 0 ? ` (${saved.join(", ")})` : ""}`,
      ...missing.map((note) => `artifact missing: ${note}`),
    ].join("\n        ");
  }
  const durationMs = performance.now() - startedMs;
  const teardownFrom = performance.now();
  for (const context of contexts) await context.close().catch(() => undefined);
  for (const server of owned.reverse()) {
    const index = cleanups.indexOf(server.stop);
    // An interrupt may already have taken it, and stops it itself.
    if (index === -1) continue;
    cleanups.splice(index, 1);
    await server.stop();
  }
  return { error, durationMs, teardownMs: performance.now() - teardownFrom, artifacts };
}

async function main(): Promise<number> {
  const runStartedMs = performance.now();
  const startedAt = new Date();
  const argv = NodeProcess.argv.slice(2);
  const refusal = refusalReason(argv, NodeProcess.env);
  if (refusal) {
    NodeProcess.stderr.write(`scenarios: refusing to run. ${refusal}\n`);
    return 2;
  }
  const options = parseArgs(argv);
  cleanLeftovers(write);
  manifest = openManifest();

  await ensureWebBundle(options);
  const browser = await launchBrowser(options.browser);
  cleanups.push(() => browser.close());
  write(
    `scenarios: ready (shells: ${options.ownShellConfig ? "your own shell config" : `${scenarioShell()}, isolated`})`,
  );

  const all = !options.selftest
    ? [...scenarios, ...storyScenarios]
    : options.only === undefined
      ? selftestScenarios
      : [...selftestScenarios, ...pickedSelftestScenarios];
  const selected = options.only === undefined ? all : all.filter(({ id }) => id === options.only);
  if (selected.length === 0) {
    NodeProcess.stderr.write(`scenarios: no scenario has the id ${options.only}.\n`);
    return 2;
  }
  const artifactsRoot = options.artifacts ?? defaultArtifactsDir(startedAt);
  let passed = 0;
  let storyPassed = 0;
  let failed = 0;
  let pending = 0;
  for (const scenario of selected) {
    const label = `${scenario.id} ${scenario.title}`;
    if (!scenario.run) {
      pending += 1;
      write(`PENDING ${label}`);
      continue;
    }
    const outcome = await runScenario(scenario, browser, options, artifactsRoot);
    const timing = `(${(outcome.durationMs / 1000).toFixed(1)} s, teardown ${Math.round(outcome.teardownMs)} ms)`;
    if (outcome.error === undefined) {
      if (storyScenarios.includes(scenario)) storyPassed += 1;
      else passed += 1;
      write(`PASS    ${label} ${timing}`);
    } else {
      failed += 1;
      const reason = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      write(`FAIL    ${label} ${timing}: ${reason}`);
      if (outcome.artifacts !== undefined) write(`        ${outcome.artifacts}`);
    }
  }

  write(
    options.selftest
      ? `scenarios: self-test ${passed} passed, ${failed} failed`
      : `scenarios: ${passed}/${TOTAL} passing, ${pending} pending, ${failed} failed (story checks: ${storyPassed}/${storyScenarios.length} passing)`,
  );
  write(`scenarios: total ${seconds(runStartedMs)}`);
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
