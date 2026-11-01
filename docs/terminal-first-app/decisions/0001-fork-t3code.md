# 0001: Fork T3 Code

Status: accepted (2026-11-01)

## Context

We want a terminal-first workspace for CLI coding agents with configurable tab kinds, comment
batches on any file, and context injection into the active terminal.

Options considered:

1. **Use Paradev as is / contribute.** Source-available under Elastic License 2.0: forking and
   self-hosting are allowed, but hosting it as a service is not, and the CLA assigns contribution
   terms we have not reviewed. It is built around cloud accounts, billing and Postgres, which we
   do not want.
2. **Standalone editor + MCP, terminal agnostic** (earlier "probe" concept). Needs a per-terminal
   adapter (iTerm2 AppleScript, tmux) or a PTY wrapper to stage text. Wrapper rejected: heavy for
   one use case and it blocks other tools that wrap.
3. **Greenfield app** (Electron, xterm.js, node-pty, CodeMirror). Largest effort, no head start.
4. **Fork T3 Code.** MIT licensed, no usage restrictions, README invites forks. The server already
   owns PTYs (node-pty), has a Ghostty-based terminal renderer, an MCP HTTP server, a typed
   context-reference system, file tree and diff components, and desktop and mobile clients.

## Decision

Fork T3 Code (option 4). Keep the batch/reference design independent of the fork where practical,
so the comment store and MCP tools could move (design draft lives in the vault until built).

## Consequences

- The fork is permanent and does not track upstream. Upstream accepts few large features, and our
  tab model touches core. No `upstream` remote, no merges (decided 2026-11-01).
- We inherit Effect-TS conventions and a ~29k-file monorepo. Budget for learning curve.
- Server-owned PTYs make "stage text without Enter" a server call. No wrapper, no terminal adapters.
- Removing chat removes T3's source of agent state (working / blocked / done). We need hooks
  (see roadmap epic "Agent state") before subagent visualization.

## Risks

- Chat is the product's center (orchestration-v2, providers). Deleting it is a rewrite of the
  domain core, not a flag. Mitigation: add the terminal path first, delete in slices.
- Mobile shares contracts. Mitigation: freeze mobile, track `mobile-impact`.
- `docs/` inherited from T3 Code will describe removed features. Mitigation: each removal PR
  rewrites or deletes the affected docs.
