import { boot } from "./scenarios/boot.ts";
import { closeTabScenario } from "./scenarios/close-tab.ts";
import { killShell } from "./scenarios/kill-shell.ts";
import { manyShells } from "./scenarios/many-shells.ts";
import { plusModal } from "./scenarios/plus-modal.ts";
import { restartSurvival } from "./scenarios/restart.ts";
import { restoreShell } from "./scenarios/restore-shell.ts";
import { standaloneShell } from "./scenarios/standalone-shell.ts";
import { worktrees } from "./scenarios/worktrees.ts";
import { deliberateFailure } from "./selftest/deliberate-failure.ts";
import { restartPersistence } from "./selftest/restart-persistence.ts";
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
export const storyScenarios: ReadonlyArray<Scenario> = [standaloneShell];

export const selftestScenarios: ReadonlyArray<Scenario> = [restartPersistence, deliberateFailure];
