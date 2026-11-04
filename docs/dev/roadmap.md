# Roadmap

Principle: **add the terminal path first, delete chat later**, keeping the app runnable after every step.

## Scope decisions

| # | Decision |
| --- | --- |
| 1 | Keep `apps/web` (it is the desktop renderer). Remove hosted/browser runtime mode and `apps/marketing`. |
| 2 | Browser first, then desktop, then mobile (decided 2026-11-02). Desktop work waits until browser functionality is done; track `mobile-impact`. |
| 3 | Remove chat. Features that depend on chat text (linking from text, etc.) are dropped. |
| 4 | Tabs can be a terminal or a terminal + script, user-configurable (name, kind, command, cwd, env). |
| 5 | Context from files and the browser flows back into the active terminal. |
| 6 | Agent status comes from hooks, starting with Claude Code; other CLIs run as plain terminals. |
| 7 | Agents sidebar tree: PRB.E-001 builds workspace > folder > worktree > branch > shell; the subagent level is added in phase 2/3 (replaces the earlier workspace > agent (worktree) > subagent wording), built from live PTY sessions. No enforcement of how worktrees or agents are created. |
| 8 | The UI is mouse-first: every action works with a mouse or touchpad; hotkeys are optional extras, never the only path (user, 2026-11-02). |

## Phases

Reordered 2026-11-01: the hero flow is many agents in one view with live status, so agent state and
the agents sidebar come before review.

0. **Run it**: toolchain installed, app runs in the browser with a working terminal (PRB.T-001).
1. **Terminal-first workspace** (first feature, PRB.E-001): workspaces, a shell tree (folder > worktree > branch > shell), standalone shells started local or in a new worktree, running a mock agent CLI, with the scenario harness. Next: configurable launch command and script tabs.
2. **Agent state and agents sidebar**: Claude Code hooks, status model, notifications, tree of workspace > folder > worktree > branch > shell > subagent (shell tree from PRB.E-001, extended), probe CLI for worktrees and agents.
3. **Subagent visualization** (builds on the hook roster from phase 2).
4. **Review**: CodeMirror pane, comments on any file, batches, MCP tools, expand window.
5. **Context to terminal**: stage a reference into the active PTY without Enter.
6. **Remove chat** in slices: UI, then providers, then orchestration.
7. **Trim**: web mode, marketing, unused providers and source-control packages.
8. **Desktop app**: build, launch and verify Electron, only after the browser functionality is done.
9. **Mobile port** (frozen until desktop settles).
10. **Hygiene**: full local checks baseline and recording it (PRB.T-002), after features land.

Chat is removed late, but agent state must not depend on it: hooks are the source from phase 2.

## Other decisions

Recorded from 2026-11-01; each entry carries its own date where it has one.

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
