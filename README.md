# Probe

Probe is a terminal-first workspace for running many CLI coding agents side by side. You group the
folders you work on into a **workspace**, start shells in them (in a project's own checkout or in a
new git worktree), and each shell runs an agent CLI such as Claude Code in a terminal the server
owns. Shells keep running when you close the tab, reload the page or restart the server.

Probe is a fork of [T3 Code](https://github.com/pingdotgg/t3code) and does not sync upstream. It is
very early: there is no release yet, the browser app is the only supported surface, and T3 Code's
chat UI is hidden while it is being removed. What comes next is in the
[roadmap](./docs/dev/roadmap.md).

## Run it from source

Probe uses Vite+, so install the global `vp` command first:

```bash
curl -fsSL https://vite.plus | bash        # macOS / Linux
```

```powershell
irm https://vite.plus/ps1 | iex            # Windows
```

Then install dependencies and start the server and the web app:

```bash
vp i
vp run dev
```

The `[dev-runner]` line prints the address to open. Setup details, the dev container and the
scenario tests are in the [development runbook](./docs/operations/development.md).

## Documentation

Docs live in [docs/](./docs); start at [docs/README.md](./docs/README.md).

- [Workspaces](./docs/user/workspaces.md): workspaces, projects, shells, worktrees, restarts
- [Terminal history](./docs/user/terminal.md)
- [Architecture overview](./docs/internals/overview.md) and [terminal runtime](./docs/internals/terminal-runtime.md)

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.
