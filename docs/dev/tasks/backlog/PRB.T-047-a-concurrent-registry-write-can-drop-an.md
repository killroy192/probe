---
id: PRB.T-047
type: bug
parent: PRB.E-001
phase: 1
labels: []
created: 2026-11-11
updated: 2026-11-11
---

# A concurrent registry write can drop an ended shell entry

## Symptom

Two shells that end at the same moment each save the shell registry
(`<state>/shells/registry.json`). If the older list lands on disk last, the `ended` entry of the
shell a signal ended is lost: after a restart it is no longer listed as ended by a signal (it reads
as lost, or is gone). Found during PRB.T-017 (Follow-ups).

## Evidence

- PRB.T-017 Follow-ups: `Manager.test.ts` "removes a shell that exits on its own, and keeps one a
  signal ended" failed 1 run in 4: the two end handlers persist the registry concurrently, so a stale
  write can drop the `ended` entry.
- PRB.T-036's commit `73aa2239b` (2026-11-10) says: "Shell-list writes are serialized: two shell
  ends saved at once could finish out of order and leave an older list on disk, which the extra
  scan's scheduling exposed as a flaky "signal" -> "lost" in tests." PRB.T-036 merged at
  `4786cd250`, after PRB.T-017 (`8ab0dc1c4`), whose branch did not have the change when its
  Follow-up was written.

## Expected

A shell a signal ended stays in the tree marked ended by a signal, also after a restart
(`kill-shell/FR-24`, `reload-and-restart/FR-16`). A shell that exited on its own is gone and stays
gone (`kill-shell/FR-23`, `reload-and-restart/FR-13`), whatever order the two ends are saved in.

## Suspected cause

In `apps/server/src/terminal/Shells.ts`, `removeExited` (through `unsave`) and `keepEnded` each
change the in-memory `saved` map and then call `persist`, which encodes the whole map and writes it
with `writeFileStringAtomically`. Before `73aa2239b` two persists could run at once: each encoded
the map as it was when it started, and whichever finished last won, so a list encoded before
`keepEnded` set `ended` could replace the one after it.

On `main`, `persist` runs under `persistLock` (a one-permit semaphore) and encodes the map only once
it holds the permit, so the last write carries both changes. Every registry write found goes through
`persist`. So the race is suspected fixed, but no test forces the order: the existing case only
fails by chance.

## Acceptance criteria

- A forced-order test in `Manager.test.ts` (or the `Shells` cases there): the first registry write
  is held (for example, a file system whose write waits on a `Deferred`) while the second shell's
  end changes the map and saves; then the first is released. The registry on disk, and a new
  `Shells` reading it, lists the signalled shell as ended by a signal and not the exited one.
- The test holds the writes in the order that broke before `73aa2239b`, so a persist that encoded
  the map before taking the lock would fail it. If it fails on `main`, fix the race it shows.
- No repeat counts, sleeps or timeouts in the test.

## How to verify

- Read the new case against `73aa2239b`'s diff: its held write is the stale list the old code
  would have written last.
- `vp test run apps/server/src/terminal/Manager.test.ts` passes.
