---
id: PRB.T-052
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-12
---

# The shell host cannot restart over a socket file a dead host left on a Mac-mounted checkout

## Goal

On a Docker Desktop Mac mount a dead shell host's socket file cannot be `lstat`ed, so
`rmSync(..., { force: true })` threw and every new shell failed with "Failed to spawn PTY process
'/bin/sh' with shell-host." The host now starts over such a file.

## Delivered

- `apps/server/src/terminal/shellHost/host.ts` clears the socket with an unlink that ignores a
  missing file, at start, at stop and after a failed start. Commit `767ef1dba`.
- The server logs a warning, "lost the shell host; its shells ended", with the host pid, when its
  connection to the host closes without the server closing it (`client.ts`). Commit `7c71450a9`.
- Merge `e07b6af17`. Test: `shellHost.test.ts` › "starts over a dead host's socket file that cannot
  be lstat-ed, as on a Docker Desktop Mac mount" (fails on the old code with the same ENOTSUP).

## Decisions

- Why the host died on 2026-11-11 (pid 81452) stays unknown: it logged nothing. With the new
  warning, the next loss is logged with its time.
