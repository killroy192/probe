---
id: PRB.T-008
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, implement]
created: 2026-11-02
updated: 2026-11-07
---

# Restore an ended shell on request

## Business Goal

**Problem:** A shell a signal ended, or that was lost in a crash or reboot, stays in the tree as "ended" and can only be removed. The user cannot bring it back without starting a new shell by hand.

**Proposed solution:** Every ended shell gets a **Restore** action next to the "x". Restore starts a new shell in the same folder, worktree and branch, under the same id and place in the tree. The user decides what to restore and what to remove; nothing restores automatically. (Narrowed on 2026-11-07 by the user from automatic restore with agent resume, 3 attempts and an error state; see `roadmap.md`.)

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Delivers:**
  - FR-17 (changed): an ended shell (signal, or lost owner) is restored in place on the user's request, also when its tab was closed (the tab stays closed). A shell whose folder is gone stays unavailable (FR-15) and offers no Restore.
  - FR-19 (kept, owned by story 7): a normal exit with any status or a Probe kill removes the shell and offers no Restore.
  - FR-23 (kept): an ended shell is removed with the "x".
  - NFR-5: Restore and remove work with the pointer alone.
  - NFR-7: docs updated in the same PR.
- **Dropped:** FR-18 (agent resume), FR-20 (automatic attempts, retries, error state), NFR-2 resume timing, NFR-6 resume logging, the mock agent always-fail switch (SA-5). Resuming agents is a possible later story.

## Expected Behavior

- A row marked ended shows a Restore control on hover. Clicking it runs `shell.restore`: the same terminal id restarts in the saved folder (so the live branch of the worktree is used), with empty output, a new kill token and `restored: true`; the row shows a small "restored" marker. A tab that was open comes back; a closed one stays closed. No agent is started.
- `shell.restore` refuses a shell that has not ended, is being killed or restored, or whose folder is gone. A spawn failure leaves the shell ended and reports why; the user may retry or remove it.
- A restored shell that ends again is an ended shell like any other.
- The server logs `shell restored`.

## Acceptance Criteria

| ID | Criterion | Check |
| --- | --- | --- |
| AC-1 | Given a shell a signal ended, when the user clicks Restore, then it runs again in the same folder under the same id, with a "restored" marker and without its earlier output | auto (S8, Manager.test.ts) |
| AC-2 | Given all processes gone after a reboot and the workspace reopened, when the user restores a lost shell, then it runs again in place | auto (S8, Manager.test.ts) |
| AC-3 | Given an ended shell, then nothing restores it until the user asks | auto (S8) |
| AC-4 | Given a shell that exited on its own or was killed, then it is removed and offers no Restore | auto (S8) |
| AC-5 | Given an ended shell whose folder is gone, then it offers no Restore and the server refuses it | auto (S8, Manager.test.ts) |
| AC-6 | Given a shell that has not ended, then `shell.restore` is refused | auto (Manager.test.ts) |
| AC-7 | Given a restored shell, when the user removes it with the "x", then it leaves the tree | auto (S8) |
| AC-8 | Given the change is complete, then the user docs, internals and roadmap describe on-request restore | manual (reviewer in the PR) |

## Dependencies

PRB.T-001 to PRB.T-007 are all done (the earlier table listing T-002 to T-007 as backlog was stale).

## Implementation Status and Handoff

- Built: `shell.restore` RPC (`packages/contracts`, `ws.ts`, `RpcAuthorization.ts`), `Shells.restore` and the `restored` field in `apps/server/src/terminal/Shells.ts`, the Restore control and marker in `WorkspaceSidebar.tsx`, `restoreShell` in `apps/web/src/state/workspaces.ts`, scenario S8 (`scripts/scenarios/scenarios/restore-shell.ts`), a Shells test in `Manager.test.ts`.
- Not built: agent resume (needs session-id capture; the mock agent already supports `--resume <id>`), automatic restore, retries.
- Not done here: a view of the dead shell's last output (an ended shell has no tab).
- Manual browser pass with `test-t3-app` still to do.
