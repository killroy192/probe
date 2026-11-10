---
id: PRB.T-006
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-06
---

# Multiple shells, close tab and kill

## Goal

A user running several agents needs shells side by side, each with its own output and tab, hideable without losing work and endable on purpose. Delivered: many shells at once, closing a tab without ending its shell, and a force-kill from the tree, from inside the shell, and by removing a workspace or project.

## Delivered

Done 2026-11-06 on `feat/shell-kill-prb-t-006`, stacked on the PRB.T-005 branch.

- FR-9 (S4, many shells with isolated output), FR-10 (S5, close a tab, reopen from the tree), FR-11 (kill from the tree after a confirmation), FR-12 (`probe kill` inside a shell), FR-24 removal part, NFR-2 (a kill leaves no process the shell started; a created worktree stays).
- Removing one project from a workspace (hover action on its row) also kills that project's shells. The user added this after the manual pass.
- `shell.close` became `shell.kill`; closing a tab is client-only.
- Proven by scenarios S4 (`many-shells.ts`, reload part left to PRB.T-007), S5 (`close-tab.ts`), S6 (`kill-shell.ts`), plus `processTree.test.ts`, `probeShell.test.ts`, `Manager.test.ts` and `SavedWorkspaces.test.ts`. The user accepted it in a manual pass in `vp run dev`.
- Fixed on the way: the shell summary fixture in `packages/contracts/src/shell.test.ts` had failed since `1251962ba`.

## Decisions

- User, 2026-11-06: the in-shell command is `probe kill`.
- User, 2026-11-06: removing a workspace kills every running shell in its projects' folders, also shells another workspace started in a shared folder; shells record no workspace.
- A kill ends the shell's whole process tree and, on Linux, its session, because a SIGKILL of the shell alone left background jobs running (`sleep 1000 &`).
- Whether a shell that exits on its own closes its tab was left to PRB.T-007 and PRB.T-008.

## Docs

- [Workspaces, tabs, close and kill](../../../user/workspaces.md)
- [Terminal runtime](../../../internals/terminal-runtime.md)
- [Roadmap](../../roadmap.md)

## Follow-ups

- Reload and restart survival, and what an ended shell becomes: PRB.T-007 and PRB.T-008.
