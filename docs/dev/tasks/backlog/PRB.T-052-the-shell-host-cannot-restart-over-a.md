---
id: PRB.T-052
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-11
---

# The shell host cannot restart over a socket file a dead host left on a Mac-mounted checkout

Found in manual testing (2026-11-11). In the dev container, `/workspaces/probe` is the Mac checkout
mounted through Docker Desktop (`fakeowner`). When the shell host dies, every new shell fails with
"The shell could not start: Failed to spawn PTY process '/bin/sh' with shell-host." and keeps
failing. The host's log (`<state>/userdata/shell-host-v1.log`) shows each restart refused:

```
could not start: Error: ENOTSUP: operation not supported on socket, lstat '.../userdata/shell-host-v1.sock'
    at Module.rmSync (node:fs)
    at startShellHost (apps/server/src/terminal/shellHost/host.ts:138)
```

On that mount the dead host's socket file is listed, but `lstat` on it fails (`ENOTSUP`, and
`stat` says it does not exist), so `rmSync(socketPath, { force: true })` throws instead of clearing
it. A plain `rm -f` (unlink) removes it, and the next shell starts a new host. The same `rmSync`
runs again when the host stops (`host.ts:159`).

How the host (pid 81452, started 13:42) died is not known: it logged nothing, the dev server logged
no loss, and no stale scenario home or run manifest names its pid. The first shell start that failed
began at 19:23:12, as a full scenario check run in a container worktree was ending.

## Direction

- Clear a stale socket with an unlink that ignores a missing file, not `rmSync` with its `lstat`;
  the liveness probe (`isAlive`) already decides that no host owns it. Test it in
  `shellHost.test.ts` by making the removal fail like this mount does (a file system stub or an
  injected remover), not by needing a Mac mount.
- Also check the client side: a server that loses its host should log it, so a dead host is seen
  before the next shell fails.
- If the host dies again, record the time and what ran then; do not guess the cause.

## Done when

- A host whose old socket file cannot be `lstat`ed still starts, and new shells open.
- A test fails before the fix and passes after.
