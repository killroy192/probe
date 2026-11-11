// The only source of the harness's deadlines: a missing event fails as fast as a missing element.

/** How long a scenario waits for an event, a log entry or a recorded value. */
export const WAIT_MS = 10_000;
/** Playwright's action timeout on every page the runner opens. */
export const ACTION_MS = 10_000;
// A ceiling for a start that never answers, not a measure of a healthy one (about 2 s here).
export const START_MS = 60_000;
