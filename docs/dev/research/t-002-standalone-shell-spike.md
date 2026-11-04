# PRB.T-002 spike: standalone shells (U-1, A-2, A-6, A-14, R-6)

Run 2026-11-03 on macOS (no systemd), repo commit ea1328b61 plus an AGENTS.md edit. A throwaway
script (deleted afterwards) started a server on a temp `--base-dir`, signed in with a pairing
credential, and called the real WS RPCs (`terminal.*`, `vcs.createWorktree`). It touched no `~/.t3`
data and stopped only the server it started.

## Findings

| ID | Status | Evidence |
| --- | --- | --- |
| SA-1 / U-1 | verified | `terminal.open` with `threadId: "spike-no-such-thread"` and no thread in orchestration returned `status: running`, a pid, and accepted `terminal.write`. `Manager.ts` imports nothing from orchestration; `threadId` is only a session key, lock key and history-file-name part. Identity is therefore a decision, not a blocker (see below). |
| A-2 / SA-3 | verified | `vcs.createWorktree {cwd, refName: "main", newRefName: "spike-wt", path: null}` with no thread succeeded and returned a path under `<home>/worktrees/<repo>/spike-wt`. Reusable as is. |
| A-6 / SA-4 | verified true | After the RPC connection that opened the shell closed (what a reload does to the server), a new connection's `terminal.attach` snapshot showed `status: running`, the same pid, history containing the echoed marker, and the pid alive. No subtask 8 needed on the server side. The browser-side reload still gets checked by the Checkpoint 5 scenario. |
| A-14 / SA-5 | verified false | `server.restart()` (SIGTERM, start again on same home and port) left the shell process **dead**. A `terminal.attach {resume: true}` for the same id after restart failed with `TerminalSessionLookupError`: no live session, and resume does not rebuild one. This matches the finalizer at `Manager.ts:2796-2822` and `survivesRestart` being a systemd-slice choice only (`process/agentScope.ts:358`). |
| R-6 | story 7 is large | Surviving a server restart needs a process that outlives the server (PTY host / detached helper) plus reattach by id on the next boot, plus a stop path that does not kill it. That is new machinery, not a flag. The existing history files and `resume` option give a cheaper fallback: after a restart, show saved history and offer to start a fresh shell in the same folder (no live process). Story 7's scope should be chosen between those two before it is planned. |

## U-1: how a shell is identified

The wire and manager key every terminal by `threadId` + `terminalId`. Two options:

- **(a) Reserved id namespace** in the existing `threadId` field (for example `shell:<uuid>`).
  Smallest change, zero manager changes, but a shell would still be "grouped under a thread id" on
  the wire and in `terminalSessions.ts` `byThreadId`, so web code needs a prefix check to keep
  shells out of the chat drawer (AC-17), and AC-3 is met only by convention.
- **(b) Explicit shell identity** in contracts (a `shellId`, with thread terminals unchanged).
  Honest on the wire and in the list; touches contracts, `ws.ts`, `Manager.ts` keys and history
  file names, and the web selectors.

Recommendation: (b) at the contract and list level, implemented over the same manager key
internally (the manager stores a single opaque owner string, so a shell's key can be its shell id
with no thread semantics). Decide at Checkpoint 1 with a failing contract test.

## Impact on the plan

- Checkpoint 6 (reload survival) is skipped on the server side: A-6 holds.
- Story 7 needs re-scoping before it is planned (R-6): ask the user to pick between a process host
  and the history-plus-fresh-shell fallback. EC-5 stays as written: this story keeps the manager
  behavior and builds no survival.
