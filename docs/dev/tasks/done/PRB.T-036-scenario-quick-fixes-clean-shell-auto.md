---
id: PRB.T-036
type: story
parent: PRB.E-005
phase: 1
labels: [testing, implement]
created: 2026-11-09
updated: 2026-11-10
---

# Scenario quick fixes: clean shell, auto-built bundle, no wall-clock gates, readable failures

## Goal

The scenario suite (`vp run test:scenarios`) passed or failed for reasons unrelated to Probe: the developer's shell config, a stale web bundle, wall-clock gates, frame waits that an earlier frame could satisfy, one-line failures and servers left behind by a killed runner. This story made the suite honest without changing what any scenario proves, and recorded the baseline the epic's KPI needs.

## Delivered

- Merged in `4786cd250` (the code, 2026-11-10) and `9fe93f4ac` (the order-check and cleanup fixes and the baseline, 2026-11-10).
- Epic requirements: FR-1 (stale bundle rebuilt, the run names the bundle), FR-2 (isolated shell config), FR-3 (PRB.T-011 order checked on the server's raw shell output), FR-4 (no wall-clock gates; durations and the server-measured start-to-prompt time are metrics), FR-5 (frame waits take offsets; "nothing since"), FR-6 without the trace (screenshot, server log tail, last recorded values), FR-7 (`unlessRoot` skips permission checks as root), NFR-2 teardown half (SIGKILL teardown; a killed runner's servers and shells are cleaned by the next run from a pid manifest), NFR-3, NFR-6, NFR-7 shared fixtures half. AC-22 (stale docs) was done by PRB.T-042.
- Proved by `scripts/scenarios/harness.test.ts` (bundle failure, shell isolation with a negative control, readiness failures, SIGKILL cleanup, pid reuse, artifacts) and the `--selftest` runs.
- **Baseline (AC-21), 2026-11-10**, devcontainer (10 cores), rebuilt bundle, serial, no retries, at `59047446d` (this story's fixes in; the "before" half could not be taken because the code merged first):
  - One run: 12 of 13 passed, 305.2 s. S1 19.0, S2 36.1, S3 37.1, S4 19.8, S5 10.9, S6 21.7 (FAIL), S7 41.0, S8 19.8, T-002 11.6, R1 16.8, E2-S3 13.8, E2-S1 35.0, E2-S4 10.9 s. Teardown 32 to 67 ms each. No scenario is atomic yet; only S5, T-002, E2-S3, E2-S4 and R1 are under the 15 s cap.
  - Metrics in that run: S2 tree node 218 ms, start to banner 634 ms; S3 branch label 1374 ms, fork start to banner 439 ms; E2-S3 click to prompt 595 ms (harness), start to prompt 544 ms (server).
  - Flake rate, N = 7: 3 of 91 scenario runs failed and 3 of 7 full runs had a failure (S8 2/7, S6 1/7, all others 0/7); full runs 288.3 to 297.0 s.
  - Every failure had one cause: `leaveAgent` (`scenarios/workspaceUi.ts`) returns on `mock-agent: bye`, and the scenario types its next line before zsh's next prompt mark, so the line editor drops characters (`probe kilN" kill`, `8-42`, a lost `false; exit`).

## Decisions

- One story for all of phase 0 of the desk analysis (user, 2026-11-09).
- The baseline is one gate-style serial run after the user confirms the machine is quiet, with no median, against the 15 s per-scenario cap rather than a full-run target (user, 2026-11-10; AC-21 amended).
- The PRB.T-011 order is read from raw shell output that the server writes to `PROBE_RAW_OUTPUT_DIR`, a harness-only variable that is off in production, adds no websocket traffic and needs no contract change (user, 2026-11-10). Page frames could not work: a page that attaches after the first prompt gets the emulator's re-rendered screen, which has no OSC 133 marks. The shell host also has the raw output but serves one client at a time.
- SA-1 (epic A-1) is false (2026-11-10): S2 on `main` (`f24dbcdf8`) failed at the order check both with and without isolation, because main's check read page frames. With the raw-output check, S2 passes with the developer's own shell config (`--own-shell-config`) too. Isolation stays, for a fixed prompt and timing.
- N = 7 for the flake loop (user, 2026-11-10; 10 was proposed).
- The `harness.test.ts` "reports a failing scenario by name and still runs the others" case can exceed the 60 s project timeout under parallel load. It was given no timeout or retry and is left to PRB.T-040 (2026-11-10).

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md): isolated shell, raw output, root skips, failure artifacts, bundle rebuild.

## Follow-ups

- AC-15: one run as root by the developer, to see the permission checks print `SKIP`. Not run; untracked.
- The typing-after-`leaveAgent` flake (S6, S8): PRB.T-041 (prompt-ready signal) and PRB.T-039.
- The "reports a failing scenario" timeout under load: PRB.T-040 (parallel load, its AC-15/AC-16). When it times out, Vitest drops the runner's output, and the case does not kill its runner.
- NFR-2 gap: a runner killed after making a throwaway home but before recording its server leaves that home, with no process, where the next run's cleanup cannot find it. Untracked; PRB.T-040 ports the cleanup (R-6).
