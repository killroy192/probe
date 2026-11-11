// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Playwright fixtures own the run's servers, homes and log files directly, and time each scenario.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { type Browser, type BrowserContext, test as base } from "@playwright/test";

import type { PointerPage } from "./browser.ts";
import {
  childPids,
  killServerTree,
  type ManifestEntry,
  openManifest,
  processStartTime,
} from "./cleanup.ts";
import { type ComposedOutcome, runComposed } from "./compose.ts";
import { createThrowawayHome, readRunPlan, removeThrowawayHome } from "./environment.ts";
import { ACTION_MS } from "./lib/deadlines.ts";
import { createTrail, type Trail } from "./lib/trail.ts";
import { resetRecorders } from "./lib/waits.ts";
import { composedNeeds, freshServerNeeded, perfVerdict } from "./registryRules.ts";
import { OUTCOME_ATTACHMENT, type StepOutcome } from "./reporter.ts";
import type {
  AnyScenario,
  ScenarioContext,
  ScenarioNeeds,
  ServerCondition,
  StepValue,
} from "./scenario.ts";
import {
  artifactLines,
  artifactsDir,
  asStageFailure,
  composedSteps,
  describeExit,
  failureMessage,
  guardShared,
  raceServerExit,
  runUndos,
  scenarioOutcome,
  sharedLogFile,
  type Undo,
} from "./scenarioRun.ts";
import { type ServerHandle, startServer } from "./server.ts";

const plan = readRunPlan(NodeProcess.env);
const VIEWPORT = { width: 1200, height: 800 };
const write = (line: string) => NodeProcess.stdout.write(`${line}\n`);
// Scenario durations are printed and judged only by the cap gate, never inside a scenario.
// oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): the runner's printed timing
const clock = () => performance.now();

type Manifest = ReturnType<typeof openManifest>;
type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** One login per server: later pages on it reuse the first one's session. */
const sessions = new WeakMap<ServerHandle, Session>();

interface OwnedServer {
  handle: ServerHandle | undefined;
  readonly home: string;
  /** Ends the server, its shell host and shells, and removes its home; safe to call twice. */
  readonly stop: () => Promise<void>;
}

/**
 * Starts a server on a throwaway home with a leased port, recorded in `manifest` from its spawn on,
 * so a killed worker's servers are swept by the launcher. `register` gets the stop before the start
 * begins, so a teardown during the start still stops it.
 */
async function startOwned(
  manifest: Manifest,
  options: {
    readonly serverBin: string | undefined;
    readonly condition?: ServerCondition;
    readonly onOutput?: (chunk: string) => void;
    readonly register: (owned: OwnedServer) => void;
  },
): Promise<OwnedServer & { readonly handle: ServerHandle }> {
  // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- permanent (a): the PID-reuse guard's timestamp
  const homeCreatedMs = Date.now();
  const home = await createThrowawayHome();
  let entry: ManifestEntry | undefined;
  const record = (pid: number) => {
    if (entry !== undefined) manifest.remove(entry.pid);
    entry = { kind: "server", pid, startTime: processStartTime(pid) ?? "", home, homeCreatedMs };
    manifest.add(entry);
  };
  let stopping: Promise<void> | undefined;
  const owned: OwnedServer = {
    handle: undefined,
    home,
    stop: () =>
      (stopping ??= (async () => {
        await owned.handle?.kill().catch(() => undefined);
        // The server is gone; its shell host and shells go with the home.
        if (entry === undefined) await removeThrowawayHome(home);
        else {
          killServerTree(entry);
          manifest.remove(entry.pid);
        }
      })()),
  };
  options.register(owned);
  const handle = await startServer({
    home,
    serverBin: options.serverBin,
    isolateShell: !(plan?.ownShellConfig ?? false),
    ...(options.condition !== undefined && { env: await options.condition.env(home) }),
    onSpawn: record,
    ...(options.onOutput !== undefined && { onOutput: options.onOutput }),
  });
  owned.handle = handle;
  return { ...owned, handle, stop: owned.stop };
}

/** The worker's shared server, started by the first scenario that asks for it. */
export interface SharedServer {
  readonly get: () => Promise<ServerHandle>;
}

interface SharedRun {
  readonly owned: OwnedServer & { readonly handle: ServerHandle };
  readonly pid: number;
  readonly log: NodeFS.WriteStream;
  scenarios: number;
  exited: boolean;
}

const artifactsRootOf = (outputDir: string) => plan?.artifactsRoot ?? NodePath.dirname(outputDir);

async function stopShared(run: SharedRun) {
  const host = run.owned.handle.shellHostPid();
  const shells = host === null ? 0 : childPids(host).length;
  write(`scenarios: server ${run.pid}: ${run.scenarios} scenarios, ${shells} shells running`);
  await run.owned.stop();
  await new Promise<void>((resolve) => run.log.end(resolve));
}

const needsOf = (scenario: AnyScenario): ScenarioNeeds =>
  scenario.kind === "composed" ? composedNeeds(scenario) : scenario.needs;

interface TrackedContext {
  readonly context: BrowserContext;
  tracing: boolean;
}

/** Everything one test started, so its end, or a teardown that interrupts it, stops exactly that. */
interface TestRun {
  readonly contexts: Array<TrackedContext>;
  readonly servers: Array<OwnedServer>;
}

async function closeContexts(run: TestRun) {
  for (const tracked of run.contexts.splice(0)) {
    if (tracked.tracing) {
      tracked.tracing = false;
      await tracked.context.tracing.stop().catch(() => undefined);
    }
    await tracked.context.close().catch(() => undefined);
  }
}

async function stopServers(run: TestRun) {
  for (const server of run.servers.splice(0).reverse()) await server.stop();
}

/** Rejects nothing; resolves with the first unexpected exit of any server watched. */
function exitSignal() {
  let report: (cause: string) => void = () => {};
  const exited = new Promise<string>((resolve) => {
    report = resolve;
  });
  return {
    exited,
    watch: (label: string, server: ServerHandle) => {
      let pid: number | undefined;
      try {
        pid = server.pid();
      } catch {
        pid = undefined;
      }
      void server.unexpectedExit().then((exit) => report(describeExit(label, pid, exit)));
    },
  };
}

interface Runtime {
  readonly scenario: AnyScenario;
  readonly browser: Browser;
  readonly manifest: Manifest;
  readonly artifactsRoot: string;
  readonly run: TestRun;
  readonly trail: Trail;
  readonly exits: ReturnType<typeof exitSignal>;
  readonly undone: Array<string>;
  readonly artifacts: Array<string>;
  /** Failures whose artifacts a step saved already. */
  readonly saved: WeakSet<object>;
}

/** Saves a failure's artifacts into `dir`: the trail's pieces, then each traced context's trace. */
async function saveArtifacts(rt: Runtime, dir: string, error: unknown) {
  const { saved, missing } = await rt.trail.save(dir, error);
  const traces: Array<string> = [];
  const traceMissing: Array<string> = [];
  for (const [index, tracked] of rt.run.contexts.entries()) {
    if (!tracked.tracing) continue;
    tracked.tracing = false;
    const name = `trace-${index + 1}.zip`;
    try {
      await tracked.context.tracing.stop({ path: NodePath.join(dir, name) });
      traces.push(name);
    } catch (cause) {
      traceMissing.push(
        `${name}: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
      );
    }
  }
  rt.artifacts.push(...artifactLines(dir, [...saved, ...traces], [...missing, ...traceMissing]));
  if (typeof error === "object" && error !== null) rt.saved.add(error);
}

function contextFor(rt: Runtime, server: ServerHandle, sessionKey: ServerHandle) {
  const signIn = async (page: PointerPage, context: BrowserContext) => {
    await page.goto(await server.pairingUrl());
    await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
    sessions.set(sessionKey, await context.storageState());
  };
  const newPage = async (signedIn: boolean): Promise<PointerPage> => {
    const session = signedIn ? sessions.get(sessionKey) : undefined;
    const context = await rt.browser.newContext({
      viewport: VIEWPORT,
      ...(session !== undefined && { storageState: session }),
    });
    const tracked: TrackedContext = { context, tracing: false };
    rt.run.contexts.push(tracked);
    // A broken step should fail in seconds; Playwright's 30 s default makes each failure slow.
    context.setDefaultTimeout(ACTION_MS);
    await context.tracing.start({ snapshots: true, screenshots: true });
    tracked.tracing = true;
    const page = await context.newPage();
    rt.trail.addPage(signedIn ? "signed-in" : "anonymous", page);
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
  return newPage;
}

async function startFresh(
  rt: Runtime,
  label: string,
  serverBin: string | undefined,
  condition?: ServerCondition,
) {
  const { handle } = await startOwned(rt.manifest, {
    serverBin,
    ...(condition !== undefined && { condition }),
    register: (owned) => rt.run.servers.push(owned),
  });
  write(`scenarios: ${rt.scenario.id} ${label} pid=${handle.pid()} home=${handle.home}`);
  rt.trail.addServer(label, handle);
  rt.exits.watch(label, handle);
  return handle;
}

/**
 * Runs one atomic check, or a perf scenario's measure, as `stepId` on `server`: the run raced
 * against an unexpected server exit, its artifacts saved into `dir` on a failure, then its undos.
 */
async function runStep<A>(
  rt: Runtime,
  step: {
    readonly id: string;
    readonly runId: string;
    readonly dir: string;
    readonly server: ServerHandle;
    readonly sessionKey: ServerHandle;
    readonly body: (context: ScenarioContext) => Promise<A>;
  },
): Promise<A> {
  const undos: Array<Undo> = [];
  const newPage = contextFor(rt, step.server, step.sessionKey);
  const context: ScenarioContext = {
    server: step.server,
    runId: step.runId,
    scenarioId: step.id,
    trail: rt.trail,
    onStepEnd: (what, undo) => {
      undos.push({ what, undo });
    },
    openPage: () => newPage(true),
    openAnonymousPage: () => newPage(false),
    startSecondServer: (options) =>
      startFresh(rt, "second server", options?.serverBin ?? plan?.serverBin),
  };
  let failure: unknown;
  let value: A | undefined;
  try {
    value = await raceServerExit(step.body(context), rt.exits.exited, rt.trail.current);
  } catch (caught) {
    failure = asStageFailure(caught, rt.trail.current());
    await saveArtifacts(rt, step.dir, failure);
  }
  // After the artifacts, so they show the state the failure left.
  const undone = await runUndos(undos);
  rt.undone.push(...undone.undone);
  if (failure === undefined && undone.failure !== undefined) {
    failure = asStageFailure(undone.failure, rt.trail.current());
    await saveArtifacts(rt, step.dir, failure);
  }
  if (failure !== undefined) throw failure;
  return value as A;
}

interface Fixtures {
  /** Runs `scenario` as this test: its server, pages, steps, artifacts and the reporter's outcome. */
  readonly runScenario: (scenario: AnyScenario) => Promise<void>;
}

interface WorkerFixtures {
  readonly workerManifest: Manifest;
  readonly sharedServer: SharedServer;
}

export const scenarioTest = base.extend<Fixtures, WorkerFixtures>({
  workerManifest: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
    async ({}, use) => {
      const manifest = openManifest(undefined, plan?.launcher);
      await use(manifest);
      manifest.close();
    },
    { scope: "worker" },
  ],

  sharedServer: [
    async ({ workerManifest }, use, workerInfo) => {
      const root = artifactsRootOf(workerInfo.project.outputDir);
      let started: Promise<SharedRun> | undefined;
      let n = 0;
      const start = async (): Promise<SharedRun> => {
        n += 1;
        const file = sharedLogFile(root, workerInfo.workerIndex, n);
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        const log = NodeFS.createWriteStream(file, { flags: "a" });
        let owned: OwnedServer | undefined;
        try {
          const startedOwned = await startOwned(workerManifest, {
            serverBin: plan?.serverBin,
            onOutput: (chunk) => log.write(chunk),
            register: (registered) => {
              owned = registered;
            },
          });
          const run: SharedRun = {
            owned: startedOwned,
            pid: startedOwned.handle.pid(),
            log,
            scenarios: 0,
            exited: false,
          };
          void startedOwned.handle.unexpectedExit().then(() => {
            run.exited = true;
          });
          write(
            `scenarios: worker ${workerInfo.workerIndex} shared server pid=${run.pid} home=${startedOwned.home} log=${file}`,
          );
          return run;
        } catch (error) {
          await owned?.stop();
          log.end();
          throw error;
        }
      };
      const get = async () => {
        const current = started === undefined ? undefined : await started;
        // A server that ended between two scenarios is replaced, so the next one is not blamed.
        if (current?.exited) {
          started = undefined;
          await stopShared(current);
        }
        started ??= start();
        const run = await started;
        run.scenarios += 1;
        return run.owned.handle;
      };
      await use({ get });
      const last = await started?.catch(() => undefined);
      if (last !== undefined) await stopShared(last);
    },
    { scope: "worker" },
  ],

  runScenario: async ({ browser, sharedServer, workerManifest }, use, testInfo) => {
    const run: TestRun = { contexts: [], servers: [] };
    await use(async (scenario) => {
      resetRecorders();
      const rt: Runtime = {
        scenario,
        browser,
        manifest: workerManifest,
        artifactsRoot: artifactsRootOf(testInfo.project.outputDir),
        run,
        trail: createTrail(),
        exits: exitSignal(),
        undone: [],
        artifacts: [],
        saved: new WeakSet(),
      };
      const needs = needsOf(scenario);
      const fresh = freshServerNeeded(needs);
      const ownDir = artifactsDir(rt.artifactsRoot, scenario.id);
      const runId = NodeCrypto.randomBytes(3).toString("hex");
      let startedMs = clock();
      let failure: string | undefined;
      let steps: ReadonlyArray<StepOutcome> | undefined;
      try {
        let server: ServerHandle;
        let sessionKey: ServerHandle;
        if (fresh) {
          // A fresh server's start counts in the scenario's time; the shared one's never does.
          startedMs = clock();
          server = await startFresh(rt, "server", plan?.serverBin, needs.condition);
          sessionKey = server;
        } else {
          sessionKey = await sharedServer.get();
          startedMs = clock();
          server = guardShared(sessionKey, scenario.id);
          rt.trail.addServer("server", sessionKey);
          rt.exits.watch("shared server", sessionKey);
        }
        const step = { server, sessionKey };
        switch (scenario.kind) {
          case "check":
            await runStep(rt, {
              ...step,
              id: scenario.id,
              runId,
              dir: ownDir,
              body: (context) => scenario.run(context, undefined),
            });
            break;
          case "perf": {
            const ms = await runStep(rt, {
              ...step,
              id: scenario.id,
              runId,
              dir: ownDir,
              body: (context) => scenario.run(context),
            });
            const verdict = perfVerdict(scenario, ms);
            write(verdict.line);
            if (!verdict.pass) failure = verdict.line;
            break;
          }
          case "composed": {
            const durations = new Map<number, number>();
            let outcome: ComposedOutcome | undefined;
            try {
              outcome = await runComposed(
                scenario,
                runId,
                async ({ n, scenario: check, given, runId: stepRunId }) => {
                  const prefix = `step ${n}`;
                  const from = clock();
                  try {
                    return await rt.trail.within(prefix, () =>
                      runStep<StepValue | void>(rt, {
                        ...step,
                        id: check.id,
                        runId: stepRunId,
                        dir: artifactsDir(rt.artifactsRoot, scenario.id, { n, id: check.id }),
                        body: (context) => check.run(context, given),
                      }),
                    );
                  } catch (error) {
                    failure = failureMessage(error, prefix);
                    throw error;
                  } finally {
                    durations.set(n, clock() - from);
                  }
                },
              );
            } finally {
              steps = composedSteps(scenario, outcome, durations);
            }
            break;
          }
        }
      } catch (caught) {
        const error = asStageFailure(caught, rt.trail.current());
        failure = failureMessage(error);
        if (!rt.saved.has(error)) await saveArtifacts(rt, ownDir, error);
      }
      const durationMs = clock() - startedMs;
      for (const { label, bytes } of rt.trail.logSizes()) {
        write(`scenarios: ${scenario.id} ${label} log=${Math.ceil(bytes / 1024)}KiB`);
      }
      const teardownFrom = clock();
      await closeContexts(run);
      await stopServers(run);
      const outcome = scenarioOutcome({
        id: scenario.id,
        durationMs,
        teardownMs: clock() - teardownFrom,
        freshServer: fresh,
        failure,
        artifacts: rt.artifacts,
        undone: rt.undone,
        steps,
      });
      await testInfo.attach(OUTCOME_ATTACHMENT, {
        body: JSON.stringify(outcome),
        contentType: "application/json",
      });
      if (failure !== undefined) throw new Error(failure);
    });
    // Reached with work left only when Playwright ends the test early, such as on an interrupt.
    await closeContexts(run);
    await stopServers(run);
  },
});
