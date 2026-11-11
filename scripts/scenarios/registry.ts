import { boot } from "./scenarios/boot.ts";
import { closeTabScenario } from "./scenarios/close-tab.ts";
import { killShell } from "./scenarios/kill-shell.ts";
import { manyShells } from "./scenarios/many-shells.ts";
import { plusModal } from "./scenarios/plus-modal.ts";
import { restartSurvival } from "./scenarios/restart.ts";
import { restoreShell } from "./scenarios/restore-shell.ts";
import { secondServer } from "./scenarios/second-server.ts";
import { layoutReload, layoutSignal, tabSignals } from "./scenarios/signals.ts";
import { plainShell, startFailures, userScripts } from "./scenarios/starting-scripts.ts";
import { standaloneShell } from "./scenarios/standalone-shell.ts";
import { worktrees } from "./scenarios/worktrees.ts";
import { changedRerun } from "./selftest/changed-rerun.ts";
import { deliberateFailure } from "./selftest/deliberate-failure.ts";
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
import type { Scenario } from "./scenario.ts";

// S1..S8 from PRB.E-001. A scenario without `run` is pending until its story builds it.
export const scenarios: ReadonlyArray<Scenario> = [
  boot,
  plusModal,
  worktrees,
  manyShells,
  closeTabScenario,
  killShell,
  restartSurvival,
  restoreShell,
];

/** Checks a story owns that are not epic scenarios; they run after S1..S8 and do not count toward 8. */
export const storyScenarios: ReadonlyArray<Scenario> = [
  standaloneShell,
  secondServer,
  plainShell,
  userScripts,
  startFailures,
  tabSignals,
  layoutSignal,
  layoutReload,
];

export const selftestScenarios: ReadonlyArray<Scenario> = [
  restartPersistence,
  deliberateFailure,
  oneLogin,
];

/** Self-tests that run only when picked with `--only`, so one `--selftest` run stays short. */
export const pickedSelftestScenarios: ReadonlyArray<Scenario> = [
  secondServerFailure,
  unstatedNeeds,
  changedRerun,
  typingWaitFails,
  layoutWaitFails,
  endCheckFails,
  waitFailuresNamed,
  labelledArtifacts,
];
