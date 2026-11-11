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

## Symptom

A mock agent started by one click on "Create shell" printed its banner and session, but its tab
stayed "Shell 1 · repo-2" and its tree row "Shell 1" (no "· node") for the whole 10 s wait. The
shell list kept `process: null`. Found during PRB.E-005 verification (PRB.T-039 Follow-ups);
original story PRB.T-004.

## Evidence

Quoted from PRB.T-039's verification notes and the artifacts:

- `S2.one-click-start`, V4's second `--only shared` run on a sandbox holding about 155 running
  shells. It passed in the first run.
- `error.txt`: `StageFailure: at stage "AC-2": Timed out after 10 s waiting for the tab "Shell 1 ·
  repo-2 · node" (visible).`
- Artifacts: `/tmp/probe-scenario-artifacts/2026-11-11T05-57-08-980Z-35838/S2.one-click-start/`.
  `recorders.json` has an `activity` frame with `hasRunningSubprocess: false` right after the
  banner. That frame also carries `cols: 115, rows: 40`, which only the resize path in
  `Manager.ts` (`resizeSession`) sends, so it is a resize and not a poll result.
- `sandbox-server.log` (13 lines) holds no "failed to snapshot processes" warning.

## Expected

A started agent's tab reads "Shell <n> · <folder> · <program>" and its tree node "Shell <n> ·
<program>" (`shells/FR-17`), promptly after its banner shows, also on a server holding many shells
(`starting-scripts/NFR-3` puts the banner within 2 s of the click; the label should not lag it by
seconds).

## Suspected cause

The subprocess poll in `apps/server/src/terminal/Manager.ts` (`pollSubprocessActivity` and the
`Effect.forever` loop after it). PRB.T-039's note suspected that a process-table snapshot taken
before the agent was the shell's child finds no subprocess, the session then counts as quiet, and
with every session quiet the poll snapshots only every 30th tick
(`QUIET_SUBPROCESS_SNAPSHOT_EVERY_TICKS`), so the label comes about 30 s late.

What the code shows (read 2026-11-11, not run):

- The quiet skip is less likely. A session counts as quiet only after two snapshots in a row with
  no child and an unchanged activity mark (`eventSequence + inputCount`), and every output chunk
  and every `write` moves that mark. The agent's banner and session lines are output, so the next
  tick after them should take a fresh snapshot, unless the snapshot itself is stale.
- The back-off is a closer fit. When the native telemetry `processTable` fails, the poll falls back
  to `ps` without logging (`fetchProcessTableSnapshot`), and that tick returns
  `snapshotSucceeded: false`. Each such tick doubles the delay (`subprocessSnapshotPollDelayMs`:
  1 s × 2^n, up to 60 s), even when the `ps` table was good. A few failed native reads in a row on a
  busy server put the next snapshot more than 10 s away. A `ps` failure also backs off, with a
  warning.
- Neither is confirmed; the run's server log has no debug lines on the poll.

## Acceptance criteria

- A test that fails on `main`: a started agent's label is published within one poll interval of
  its process appearing, after the native process table has failed some ticks while `ps` works.
  (If the cause found is different, the test targets that cause instead.)
- The label follows a start within a bound the author sets, on a server with about 150 running
  shells.
- A real failure to read the process table is still logged and still backs off.

## How to verify

- The new `Manager.test.ts` case fails on `main` and passes with the fix, on the `TestClock`.
- `S2.one-click-start` passes the epic's N runs on a sandbox with about 150 running shells.
