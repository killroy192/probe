# T3 Code analysis

Read from the fork base commit `2f4da5de4`. Verified by reading code unless marked *unverified*.

## Layout

pnpm monorepo, about 29k tracked files, MIT licensed.

| Path | Role | Approx. TS files |
| --- | --- | --- |
| `apps/web` | React UI. **Also the desktop renderer**: the server serves `apps/web/dist` as the client (`apps/server/src/config.ts`) | 1.7k |
| `apps/server` | Owns provider processes, terminals (node-pty), git, project files; RPC to clients | 1.3k |
| `apps/desktop` | Electron shell, bundles the server | 250 |
| `apps/mobile` | Native iOS/Android client; shares `client-runtime`, `contracts`, `shared` | 1.3k |
| `apps/marketing` | Marketing site | 8 |
| `packages/provider-*`, `effect-acp`, `effect-codex-app-server` | Agent providers over structured protocols | ~300 |
| `packages/source-control-*` | GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo, GitCafe | ~150 |
| `packages/client-runtime`, `contracts`, `shared` | Shared client state, RPC contract, utilities | ~700 |

Stack: TypeScript, **Effect-TS** throughout, React, Zustand, TanStack Router, Tailwind, Electron,
Vite+ (`vp`). Tiptap composer editor. `@pierre/trees` and `@pierre/diffs` for tree and diffs.
No code editor dependency (no CodeMirror/Monaco).

## Architecture points that matter for us

- **Execution belongs to the server.** Clients (web, desktop, mobile) never touch the filesystem or
  providers directly; they use an authenticated RPC contract (`packages/contracts/src/rpc.ts`).
  `docs/internals/overview.md`.
- **Chat is protocol based.** Claude through `@anthropic-ai/claude-agent-sdk`, Codex through its
  app-server protocol. The agent CLI's own TUI is *not* what is rendered.
- **Terminal is secondary.** `ThreadTerminalDrawer` attaches a terminal to a thread. Rendering uses a
  Ghostty surface (`apps/web/src/terminal/ghostty`, wasm build via `build:ghostty-wasm`).
- **Event-sourced orchestration.** `apps/server/src/orchestration-v2` (about 400 files) is the domain
  core for threads and turns. Removing chat means replacing this.
- **Context references exist.** `docs/internals/composer-context-references.md`: a message can point
  at a typed record (image, file, terminal excerpt, page element, review comment, file mention, skill)
  via `contextId`; records live in `message.context.records`. Review comment records are tied to diffs
  and PR review (`apps/web/src/reviewCommentContext.ts`).
- **MCP.** `apps/server/src/mcp` contains an HTTP MCP server, session registry and tool access control.
  `mcpApps` also exists. *How agents launched by T3 receive MCP config: unverified.*
- **Subagents.** `delegatedTaskModes.ts` in `mcp/` hints at a delegation concept. *Unverified.*

## Where our changes land

| Change | Touches |
| --- | --- |
| Tab model (terminal, terminal + script) | `apps/web` shell and routing, `apps/server` terminal service, settings schema in `contracts` |
| Context -> terminal | New server RPC to write to a PTY without Enter, client selection menu, reference format |
| Remove chat | `orchestration-v2`, `provider*`, `apps/web/src/components` (chat), `client-runtime` thread state |
| Remove web mode | `RuntimeMode "web"` in `apps/server/src/config.ts`, remote browser access, `apps/marketing` |
| Editor for any file | New: CodeMirror 6 pane in `apps/web` (none exists today) |
| Agent state | New: hook endpoint on server, replaces chat as the status source |

## Risks

- Size and Effect-TS conventions enforced by `oxlint-plugin-t3code`.
- Mobile shares contracts with desktop; any contract change can break it.
- No upstream merges are planned (decided 2026-11-01), so fixes upstream will not arrive by themselves.
