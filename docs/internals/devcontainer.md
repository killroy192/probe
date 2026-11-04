# Dev container

> For maintainers. Using T3 Code? See [docs/user](../user/). How to start and use it:
> [Development](../operations/development.md#dev-container).

`.devcontainer/` is an execution sandbox for a coding agent that runs on the host. The agent edits files
in the checkout, which is bind-mounted into the container, and runs every other command there with
`docker exec`. Its goals are that agent-started code cannot run on the host, cannot reach the open
network, and cannot push. The image matches CI otherwise: Ubuntu 24.04, Node 26 (with `nvm`), pnpm, Rust
stable, the global `vp` CLI. There is no Claude Code, `ccc` or Codespaces/VS Code workflow in it.

The isolation lives in the container, not in any harness's settings, so Claude Code, Codex, Cursor and
others get the same guarantees once their commands go through `docker exec`. The agent deliberately
stays on the host:

- **Credentials.** The agent's login and API keys, and the code index's, would otherwise sit beside
  dependency code that can read them, and the firewall would have to allow the providers' APIs.
- **Indexing.** The `cocoindex-code` index is built once on the host. Inside, every container (one per
  worktree, again after each rebuild) would rebuild it on the slower bind mount.

Each checkout gets two containers from [`compose.yaml`](../../.devcontainer/compose.yaml): `net` owns
the network namespace, the firewall and the published ports, and `dev` joins that namespace and runs
everything else. [`up.sh`](../../.devcontainer/up.sh) is the only supported way to start them, because
it sets the variables compose interpolates; [`down.sh`](../../.devcontainer/down.sh) removes them with
the checkout's `node_modules` volume.

## What the container enforces, and the traps

- **No root at run time.** The base image's `vscode` user is renamed `devcontaineruser` and loses its
  sudoers entry. A root entrypoint ([`container-init.sh`](../../.devcontainer/container-init.sh)) does the
  privileged setup instead, and removes sudoers on every start because the devcontainer features can
  re-add them. A plain `docker exec` runs as root, so the host permission rule pins
  `-u devcontaineruser`; a wildcard in that rule could match an inserted `-u root`.
- **Firewall, outside the dev container.** [`net-init.sh`](../../.devcontainer/net-init.sh) rejects all
  outbound traffic except DNS and the hosts in
  [`allowed-domains.txt`](../../.devcontainer/allowed-domains.txt), resolved to an `ipset` at start and
  every five minutes (it only adds addresses; CDN hosts rotate). IPv6 is blocked. Only `net` has
  `NET_ADMIN`, so even root in `dev` cannot change the rules. `dev` waits for `net`'s healthcheck, which
  passes only after the rules are in. The list is copied into the image, so changing it needs a rebuild.
  Two leaks remain: DNS to the resolver stays open (tunnelling), and an allowed CDN address also serves
  other sites behind the same CDN. Closing them needs a domain-filtering proxy instead of IP rules.
- **The checkout is shared and writable, so files the host later executes are the real risk.** Code in
  the container writes through the bind mount directly; the host's Claude `ask` rules gate only the
  agent's own edits. Two mechanisms close the paths:
  - **Hooks never run on the host.** The host's `.git/config` sets `core.hooksPath=/dev/null`, so no
    host tool (editor, terminal, `git worktree add`) runs a `.vite-hooks/` script, and with it the
    container-writable `vite.config.ts` `staged` config. The entrypoint refuses to start until that is
    set. The container sees [`git-config`](../../.devcontainer/git-config) as its `.git/config`
    instead: it includes the host's config and turns the hooks back on. Both are read-only there, so
    the container cannot set `core.fsmonitor`, aliases or `core.sshCommand` for the host either.
  - **Host-loaded config is read-only in the container:** `.claude/`, `.agents/` (Claude's skills and
    agents link there), `.mcp.json`, `.vscode/`, `.cursor/` and `.devcontainer/` (`up.sh` runs on the
    host). `CLAUDE.md` and `AGENTS.md` stay writable; they steer the host agent but do not execute.
    Project config of any other harness the host loads or runs (for example a `.codex/` directory)
    needs its own line in `compose.yaml`.
  - Nothing in the repo runs on the host to set up a checkout; `vp i` and its install scripts run in
    the container only.
- **No git credentials in the container.** No ssh agent, no gitconfig, no credential helper; `up.sh`
  passes the author identity in as environment variables. A single-file bind mount follows the file,
  not the path: after a host `git config` write the container can keep seeing the old config until it
  restarts.
- **Host paths inside the container.** The checkout and the repository's common `.git` are mounted at
  their host paths, because a linked worktree's `.git` file and the main repository's back-pointer
  name each other by absolute path. Every linked worktree's container can therefore write the shared
  objects and refs, as the host's git would.

## Ports

The host runs its own dev servers on the dev runner's default ports (and on `[::1]` too), so the
container cannot publish the defaults. `up.sh` picks a free offset per checkout, publishes
`5733 + offset` and `13773 + offset` on `127.0.0.1` only, and sets `T3CODE_PORT_OFFSET` to the same
value, so the URL the dev runner prints works on the host. The dev runner binds loopback on purpose and
deletes an inherited `HOST`, so a small relay ([`port-relay.mjs`](../../.devcontainer/port-relay.mjs))
in `net` bridges the namespace's address to the loopback listeners (`127.0.0.1` for the server, `::1`
for Vite) instead of changing the runner. Do not pass `--host` to the dev runner here: it would bind
the address the relay uses.

## State and safety

`T3CODE_HOME` points at the workspace's gitignored `.t3`, so runtime state stays in the container
workspace, mirroring the worktree default. The test-data rule from AGENTS.md still holds: copy data in,
never point at shared state. `~/.t3` is not mounted, so the dev runner's automatic seeding finds no
source and the database starts empty.

## Caching

Root `node_modules` is a per-checkout named volume, which keeps installs off the slow macOS bind mount.
It covers the whole `.pnpm` virtual store and pnpm's own store, which pnpm places there because the
home directory is another filesystem; packages are hardlinked from it, not copied. The entrypoint chowns
the volume because Docker creates its mount point root-owned. The host sees an empty `node_modules`, so
a host editor cannot resolve types; run tooling in the container.

## Out of scope

- Windowed Electron development and mobile native builds are host-only. Building and checking the
  desktop bundle, typechecks, lint and the mobile static checks run in the container.
- `vp run dev --share` needs a tailscale binary and a tailnet; not provisioned.
- Codespaces and VS Code "Reopen in Container" are not supported: the setup relies on `up.sh` for
  ports, paths and git identity.
