import { successors as s1 } from "./scenarios/boot.ts";
import { branchLabelPerf } from "./scenarios/branch-label.perf.ts";
import { successors as s5 } from "./scenarios/close-tab.ts";
import { closeThenKill } from "./scenarios/composed.ts";
import { successors as s6 } from "./scenarios/kill-shell.ts";
import { successors as s4 } from "./scenarios/many-shells.ts";
import { successors as s2 } from "./scenarios/plus-modal.ts";
import { promptHarnessPerf } from "./scenarios/prompt-harness.perf.ts";
import { promptServerPerf } from "./scenarios/prompt-server.perf.ts";
import { successors as s7 } from "./scenarios/restart.ts";
import { successors as s8 } from "./scenarios/restore-shell.ts";
import { successors as r1 } from "./scenarios/second-server.ts";
import { layoutReload, layoutSignal, successors as t041a } from "./scenarios/signals.ts";
import { successors as e2 } from "./scenarios/starting-scripts.ts";
import { successors as t002 } from "./scenarios/standalone-shell.ts";
import { startToBannerPerf } from "./scenarios/start-to-banner.perf.ts";
import { treeNodePerf } from "./scenarios/tree-node.perf.ts";
import { successors as s3 } from "./scenarios/worktrees.ts";
import { changedRerun } from "./selftest/changed-rerun.ts";
import { failsAtStepTwo, handoverTwice, withRestartStep } from "./selftest/composed.ts";
import { deliberateFailure } from "./selftest/deliberate-failure.ts";
import { outputNeverComes, serverKilled, wrongUiState } from "./selftest/diagnosis.ts";
import {
  reachWorkspace,
  setupCallFails,
  twoSetups,
  workspaceNotShown,
} from "./selftest/direct-setup.ts";
import { returnsWorkspace, takesWorkspace } from "./selftest/handover.ts";
import { serverCondition, serverWideChange } from "./selftest/needs.ts";
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
import { failsWhileUnwritable } from "./selftest/step-undo.ts";
import { releaseSelftests } from "./selftest/reload-release.ts";
import { unstatedNeeds } from "./selftest/unstated-needs.ts";
import type { Runnable } from "./registryRules.ts";
import { sandboxRefusal } from "./sandboxRules.ts";
import type { CheckScenario, ComposedScenario, PerfScenario, ScenarioSet } from "./scenario.ts";

/** Every atomic check scenario; T-041b and T-041c were atomic already and keep their ids. */
export const checks: ReadonlyArray<CheckScenario> = [
  ...s1,
  ...s2,
  ...s3,
  ...s4,
  ...s5,
  ...s6,
  ...s7,
  ...s8,
  ...t002,
  ...r1,
  ...e2,
  ...t041a,
  layoutSignal,
  layoutReload,
];

export const composed: ReadonlyArray<ComposedScenario> = [closeThenKill];

/** Run only in the serial perf run, never as set members. */
export const perfScenarios: ReadonlyArray<PerfScenario> = [
  treeNodePerf,
  startToBannerPerf,
  branchLabelPerf,
  promptServerPerf,
  promptHarnessPerf,
];

/** The long scenarios that PRB.T-039 split; each name is now a set of the checks that cover it. */
export const OLD_IDS = [
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
  "T-002",
  "R1",
  "E2-S3",
  "E2-S1",
  "E2-S4",
  "T-041a",
] as const;

const covering = (old: string) =>
  checks
    .filter((check) => check.covers?.some((covered) => covered.startsWith(`${old} `)))
    .map((check) => check.id);

/**
 * Ids and set names share one namespace. An old id is the set of every check that covers one of
 * its criteria; `shared` is every check a sandbox accepts.
 */
export const sets: ReadonlyArray<ScenarioSet> = [
  ...OLD_IDS.map((old) => ({ name: old, members: covering(old) })),
  {
    name: "shared",
    members: checks.filter((check) => sandboxRefusal(check) === undefined).map(({ id }) => id),
  },
];

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
  returnsWorkspace,
  takesWorkspace,
  wrongUiState,
  outputNeverComes,
  serverKilled,
  failsAtStepTwo,
  handoverTwice,
  serverWideChange,
  serverCondition,
  failsWhileUnwritable,
  withRestartStep,
  ...releaseSelftests,
];

export const selftestSets: ReadonlyArray<ScenarioSet> = [
  { name: "T-lib", members: ["T10", "T11", "T12", "T13", "T14", "T15"] },
  { name: "T-diagnosis", members: ["T18", "T19", "T20"] },
  { name: "T-compose", members: ["T21", "T22", "T17", "T25"] },
  { name: "T-needs", members: ["T23", "T24"] },
  { name: "T-sandbox", members: ["T16", "T17", "T22"] },
  { name: "T-restart-set", members: ["T16", "T1"] },
  { name: "T-gate", members: ["T16", "T1", "T22"] },
];
