# Open questions

Assumptions that have **not** been verified and decisions still open, where they span tickets.
An assumption that only one ticket depends on stays in that ticket's table. Remove an entry when
it is verified or decided; settled decisions go to `roadmap.md`.

## Unverified

- How agents started in a T3 terminal receive MCP configuration, and whether the existing
  `apps/server/src/mcp` server can serve review-batch tools to them.
- Whether `delegatedTaskModes` indicates real subagent support usable for visualization.
- Whether the Ghostty terminal surface and the server's PTY layer accept programmatic input without
  submitting (the "stage text, no Enter" primitive).
- Agent CLIs' handling of staged input: bracketed paste, multi-line, kitty keyboard protocol.
- Claude Code's current support for MCP prompts as slash commands and for server-pushed messages.
- PRB.E-001: the 5 s resume limit is provisional (PRB.T-008).
- How Probe tells an unexpected end from a normal exit or a Probe kill at the moment of death. The
  rule is decided; the mechanism comes from PRB.T-007, and PRB.T-008 depends on it.
- Mock CLI gaps left by PRB.T-001: behavior for an unknown session id, and a switch that makes
  resume always fail. PRB.T-008 owns both (by 2026-11-16).
- Whether CI type-checks desktop and mobile after contract changes (PRB.T-008 SA-4). Locally,
  `vp run check:changed` type-checks both as dependents of `packages/contracts`.
- Which story brings back the right panel (folders and file preview) next to shells. It lived in the
  chat view, which PRB.T-003 hides; the user wants it back once shells and folders exist (2026-11-05).
  PRB.T-002 builds it inside the ws layer (`apps/server/src/ws.ts`); deferred by the user.
- Paradev CLA terms (not read; irrelevant unless we contribute).

## Decisions pending

- Session identity: a nested agent inherits the parent PTY's env, so terminal id alone cannot tell
  sessions apart. Key the tree by hook `session_id` plus `cwd`. **Verified** (code.claude.com/docs/en/hooks,
  read 2026-11-01): every hook payload carries `session_id`, `cwd`, `transcript_path`,
  `hook_event_name`; events fired inside a subagent also carry `agent_id` and `agent_type`.
  *Still unverified:* whether a nested `claude -p` run gets its own `session_id` and fires the same global hooks
  (docs only say hooks load from settings, so likely yes); whether `Stop` fires on Esc/Ctrl+C (the docs
  page was truncated before that section); whether `--settings` can add hooks for a single session
  (docs show it only for `disableAllHooks`).
- Status for an agent whose process is alive but silent (interrupted turn): timeout or process check.

- Batch reference format: reuse T3 context records or probe-specific.
- Comment storage: server DB vs. per-worktree file.
- Tab config location: per user, per project (`t3.json`?), or both.
- Whether to keep source-control packages (GitHub only vs. all hosts).
- Repo visibility (public/private) and what that implies for docs and the analysis of Paradev.
- Product name and bundle id (currently `probe`).

- PRB.E-006 removes "hosted/browser runtime mode" while we now build browser first (2026-11-02). Unverified how the two differ: the locally served `apps/web` stays as the dev and test surface, only the hosted `app.t3.codes` mode is meant to go. Decide before starting PRB.E-006.
