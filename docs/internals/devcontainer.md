# Dev container

> For maintainers. Using T3 Code? See [docs/user](../user/). How to start and use it:
> [Development](../operations/development.md#dev-container).

`.devcontainer/` is a container for the coding agent and everything it runs. Its one goal is that
nothing done inside damages the developer's machine. It does not protect the repository or the
developer's GitHub account: the agent commits and pushes with the developer's forwarded SSH agent, and
the network is open. The image otherwise matches CI: Ubuntu 24.04, Node 26 (with `nvm`), pnpm, Rust
stable, the global `vp` CLI, plus Claude Code.

It starts the same way from Cursor or VS Code (_Reopen in Container_) and from the `devcontainer` CLI,
and both reach the same container. [`init-env.sh`](../../.devcontainer/init-env.sh), the
`initializeCommand`, runs on the host before every start and writes the gitignored `.devcontainer/.env`
that [`compose.yaml`](../../.devcontainer/compose.yaml) interpolates. A plain `devcontainer.json`
cannot compute mount paths; compose exists only to read that file.

## What keeps the host safe, and the traps

- **Only the checkout is mounted,** plus the repository's shared `.git` for a linked worktree and
  Docker Desktop's SSH agent socket. No home directory, no Docker socket, no privileges.
- **Nothing the container writes runs on the host.** The host runs two kinds of repo files, and both
  are closed:
  - **`.devcontainer/` itself:** Cursor runs `initializeCommand` there, and the developer runs
    `worktree.sh`. It is mounted read-only, so changes come from the host.
  - **Git hooks:** the container rewrites `.vite-hooks/` and everything `vp staged` loads. `init-env.sh`
    sets `core.hooksPath=/dev/null` in the host's `.git/config`, so no host tool (editor, terminal,
    `git worktree add`) runs one. The container sees [`git-config`](../../.devcontainer/git-config) as
    its `.git/config` instead: it includes the host's config and turns the hooks back on. Both are
    read-only there, so the container cannot set `core.fsmonitor`, aliases or `core.sshCommand` for
    the host either.
- **A single-file bind mount follows the file, not the path:** after a host `git config` write the
  container can keep seeing the old config until it restarts.

## Worktrees

A linked worktree's `.git` is a file pointing into the main checkout's `.git`, which holds all history,
refs and config. [`worktree.sh`](../../.devcontainer/worktree.sh) creates worktrees with
`--relative-paths`, so the pointer is `../<main>/.git/worktrees/<name>`, and `init-env.sh` mounts the
main `.git` (without the main checkout's files) where that pointer lands inside the container. This sets
`extensions.relativeWorktrees` in the repository, which git older than 2.48 refuses to open; `git-config`
repeats it because the container reads the host's config only through an include.

A container sees only its own worktree, so git lists the others as prunable, and `git worktree prune`
there would delete their metadata. `worktree.sh` locks every worktree it creates, which prune skips;
AGENTS.md forbids prune in the container on top of that. A worktree created any other way, or with
absolute paths, is not locked, and `init-env.sh` refuses absolute ones.

## Ports

The host runs its own dev servers on the dev runner's default ports, so `init-env.sh` picks a free
offset per checkout (kept across rebuilds), publishes `5733 + offset` and `13773 + offset` on
`127.0.0.1`, and sets `T3CODE_PORT_OFFSET` to the same value, so the URL the dev runner prints works on
the host. The dev runner binds loopback on purpose and deletes an inherited `HOST`, so the container's
main process is a small relay ([`port-relay.mjs`](../../.devcontainer/port-relay.mjs)) bridging the
container's address to the loopback listeners (`127.0.0.1` for the server, `::1` for Vite). Cursor's own
forwarding reaches loopback directly and does not need it; the terminal does. Do not pass `--host` to
the dev runner here: it would bind the address the relay uses.

## State and caching

`T3CODE_HOME` points at the workspace's gitignored `.t3`. `~/.t3` is not mounted, so the dev runner's
automatic seeding finds no source and the database starts empty.

Root `node_modules` and Claude Code's config directory (`CLAUDE_CONFIG_DIR`) are named volumes per
checkout; `worktree.sh remove` deletes them with the container. `node_modules` covers the whole `.pnpm`
virtual store and pnpm's own store, which pnpm places there because the home directory is another
filesystem; packages are hardlinked from it, not copied. The host sees its own `node_modules`, not the
container's.

## Out of scope

- Windowed Electron development and mobile native builds are host-only. Building and checking the
  desktop bundle, typechecks, lint and the mobile static checks run in the container.
- `vp run dev --share` needs a tailscale binary and a tailnet; not provisioned.
- The `cocoindex-code` MCP server is not installed in the container.
