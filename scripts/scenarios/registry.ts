import { boot } from "./scenarios/boot.ts";
import { plusModal } from "./scenarios/plus-modal.ts";
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
  { id: "S4", title: "pending (story 6)" },
  { id: "S5", title: "pending (story 6)" },
  { id: "S6", title: "pending (story 6)" },
  { id: "S7", title: "pending (story 7)" },
  { id: "S8", title: "pending (story 8)" },
];

/** Checks a story owns that are not epic scenarios; they run after S1..S8 and do not count toward 8. */
export const storyScenarios: ReadonlyArray<Scenario> = [standaloneShell];

export const selftestScenarios: ReadonlyArray<Scenario> = [restartPersistence, deliberateFailure];
