# Product brief: probe

Draft, 2026-11-01. Status: not built. Decisions are in `../roadmap.md` and `../questions.md`.

## What it is

A free, open-source desktop workspace for running many CLI coding agents side by side. A fork of
T3 Code (this vault is the source of truth until there is implementation; `probe/docs/` is written afterwards). The agent's own TUI runs in server-owned terminals.

## Users

- First user: the author, building for their own workflow.
- Next: a small team of peers using CLI agents. Public open-source users are not a goal yet.

## Problems it solves

1. **Multi-agent development and research.** Running 10+ agents is normal. Today there is no one
   place to see which are working, blocked or done.
2. **Convenient preview.** Open and review any file and its changes next to the agent that touched
   it, then send context back to that agent.

## Hero flow: many agents, one view

- An agents sidebar tree (like an IDE file tree): workspace > project > worktree > shell.
- Single click previews a session; double click pins it as a tab. Not every agent is a tab.
- A small status indicator per node and per tab: working, needs permission, failed, done-unseen.
- Notifications when an agent finishes or needs input: sound, OS notification, dock badge,
  suppressed when you are already looking at that pane, click to focus.

## How status works (from Paradev research)

Hooks merged into the agent's global config (Claude Code first, `~/.claude/settings.json`) post
lifecycle events to the probe server. The server sets an env marker on every PTY, so hooks only report
for agents started in probe. Details and pitfalls: `../research/paradev-agent-status.md`.

- The server also watches the Claude Code process, so a crash clears the status.
- Nested sessions share the parent's PTY, so the tree is keyed by `session_id` + `cwd`. (Unverified.)
- Agents may create worktrees or spawn sessions. Probe detects and shows them; it does not block.
  A worktree node exists only while a session runs there.

## Scope

In: tab kinds (terminal, terminal + script), agents tree, hooks status, notifications, probe CLI for
worktrees and agents, review comments on any file with batches, staged context in the PTY.
Out for now: mobile, accounts/billing, cloud, hosted/web mode, chat.
Non-Claude CLIs: plain terminals with no status.

## Success (personal first)

- The author uses probe daily instead of plain terminal tabs.
- With 10+ agents running, any agent needing attention is visible without opening it.
- No stuck status after Ctrl+C, crash or restart.

## Risks

- Removing chat means deleting the `orchestration-v2` code (about 165 entries in `apps/server/src/orchestration-v2`; its docs are already deleted) and everything that depends on it. We do not reimplement it. Mitigation: add the terminal path first, delete in slices (PRB.E-005).
- Effect-TS conventions and a ~29k-file monorepo.
- Hook payloads and nested-session behavior are unverified for current Claude Code.
- Paradev is source-available (ELv2): behavioral reference only, no copied code.
