---
id: PRB.T-046
type: bug
parent: PRB.E-001
phase: 1
labels: []
created: 2026-11-11
updated: 2026-11-11
---

# Agent program label stays missing for over 10 s after the agent starts
## Goal

A started agent's tab and tree row should name its program promptly (`shells/FR-17`). In
verification it stayed unnamed for over 10 s.

## Delivered

- `eb00377e5` (merged in `969d2d216`): a `ps` fallback for the native process table counts as a good
  snapshot on Linux and macOS, so the shell process poll keeps its 1 s interval.
- Test: "keeps the poll interval while ps stands in for the native process table" in
  `apps/server/src/terminal/Manager.test.ts`. It failed before the fix (`linux: expected 2 to be 6`).
- Checked by hand on a dev server: labels followed Enter and Ctrl+C within 0 to 1 s, where they had
  lagged 17 to 60 s.

## Decisions

- Cause, confirmed 2026-11-11 with debug lines on the poll during a manual run: the native monitor
  binary was missing (the usual case in dev and in scenario sandboxes), so every tick fell back to
  `ps`. `ps` found the right program, but the tick still counted as failed, so the delay doubled up
  to 60 s. The quiet-skip theory was ruled out: no skipped ticks while the user typed.
- Windows keeps the back-off, because its fallback is PowerShell (the upstream fix for CPU spikes).
- Closed by the user on 2026-11-11 without the measurement on about 150 shells or a scenario run.

## Follow-ups

- PRB.T-050: a per-shell check schedule with reset events, replacing the 1 s floor and the quiet
  skip.
- PRB.T-051: sandbox sign-in stall, found while checking this fix.
