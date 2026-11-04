# Dev container

> For maintainers. Using T3 Code? See [docs/user](../user/). How to start and use it:
> [Development](../operations/development.md#dev-container).

`.devcontainer/` is an execution sandbox for a coding agent that runs on the host. The agent edits files
in the checkout, which is bind-mounted into the container, and runs every other command there with
`docker exec`. Its goals are that agent-started code cannot run on the host, cannot reach the open
network, and cannot push. The image matches CI otherwise: Ubuntu 24.04, Node 26 (with `nvm`), pnpm, Rust
stable, the global `vp` CLI. There is no Claude Code, `ccc` or Codespaces/VS Code workflow in it.

## What the container enforces, and the traps

- **No root at run time.** The base image's `vscode` user is renamed `devcontaineruser` and loses its
  sudoers entry. A root entrypoint ([`container-init.sh`](../../.devcontainer/container-init.sh)) does the
  privileged setup instead, and removes sudoers on every start because the devcontainer features can
  re-add them. A plain `docker exec` runs as root, so the host permission rule pins
  `-u devcontaineruser`.
- **Firewall.** The entrypoint rejects all outbound traffic except DNS and the hosts in
  [`allowed-domains.txt`](../../.devcontainer/allowed-domains.txt), resolved to an `ipset` at start and
  every five minutes (it only adds addresses; CDN hosts rotate). IPv6 is blocked. The container has
  `NET_ADMIN` for this, which `devcontaineruser` cannot use: it has no sudo, and capabilities do not
  reach a non-root `exec`. If the setup fails the container exits, so it never runs unrestricted. The
  list is copied into the image, so changing it needs a rebuild. DNS to the resolver stays open, so DNS
  tunnelling is a possible exfiltration channel.
- **The checkout is shared and writable, so files the host later executes are the real risk.** Git runs
  config and hooks on whichever machine runs it next, and the host runs `pull`, `fetch` and `push`.
  `.git/config` (`core.fsmonitor`, aliases, `core.hooksPath`, `core.sshCommand`) and `.git/hooks` are
  therefore mounted read-only in the container. The host runs those commands with
  `core.hooksPath=/dev/null`, so edited hook scripts under `.vite-hooks/` never run on the host. Other
  host-executed files (`vite.config.ts` `staged`, `.claude/settings*.json`, `.devcontainer/`) are
  protected by `ask` rules in the host's Claude settings, not by the container.
- **No git credentials in the container.** No ssh agent, no gitconfig, no credential helper; the author
  identity comes from a gitignored env file that [`git-identity.sh`](../../.devcontainer/git-identity.sh)
  writes on the host. A single-file bind mount follows the file, not the path: after a host `git config`
  write the container can keep seeing the old config until it restarts. Linked worktrees are not
  supported: their `.git` is a file pointing at an absolute host path that does not exist in the container.

## Ports

The host runs its own dev servers on the dev runner's default ports (and on `[::1]` too), so the
container cannot publish the defaults. [`up.sh`](../../.devcontainer/up.sh) picks a free offset per
checkout, publishes `5733 + offset` and `13773 + offset` on `127.0.0.1` only, and sets
`T3CODE_PORT_OFFSET` to the same value, so the URL the dev runner prints works on the host. The dev runner
binds loopback on purpose and deletes an inherited `HOST`, so a small relay
([`port-relay.mjs`](../../.devcontainer/port-relay.mjs)) bridges the container's address to the loopback
listeners (`127.0.0.1` for the server, `::1` for Vite) instead of changing the runner. Do not pass
`--host` to the dev runner here: it would bind the address the relay uses.

## State and safety

`T3CODE_HOME` points at the workspace's gitignored `.t3`, so runtime state stays in the container
workspace, mirroring the worktree default. The test-data rule from AGENTS.md still holds: copy data in,
never point at shared state.

## Caching

Two named volumes keep rebuilds fast and installs off the slow macOS/Windows bind mount: the pnpm store
(shared across checkouts) and root `node_modules` (per checkout; it covers the whole `.pnpm` virtual
store). Docker gives a new volume the ownership of the directory it is mounted on, so the image
pre-creates `~/.cache/pnpm` and the entrypoint chowns `node_modules` (inside the bind mount, so the image
cannot). The host sees an empty `node_modules`; run tooling in the container.

## Out of scope

- Windowed Electron development and mobile native builds are host-only. Building and checking the
  desktop bundle, typechecks, lint and the mobile static checks run in the container.
- `vp run dev --share` needs a tailscale binary and a tailnet; not provisioned.
- Codespaces and VS Code "Reopen in Container" are not supported: the setup relies on `up.sh` for ports
  and git identity, and on `NET_ADMIN`.
