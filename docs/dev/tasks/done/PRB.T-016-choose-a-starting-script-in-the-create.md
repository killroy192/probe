---
id: PRB.T-016
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-09
---

# Choose a starting script in the Create shell modal

## Goal

Every shell started from a workspace ran one server-wide command from an environment variable, and the "Starting script" dropdown in the Create shell modal was disabled. The outcome: the user picks Plain shell or one of their saved starting scripts for each start, and the choice is remembered per project.

## Delivered

- The modal's dropdown is enabled: Plain shell first, then the user's scripts. A start with no script is a plain shell; a script that is not in the list at start time is refused with a message naming it.
- The user list is kept on the default server (the server that serves the UI), survives reload and restart, and is offered for a workspace on any connected server. In dev and the scenario harness a state folder with no saved list gets "mock agent"; a saved list, even an empty one, is never seeded again. A damaged list does not stop Probe and the modal still offers Plain shell.
- Each project remembers its own last start (worktree choice and script, by script identity, not name) in the workspace file; a gone or missing script preselects Plain shell. The old single remembered start is migrated on read.
- `PROBE_AGENT_COMMAND` no longer decides what a shell runs; the dev runner and the scenario harness seed their scripts instead. Each start is logged with the script name and program, or "plain", never the command line.
- U-1 spike: the shell, not the server's `PATH`, must decide whether a program exists (aliases, functions, builtins and rc-added `PATH` entries all run in zsh and bash). This shaped PRB.T-017.
- Plain-shell click-to-prompt measured at 604 to 644 ms before the change (up to 851 ms under load) and 635 to 700 ms after, in a shared dev container; the baseline was under 700 ms, so scenario E2-S3 asserts at most 700 ms.
- Epic requirements: FR-1, FR-3, FR-6, FR-2 (persistence), FR-12 (not-in-list refusal), NFR-1 to NFR-7. Scenario E2-S3 proves the plain-shell start.

## Decisions

- The user list lives on the default server (user, 2026-11-09), not on each workspace's server; the shell is opened, the command typed and the program checked on the workspace's server.
- The remembered choice is per project, not one per workspace (user, 2026-11-09, planning). It follows a script by identity (settled 2026-11-08).
- Plain shell is the default for a start that names no script (settled 2026-11-08), so older clients keep working.
- Script names default to the program and may repeat (settled 2026-11-08).
- The program check skips leading `NAME=value` words, because `TOKEN=x claude` used to put the secret in the error and the log.
- `agent` left the `shell.open` wire input; a script reaches `Shells.open` only as a server-side option from `workspace.startShell`.
- This story kept the server-side lookup; the shell-decides rule was left to PRB.T-017.

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md): how a start is chosen, the list file, seeding, remembered start, and the U-1 finding.
- [Starting scripts](../../../user/workspaces.md#starting-scripts): using the dropdown.
- [Development setup](../../../operations/development.md): the dev runner's mock agent seed.
- [Roadmap](../../roadmap.md): decision 4 and the PRB.E-002 decisions.

## Follow-ups

- Editing the list in Settings, and showing a damaged list there: PRB.T-018. Disabling and workspace scripts: PRB.T-019. Changes after start and the removed-by-another-client refusal: PRB.T-020.
- Second-server checks (AC-24, AC-25) and how a start on another server gets its command (epic U-4): PRB.E-003 story 8 and story 2.
- Open, not recorded as done in this ticket: the manual Claude Code check (A-2; PRB.T-017 AC-13 covers it with real Claude Code), repeating the U-1 test with the author's real startup files, whether "mock agent" can be a default outside dev (epic U-2), and whether a downgrade must read the new workspace file (SU-4, recommendation no).
