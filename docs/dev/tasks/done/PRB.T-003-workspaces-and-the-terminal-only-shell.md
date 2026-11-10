---
id: PRB.T-003
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, chat-removal]
created: 2026-11-02
updated: 2026-11-05
---

# Workspaces and the terminal-only shell-tree screen

## Goal

The app was chat-first and had no workspace concept, so the terminal-first product could not start.
The app now opens on a terminal-only screen with saved workspaces, and chat is hidden everywhere.

## Delivered

Start screen with "Open workspace" and "Create workspace"; the "Workspaces" menu to switch,
create, open and remove workspaces (workspaces live on the primary environment, one file each,
removing never touches folders on disk); the workspace as root of an empty shell tree; every chat
route, chat settings page and chat command hidden or redirected. Proved by scenario S1 in
`scripts/scenarios/scenarios/boot.ts` and the `SavedWorkspaces` tests; the author's AC-10 manual
pass (2026-11-05) passed on its second round.

Satisfies PRB.E-001: FR-1, FR-2, FR-24 (part), FR-7 (part), NFR-3, NFR-4, NFR-5.

## Decisions

- Chat code stays and is hidden, not deleted, until the chat-removal epic (PRB.E-001 Out).
- Old chat addresses land on the shown workspace, else the start screen; removing the shown
  workspace returns to the start screen (user, 2026-11-02).
- Workspace operations are server-side RPCs, one file per workspace (user, 2026-11-02).
- The command palette is not mounted and the `chat.new*` and `usage.open` commands are not
  installed (user, 2026-11-05).
- Layout (user, after the AC-10 review, 2026-11-05): the app sidebar keeps its chrome; the thread
  list is replaced by the workspace tree; the Workspaces menu sits where the new-thread icon was;
  Search and Add project were shown disabled until PRB.T-004. Rows kept for later reuse:
  project grouping and order, boring sidebar rows, `terminal.*` keybindings.
- The shown workspace was first kept in memory only, so a reload returned to the start screen
  (user, 2026-11-05); PRB.T-007 replaced that with a per-browser memory.
- AC-19 (docs describing the full terminal-first product) deferred by the user, 2026-11-05: they
  cannot be written before stories 4 to 8 exist. Chat-only user pages instead carry a "Not
  relevant in the terminal-first build" note and are listed apart in `docs/README.md`.

## Docs

- [Workspaces](../../../user/workspaces.md)
- [Hidden chat](../../../internals/web-ui.md#hidden-chat)
- [Glossary: Workspace](../../../internals/glossary.md)
- [Roadmap decisions](../../roadmap.md)

## Follow-ups

- The right panel (folders and file preview) returns in a later story: `docs/dev/questions.md`.
- The verify run of 2026-11-05 failed on AC-10, AC-19 evidence, `/guest`, the AC-12 check and
  permission gating; all but AC-19 were fixed and verify was not rerun.
