---
id: PRB.T-017
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-10
---

# A missing program is named and an exiting command keeps the shell

## Goal

Once any starting script can be chosen, a typo or an uninstalled CLI must say which program is missing and leave no dead shell, and a command that exits at once must not take the shell with it. Epic: PRB.E-002 (candidate story 2).

## Delivered

- Starting a script whose program is not found on the workspace's server shows an alert in the Create shell modal that names the program, leaves no shell and no saved entry, and logs a warning with the cwd, script name and program (never the command line).
- A program the user's own shell can run (a `PATH` set by startup files, an alias, a function, a builtin) is not refused.
- A command that exits, cleanly or not, leaves the shell open at its prompt. This needed no behavior change; it is now covered by a scenario and a server test (scenario E2-S4).
- FR-7, FR-8, NFR-3 (part), NFR-5 (part), NFR-6 (part). The second-server cases (AC-15, AC-16) are verified by PRB.E-003 story 8, not here.

## Decisions

- The shell decides "not found", not the server's `PATH` (user, 2026-11-09), following the U-1 finding of PRB.T-016: a server-side lookup refused working commands.
- No answer from the shell (unwrapped shell such as fish, a replaced wrapper, timeout) means not refused (user, 2026-11-09).
- Refusal is logged at warning (user, 2026-11-09).
- The shell is listed as soon as it spawns, not at the first prompt (user, 2026-11-10), because PRB.E-001 S2 AC-3 needs its tree node within 1 s of the click. On a refusal the node shows briefly and is removed; the modal waits for the check.
- A path program (`./bin/tool`) now needs the executable bit, as running it does; the old check accepted any file.
- Contracts unchanged: the launch error's `reason` names the program, the script name is in the log only.
- Scenario harness: the server gets `LANG=C.UTF-8` when no locale is set, because without it zsh counts the prompt's arrow as three columns and its redraw at the wrap erases the prompt row.

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md): the shell-side check, the command-start mark and the start log.
- [Workspaces](../../../user/workspaces.md): what "not found" means and that an exiting command keeps the shell.

## Follow-ups

- `Manager.test.ts` "removes a shell that exits on its own, and keeps one a signal ended" failed 1 run in 4: the two end handlers persist the registry concurrently, so a stale write can drop the `ended` entry: PRB.T-047.
- A save-time hint in Settings and detecting a failure after the shell started: still undecided (TBD, user, 2026-11-15).
- How the command reaches a workspace on another server: PRB.E-003 story 2.
