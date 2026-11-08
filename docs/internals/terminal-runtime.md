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
normal interactive shell and types the command into it. The check runs before spawning so a
missing CLI fails the start instead of leaving a shell that only printed "command not found".
Typing the command, rather than spawning the CLI directly, keeps the shell open when the CLI
exits. `Shells` logs each start, failed start (with the cwd) and end at info level.

The command is typed only once the shell is ready. Typed at once, the terminal driver echoes it
before the prompt and the shell's line editor draws it again after, so it shows twice. zsh and bash
are therefore started through wrapper startup files ([`shellReady.ts`](../../apps/server/src/terminal/shellReady.ts),
written to `<state dir>/shell-ready` and chosen in `trySpawn` for shell owners only) that run the
user's own files and then print the OSC 133;B input-start mark after the prompt. `Shells` types
after the first mark, or after 15 seconds without one (a slow startup file, or a user config that
replaced the wrapper), and does it in the background so `shell.open` returns at once. Three details
are easy to get wrong: zsh prints the mark from a `line-init` hook, because a `precmd` hook runs
before zsh has put the terminal in raw mode; bash prints it at the end of `PS1`, because
`PROMPT_COMMAND` runs before readline has; and the mark after the prompt must be B, not the
prompt-start A, because Ghostty starts a fresh line at an A and would move typed text off the
prompt's row. The A goes at the start of the prompt instead, as `133;A;redraw=1`, so it is printed
again with every redraw: libghostty-vt clears the prompt rows on resize only for a shell that sends
`redraw=1`, and without that a narrowed window keeps a stale copy of the prompt line. The zsh wrapper keeps `ZDOTDIR` pointing at its own folder while it reads the user's
files and restores the user's value before the first prompt. Other shells are not wrapped and get
the command at once.

A shell started from a workspace carries its project and worktree. Every 2 seconds, and only
while such shells exist, `Shells` reads each worktree's `HEAD` file (following a linked
worktree's `.git` file) and each shell process's current folder (`/proc/<pid>/cwd` on Linux, one
batched `lsof` on macOS, nothing elsewhere), and sends an upsert for the shells whose branch or
"elsewhere" folder changed. It never starts git, so a switch made by any program in the worktree
shows up, and the cost stays one small file read per worktree and per shell.

`shell.kill` ([`Shells.kill`](../../apps/server/src/terminal/Shells.ts)) is the only way Probe ends
a shell on purpose: the tree's kill, `probe kill` and workspace removal all go through it. A
SIGKILL to the pty process alone leaves the shell's background jobs running, so the kill reads
the process table with `ps`, stops the shell, its descendants and, on Linux, every process in
its session (which catches a job that double-forked away from its parent), reads it again and
SIGKILLs them all ([`processTree.ts`](../../apps/server/src/terminal/processTree.ts)). macOS's
`ps` has no session id, so there a job that double-forked before the kill escapes; Windows
signals the shell only. A kill is uninterruptible, because `probe kill`'s request dies with the
shell it kills.

`probe kill` reaches the server without environment auth, like `/mcp`. At startup `Shells`
writes a `probe` wrapper into `<state dir>/shell-bin` that runs the server's own entry with the
hidden `__probe` command, dispatched in [`bin.ts`](../../apps/server/src/bin.ts) before the full
CLI loads, and writes the current endpoint (`POST /api/shell/self/kill` on the address the
server bound, loopback when it bound every interface) to `shell-bin/endpoint`. Each shell gets a
random token, the endpoint file's path, `PROBE_BIN` and a `PATH` with that folder first
([`shellEnv.ts`](../../apps/server/src/terminal/shellEnv.ts)). Shells outlive the server, so the
command reads the file at each call rather than an endpoint fixed at the shell's start. The
token kills only its own shell; only its hash is kept, in the shell registry.

## Shell host

A shell outlives its viewers and the server. Closing or reloading a page only detaches. Shells
(owners `shell:<id>`) are spawned in the **shell host**
([`shellHost/`](../../apps/server/src/terminal/shellHost/)), a detached process the server starts
with the hidden `__shell-host <state dir>` command, one per state folder. It owns the PTYs,
keeps up to 8 MiB of output per shell, and speaks newline-delimited JSON to one server at a time
over `<state dir>/shell-host-v<N>.sock` (a temp-folder path when that is too long for a unix
socket), writing its pid next to it. The manager's shutdown detaches from host processes
instead of killing them; thread terminals still use the in-process PTY and end with the server.
Windows has no host. The host exits by itself when it has no shells and no server.

`Shells` saves every shell it starts in `<state dir>/shells/registry.json` (project, worktree,
pid, token hash; an older server wrote `folder` for `project`, which is still read, as are `folders` and
`lastStart.folder` in workspace files). At startup it matches the registry against the host's sessions by pid: a live
one is adopted into the manager (`TerminalManager.adopt`) with the host's output as its history,
so the same process continues with its scrollback; a host session with no registry entry is a
crashed server's leftover and is killed.

How a shell ended decides whether it stays: a Probe kill or an exit without a signal (any status)
removes it and its history; a signal exit, or a registry entry the host no longer has (the host
died, for example in a reboot), keeps it listed with `ended: "signal" | "lost"` until it is
killed. Only the user brings an ended shell back: `Shells.restore` (`shell.restore`) reopens the
same terminal under the same id and folder, drops the old output, issues a new kill token and
sets `restored`. It refuses a shell that has not ended or whose folder is gone, and nothing calls
it automatically. The host remembers an exit that happens while no server is connected until a server
forgets it. The socket name carries the protocol version, so a server of another version starts
its own host and shows the old host's shells as lost.

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
