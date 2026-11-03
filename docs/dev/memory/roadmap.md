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
