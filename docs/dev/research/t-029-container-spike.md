# PRB.T-029 spike: build and run the server in a container by hand

Run 2026-11-09 and 2026-11-10 by the author with an agent, from the macOS host against Docker
Desktop. Source: branch `prb-t-029` at the commit the ticket moved to in-progress (44 commits ahead
of the public `main`, 43e96ed). Throwaway containers, images and state folder; no `~/.t3` data, no
host install, servers killed only by their captured PID.

## Machine and image

- **Host:** macOS 26.7.1, Apple M1 Pro (arm64), Docker Desktop 27.5.1. The Docker VM had 10 CPUs and
  8 GB of memory. All containers ran **linux-arm64**; linux-x64 is left to PRB.T-033.
- **Image:** `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` (the `.devcontainer/` base, user
  `vscode`, uid 1000), with `python3 make g++` (the node-gyp set the Node feature brings), Node
  26.12.1 from the nodejs.org tarball, and vp 1.5.0 installed per user the way
  `.devcontainer/on-create.sh` does it (`VP_NODE_MANAGER=no`). Left out on purpose: the Playwright
  libraries, Rust and Claude Code. Image build 35 s with the base cached; image size 1.9 GB.
- **Container:** `docker run -d --init -u vscode -p 127.0.0.1:3773:3773 -v <host folder>:/state
  <image> sleep infinity`. `--init` matters: see [Shells](#shells-ac-3-a-2).

## The by-hand path

Times are wall clock from a warm network; memory is peak RSS from `/usr/bin/time -v` and peak
container memory from `docker stats`.

| Step | Command (inside the container unless noted) | Time | Peak memory |
| --- | --- | --- | --- |
| Source, public clone | `git clone https://github.com/killroy192/probe.git` (no credentials) | 15.6 s, 28,991 files | |
| Source, used for the build | host: `git archive --prefix=probe/ HEAD \| docker exec -i <c> tar -x -C ~` | 3 s, 407 MB | |
| Dependencies | `cd ~/probe && CI=true vp i` | 53 s, 1,657 packages | 0.95 GB RSS |
| Build | `vp run --filter t3 build` (web, then server) | 15.2 s | 3.3 GB RSS, 3.69 GiB container |
| Start | `nohup env T3CODE_NO_BROWSER=1 PROBE_AGENT_COMMAND=… node apps/server/dist/bin.mjs serve --host 0.0.0.0 --port 3773 --base-dir /state &` | ready about 3 s after start | ~370 MB |
| Pair | `node apps/server/dist/bin.mjs pair --base-dir /state` (`--ttl 2h` for a browser session) | instant | |

Cold path from an empty container to a reachable server: about **75 s** of install and build plus
the source fetch. No Rust and no compiler run was needed: `node-pty` 1.2.0-beta.15 ships a
`linux-arm64` prebuild and used it.

**Disk for one install** (about 4.5 GB):

| Item | Size |
| --- | --- |
| `~/probe` total | 3.7 GB |
| of which `node_modules` | 2.9 GB |
| of which server `dist` / web `dist` | 257 MB / 201 MB |
| pnpm store | 640 MB |
| `~/.cache` (vp, pnpm metadata) | 173 MB |
| `/state` after shells and a Claude login | 18 MB |
| Claude Code (`~/.local/share/claude`) | 326 MB |

A `docker commit` of the finished container was 8.32 GB and took 230 s; snapshotting a built
container is not a cheap shortcut.

## What broke

| # | Command | Output | Cause |
| --- | --- | --- | --- |
| B-1 | "+" dialog, any shell, server started without `PROBE_AGENT_COMMAND` | `The shell could not start: No agent command is configured.` | The "+" dialog always starts an agent shell, and the server reads the agent command only from the `PROBE_AGENT_COMMAND` env var (`apps/server/src/cli/config.ts:167`, `Shells.ts` `agentProblem`). A plain server has no way to open even a plain shell. Fixed for the spike with `PROBE_AGENT_COMMAND="echo spike-shell-ready"`. PRB.T-031's start command must set it or the server must default it. |
| B-2 | `serve --host 0.0.0.0` | banner and `pair` print `http://172.17.0.2:3773/…` | The address is the container's bridge IP, which the Mac cannot reach. The user must swap in the published `127.0.0.1:<port>`. The start command should print the published address or say to swap it. |
| B-3 | `serve` | the startup pairing URL with its token is written to the server log | Against epic NFR-3 for a log that `nohup` keeps on disk. |
| B-4 | Alpine: `serve` | `NodePtyModuleLoadError: Failed to load node-pty for linux-arm64.` / `Cannot find module './prebuilds/linux-arm64/pty.node'` | The glibc prebuild folder exists, so node-gyp is skipped at install, and the glibc binary does not load on musl. See [Alpine](#alpine-ac-10-a-5). |
| B-5 | SSH clone through Docker Desktop's forwarded agent | `The agent has no identities.` | The forwarded socket was mounted but the host agent had no keys loaded. A-10: the container's credentials are the user's setup. |
| B-6 | `serve` with no Claude installed | WARN `Claude Agent CLI health check failed` | The chat-era provider probe. Harmless noise; it goes once chat is removed. |
| B-7 | Bare user, no `--base-dir` | `PermissionDenied: FileSystem.makeDirectory (/nonexistent/.t3/worktrees)` / `EACCES: permission denied, mkdir '/nonexistent'` | The default state folder is under `$HOME`. Fails fast and clearly. See [Bare user](#bare-user-ac-8-u-1). |
| B-8 | `vp` installer as the bare user | `error: Command execution failed: Permission denied (os error 13)` | vp installs per user under `$HOME`. |
| B-9 | Stale comment | `.devcontainer/devcontainer.json:14` says `node-pty`'s prebuilds are mac/win only | Out of date: the pinned 1.2.0-beta.15 ships `linux-arm64` and `linux-x64` prebuilds (glibc). |

Not a Probe break, noted so it is not mistaken for one: container A was stopped once (exit 143,
`OOMKilled=true`) when the author had to restart Docker because of another container. Before that,
one bare-user server in container A sat in state R, wrote nothing and ignored SIGTERM. It did not
reproduce in a fresh container with a 1 GB cap; it is put down to the same resource pressure and
stays unverified.

## Launch-logic tools (AC-6, A-3)

| Tool | Ubuntu 24.04 | Alpine 3 (`node:26-alpine`) |
| --- | --- | --- |
| `sh` | dash (`/bin/sh` → `dash`) | busybox ash |
| `ps` | procps-ng 4.0.4 | busybox; `procps` added for the spike |
| `mktemp` | coreutils | busybox |
| `kill` | shell builtin | shell builtin |
| `nohup` | coreutils | busybox |

The pieces of `packages/ssh/src/tunnel.ts`'s runner and launch scripts were copied as written into
a scratch script and run under dash. All ran unchanged:

- the install lock (`set -C` noclobber), a second attempt refused, and a stale lock from a dead PID
  reclaimed;
- `mktemp -d` staging, the `--version` proof (`t3 v0.1.5`), the `.install-complete` marker and the
  atomic `mv`;
- the `nohup … < /dev/null &` start with the PID captured from `$!`;
- `server_running` (`kill -0` plus `ps -o stat=`, rejecting zombies).

What does **not** carry over unchanged, for PRB.T-030's plan:

- The launch script hardcodes `--host 127.0.0.1` and `--base-dir $HOME/.t3`. A container needs an
  explicit bind (A-7) and usually an explicit state folder (topology 1, U-1).
- `resolve_default_runtime_port` adopts only origins on `127.0.0.1` or `localhost`, so a server
  bound to `0.0.0.0` is not adopted.
- Pairing calls `auth pairing create`; the current CLI is `pair`.
- The download, checksum and archive parts are replaced by the build in the target.
- On Alpine the `--version` proof passes and the server still cannot start (B-4). The proof must
  load `node-pty` or start the server.

## Bind and published port (AC-2, A-7)

- `--host 0.0.0.0` with `-p 127.0.0.1:3773:3773`: the host reaches
  `http://127.0.0.1:3773/.well-known/t3/environment` with 200, about 3 s after the start command.
- `--host 127.0.0.1`, same publish: inside the container 200; from the host `curl` gets
  `Empty reply from server`. A-7 holds.
- A published port needs only a non-loopback bind inside the container. Publishing on the host's
  `127.0.0.1` keeps it off the LAN.

## Pairing (AC-9, A-6)

`pair --base-dir /state` inside the container prints a token (default lifetime 5 minutes; `--ttl`
sets it) and, like the banner, the container IP (B-2). From the host, `POST
/api/auth/browser-session {"credential": …}` returned 200 and a cookie, `POST
/api/auth/websocket-ticket` 200, and reusing the token 401. The author paired a real browser with
`http://127.0.0.1:3773/pair#token=…` and used the app. A-6 holds.

## Shells (AC-3, A-2)

Checked by the author in the browser against the container server:

- **Open, type, resize:** a shell opened (after B-1), took input, and `stty size` changed on resize.
- **`probe kill`** in shell B ended it and its processes; the UI removed it.
- **Server restart** (kill by captured PID, start again on the same `/state`): the shell host and its
  bash survived, re-parented to the init process, and shell A was intact after a reload.
- **`--init` is part of the image contract.** Without it PID 1 is `sleep`, which does not reap, so
  detached shell hosts and their exited children would pile up as zombies.
- **Container restart** (the Docker restart above): stale `shell-host-v1.pid`, `shell-host-v1.sock`
  and `shells/registry.json` stayed in `/state`. The next server started over them with no error,
  and the UI showed the old shells as ended with Restore. That is the right reverse state (R-5).
- **Observation, not a break:** after quitting `top` the prompt sits on the bottom row. `top` leaves
  the cursor there; not compared with a local Probe shell.

## Mounted state folder and a second server (AC-4, AC-14, A-8, A-9)

- **Host OS:** macOS with Docker Desktop (virtiofs). Linux: `TBD (author, 2026-11-15)`.
- **Ownership (A-8):** the `vscode` user (uid 1000) could write `/state` with no `chown`. On macOS
  the files show as the host user (501:wheel). Docker Desktop maps ownership; on Linux the uid
  must match and is untested.
- **Socket and database (A-9):** the shell host's unix socket and the SQLite databases in WAL mode
  worked on the mount through open, restart and reload.
- **Second server from a second container** on the same `/state`: container B cannot see A's server
  PID (separate PID namespace), so the PID-based "already running" preflight
  (`config.ts:336-350`) passes. The ownership lock still refused it, exit 78:
  `ServerAlreadyRunningError: A T3 Code server already owns /state/userdata. … server-owner.sqlite
  is the ownership lock`. Sharing the folder between two servers is safely refused.
- **The socket is reachable from every container that mounts the folder.** A client in container B
  connected to A's shell-host socket (one VM kernel). Anyone who can mount the state folder can
  drive its shells; the guide should say the state folder is as sensitive as the shells.
- **Host-server variant:** not run (ER-2, SU-3). The ownership lock is the same SQLite file, so it is
  expected to refuse too; unverified.

## Secret storage (AC-5, U-4)

The container has no D-Bus secret service and the server started and reported nothing about it.
Probe's server keeps its secrets as files, `<state>/userdata/secrets/*.bin` (mode 0600, folder 0700,
`ServerSecretStore.ts`). Only the chat-era Cursor provider reaches `@napi-rs/keyring`
(`packages/provider-cursor/src/server/CursorKeychain.ts`). So nothing Probe uses needs a keyring. In
topology 1 the server's signing keys sit on the host mount (see the socket point above).

## Bare user (AC-8, U-1)

A fresh container with a 1 GB cap and a user `bare` with `HOME=/nonexistent`:

- the server built by `vscode`, started as `bare` with `--base-dir` on a writable folder: works (200,
  about 370 MB);
- the same with no `--base-dir`: fails at once with B-7;
- installing vp as `bare`: fails (B-8).

So the **build** needs a writable home (vp, the pnpm store and caches live there), and the **run**
needs only a writable state folder given with `--base-dir`.

## Source and credentials (AC-7, U-6, A-10)

- No credentials: an HTTPS clone works; the repository is public now, so SA-3's failure case did not
  arise. But the public `main` lags this branch, so the build used `git archive HEAD` copied in. The
  copy has no `.git`; `prepare` prints `.git can't be found` and carries on.
- Devcontainer credentials: an SSH clone through Docker Desktop's forwarded agent socket failed with
  B-5. Whatever credentials the container gets are its configuration's, not Probe's (A-10).
- The registry is needed at install time: `vp i` fetched 1,657 packages. Nothing was tried offline.

## Oldest versions (AC-7, U-7)

One try each, same image with a different Node tarball:

| Node | `vp i` | Build | Server reachable | Notes |
| --- | --- | --- | --- | --- |
| 26.12.1 (pinned) | 53 s | 15 s | yes | |
| 24.22.2 | 49 s | 18 s | yes | |
| 22.23.4 | 48 s | 19 s | yes | logs a SQLite `ExperimentalWarning` and `SQLite checkpoint worker unavailable` |

`engines` pins 26.12.1 and is not enforced. Shells were not checked on 24 and 22, and nothing older
than 22 was tried. The package manager is fixed by vp at pnpm 12.16.1; no older one was tried.

## Alpine (AC-10, A-5)

`node:26-alpine` with `bash build-base python3 git curl procps` and vp 1.5.0: `vp i` (53 s) and the
build succeed, and the launch-logic tools are all there (busybox). The server then exits at startup
with B-4. A-5 holds: Alpine is out unless `node-pty` is built from source there.

## Claude Code in a shell (AC-13)

Claude Code 2.1.321, installed per user in container A (`~/.local/bin/claude`, on `PATH` through
the server's environment). In a Probe shell the author ran plain `claude`, logged in, picked Haiku,
sent one prompt and exited: it **started, took input and exited**, so it works. One difference seen:
leaving at the first-run theme screen left Claude's output on screen with the prompt in the middle
of it. That looks like Claude's inline renderer; it was not compared with a local Probe shell.

## Writes outside the expected folders (NFR-3)

`find / -xdev -newer <marker> -user vscode`, with `~/probe`, `/state` and `/tmp` pruned, after the
whole run:

- **vp and pnpm:** the pnpm store and caches under `~/.local/share` and `~/.cache`.
- **Claude Code** (installer and login): `~/.local/share/claude`, `~/.local/state/claude`,
  `~/.claude/`, `~/.cache/claude*`, `~/.npm/_logs`, and a desktop URL handler
  `~/.local/share/applications/claude-code-url-handler.desktop`.
- **The spike itself:** `~/.t3-spike` (the launch-logic copy), `~/.ssh/known_hosts` (the SSH clone),
  server logs in `~`.
- **The Probe server:** nothing outside its state folder.

## Status of the epic's assumptions and unknowns

| ID | Status | Evidence |
| --- | --- | --- |
| A-1 | verified, with a gap | Builds and runs on Ubuntu 24.04 arm64 with the devcontainer toolchain and no further setup; `node-pty` used its prebuild, no compiler run. Shells need `PROBE_AGENT_COMMAND` (B-1). x64 not run (PRB.T-033). |
| A-2 | verified | Shells open, type, resize; `probe kill` works; shells survive a server restart. Needs `--init` in the container. |
| A-3 | partly true | Every piece runs unchanged under dash and busybox; the hardcoded bind and `$HOME/.t3`, loopback-only adoption and the old pairing command do not fit a container. |
| A-5 | verified | Alpine installs and builds but the server cannot load `node-pty` (B-4). |
| A-6 | verified | `pair` inside, token redeemed from the host and in a browser through the published port. |
| A-7 | verified | `0.0.0.0` bind reachable through `-p 127.0.0.1:3773:3773`; loopback bind gives an empty reply. |
| A-8 | verified on macOS / Docker Desktop | Writable by uid 1000 without `chown`. Linux `TBD (author, 2026-11-15)`. |
| A-9 | verified for the container side | Socket and WAL SQLite work on the mount; a second server from another container is refused by the ownership lock. The host-server variant not run (ER-2). The socket is reachable from any container mounting the folder. |
| A-10 | verified | The forwarded SSH agent had no keys; credentials are the container configuration's (B-5). |
| U-1 | answered | Build needs a writable home; run needs only `--base-dir` on a writable folder. |
| U-2 | answered | ~53 s install + ~15 s build, ~3 s to ready; ~4.5 GB disk; build peak ~3.7 GiB. |
| U-4 | answered | No keyring needed: the server keeps secrets in files; only chat-era Cursor uses the keyring. |
| U-6 | answered | Public HTTPS clone with no credentials works (but `main` may lag); `git archive` copy works; registry needed. |
| U-7 | narrowed | Node 22.23.4 is the oldest tried that builds and serves (shells not checked there); pnpm fixed at 12.16.1 by vp; registry needed at install. |

## Proposed NFR-1 limits

From one arm64 run on a fast laptop, so with headroom:

- **Cold install** (install and build, source already fetched): about 70 s measured; propose a limit
  of **5 minutes** on a 2-CPU target. `TBD (author, 2026-11-15)` once x64 and a smaller machine are
  measured in PRB.T-033.
- **Disk:** about 4.5 GB measured; propose requiring **6 GB free**.
- **Memory:** the build peaked at 3.69 GiB; propose requiring **4 GB** for the build. The smallest
  size that works was not searched (EC-1); `TBD (author, 2026-11-15)`. The running server needs
  about 400 MB.
- **Time to ready:** about 3 s; propose 30 s as the start command's wait.

## Not run

- The host-server variant of the second-server check (ER-2, SU-3).
- Linux as the Docker host (SU-1, AC-14): `TBD (author, 2026-11-15)`.
- linux-x64 (PRB.T-033).
- The smallest memory that builds (EC-1).
- R-9, the same-path mount failure: not shown; left to PRB.T-034.
