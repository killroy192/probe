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

## Goal

Two shells ending at once each save the shell registry; if the older list landed last, the shell a
signal ended lost its `ended` mark and read as lost after a restart (seen as a 1-in-4 flake in
PRB.T-017). Prove the order is handled, and fix it if not.

## Delivered

- The race was already fixed by PRB.T-036's `73aa2239b`: registry saves run one at a time and encode
  the list only once they hold the lock.
- `Manager.test.ts` "removes a shell that exits on its own, and keeps one a signal ended while the
  other saves" now forces the order: it holds the first save until any save started meanwhile has
  landed. It fails on the unlocked save from before `73aa2239b` (`signal` -> `lost`) and passes on
  `main`. Merged 2026-11-11.

## Decisions

- 2026-11-11: the shell end handler starts its registry update at once (`startImmediately`), so each
  end has changed the list before the next event is handled. Without it no test can know when the
  second end changed the list, so the order could not be forced; a scheduler-order wait was tried
  and ran the end after the release.
