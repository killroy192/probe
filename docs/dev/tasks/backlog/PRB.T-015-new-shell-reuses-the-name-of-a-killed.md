---
id: PRB.T-015
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal]
created: 2026-11-08
updated: 2026-11-08
---

# New shell reuses the name of a killed shell that can still be restored

## Steps

1. Open a shell in a worktree. Its name is "shell 1".
2. Kill it.
3. Open another shell in the same worktree. Its name is also "shell 1".

## Expected

The new shell is "shell 2". Killing a shell does not remove it completely: it can still be
restored, so its name is still taken. Two shells with the same name would collide on restore.

## Done when

- A new shell's default name skips the names of every shell in that worktree that can still be
  restored, not only the running ones.
- A test covers the sequence above (open, kill, open) and fails on `main`.
- Restoring the killed shell after step 3 gives "shell 1" and "shell 2" side by side.

## Notes

Not yet investigated. Start from where the default shell name is chosen and check which shells it
counts.
