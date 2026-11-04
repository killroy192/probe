# Dev container

> For maintainers. Using T3 Code? See [docs/user](../user/).

`.devcontainer/` gives you a ready-to-code Linux environment matching CI: Ubuntu 24.04, Node 26, pnpm, Rust stable, the global `vp` CLI, Claude Code, and `ccc` for code search. It needs only Docker: open the repo in VS Code and "Reopen in Container", create a GitHub Codespace, or use the [Dev Container CLI](https://github.com/devcontainers/cli) (`devcontainer up --workspace-folder .`, then `devcontainer exec --workspace-folder . claude`). The CLI does not forward ports or git credentials the way VS Code does. Dependency install (`vp i`), the Electron exec-bit repair, and the Vite dep-cache warmup all run automatically before you attach.

## What works in the container

- The full dev stack: `vp run dev`, then open the pairing URL it prints through the forwarded web port (5733). The bare origin is useless without the pairing token. In VS Code the forwarded port is a true localhost, so the printed URL works as-is; in browser Codespaces the forwarded origin differs, and if the server rejects it, pass the forwarded origin via `T3CODE_DEV_ALLOWED_ORIGINS`.
- Everything the Linux CI jobs run: focused `vp test run <files>`, `vp lint <files>`, package typechecks, `vp run build:desktop`, and the resource-monitor cargo build and tests. (`vpr` is not on PATH here; the curl installer only shims `vp`. Use `vp run <script>` or `node_modules/.bin/vpr` after install.)

## Claude Code

`claude` runs without permission prompts, with the repo's `.mcp.json` servers pre-approved, and without its own sandbox: `/etc/claude-code/managed-settings.json`, written by `on-create.sh`, outranks the repo's and your local settings, and exists only in the container. The container is the boundary, but the workspace is a bind mount, so Claude can still change or delete files in your real checkout. `~/.claude` (with `CLAUDE_CONFIG_DIR` pointing there) is a named volume, so you log in once and stay logged in across rebuilds.

The `cocoindex-code` MCP server runs `ccc`. The workspace's `.cocoindex_code/settings.yml` is shared with the host, but `COCOINDEX_CODE_DB_PATH_MAPPING` keeps the container's index and embedding model in their own volume, because an index built from container paths would clobber the host's. `update-content.sh` builds it.

## State and safety

`T3CODE_HOME` points at the workspace's gitignored `.t3`, so all runtime state stays inside the container workspace, mirroring the worktree default. There is no live install to damage inside a container, but the test-data rule from AGENTS.md still holds: copy data in, never point at shared state.

## Caching

Two named volumes keep rebuilds fast and installs off the slow macOS/Windows bind mount: the pnpm store (shared across checkouts, mounted where `vp i` keeps it) and root `node_modules` (per-container, which covers the whole `.pnpm` virtual store since workspace packages just symlink into it). Deleting a container and recreating it reuses both, so a rebuild's `vp i` is seconds, not minutes. The host sees an empty `node_modules`; run host-side tooling inside the container.

## Out of scope

- Windowed Electron development is host-only. Building and verifying the desktop bundle works fine in the container (CI does exactly that, headless); launching the app needs a display.
- Mobile native builds are host-only (Xcode for iOS, Android SDK for Android). Typecheck, lint, and the mobile static checks run fine.
- `vp run dev --share` needs a tailscale binary and a tailnet; not provisioned here.

## Prebuilds

Container creation from scratch does a full `vp i` plus toolchain installs, which is worth prebuilding. Codespaces prebuilds are configured in repo settings, not files, and pick this config up as-is: the heavy steps live in `onCreateCommand` and `updateContentCommand`, which prebuilds bake in. Restrict prebuilds to one region and one retained version; storage bills per region per version. Note that prebuild snapshots exclude the caching volumes, so a prebuild-first workflow may prefer dropping the mounts. Outside Codespaces, the Dev Container CLI can push a prebuilt image:

```bash
devcontainer build --workspace-folder . --push true --image-name <registry>/t3code-devcontainer:latest
```
