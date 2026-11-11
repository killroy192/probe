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


Found 2026-11-11 while checking the PRB.T-046 fix. A browser opened on a sandbox's pairing link
(`vp run scenarios:sandbox`) never leaves `/pair`, so two tests in `scripts/scenarios/sandbox.test.ts`
fail on unchanged `main` (`6121cba5b`), with and without that fix:

- "starts on a throwaway home, prints what to use it with, seeds a fixture and stops by its pid":
  `page.waitForURL` times out after 30 s on `/pair#token=…` (line 400).
- "reports a failure on the sandbox from its first run, then runs on; refuses what a run did not
  state": the self-test `T2` run on the sandbox should fail at its deliberate step, but fails earlier
  at stage "setup" with `page.waitForURL: Timeout 10000ms exceeded`.

The page console shows `PrimaryEnvironmentRequestError: Primary environment request failed during
fetch-session-state (HTTP 500)` from the route's `beforeLoad`, after a
`net::ERR_NAME_NOT_RESOLVED`. The sandbox server's debug log for that stage holds one line and no
error, so the server does not log the 500. Artifacts of one run (outside the repo, gone after a
reboot): `/tmp/probe-scenario-artifacts/2026-11-11T15-18-36-435Z-45827/T2/`. The same pairing flow
works on the scenario suite's own servers (`--selftest` passes `T1`, `T4`, `T10`, `T11`), so the
difference is in how the sandbox server is started or reached.

In the main checkout three other sandbox tests and one `harness.test.ts` test also hit the 60 s test
timeout while a dev server and its shells ran there; in a fresh worktree they passed. Check that
separately once this one is fixed.

## Direction

- Find which request returns 500 and why: the sandbox server's log at debug level should show it;
  if it does not, that is a logging gap to close first.
- Compare the sandbox's server start (`scripts/scenarios/sandbox.ts`, `server.ts`) with the
  suite's shared server: environment, origin, and what the `ERR_NAME_NOT_RESOLVED` request asked
  for.
- If the cause is in the product (session state on a server started this way), the fix gets a
  failing server test first; if it is in the harness, `sandbox.test.ts` is already the failing test.

## Done when

- Both tests above pass in a fresh worktree, and the T2 run on a sandbox fails only at its
  deliberate step.
- A 500 on the session-state request is visible in the server's log.
