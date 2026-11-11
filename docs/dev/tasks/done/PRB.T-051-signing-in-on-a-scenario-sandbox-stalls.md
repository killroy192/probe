---
id: PRB.T-051
type: bug
parent:
phase: 1
labels: [testing]
created: 2026-11-11
updated: 2026-11-11
---

# Signing in on a scenario sandbox stalls on the pairing page

## Goal

A browser opened on a sandbox's pairing link never left `/pair`, so sandbox and harness tests
failed. Sign-in on a sandbox now works and the self-test T2 fails only at its deliberate step.

## Delivered

- `scripts/scenarios/bundle.ts` builds the web bundle with the harness's child environment, and
  writes the build's output as lines with escape codes stripped. Commits `80b6cfc34`, `086a5a76b`,
  merge `f52754759`.
- Test: `harness.test.ts` "web bundle" › "builds without the caller's Vite variables or forced
  colour, and prints no escapes" (fails on the old code).

## Decisions

- Cause, found 2026-11-11 from a probe log: the first `sandbox.test.ts` case starts a sandbox with
  an ambient `VITE_HTTP_URL=http://ambient.example` to prove the server never sees it. When the
  bundle was stale, the sandbox rebuilt `apps/web/dist` with that variable, so the page sent its
  session requests to `ambient.example` (`ERR_NAME_NOT_RESOLVED`), which the client reports as
  "HTTP 500". The server never got the request, so there was no 500 to log. Every later run on
  that checkout served the broken bundle.
- The build prints its `[PLUGIN_TIMINGS]` warning in colour even under `NO_COLOR`, and only when
  plugins are slow, so the sandbox test's "no escapes in the output" check failed now and then.
- A 19-minute and a 34-minute gap between wall clock and Vitest's monotonic time in two runs were
  the container's VM pausing (likely host sleep); a clock sampler saw no jump in later runs.

## Follow-ups

- The tests still overrun 60 s when `sandbox.test.ts` and `harness.test.ts` run together:
  PRB.T-053.
