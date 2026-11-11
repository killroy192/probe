import { boot } from "./scenarios/boot.ts";
import { branchLabelPerf } from "./scenarios/branch-label.perf.ts";
import { closeTabScenario } from "./scenarios/close-tab.ts";
import { killShell } from "./scenarios/kill-shell.ts";
import { manyShells } from "./scenarios/many-shells.ts";
import { plusModal } from "./scenarios/plus-modal.ts";
import { promptHarnessPerf } from "./scenarios/prompt-harness.perf.ts";
import { promptServerPerf } from "./scenarios/prompt-server.perf.ts";
import { restartSurvival } from "./scenarios/restart.ts";
import { restoreShell } from "./scenarios/restore-shell.ts";
import { secondServer } from "./scenarios/second-server.ts";
import { layoutReload, layoutSignal, tabSignals } from "./scenarios/signals.ts";
import { plainShell, startFailures, userScripts } from "./scenarios/starting-scripts.ts";
import { standaloneShell } from "./scenarios/standalone-shell.ts";
import { startToBannerPerf } from "./scenarios/start-to-banner.perf.ts";
import { treeNodePerf } from "./scenarios/tree-node.perf.ts";
import { worktrees } from "./scenarios/worktrees.ts";
import { changedRerun } from "./selftest/changed-rerun.ts";
import { deliberateFailure } from "./selftest/deliberate-failure.ts";
import {
  reachWorkspace,
  setupCallFails,
  twoSetups,
  workspaceNotShown,
} from "./selftest/direct-setup.ts";
import { oneLogin } from "./selftest/one-login.ts";
import { restartPersistence } from "./selftest/restart-persistence.ts";
import { secondServerFailure } from "./selftest/second-server-failure.ts";
import { labelledArtifacts } from "./selftest/labelled-artifacts.ts";
import {
  endCheckFails,
  layoutWaitFails,
  typingWaitFails,
  waitFailuresNamed,
} from "./selftest/signal-waits.ts";
import { unstatedNeeds } from "./selftest/unstated-needs.ts";
import type { Runnable } from "./registryRules.ts";
import type { CheckScenario, ComposedScenario, PerfScenario, ScenarioSet } from "./scenario.ts";

export const checks: ReadonlyArray<CheckScenario> = [
  boot,
  plusModal,
  worktrees,
  manyShells,
  closeTabScenario,
  killShell,
  restartSurvival,
  restoreShell,
  standaloneShell,
  secondServer,
  plainShell,
  userScripts,
  startFailures,
  tabSignals,
  layoutSignal,
  layoutReload,
];

export const composed: ReadonlyArray<ComposedScenario> = [];

/** Run only in the serial perf run, never as set members. */
export const perfScenarios: ReadonlyArray<PerfScenario> = [
  treeNodePerf,
  startToBannerPerf,
  branchLabelPerf,
  promptServerPerf,
  promptHarnessPerf,
];

/** Ids and set names share one namespace. */
export const sets: ReadonlyArray<ScenarioSet> = [];

/** The default `--selftest` run. */
export const selftests: ReadonlyArray<Runnable> = [
  restartPersistence,
  deliberateFailure,
  oneLogin,
  twoSetups,
  reachWorkspace,
];

/** Self-tests that run only when picked with `--only`, so one `--selftest` run stays short. */
export const pickedSelftests: ReadonlyArray<Runnable> = [
  secondServerFailure,
  unstatedNeeds,
  changedRerun,
  typingWaitFails,
  layoutWaitFails,
  endCheckFails,
  waitFailuresNamed,
  labelledArtifacts,
  setupCallFails,
  workspaceNotShown,
];

export const selftestSets: ReadonlyArray<ScenarioSet> = [];
