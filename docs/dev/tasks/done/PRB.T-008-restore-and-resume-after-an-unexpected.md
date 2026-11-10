---
id: PRB.T-008
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-07
---

# Restore an ended shell on request

## Goal

A shell that a signal ended, or that was lost in a crash or reboot, stayed in the tree as "ended" and could only be removed. The user can now restore it, in place, on request.

## Delivered

- A **Restore** action on every ended shell row, next to the "x". It starts a new shell in the same folder, worktree and branch, under the same id and place in the tree, with empty output and a "restored" marker; an open tab comes back, a closed one stays closed. No agent is started.
- A shell whose folder is gone, or that has not ended, offers no Restore and the server refuses it. A restored shell that ends again is an ended shell like any other.
- Scenario S8 (`scripts/scenarios/scenarios/restore-shell.ts`) and the Shells test in `apps/server/src/terminal/Manager.test.ts`.
- Epic requirements: FR-17 (changed), FR-19 and FR-23 (kept), NFR-5, NFR-7.

## Decisions

- Narrowed on 2026-11-07 by the user from automatic restore with agent resume, 3 attempts and an error state to restore on request only. Dropped: FR-18 (agent resume), FR-20, NFR-2, NFR-6 and the mock agent always-fail switch (SA-5).

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md)
- [Workspaces user guide](../../../user/workspaces.md)
- [Roadmap](../../roadmap.md) (PRB.E-001 restore decision)

## Follow-ups

- Resuming agents in a restored shell (needs session-id capture): deferred to the agent state phase.
- A view of an ended shell's last output: not built; an ended shell has no tab.
- Manual browser pass with `test-t3-app` was still to do when the ticket was written.
