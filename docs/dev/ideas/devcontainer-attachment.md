# Devcontainer attachment

Let Probe virtualize a workspace: the user picks the folders, clicks _Virtualize_, and Probe starts
one container that holds those repos and all their worktrees. Agents, shells and dev servers run
inside, so nothing they do touches the host; Probe stays on the host. The goal is protecting the host,
not isolating agents from each other. This repo's own `.devcontainer/` (one container per worktree,
the agent inside) is the motivating case and what this would replace.

## Proposed shape

- **One container per workspace, not per worktree.** It sees every repo and worktree, so worktrees
  are plain `git worktree add` inside: no relative-path pointers, no computed `.git` mounts, no host
  script, no prune hazard in the container. One `claude` login, one setup run, and pnpm's store is
  shared, so a new worktree's install takes seconds.
- **Attach the way Cursor does.** The image carries no Probe. On attach, the host app installs a
  version-matched Probe server into the container and starts it there; the host app is a client and
  the container is one more environment. A host-side server cannot work: it cannot see worktrees on a
  volume (files, diffs, checkpoints, git), and every MCP tool it served to agents inside would run on
  the host, an escape hatch to audit forever.
- **Port forwarding through the server connection**, as Cursor does: it reaches loopback inside and
  adds ports at runtime. Fallback for terminal use without Probe attached: a fixed published range
  sized from a max-worktrees setting, user-overridable.
- **Worktrees on a volume by default**, with an option to put them in the mounted repo instead.
- **A base image, or the user's own** (an image or a `devcontainer.json`, which brings devcontainer
  features for toolchains).
- **Login from the first shell.** That first agent becomes the orchestrator; it cannot exist before
  the login, and every sub-agent it starts shares the credential.
- **The definition lives in Probe's app data, not the repo**, so the container cannot edit what the
  host runs.

## Accepted trade-offs

- Any agent can damage any worktree or mounted repo, or rewrite branches. Pushed branches are the
  backup.
- Repo files the host later runs (git hooks, `.vscode/tasks.json`, `.envrc`, package scripts) are
  written by the container. Mounted repos still need host hooks off (`core.hooksPath=/dev/null`).
- Docker Desktop's memory cap and one subscription's rate limits are shared by every agent; the
  orchestrator needs a concurrency cap.

## To research

- Server injection: the client/server version match (Cursor pins the exact build) or a protocol
  version check; a self-contained server binary so any image works, or a minimum image contract
  (non-root user, git, bash, Node).
- Restarting the injected server after a container restart, without a supervised service.
- Port forwarding over the WebSocket; for the fixed-range fallback, ports per worktree slot (Probe
  needs 2, other repos more), recreating the container when the range changes, a relay for dev
  servers bound to loopback, and collisions with host ports.
- Volume mode: when the original repo is also bind-mounted, host git sees the worktrees as missing,
  and a host `git worktree prune` would drop their metadata, so lock them. Mounted mode: relative
  paths so host and container git both resolve them; slow macOS bind-mount I/O with node_modules.
- Base image contents, and what to do with repos that ship their own `.devcontainer`.
- A credential that expires mid-run fails every sub-agent at once: the orchestrator should detect it
  and pause. Each provider (Codex, Cursor, others) logs in separately.
- How the tree and the "+" modal show that a shell is inside a container, and how a dead container
  is shown on restore.
- Remote and tunnel connections: the container runs where the host app's machine is.
