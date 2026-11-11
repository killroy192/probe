// The only source of the harness's deadlines: a missing event fails as fast as a missing element.

/** How long a scenario waits for an event, a log entry or a recorded value. */
export const WAIT_MS = 10_000;
/** Playwright's action timeout on every page the runner opens, and the deadline of page waits. */
export const ACTION_MS = 10_000;
// A ceiling for a start that never answers, not a measure of a healthy one (about 2 s here).
export const START_MS = 60_000;
/** How long a process the server does not own may take to end, and how often it is looked at. */
export const PROCESS_END_MS = 5_000;
export const PROCESS_END_STEP_MS = 100;
/** How often a run on a sandbox looks whether the sandbox, not its own child, has ended. */
export const SANDBOX_POLL_MS = 250;
/** For self-tests only: a wait that must fail does so without taking a scenario's deadline. */
export const SELFTEST_SHORT_MS = 2_000;

/** A deadline a wait may be given: one of the above, never a number of the caller's own. */
export type Deadline = typeof WAIT_MS | typeof ACTION_MS | typeof SELFTEST_SHORT_MS;

/** A deadline as failure messages name it. */
export const seconds = (ms: number) => `${ms / 1000} s`;
