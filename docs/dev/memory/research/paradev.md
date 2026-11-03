# Paradev analysis (reference only)

Paradev (formerly Superset, `ParadevAI/Paradev`) is the product whose workflow we want. We are not
forking it. License: Elastic License 2.0 (source-available; no offering as a hosted service). Do not
copy code into probe; use it as a behavioral reference.

## Shape

Bun + Turborepo monorepo, 12 apps and 25 packages. Electron desktop (React, TanStack, Zustand,
Tailwind), a separate `host-service` (Hono + tRPC) that owns workspaces, git, terminals and ports,
a `pty-daemon` that keeps PTYs alive across restarts, a Cloudflare Worker relay for remote hosts,
and an optional cloud API (Next.js, Postgres, Redis, auth, billing).

## Features worth reproducing

- **Workspaces as git worktrees**, one per task, each with its own branch and terminals.
- **Terminal tabs running agent CLIs**, with agent status (working / blocked / ready) fed by hooks.
- **Panes** (`packages/panes`) as the layout primitive.
- **Terminal control from outside**: `terminals send --noSubmit` stages text without Enter.
- **Send selection to agent** from diff views and from browser "Design" mode.
- **Plugins** are skills + MCP tools bundles, not UI extensions.

## Skipped for probe

Accounts, billing, cloud sandboxes, relay, email, marketing, mobile (for now), Postgres/Docker dev setup.

## Limits that motivate probe

- Review comments cannot be collected and sent as one batch.
- No comment/review on unchanged files.
- No expandable review window.

Cloned for analysis at commit time of 2026-10; not vendored here.
