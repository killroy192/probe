#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Scenario runner owns host processes and directories directly, and times its own runs.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { Browser, BrowserContext } from "playwright-core";

import { launchBrowser, type PointerPage } from "./browser.ts";
import { ensureWebBundle } from "./bundle.ts";
import {
  cleanLeftovers,
  findSandbox,
  killServerTree,
  type ManifestEntry,
  lockSandbox,
  openManifest,
  processStartTime,
  type SandboxRecord,
} from "./cleanup.ts";
import {
  createThrowawayHome,
  defaultArtifactsDir,
  parseArgs,
  refusalReason,
  removeThrowawayHome,
  type RunOptions,
  strayArgs,
} from "./environment.ts";
import { scenarioShell } from "./isolation.ts";
import { ACTION_MS } from "./lib/deadlines.ts";
import { createTrail, StageFailure } from "./lib/trail.ts";
import { resetRecorders } from "./lib/waits.ts";
import {
  pickedSelftestScenarios,
  scenarios,
  selftestScenarios,
  storyScenarios,
} from "./registry.ts";
import { pickScenario, sandboxRefusal, staleSandboxFile } from "./sandboxRules.ts";
import type { Scenario } from "./scenario.ts";
import { attachServer, REPO_ROOT, startServer, type ServerHandle } from "./server.ts";

const TOTAL = 8;

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
// oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): the runner's printed timing
const clock = () => performance.now();
const VIEWPORT = { width: 1200, height: 800 };
const seconds = (fromMs: number) => `${((clock() - fromMs) / 1000).toFixed(1)} s`;

interface Owned {
  handle: ServerHandle | undefined;
  readonly stop: () => Promise<void>;
}

interface SandboxTarget {
  readonly pid: number;
  readonly record: SandboxRecord;
}

/** True once the sandbox is stopping: its stop kills the server before it removes the home. */
function sandboxEnded(pid: number): boolean {
  const found = findSandbox(pid);
  return (
    "refusal" in found ||
    processStartTime(found.sandbox.serverPid) === null ||
    !NodeFS.existsSync(found.sandbox.home)
  );
}

const sandboxEndedError = (pid: number) =>
  new Error(`The sandbox ${pid} ended during the run; no server is started in its place.`);

/** Rejects once the sandbox is gone, so a run on it fails at once instead of on a page timeout. */
function sandboxEnds(pid: number): Promise<never> {
  return new Promise((_, reject) => {
    // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- permanent (c): the sandbox is not this run's child, so no exit event reaches it
    const timer = setInterval(() => {
      if (!sandboxEnded(pid)) return;
      clearInterval(timer);
      reject(sandboxEndedError(pid));
    }, 250);
    cleanups.push(async () => clearInterval(timer));
  });
}

/**
 * What a run on a sandbox targets, or why it is refused; checked before the sandbox is touched.
 * Only a registered scenario that needs nothing from its server runs there.
 */
function sandboxTarget(
  argv: ReadonlyArray<string>,
  options: RunOptions,
  sandboxPid: number,
): { readonly target: SandboxTarget; readonly scenario: Scenario } | { readonly refusal: string } {
  const [stray] = strayArgs(argv);
  if (stray !== undefined) {
    const picked = pickScenario(stray, []);
    return { refusal: "refusal" in picked ? picked.refusal : `${stray} is not an option.` };
  }
  for (const flag of ["--rebuild", "--server-bin", "--own-shell-config", "--selftest"]) {
    if (argv.includes(flag)) {
      return { refusal: `${flag} does not apply to a sandbox; start a new sandbox instead.` };
    }
  }
  if (options.only === undefined)
    return { refusal: "--sandbox runs one scenario; name it with --only <id>." };
  const picked = pickScenario(options.only, [
    ...scenarios,
    ...storyScenarios,
    ...selftestScenarios,
    ...pickedSelftestScenarios,
  ]);
  if ("refusal" in picked) return picked;
  const refusal = sandboxRefusal(picked.scenario);
  if (refusal !== undefined) return { refusal };
  const found = findSandbox(sandboxPid);
  if ("refusal" in found) return found;
  const stale = staleSandboxFile(REPO_ROOT, found.sandbox);
  if (stale !== null) {
    return {
      refusal: `${stale} changed since sandbox ${sandboxPid} started, so it would run older code; start a new sandbox.`,
    };
  }
  return { target: { pid: sandboxPid, record: found.sandbox }, scenario: picked.scenario };
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
  sandbox: SandboxTarget | undefined,
): Promise<Outcome> {
  const startedMs = clock();
  resetRecorders();
  const trail = createTrail();
  const owned: Array<Owned> = [];
  const contexts: Array<BrowserContext> = [];
  const startOwnedServer = async (label: string, serverBin: string | undefined) => {
    // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): the PID-reuse guard's timestamp
    const homeCreatedMs = Date.now();
    const home = await createThrowawayHome();
    let entry: ManifestEntry | undefined;
    const record = (pid: number) => {
      if (entry !== undefined) manifest?.remove(entry.pid);
      entry = { kind: "server", pid, startTime: processStartTime(pid) ?? "", home, homeCreatedMs };
      manifest?.add(entry);
    };
    const server: Owned = {
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
    trail.addServer(label, server.handle);
    return server.handle;
  };

  const attachSandbox = (record: SandboxRecord) => {
    const handle = attachServer(
      record,
      (need) => new Error(`${scenario.id} tried ${need} on the sandbox, a need it did not state.`),
    );
    // Its log from now on is this run's share; the sandbox owns and stops its server.
    trail.addServer("sandbox server", handle);
    return handle;
  };

  const undos: Array<{ readonly what: string; readonly undo: () => Promise<void> }> = [];
  let error: unknown;
  let artifacts: string | undefined;
  const fail = async (caught: unknown) => {
    error = caught instanceof StageFailure ? caught : new StageFailure(trail.current(), caught);
    const dir = NodePath.join(artifactsRoot, scenario.id);
    const { saved, missing } = await trail.save(dir, error);
    artifacts = [
      `artifacts: ${dir}${saved.length > 0 ? ` (${saved.join(", ")})` : ""}`,
      ...missing.map((note) => `artifact missing: ${note}`),
    ].join("\n        ");
  };
  try {
    const server =
      sandbox === undefined
        ? await startOwnedServer("server", options.serverBin)
        : attachSandbox(sandbox.record);
    // One login per server run: the first signed-in page pairs, later ones reuse its session.
    let session: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
    const signIn = async (page: PointerPage, context: BrowserContext) => {
      await page.goto(await server.pairingUrl());
      await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
      session = await context.storageState();
    };
    const newPage = async (signedIn: boolean): Promise<PointerPage> => {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        ...(signedIn && session !== undefined ? { storageState: session } : {}),
      });
      contexts.push(context);
      // A broken step should fail in seconds; Playwright's 30 s default makes each failure slow.
      context.setDefaultTimeout(ACTION_MS);
      const page = await context.newPage();
      trail.addPage(signedIn ? "signed-in" : "anonymous", page);
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
    const running = scenario.run!({
      server,
      runId: NodeCrypto.randomBytes(3).toString("hex"),
      scenarioId: scenario.id,
      trail,
      onStepEnd: (what, undo) => {
        undos.push({ what, undo });
      },
      openPage: () => newPage(true),
      openAnonymousPage: () => newPage(false),
      startSecondServer: (secondOptions) =>
        sandbox === undefined
          ? startOwnedServer("second server", secondOptions?.serverBin ?? options.serverBin)
          : Promise.reject(
              new Error(
                `${scenario.id} tried a second server on the sandbox, a need it did not state.`,
              ),
            ),
    });
    if (sandbox === undefined) await running;
    else {
      // Once the race is lost, the scenario's own failure is not the one reported.
      running.catch(() => undefined);
      await Promise.race([running, sandboxEnds(sandbox.pid)]).catch((caught) => {
        throw sandboxEnded(sandbox.pid) ? sandboxEndedError(sandbox.pid) : caught;
      });
    }
  } catch (caught) {
    await fail(caught);
  }
  // After the artifacts, so they show the state the failure left.
  for (const { what, undo } of undos.splice(0).reverse()) {
    try {
      await undo();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      if (error === undefined) await fail(new Error(`Undoing ${what} failed: ${reason}`));
    }
  }
  const durationMs = clock() - startedMs;
  for (const { label, bytes } of trail.logSizes()) {
    write(`scenarios: ${scenario.id} ${label} log=${Math.ceil(bytes / 1024)}KiB`);
  }
  const teardownFrom = clock();
  for (const context of contexts) await context.close().catch(() => undefined);
  for (const server of owned.reverse()) {
    const index = cleanups.indexOf(server.stop);
    // An interrupt may already have taken it, and stops it itself.
    if (index === -1) continue;
    cleanups.splice(index, 1);
    await server.stop();
  }
  return { error, durationMs, teardownMs: clock() - teardownFrom, artifacts };
}

async function main(): Promise<number> {
  const runStartedMs = clock();
  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): names the artifacts folder
  const startedAt = new Date();
  const argv = NodeProcess.argv.slice(2);
  const refusal = refusalReason(argv, NodeProcess.env);
  if (refusal) {
    NodeProcess.stderr.write(`scenarios: refusing to run. ${refusal}\n`);
    return 2;
  }
  const options = parseArgs(argv);
  let sandbox: SandboxTarget | undefined;
  let selected: ReadonlyArray<Scenario>;
  if (options.sandbox !== undefined) {
    const refuse = (why: string) => {
      NodeProcess.stderr.write(`scenarios: refusing to run on the sandbox. ${why}\n`);
      return 2;
    };
    const prepared = sandboxTarget(argv, options, options.sandbox);
    if ("refusal" in prepared) return refuse(prepared.refusal);
    const lock = lockSandbox(options.sandbox);
    if ("refusal" in lock) return refuse(lock.refusal);
    cleanups.push(async () => lock.release());
    sandbox = prepared.target;
    selected = [prepared.scenario];
  } else {
    const all = !options.selftest
      ? [...scenarios, ...storyScenarios]
      : options.only === undefined
        ? selftestScenarios
        : [...selftestScenarios, ...pickedSelftestScenarios];
    selected = options.only === undefined ? all : all.filter(({ id }) => id === options.only);
  }
  cleanLeftovers(write);
  manifest = openManifest();

  // The sandbox's server serves the bundle it started with; a run never rebuilds it under it.
  if (sandbox === undefined) await ensureWebBundle(REPO_ROOT, options.rebuild, write);
  else {
    write(
      `scenarios: on sandbox ${sandbox.pid} (server pid=${sandbox.record.serverPid} home=${sandbox.record.home})`,
    );
  }
  const browser = await launchBrowser(options.browser);
  cleanups.push(() => browser.close());
  write(
    `scenarios: ready (shells: ${options.ownShellConfig ? "your own shell config" : `${scenarioShell()}, isolated`})`,
  );

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
    const outcome = await runScenario(scenario, browser, options, artifactsRoot, sandbox);
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
    sandbox !== undefined
      ? `scenarios: on sandbox ${sandbox.pid}, ${passed + storyPassed} passed, ${failed} failed`
      : options.selftest
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
