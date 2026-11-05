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
- PRB.E-001 assumptions its stories depend on (2026-11-02): A-8 chat can be hidden everywhere
  (PRB.T-003); A-13 the existing add-project flow can be reused inside the "+" modal's folder step
  (PRB.T-004); A-17 forking a worktree needs at least one commit, and a folder without one runs in
  its own checkout (PRB.T-004, PRB.T-005); A-11 Probe can learn and track a shell's current branch
  and A-12 list a folder's worktrees, including detached and shell-less ones (PRB.T-005). Unknowns:
  U-2 default base branch and worktree location; U-3 time from start to the CLI banner (PRB.T-004);
  U-5 the kill command's name and how it finds its own shell (PRB.T-006). The 2 s start and 5 s
  resume limits are provisional (PRB.T-004, PRB.T-008).
- The inner format of a workspace file, and whether workspace operations are server-side. Decided
  in PRB.T-003 (SU-1); PRB.T-007 builds on it.
- Whether a shell exiting on its own closes its tab (PRB.T-006 SU-2, split with PRB.T-007 and
  PRB.T-008).
- How Probe tells an unexpected end from a normal exit or a Probe kill at the moment of death. The
  rule is decided; the mechanism comes from PRB.T-007, and PRB.T-008 depends on it.
- How a scenario ends a shell's process before PRB.T-006's kill exists (PRB.T-004 SA-8, PRB.T-005
  SU-5).
- Mock CLI gaps left by PRB.T-001: behavior for an unknown session id, and a switch that makes
  resume always fail. PRB.T-008 owns both (by 2026-11-16).
- Whether CI type-checks desktop and mobile after contract changes (PRB.T-008 SA-4). Locally,
  `vp run check:changed` type-checks both as dependents of `packages/contracts`.
- Which story makes `Shells` a server service, so MCP tools and scheduled tasks can reach shells.
- Which story brings back the right panel (folders and file preview) next to shells. It lived in the
  chat view, which PRB.T-003 hides; the user wants it back once shells and folders exist (2026-11-05).
  PRB.T-002 builds it inside the ws layer (`apps/server/src/ws.ts`); deferred by the user.
- Paradev CLA terms (not read; irrelevant unless we contribute).

## Decisions pending

- PRB.T-007 scope. The PRB.T-002 spike found that shells die when the server restarts (epic
  A-14 false, `research/t-002-standalone-shell-spike.md`): a restart-surviving process host, or
  saved history plus a fresh shell. Ask the user before planning PRB.T-007.
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
