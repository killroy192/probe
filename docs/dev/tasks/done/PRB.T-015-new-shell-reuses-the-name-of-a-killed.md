---
id: PRB.T-015
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal]
created: 2026-11-08
updated: 2026-11-09
---

# New shell reuses the name of a killed shell that can still be restored

## Goal

After a server restart, a new shell reused the "Shell N" name of a shell that was killed from outside
Probe but could still be restored, so the two would collide on restore. A new shell's name now
skips every number that can still be restored.

## Delivered

- The last "Shell N" number is saved in the workspace file (`lastShellNumber`) and survives restarts.
- Test `SavedWorkspaces.test.ts` "keeps numbering after a restart, past a killed shell that can be restored" fails on `main` and passes with the fix.
- Scenario S8, stage "restore after a restart": after a server and shell host restart a new shell is "Shell 2" next to the ended "Shell 1", and restoring "Shell 1" shows both.

## Decisions

- The counter is saved rather than derived from listed shells, because an ended shell that can be restored keeps its name taken. The counter was in memory only, so it restarted at 1.
- A workspace file written before the fix has no saved number, so its first restart can still repeat a number once. Accepted.
