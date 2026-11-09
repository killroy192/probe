# Attaching Probe to a devcontainer

Question: can Probe virtualize a workspace the way VS Code and Cursor attach to a devcontainer
(see [the idea](../ideas/devcontainer-attachment.md)), and what would it take? Desk research on
2026-11-08 by three read-only passes (attach mechanics, prior art and Docker control, this codebase).
**Verified** means a fetched source or the code said it; **inference** is reasoning, not re-checked.
VS Code and Cursor internals come from community logs, not official docs. Nothing here was run.

## Findings

### How VS Code and Cursor attach

- The client downloads a server build matched to its own commit hash and copies it into the container
  once. The server listens inside the container and the client reaches it through `docker exec`, so no
  Docker port is published (verified for the install; the stdio bridge is inference). A new client
  installs a new server beside the old one.
- Port forwarding rides that connection: a local listener tunnels each connection through the server
  (inference). After a container restart the client runs `docker exec` again and restarts the server
  (inference).
- Cursor cannot use Microsoft's extension and ships a closed fork of both the extension and the
  server. It works but has known gaps (GPG not mounted, `forwardPorts` not shown). A fork-specific
  client and server pair is feasible and a maintenance burden.

### What we can reuse

- `@devcontainers/cli`: `up`, `exec`, `read-configuration`, `run-user-commands` give builds, features,
  lifecycle commands and user setup (verified commands; flags are inference). It does not forward
  ports or install a server.
- The `docker` CLI from Node for inspect, `ps` by label, `events` and file copy. node-pty running
  `docker exec -it` gives a real PTY with working resize (inference).
- Our own server, copied in and keyed by version.
- `packages/ssh/src/tunnel.ts` is the closest attach already in the repo (verified): it installs a
  self-contained server archive on a remote machine, picks a free port, starts the server detached,
  adopts a running one, mints a pairing token with `bin.ts pair` and forwards a port. Its scripts are
  POSIX sh and could run under `docker exec` (inference). The part that does not carry over is the
  port forward, because `docker exec` cannot forward ports.

### Fit with Probe's architecture

- An in-container server is one more environment (verified model: the glossary defines an
  environment as a running server plus the machine and state it owns, and the client runtime holds
  several at once). Pairing, routes and the protocol-version check already exist.
- Missing: a route whose transport is exec plus forward, with lifecycle owned by the host app; a
  notion of "this environment is the container of workspace W"; a rule for which environment owns a
  workspace file.
- Everything that touches files assumes the server shares the machine: shell host and registry,
  worktree creation and branch reads, checkpoints, the "Add project" file browser, MCP tools. This
  confirms the idea's rule that the server must run inside the container.
- Shells reach the server over loopback through `<state dir>/shell-bin/endpoint`, which holds when the
  server and its shells are in the same container.

### Shipping the server

- Release archives exist for darwin, linux-arm64, linux-x64 and Windows and download from the
  upstream T3 repository's releases (verified, `packages/shared/src/cliRelease.ts`). This fork has
  none. A Mac host cannot copy its own build into a Linux container.
- The single-file build still needs a `node_modules` tree beside it for native packages (`node-pty`
  and its spawn helper, `@napi-rs/keyring`). The client-server check is one integer, the orchestration
  protocol version; exact version pinning like Cursor's would be an extra rule.

### Repos and worktrees

- A worktree's `.git` file holds an absolute path, so bind-mounting a repo at a different path
  breaks it (verified). A host `git worktree prune` also drops worktrees it cannot see.
- Cleanest layout (inference): clone into a named volume and create worktrees only inside the
  container; the host never sees the repo, so nothing can prune it and a planted git hook never runs
  on the host. Cost: host repos need a way in (clone from a read-only mount, or copy), and the "Add
  project" browser now browses the container.
- Bind mounts are slow on macOS with `node_modules`; a named volume for it is the standard fix.

### Credentials and safety

- `git push` inside needs the SSH agent, an HTTPS credential helper or a token (VS Code forwards the
  agent and calls back to the host helper; inference on mechanism). Docker Desktop on macOS proxies
  the agent at a fixed path (from memory, unverified).
- A container does not stop a hostile repo from exfiltrating anything reachable inside it, including
  `~/.claude` credentials, while egress is open (verified, Claude Code's devcontainer docs). The
  reference setup uses a non-root user, an egress allowlist and no mounted `~/.ssh`.
- Never mount the Docker socket. Docker Sandboxes (`sbx`) have the strongest model (microVM, host proxy
  that injects credentials, same-path mount) but are a proprietary binary: copy the design, treat it
  as an optional backend at most.

### Prior art

| Tool | Licence | Take |
| --- | --- | --- |
| DevPod | MPL-2.0 | Closest precedent: an agent in the container speaks SSH over the exec pipe and forwards ports. A Go binary is awkward to embed. |
| devc | not checked | Small proof of the exec-pipe relay with no published port. |
| Sculptor (Imbue) | MIT | Closest product: worktree workspaces and an experimental Docker backend. Code is reusable. |
| Dagger container-use | Apache-2.0 | One container per agent, MCP-driven; a different shape. |
| Docker Sandboxes | proprietary | Learn the proxy and credential design. |
| Crystal, Conductor | MIT (deprecated) / closed | Worktrees without containers; learn only. |

Coder, Codespaces and Ona were not researched and are remote-first anyway.

## Proposed design (recommendation)

1. **Host app is the client and owns the lifecycle.** It creates the container (the `devcontainer`
   CLI or plain `docker run`; decide in a spike), copies in a Linux server artifact, starts the server
   and pairs, extracted from `packages/ssh` as a runner interface with an SSH and a Docker
   implementation.
2. **First transport: publish one port.** Map the in-container server's port to a free
   `127.0.0.1` port at creation. That avoids building a relay for the Probe connection itself. Dev
   server ports inside come later, through the same server connection or a relay.
3. **Shell persistence is Probe's own.** Shells run under the in-container shell host, which already
   outlives the server (inference from `docs/internals/terminal-runtime.md`), so no tmux and no
   long-lived `docker exec` sessions are needed. The container's main process only has to stay alive.
4. **Workspace belongs to one environment** (decision below), with the repos on a volume.

## Proposed epics (no IDs yet; arrows mean "depends on")

- **A. Run Probe inside a container.** A1 spike: run the built server in a stock Linux container by
  hand and pair a browser (this is also the plan for developing Probe with Probe). A2: a Linux server
  artifact we build and version, plus a minimum image contract. A3: runner interface and Docker
  implementation (install, start, adopt, stop, pair). A4: restart the server after a container
  restart. A2 → A3 → A4.
- **B. Virtualize a workspace** (needs A). Virtualize action; the definition lives in Probe's app data;
  the workspace is bound to one environment; the tree and "+" show a shell is in a container; show a
  dead container on restore; repos in a volume and how host repos get in; base image or
  `devcontainer.json`.
- **C. Credentials and agents inside.** Login from the first shell, `git push`, a concurrency cap,
  credential expiry.
- **D. Host safety and port forwarding** (needs B). Hooks off on mounted repos, egress allowlist,
  forwarding for dev servers.

## Spike order

1. Server in a stock container: do `node-pty`, the spawn helper, the shell host, the `probe` shell
   wrapper and pairing work, and how is the artifact obtained?
2. Runner interface: can the `packages/ssh` scripts run under `docker exec` with a small abstraction?
3. Persistence: with Probe's shell host in the container, do shells and the server survive a host app
   restart and a container restart?
4. Volume layout: clone into a volume with worktrees inside; host repo import; `git push`.

## Decisions (2026-11-08, user)

Recorded in `roadmap.md` (scope decision 9 and "Remote and devcontainer"). In short: a container is a
remote server and Probe's UI connects to it; a workspace belongs to the server it is created on;
there is no new version policy; the repo model, container backend and safety come from the
devcontainer configuration (repos bind-mounted and worktrees in a volume for the author), not from
Probe. This shrinks the epics to two: the terminal-first UI against a remote environment, and a
devcontainer helper that starts a container and connects.

## Gaps

Not verified: devcontainer CLI flags, git 2.48 relative worktree paths, Docker Desktop's macOS agent
socket path, Podman, Colima and OrbStack behavior, the `docker exec` session lifetime when the client
dies, and macOS bind-mount numbers. Not read in full by the code pass: `ws.ts`, the MCP server, the
Rust helpers and the web environment state.
