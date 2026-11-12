---
id: PRB.T-056
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-12
updated: 2026-11-12
---

# The restored mark stays on a shell for good and survives reloads

## Goal

Found in manual testing (2026-11-12): after Restore, a shell's tree row kept "restored" for good,
because the server saved the mark with the shell list. It is now a short notice.

## Delivered

- Server (`Shells.ts`): the mark is kept in memory only, never saved (old saved lists that carry it
  load without it), and cleared 20 s after the restore with a shell update to every client; a
  second restore starts the 20 s over.
- Web (`state/shells.ts`, `WorkspaceSidebar.tsx`): a page marks only restores it saw happen, so a
  reload never shows the mark.
- Commit `7c8db6dc9`, merge `2234005a6`. Tests: `Manager.test.ts` restore cases (nothing saved, nothing
  after a restart, the 20 s clear on the `TestClock`), `apps/web/src/state/shells.test.ts`,
  scenario `S8.restored-mark-reload` (`restore-shell/FR-15`).

## Decisions

- User decision, 2026-11-12: the mark lasts 20 s and is not saved; a reload or a server restart
  shows none.
- A sidebar remounted while a mark shows takes a new baseline and drops that mark early; accepted
  for a short notice.
