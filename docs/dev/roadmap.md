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
| 7 | Agents sidebar tree: PRB.E-001 builds workspace > project > worktree (labelled with its current branch) > shell; the subagent level is added in phase 2/3 (replaces the earlier workspace > agent (worktree) > subagent wording), built from live PTY sessions. No enforcement of how worktrees or agents are created. |
| 8 | The UI is mouse-first: every action works with a mouse or touchpad; hotkeys are optional extras, never the only path (user, 2026-11-02). |

## Phases

Reordered 2026-11-01: the hero flow is many agents in one view with live status, so agent state and
the agents sidebar come before review.

0. **Run it**: toolchain installed, app runs in the browser with a working terminal (PRB.T-001).
1. **Terminal-first workspace** (first feature, PRB.E-001): workspaces, a shell tree (project > worktree > shell), standalone shells started in an existing worktree or a new forked one, running a mock agent CLI, with the scenario harness. Next: configurable launch command and script tabs.
2. **Agent state and agents sidebar**: Claude Code hooks, status model, notifications, tree of workspace > project > worktree > shell > subagent (shell tree from PRB.E-001, extended), probe CLI for worktrees and agents.
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
- PRB.E-001 decisions (2026-11-02): a workspace is created by Probe and saves its layout; reopening it restores running shells and resumes dead agents as described in the next entry (supersedes "no persistence" and the earlier "fresh shells on restore" idea); a folder's own checkout is a worktree (shown as its primary worktree); shells are started only from the "+" modal described under "+" and projects below; non-git folders get shells and tabs without git features.
- PRB.E-001 restore (2026-11-02): works like Paradev (docs.paradev.com terminal-integration, agent-sessions): running shells survive restarts with scrollback; a shell killed through Probe (tree or in-shell kill command) or exiting normally with any status is removed and never restored; an unexpected end (signal, or the owner process lost) is restored in place (up to 3 attempts per death, 2 s apart, then an error with the dead shell's last output), and agents are relaunched with their resume command and session id (no "New shell"). Supersedes the earlier "fresh shells on restore" wording above.
- PRB.E-001 answers (2026-11-02): "Open workspace" is a scrollable dropdown of saved workspaces (one file per workspace in an internal Probe folder, name parsed from the file name, no file picker); switching restores the whole layout and running shells are shown again, removing deletes the file and layout for good, and the app then returns to the start screen. Old chat URLs land on the current workspace, else the start screen. "+" modal choices are remembered per workspace; a failed-start worktree stays pickable; detached HEAD shows the short commit hash. Rename is deferred (out of scope). Scenarios run locally only (no CI) with Playwright as a library. Resolves U-6, U-7, U-8.
- PRB.E-001 "+" and projects (2026-11-05 and 2026-11-06, user, PRB.T-004 review and PRB.T-005 manual pass): a workspace holds **projects** (the code and saved data still say "folder" until PRB.T-009). The sidebar's "Add project" icon opens "Add project to workspace", which only imports an existing folder or creates one with `git init` and starts no shell; importing any worktree of a repository adds the repository. Each project row has a "+" that opens "Create shell": a disabled starting-script dropdown ("mock agent" for now) and, for a git project, an **Existing | Fork** switch with one dropdown. Existing lists every worktree (the primary one first, shown as its branch), and any worktree can hold any number of shells. Fork lists what a new worktree forks from: linked worktrees, a branch named exactly like a linked worktree grouped with it, then the remaining local branches with the primary's current one first; items show the branch on the first line and "<name> worktree" on the second. The modal preselects the project's last start. There is no other start control, and no per-worktree buttons, hiding or worktree management in the tree. The existing add-project flow is not reused (it opens chat drafts); its clone and publish options are deferred to a later story. Shells are named "Shell N · folder · program", N fixed per workspace in start order; rename stays deferred. The 2 s start-to-banner limit is kept (measured 350–380 ms).
- PRB.E-001 branch model (2026-11-05, user, PRB.T-005 planning): the tree shows git's real state, project > worktree > shell, with each worktree node labelled by its current branch ("primary · main" for the repository's own checkout) and shown only while it has running shells; a branch switch in any shell moves all shells of that worktree, and there is no per-shell branch level (supersedes FR-7's "branch a shell was started on"). A shell that changes directory out of its worktree stays under it, marked "elsewhere".
- PRB.E-001 close and kill (2026-11-06, user, PRB.T-006 planning): closing a tab only hides the shell's terminal; the shell keeps running and reopens from the tree. A kill (the tree's "x" after a confirmation, or `probe kill` run inside the shell) force-ends the shell and everything it started, and never deletes a worktree. Removing a workspace kills every running shell in its projects' folders, also when another workspace shares a folder.
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
