---
id: PRB.T-005
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-06
---

# Start a shell in a new or existing worktree

## Goal

Agents in parallel on one repository shared one working tree. A user can now start a shell, from a "+" on a project row, in any existing worktree or in a brand-new, automatically named worktree forked from a chosen origin, and repeat it with one click.

## Delivered

Branch `feat/worktrees-prb-t-005` (2026-11-06), stacked on PRB.T-004. Each project row has a "+" opening "Create shell" with an Existing | Fork switch; the tree shows project > worktree > shell, each worktree labelled by its current branch. Proven by scenarios S2 and S3 (S3 holds a fork open with a post-checkout hook), `SavedWorkspaces.test.ts`, `Manager.test.ts` and `StartShellDialog.browser.test.tsx`. The user accepted a manual pass in `vp run dev` on 2026-11-06.

Satisfied epic requirements: FR-3, FR-4, FR-5, FR-13, FR-21, FR-22 (part), FR-6 (part), FR-7 (part), NFR-1, NFR-2, NFR-5, NFR-6 (part), NFR-7 (part); epic A-11, A-12, A-17 and U-2 resolved here.

## Decisions

- 2026-11-05, user: the tree shows git's real state. Each worktree node shows its current branch, read from the worktree's HEAD; no per-shell branch and no branch level (supersedes a per-shell branch; git keeps one branch per worktree). A shell whose cwd left its worktree stays under it, marked "elsewhere".
- 2026-11-05, user: while a worktree is created the modal shows static text "Creating probe-worktree-<hex>..." with the up-arrow disabled; no percentage and no animation.
- 2026-11-05: the default fork origin is the primary worktree's current branch.
- 2026-11-02, user: a detached-HEAD worktree is labelled by its short commit id.
- 2026-11-05 to 2026-11-06, user, manual pass: a workspace holds projects; the only start control is the per-project "+"; any worktree takes any number of shells; the repository's own checkout is called "primary". Per-worktree buttons, hiding and worktree management in the tree were tried and dropped.
- 2026-11-11, user: the branch-label limit (AC-26) is raised from 2 s to 3 s. The server re-reads HEAD on a 2 s poll, so a switch can wait a full interval plus the read; `perf-branch-label` missed 2 s in 2 of 3 loop runs (PRB.E-005 V7).
- Worktree-start time limit: measured (about 411-422 ms click to banner for a tiny repository), reported, not enforced.

## Docs

- [Worktrees](../../../user/workspaces.md#worktrees)
- [Shell location polling](../../../internals/terminal-runtime.md)
- Decisions: [roadmap](../../roadmap.md) ("+" and projects, branch model)

## Follow-ups

- Rename "folder" to "project" in code and saved data: PRB.T-009.
- Branch-label timing (AC-26, 3 s) is the `perf-branch-label` limit.
