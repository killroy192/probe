---
id: PRB.T-015
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal, verify]
created: 2026-11-08
updated: 2026-11-09
---

# New shell reuses the name of a killed shell that can still be restored

## Steps

1. Open a shell in a worktree. Its name is "shell 1".
2. Kill it with a signal from outside Probe (for example `kill -9` on its process), so it stays
   listed as ended with Restore. Killing it from Probe removes it for good.
3. Restart the server.
4. Open another shell in the same worktree. Its name is also "shell 1".

## Expected

The new shell is "shell 2". Killing a shell does not remove it completely: it can still be
restored, so its name is still taken. Two shells with the same name would collide on restore.

## Done when

- A new shell's default name skips the names of every shell in that worktree that can still be
  restored, not only the running ones.
- A test covers the sequence above (open, kill, open) and fails on `main`.
- Restoring the killed shell after step 3 gives "shell 1" and "shell 2" side by side.

## Notes

The "Shell N" counter in `SavedWorkspaces` was in memory only, so it started over at 1 after a
restart. Within one server run it never repeated. Fixed by saving the last number in the
workspace file (`lastShellNumber`). A workspace file written before the fix has no saved number,
so its first restart can still repeat one once.

## Verification

- `SavedWorkspaces.test.ts` "keeps numbering after a restart, past a killed shell that can be
  restored": fails on `main` ("Shell 1"), passes with the fix ("Shell 2").
- Not yet checked in a real client: restoring the ended "Shell 1" next to "Shell 2".
