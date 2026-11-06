# Terminal runtime

The environment server owns PTYs, session lifetime, and retained output. Every
client, including the desktop renderer, attaches through the environment connection.
This lets clients reconnect or share a running session. Renderer choices stay local
to each client and do not change terminal contracts.

## Shells and thread terminals

A shell is a terminal owned by the environment, not by a chat thread. It has its own
[`shell.*` RPCs](../../packages/contracts/src/shell.ts) and a server-allocated id. Inside
the terminal manager it is an ordinary session whose owner key is `shell:<id>` where a
thread terminal's key is its thread id; [`Shells.ts`](../../apps/server/src/terminal/Shells.ts)
maps between the two. The thread terminal list (`subscribeTerminalMetadata`) drops shell owners
and the shell list carries no thread id, so clients never see a shell as a thread's terminal.
The `terminal.*` input schemas reject the `shell:` prefix, because those inputs can reopen
or recreate sessions by key, which a shell id must not do. Server code that calls the manager
directly with a shell owner key bypasses that check, so it should go through the `Shells`
service. A shell that cannot start is closed again, and `shell.open` fails with the launch reason.

`shell.open` with `agent: true` (used by `workspace.startShell`) checks that the first word of
`PROBE_AGENT_COMMAND` resolves to a file or a program on the server's `PATH`, then starts the
normal interactive shell and writes the command as its first input. The check runs before
spawning so a missing CLI fails the start instead of leaving a shell that only printed "command
not found". Writing the command, rather than spawning the CLI directly, keeps the shell open when
the CLI exits. `Shells` logs each start, failed start (with the cwd) and end at info level.

A shell started from a workspace carries its folder and worktree. Every 2 seconds, and only
while such shells exist, `Shells` reads each worktree's `HEAD` file (following a linked
worktree's `.git` file) and each shell process's current folder (`/proc/<pid>/cwd` on Linux, one
batched `lsof` on macOS, nothing elsewhere), and sends an upsert for the shells whose branch or
"elsewhere" folder changed. It never starts git, so a switch made by any program in the worktree
shows up, and the cost stays one small file read per worktree and per shell.

A shell outlives its viewers: closing or reloading a page only detaches. It does not
outlive the server. Shutdown ends every PTY, and the `survivesRestart` process-scope
flag does not change that.

## Output and retention

[Terminal history](../../apps/server/src/terminal/Manager.ts) is incremental.
PTY callbacks append new chunks; live events carry only those chunks. Materializing
or copying full scrollback on every callback makes output cost grow with retained
history, so snapshots and coalesced persistence are the materialization boundaries.
Persistence queues the mutable history buffer and reads its latest value when the
write runs. Clear, restart, and close must drain writes before completing their
lifecycle boundary.

Server history is capped at 5,000 lines and 8 MiB of UTF-8 text per terminal, so a
long unterminated line cannot bypass retention. Eviction removes the oldest output
without splitting Unicode code points; live output is not truncated. Release
discarded chunk references immediately, even if array compaction happens later.
Client buffers have a separate 512 KiB cap. Measure throughput with full scrollback
when changing this path.

Restoration must read only the bounded tail of current or legacy history files,
skip any incomplete UTF-8 prefix, and apply the line limit. Close the read handle
before rewriting the capped file. Reading whole old logs would defeat the memory
bound during startup.

## Renderer ownership

Android and web use the same `libghostty-vt` C ABI for terminal behavior. Platform
adapters own drawing and input integration, and React stays out of terminal frames.
The web adapter shares one WebAssembly instance per browser tab while each terminal
owns and frees its own handles. The canonical upstream pin is
[`native/libghostty-vt/VERSION`](../../native/libghostty-vt/VERSION); both native and
web artifacts must be rebuilt when it changes. Web embeds the revision in its build
info so the ABI check can detect drift without a second pin.

Restoring scrollback must not send terminal replies to the current shell. Historical
device queries can otherwise provoke fresh replies that appear as junk at the
prompt. The server strips query/response traffic from retained history, and the
[web renderer](../../apps/web/src/terminal/ghostty/core.ts) detaches its PTY writer
during replay. Preserve both protections when changing retention or renderer code.
