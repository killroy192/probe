import { SELFTEST_SHORT_MS } from "../lib/deadlines.ts";
import { outputDuringReload } from "../scenarios/many-shells.ts";

/** Lets the held output go before the reload, so the raw-output check fails on purpose. */
const releaseBeforeReload = outputDuringReload(import.meta.url, {
  id: "T27",
  title: "held output let go before the reload fails the raw-output check",
  release: "before-reload",
});

/** Never lets the held output go, so the wait for it after the reload fails naming it. */
const releaseNever = outputDuringReload(import.meta.url, {
  id: "T28",
  title: "held output never let go fails the wait for it after the reload",
  release: "never",
  deadline: SELFTEST_SHORT_MS,
});

export const releaseSelftests = [releaseBeforeReload, releaseNever];
