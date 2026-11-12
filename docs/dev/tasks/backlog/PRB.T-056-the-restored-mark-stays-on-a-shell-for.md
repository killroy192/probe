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

Found in manual testing (2026-11-12). After Restore, a shell's tree row shows "restored" and keeps it
for good: the server sets `restored` on the shell's record and saves it with the shell list
(`apps/server/src/terminal/Shells.ts`), so it comes back after a reload and a server restart. The
user wants it as a short notice: gone 20 s after the restore, and gone at a page reload.

## Direction

User decision, 2026-11-12: the mark is not saved.

- Server: do not persist `restored` in the shell list; keep it in memory and clear it 20 s after
  the restore, sending the change to clients like any other shell update. A restored shell read
  back after a server restart is not restored.
- Web: show the mark only for a shell this page saw being restored (its `restored` turned true
  while the page was open), so a reload never shows it; it goes when the server clears it.
- Works the same for a restore from another client or the `probe` command.

## Done when

- The mark shows after Restore and is gone 20 s later on every client.
- A page reload, or a server restart, shows no mark.
- Tests fail before the fix and pass after (server: the 20 s clear on the `TestClock` and nothing
  saved; web: no mark for a shell restored before the page loaded).
