---
id: PRB.E-001
type: epic
parent:
phase: 1
labels: [terminal-first, testing]
created: 2026-11-02
updated: 2026-11-12
---

# Terminal-first workspace: shell tree with mock-agent shells

## Goal

Probe pivoted from chat-first to terminal-first: agent harnesses already have good TUIs, and every
later epic needs shells that stand alone and a tree to hang them on. The browser app now opens on
named workspaces with a project > worktree > shell tree, no reachable chat, shells started from the
"+" modal (in a worktree or a new fork) running a mock agent CLI, shells that survive reloads and
server restarts, and Restore for a shell that ended unexpectedly, all checked by an automated
scenario suite that needs no human and no paid model.

## Result

- KPI: scenario sets S1 to S8 passing from one command (`vp run test:scenarios`), baseline 0 of 8,
  target 8 of 8, reached 8 of 8 on 2026-11-12 (107 of 107 checks, run on main after the last
  merge). No guardrail metric (chat visibility was a requirement, not a metric).
- Start-to-banner time: 350 to 380 ms against the 2 s limit (S2, 2026-11-05).
- Signed off by the author after a manual pass, 2026-11-12.

## Delivered by

- Stories: PRB.T-001 Scenario harness, mock agent CLI and booting scenario skeleton; PRB.T-002
  Standalone shells without chat threads or tabs; PRB.T-003 Workspaces and the terminal-only
  shell-tree screen; PRB.T-004 Start a local shell from the plus modal; PRB.T-005 Start a shell in
  a new or existing worktree; PRB.T-006 Multiple shells, close tab and kill; PRB.T-007 Reload,
  restart survival and saved workspace layout; PRB.T-008 Restore an ended shell on request;
  PRB.T-009 Rename workspace folders to projects in code and storage.
- Bugs: PRB.T-010, PRB.T-011, PRB.T-015, PRB.T-045 to PRB.T-050, PRB.T-052, PRB.T-054 to
  PRB.T-056.

## Decisions

- The product and scope decisions (workspaces, "+" and projects, branch model, close and kill,
  restart survival, restore on request) are in `docs/dev/roadmap.md`, the "PRB.E-001" entries
  (2026-11-02 to 2026-11-07).
- Rejected: keeping chat behind a flag (the user wanted no chat at all); deleting chat code first
  (too large, breaks the runnable app; a later epic); automatic restore with agent resume and
  retries (chosen 2026-11-02, narrowed 2026-11-07 to a Restore action with no resume); keeping
  killed shells as "ended" (only unexpected ends are restorable).
- Out of scope, with the reason: subagent tree level (dropped 2026-11-07); configurable launch
  command (PRB.E-002); agent status (a later epic); worktree name patterns, picking an existing
  agent session, an initial prompt and per-agent resume arguments (later); desktop and mobile
  (not required, 2026-11-02); killing a shell never deletes a worktree.
- A-14 was false: a server restart ended every shell (PRB.T-002 spike). Risk R-6 came true and
  was met with a detached shell host per state folder (PRB.T-007), see
  `docs/internals/terminal-runtime.md`.
- A-13 was false: the old add-project flow opens chat drafts, so "Add project" is its own dialog.
- Risk R-3 (a flaky harness) led to PRB.E-005, which rebuilt the scenario suite.
- 2026-11-12 (user): PRB.T-044 (typed lines lose a middle chunk) was taken out of this epic,
  as it was not reproduced by hand; the "restored" mark lasts 20 s and is not saved.

## Docs

- `docs/user/workspaces.md`: the terminal-first screen, for users.
- `docs/scenarios/` (workspaces, projects, worktrees, shells, close-and-reopen, kill-shell,
  reload-and-restart, restore-shell, second-server): the built behavior and its requirements.
- `docs/internals/terminal-runtime.md`: the shell host and wrapper startup files.
- `.agents/rules/scenarios.md` and `docs/operations/development.md`: running scenarios.

## Follow-ups

- PRB.T-044 Typed lines lose a middle chunk (backlog, out of this epic).
- PRB.T-053 Harness tests overrun 60 s when run beside many test files (backlog).
- PRB.T-012 Agent command echoed twice in fish; PRB.T-014 mobile prompt repeat after resize.
- Renaming a shell (FR-16) and resuming an agent in a restored shell: deferred, not ticketed.
- Folders in a workspace stay a flat list; any further grouping would be a new epic.
- Removing the chat code: the later remove-chat epic.
