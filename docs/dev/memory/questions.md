# Open questions

Assumptions made while planning that have **not** been verified, and decisions still open.

## Unverified

- How agents started in a T3 terminal receive MCP configuration, and whether the existing
  `apps/server/src/mcp` server can serve review-batch tools to them.
- Whether `delegatedTaskModes` indicates real subagent support usable for visualization.
- Whether the Ghostty terminal surface and the server's PTY layer accept programmatic input without
  submitting (the "stage text, no Enter" primitive).
- Agent CLIs' handling of staged input: bracketed paste, multi-line, kitty keyboard protocol.
- Claude Code's current support for MCP prompts as slash commands and for server-pushed messages.
- PRB.E-001 (unverified): A-2 worktree creation can be reused from `apps/server/src/vcs/`; A-6 a running shell survives a browser reload (the spike in PRB.T-002 checks it and builds the fix if false); A-8 chat can be hidden everywhere; A-13 the existing add-project flow can be reused inside the "+" modal's folder step (adding only selects the folder); A-14 terminals can outlive a server restart and be reattached; A-17 forking a worktree needs at least one commit; A-11 Probe can learn a shell's current branch; A-12 Probe can list a folder's existing worktrees. Unknowns: U-1 how much terminals depend on chat threads; U-2 default base branch and worktree location; U-3 time to the CLI banner; U-5 how the shell-side kill command finds its shell. The 2 s start and 5 s resume limits are provisional.
- PRB.T-001 (done 2026-11-03; A-3, A-4, A-7, A-15 verified): open only SU-2 mock CLI behavior for an unknown session id (story 8 owns it, by 2026-11-16), and the missing always-fail resume switch (story 8, SA-5). AC-2 and AC-3 are accepted as partial by design (home and pid check instead of a `~/.t3` snapshot; pointer-only is a compile-time type).
- PRB.T-002 (unverified, approved 2026-11-02): SA-1 the terminal RPCs and manager treat the thread id as an opaque string; SA-2 chat-thread terminals keep working while standalone shells are added; SA-3 (epic A-2) worktree creation can be reused without a chat; SA-4 (epic A-6) a running shell survives a browser reload, and if not the fix is built in this story; SA-5 (epic A-14) shells can keep running across a server restart and be reattached, which sizes story 7 (R-6). Unknowns: SU-1 (epic U-1) how a standalone shell is identified, answered by the spike; SU-4 which `probe/docs/` pages describe terminals (by 2026-11-09); SU-5 whether CI type-checks desktop or mobile against contract changes (by 2026-11-09); SU-7 how the terminal view is pointed at a shell before the tree exists (default: a direct address with the shell id).
- PRB.T-003 (unverified, approved 2026-11-02): SA-1 (epic A-8) chat can be hidden everywhere without breaking the app, checked by listing every chat entry point in the plan; SA-3 the S1 scenario can drive the "Open workspace" dropdown by pointer and seed saved workspaces into the throwaway Probe folder. Unknown: SU-1 the inner format of a workspace file and whether workspace operations are server-side (AC-16 and AC-17 apply only if so).
- PRB.T-004 (unverified, approved 2026-11-02): SA-1 stories 1 to 3 land first; SA-2 (epic A-13) the existing add-project flow can be reused inside the "+" modal's folder step; SA-3 a shell can be told the pane size at start and on resize and the size read back; SA-5 (epic A-17) a folder without a commit runs in its own checkout; SA-6 no shell start/end logging or start-to-banner measurement exists today; SA-7 the server logs a shell end when the scenario ends its process from outside; SA-8 the story 1 harness can make the mock CLI unstartable, drop the connection and end a shell's process. Unknowns: SU-1 (epic U-3) time from start to banner, 2 s provisional (by 2026-11-09); SU-5 wording of the "start did not happen" message (by 2026-11-09); SU-6 how the folder step shows that a folder is a git repository (by 2026-11-09).
- PRB.T-005 (unverified, approved 2026-11-02): SA-1 (epic A-12) Probe can list a folder's worktrees including detached and shell-less ones; SA-2 (epic A-2) worktree creation can be reused outside chat and orchestration code; SA-3 (epic A-17) forking a worktree needs at least one commit; SA-4 a failed fork can leave nothing behind (the branch is created before `git worktree add` today); SA-5 the mock CLI starts the same way inside a worktree; SA-6 (epic A-11) a shell's current branch can be learned and kept up to date. Unknowns: SU-1 time limit for a worktree start (by 2026-11-16); SU-2 what the modal shows while a fork runs (by 2026-11-09); SU-3 how a branch switch inside a shell is detected (by 2026-11-16); SU-5 how the scenario ends a shell before story 6's kill exists (by 2026-11-09).
- PRB.T-006 (unverified, approved 2026-11-02; rename removed from scope by the user): SA-1 (epic A-6) a running shell stays alive while no tab is open for it; SA-2 ending the shell process also ends what it started (current code signals the pty process only). Unknowns: SU-1 (epic U-5) the name of the kill command and how it finds its own shell, decided in the plan; SU-2 whether a shell exiting on its own closes its tab (split with stories 7 and 8).
- PRB.T-007 (unverified, approved 2026-11-02): SA-1 (epic A-14) terminals can keep running while the server restarts and be reattached, from the story 2 spike (if false or too large, re-plan the epic with the user); SA-2 (epic A-6) a running shell survives a browser reload; SA-3 (epic A-7) the harness can stop and restart the server in one scenario; SA-4 the saved layout file contains no secrets; SA-5 the existing per-session history file can serve as the source of reopened-tab history after a restart; SA-6 the workspace file's inner format comes from story 3; SA-7 delivering the full history on reload stays within the repo performance rule.
- PRB.T-008 (unverified, approved 2026-11-02): SA-1 (epic A-15) the mock CLI prints a session id and resumes by it; SA-2 Probe can tell an unexpected end from a normal exit or a Probe kill at the moment of death (rule decided, mechanism in story 7); SA-3 Probe knows an agent is running in a shell and its session id without hooks; SA-4 mobile and desktop still compile after contract changes (not required); SA-5 the mock CLI can make its resume fail every time (added to the story 1 CLI contract note, SU-7). Unknowns: SU-1 whether 5 s for an attempt to start is right (provisional); SU-4 whether the harness can make all server and shell processes disappear and then reopen the workspace (epic A-7).
- Paradev CLA terms (not read; irrelevant unless we contribute).

## Decided (2026-11-01)

- Agent status hooks are merged into the agent's global config (`~/.claude/settings.json` first),
  as Paradev does, with probe-owned entries identifiable and removable. See
  `research/paradev-agent-status.md`. Per-session settings file was not evaluated.
- PRB.E-001 decisions (2026-11-02): a workspace is created by Probe and saves its layout; reopening it restores running shells and resumes dead agents as described in the next entry (supersedes "no persistence" and the earlier "fresh shells on restore" idea); a folder's own checkout is a worktree; a "+" button opens the only way to start a shell: a modal that selects folder (git or not), worktree (or none for the current branch) and a starting point for a new worktree, preselecting the last choices; folders are added via the existing add-project flow; non-git folders get shells and tabs without git features.
- PRB.E-001 restore (2026-11-02): works like Paradev (docs.paradev.com terminal-integration, agent-sessions): running shells survive restarts with scrollback; a shell killed through Probe (tree or in-shell kill command) or exiting normally with any status is removed and never restored; an unexpected end (signal, or the owner process lost) is restored in place (up to 3 attempts per death, 2 s apart, then an error with the dead shell's last output), and agents are relaunched with their resume command and session id (no "New shell"). Supersedes the earlier "fresh shells on restore" wording above.
- PRB.E-001 answers (2026-11-02): "Open workspace" is a scrollable dropdown of saved workspaces (one file per workspace in an internal Probe folder, name parsed from the file name, no file picker); switching restores the whole layout and running shells are shown again, removing deletes the file and layout for good, and the app then returns to the start screen. Old chat URLs land on the current workspace, else the start screen. "+" modal choices are remembered per workspace. The worktree picker offers only worktrees with no active shell, plus "new"; a failed-start worktree stays pickable; detached HEAD shows the short commit hash. Rename is deferred (out of scope). Scenarios run locally only (no CI) with Playwright as a library. Resolves U-6, U-7, U-8.
- UI is mouse-first (2026-11-02, user): epics, stories and scenarios never require keyboard-only paths or hotkeys; shortcuts such as Enter in a modal are optional extras.
- Agent tree hierarchy was workspace > agent (worktree) > subagent; superseded 2026-11-02 by workspace > folder > worktree > branch > shell > subagent (PRB.E-001). Several agents may share a
  worktree. Probe creates worktrees and agents through its own CLI; how this is enforced is open.
- First agent integration: Claude Code. Other CLIs run as plain terminals.
- No enforcement of worktree/agent creation. The tree is derived from live sessions tracked through
  server-owned PTYs: a worktree node appears only while a session runs there. An agent that spawns
  another session is shown under its new worktree, or in the same worktree if it stays there.
- Stale status: the server watches the Claude Code process behind each session and clears or marks
  status when it dies, in addition to Paradev-style clearing on terminal exit.

- orchestration-v2 is dropped, not reimplemented. Its docs are deleted in `../probe`; the code is
  removed under PRB.E-005, not in phase 0.
- `probe/docs/terminal-first-app/` was deleted from `../probe` on purpose. The vault is the source
  of truth for new work; `probe/docs/` is written after implementation.
- No CI for now. "Green" means local checks (fmt, lint, typecheck, test). The inherited workflows
  (Blacksmith runners, mobile, relay, release) are left as is.
- An agent may install Node 26.12.1 and pnpm 12.16.1 (PRB.T-001, decided 2026-11-02; this also changes `packageManager` in `../probe/package.json` from the inherited 12.14.0).

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
