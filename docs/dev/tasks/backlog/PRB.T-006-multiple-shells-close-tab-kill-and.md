---
id: PRB.T-006
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, plan]
created: 2026-11-02
updated: 2026-11-02
---

# Multiple shells, close tab and kill

## Business Goal

**Problem:** A user who runs several agents needs them side by side: each with its own output, switchable by tab, hideable without losing work, and endable on purpose. Today a terminal is tied to one chat thread, closing it ends its process, and there is no way for an agent to end its own shell.

**Proposed solution:** Several shells run at once across folders and worktrees, each with its own output. A user switches between tabs and closes a tab without ending the shell; the shell stays in the tree and reopens from it. A user kills a shell from the tree, an agent kills its own shell with a command run inside it, and removing a workspace ends its running shells.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 6 Multiple shells, close tab, kill
- **Delivers:**
  - FR-9: several shells run at once across folders and worktrees, each with its own output (scenario S4).
  - FR-10: closing a tab hides the terminal, the shell keeps running and stays in the tree, selecting it reopens a tab (S5).
  - FR-11: a user kills a shell with the "x" on its node in the tree, after a confirmation; the kill is a force-kill, so the process always ends, the node disappears and the shell is removed from the saved layout (S6).
  - FR-12: a command available inside a shell force-kills that shell (S6).
  - FR-24 (the removal part, S6): removing a workspace force-kills its running shells, forgets its layout and returns the app to the start screen; it never deletes folders on disk. Switch, create and open of workspaces, and the removal control, are delivered by PRB.T-003.
  - NFR-2 (the S6 part): killing a shell leaves no process that it started still running, and a worktree it created stays on disk.
  - NFR-6 (the shell-end log line on a kill) and NFR-1 (animation rule in the tree and terminal area): both are owned by earlier stories per the epic table; this story verifies them for the kill path (AC-20, AC-21) and does not own them.
  - NFR-5: start, switch, close, kill and remove are doable with the mouse or touchpad alone; shortcuts are optional extras.
- **One deployable outcome:** A user can run several shells at once, switch between their tabs, close a tab without losing the shell, and end a shell on purpose from the tree or from inside it, with no process left behind; this makes the terminal-first workspace usable with many agents.

## Current Behavior

Verified by reading `/Users/Dzmitry_Lahunouski/dev/probe-org/probe`; the epic states that earlier stories (PRB.T-002 to PRB.T-005) change this, so what follows is the state of the repository today, not the state when this story starts.

- **Server terminals.** `apps/server/src/terminal/Manager.ts` keeps terminal sessions keyed by a thread id plus a terminal id (`toSessionKey`). Several terminals per thread exist. The contract `TerminalCloseInput` in `packages/contracts/src/terminal.ts` takes a thread id, an optional terminal id and an optional "delete history" flag; the RPC is `terminal.close` in `packages/contracts/src/rpc.ts`.
- **Close today ends the process.** `close` in `Manager.ts` stops the session's process (SIGTERM, then SIGKILL escalation after a wait), drops the session and persists history. There is no server operation that hides a terminal while its process keeps running; hiding a tab today is a client-side state.
- **Kill reach.** The code signals the pty process only. Whether child processes started by the shell (as agents do) are also ended is unverified.
- **No standalone shell and no shell-side kill command.** Terminals are scoped to a chat thread. `shouldExcludeTerminalEnvKey` in `Manager.ts` removes `T3CODE_*` and `VITE_*` variables from the terminal environment. No command inside a terminal that reaches the server to end its own terminal was found (unverified beyond that search of `apps/server/src/terminal/` and `apps/server/src/mcp/`).
- **Web tabs.** `apps/web/src/components/ThreadTerminalDrawer.tsx` and `PersistentThreadTerminals.tsx` render a bottom drawer of terminals per thread, with tab buttons, a close button per tab (`PanelTabCloseButton`, `onCloseTerminal`), a new-terminal button and split groups. UI state (open terminals, active terminal) lives in `apps/web/src/terminalUiStateStore.ts`. Closing from the drawer calls the server close (ending the process); `confirmTerminalClose` (`apps/web/src/lib/terminalCloseConfirm.ts`) asks first.
- **Labels.** `packages/shared/src/terminalLabels.ts` derives a label from the terminal id ("Terminal N") or from a summary label (`resolveTerminalSessionLabel`). Whether a user can set the label is unverified.
- **Tree and workspaces.** The sidebar is a project > thread tree; there is no shell tree and no workspace concept in the code (the epic says PRB.T-003 adds them).
- **Mobile.** Not inspected; the epic excludes desktop and mobile.

## Expected Behavior

Once this story ships on top of PRB.T-001 to PRB.T-005, a user has several shells running at once. Each has its own output and its own tab. The tree (grouping and levels from PRB.T-003 to PRB.T-005) lists them. A tab can be closed with the mouse without ending the shell, and the shell can be reopened from the tree. A shell can be killed from the tree (after a confirmation) or by a command run inside it; the kill is a force-kill, so its process (and anything it started) always ends, it leaves the tree and the saved layout, and its worktree stays on disk. Removing a workspace force-kills its running shells and returns the app to the start screen.

### User Flow

1. The user has shells in two git folders and one non-git folder, plus two worktrees of one folder (S4); each is started from "+" as delivered by PRB.T-004 and PRB.T-005.
2. The user clicks a shell's tab; that shell's terminal shows and keeps its own output. Typing in one shell does not appear in another.
3. The user starts a second shell in a folder that already has one and types in it; each shell keeps its own output.
4. The user closes a tab with the "x" on the tab. The terminal view hides; the shell remains in the tree and keeps running.
5. The user selects that shell in the tree; its tab opens again showing the running shell.
6. The user clicks the "x" on a shell's node in the tree and confirms; its process is force-killed and the shell leaves the tree.
7. Inside a running shell (as an agent would), the user or agent runs the kill command; that shell's process ends and it leaves the tree.
8. The user removes a workspace that has a running shell from the "Workspaces" button; the shell's process is force-killed and the app returns to the start screen.

### Edge Cases

- EC-1: Closing the last open tab leaves the shell running and listed; the main area shows no terminal and no error.
- EC-2: Closing a tab on a shell that is mid-output does not stop or lose output; reopening shows the output produced meanwhile (reload and restart persistence is PRB.T-007).
- EC-3: Killing a shell whose tab is open closes the tab; killing one whose tab is closed removes it from the tree only.
- EC-4: Killing a shell that has started child processes (an agent that spawned others) leaves none of them running.
- EC-5: A worktree that a killed shell created stays on disk (killing never deletes a worktree).
- EC-6: Killing one shell does not affect other shells, including others in the same worktree.
- EC-7: Running the kill command in a shell kills that shell only, not another shell's.
- EC-8: Removing a workspace with several running shells force-kills all of them, leaves folders on disk untouched and returns the app to the start screen.
- EC-9: A shell whose record the server does not know, or one that failed all its restore attempts (once PRB.T-008 lands), is removed from the tree by the kill action without an error shown to the user. Until PRB.T-007 and PRB.T-008 land, a shell whose process ended on its own is also removed this way; what happens to such a shell afterwards (removed or restored) is decided there.
- EC-10: The user cancels the kill confirmation; the shell keeps running and stays in the tree.

### Error Handling

- ER-1: If the kill command inside a shell cannot reach the server, the command prints a message in that shell and the shell keeps running.

## Out Of Scope

- Creating shells, the "+" modal, worktrees and starting points: PRB.T-004 and PRB.T-005.
- Workspace creation, switching, opening, and the removal control itself (only "removal ends running shells" is here): PRB.T-003.
- Reload and server-restart survival, output history and scrollback after reopening, saved layout, unavailable shells, and removal of an unavailable shell: PRB.T-007 (FR-14, FR-15, FR-19 after restart, FR-23).
- Tree grouping, branch level, node removal rules and the 1-second appearance rule (FR-7): PRB.T-003, PRB.T-004 and PRB.T-005.
- What a tab does when its shell exits on its own (for example `exit`), and whether such a shell is removed or restored: PRB.T-007 and PRB.T-008 (SU-2).
- Unavailable shells (folder gone) and shells shown as ended after a restart: PRB.T-007; this story owns only an in-session process that ended or a record the server does not know (EC-9).
- Restoring or resuming a shell after its process ends unexpectedly: PRB.T-008.
- Deleting a worktree when its last shell is killed: epic non-goal.
- Renaming a shell (FR-16): deferred by the user, 2026-11-02.
- Subagent level, agent status, notifications: later epics.
- Keyboard-only flows: shortcuts may exist but are not required or tested here (NFR-5).
- Desktop and mobile: epic non-goal.

## Technical Scope

Work areas, not steps:

- **Layers:** terminal UI (tabs: switch, close without ending, reopen from the tree; the kill control in the tree); tree (kill control on a shell node; grouping and levels are owned by PRB.T-003 to PRB.T-005); server shell lifecycle (a kill that ends the process and what it started, and hiding a tab without ending the shell); a shell-side kill command and how it reaches the server; workspace removal force-killing its shells; contracts for any new operation; the scenario tests for S4 (output isolation), S5 and S6, run by `vp run test:scenarios`.
- **Docs impact:** `docs/` pages describing the terminal-first screen and how to run scenarios (NFR-7) get the tab, kill, kill command behaviour in the same PR; user docs for the kill command if it is user-facing.
- **Mobile impact:** none (epic: desktop and mobile are not required).

## Non-functional Requirements and Constraints

- NFR-2: a kill leaves no process that the shell started running; checked by the scenario.
- NFR-5: every Probe UI action here is done with the mouse or touchpad (the tree "x" is the mouse-only kill path); typing into a shell, including the kill command, is typed by design and excluded; scenarios drive the UI with pointer actions.
- NFR-1: no continuously repainting animation in the tree or terminal area.
- NFR-3: scenarios use a throwaway data directory and never touch the user's real Probe data.
- NFR-6: the server logs shell end with the shell id and cwd, for a kill as for any end.
- Repo rules (`/Users/Dzmitry_Lahunouski/dev/probe-org/probe/AGENTS.md`): scenario tests use no sleeps or polling; server features are services and transports stay thin, and both kill paths (tree and in-shell command) must behave identically; wire types live in `packages/contracts`.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given shells in two git folders, one non-git folder and two worktrees of one folder, when the user types a distinct line in each shell, then each terminal shows only its own output; the same holds for two shells in one worktree | auto | FR-9 |
| AC-2 | Given two open tabs, when the user clicks the other tab, then that shell's terminal shows with its own output and the first keeps running | auto | FR-9 |
| AC-3 | Given an open tab, when the user clicks the "x" on the tab, then the terminal view is hidden, the shell's process is still running and the shell is still in the tree | auto | FR-10 |
| AC-4 | Given a shell with a closed tab, when the user selects it in the tree, then its tab opens and shows the running shell | auto | FR-10 |
| AC-5 | Given one open tab, when the user closes it, then the main area shows no terminal and no error, and the shell stays running and listed | auto | FR-10, EC-1 |
| AC-6 | Given a shell producing output, when its tab is closed and reopened, then the output produced while closed is shown (in-session reopen only; reload, restart and scrollback limits are PRB.T-007) | auto | FR-10, EC-2 |
| AC-7 | Given a running shell, when the user clicks the "x" on its tree node and confirms, then its process is force-killed and the node leaves the tree (persistence of that removal across restart is PRB.T-007) | auto | FR-11 |
| AC-8 | Given a shell whose tab is open, when the user kills it from the tree, then its tab closes; given one whose tab is closed, then it only leaves the tree | auto | FR-11, EC-3 |
| AC-9 | Given a shell that started a child process, when the shell is killed (tree or kill command), then neither the shell process nor the child is running | auto | NFR-2, EC-4 |
| AC-10 | Given a shell in a worktree it created, when the shell is killed (tree or kill command), then the worktree directory still exists on disk | auto | NFR-2, EC-5 |
| AC-11 | Given two shells in one worktree, when one is killed, then the other keeps running and keeps its output | auto | FR-11, EC-6 |
| AC-12 | Given a running shell, when the kill command is run inside it, then that shell's process ends and it leaves the tree | auto | FR-12 |
| AC-13 | Given two running shells, when the kill command is run in one, then only that shell ends | auto | FR-12, EC-7 |
| AC-14 | Given the server cannot be reached by the command, when it is run, then it prints a message in the shell and the shell keeps running | auto | FR-12, ER-1 |
| AC-15 | Given a workspace with a running shell, when the user removes the workspace, then the shell's process is force-killed, the folders on disk are unchanged and the app shows the start screen | auto | FR-24, EC-8 |
| AC-16 | Given a workspace with several running shells, when it is removed, then all their processes end | auto | FR-24, EC-8 |
| AC-17 | Given a shell whose record is unknown to the server (or that failed all restore attempts, once PRB.T-008 lands), when the user clicks the "x" on its node and confirms, then the shell leaves the tree and no error is shown | auto | FR-11, EC-9 |
| AC-18 | Given a running shell, when the user clicks the "x" on its tree node and cancels the confirmation, then the shell keeps running and stays in the tree | auto | FR-11, EC-10 |
| AC-19 | Given the scenarios S4, S5 and S6, when they run, then every Probe UI action (switch tab, close tab, reopen from the tree, kill from the tree, remove workspace) is done with pointer actions only; typing into a shell, including running the kill command, is excluded | auto | NFR-5 |
| AC-20 | Given a shell is killed (tree or command), when the server log is read, then it has a shell end line with the shell id and cwd | auto | NFR-6 |
| AC-21 | Given the tree and terminal area, when code review checks them, then no continuously repainting animation was added | manual (reviewer) | NFR-1 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-001 | Scenario harness and mock agent CLI for S4, S5, S6 | done (2026-11-03) |
| PRB.T-002 | Standalone shells that outlive a tab | backlog |
| PRB.T-003 | Workspaces and the shell tree; the removal control that ends shells | backlog |
| PRB.T-004 | Starting a local shell to have shells to close and kill | backlog |
| PRB.T-005 | Worktree shells, worktree picker and created worktrees (S4, NFR-2 worktree kept) | backlog |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | A running shell can stay alive while no tab is open for it (epic A-6, depends on PRB.T-002) | assumption | verified | PRB.T-002: a shell outlives its viewers (scenario T-002, [spike](../../research/t-002-standalone-shell-spike.md)) | author |
| SA-2 | Ending the shell process also ends what it started (current code signals the pty process only) | assumption | unverified | Run a shell with a child, kill it, check processes, at the start of planning | author |
| SU-1 | Name of the kill command and how it finds its own shell (epic U-5, designed in this story's plan stage) | unknown | unverified | Decide in the plan stage; do not decide here | author |
| SU-2 | Whether a shell exiting on its own (for example `exit`) while a tab is open closes the tab; the epic assigns the not-restored rule to PRB.T-007 and PRB.T-008 | unknown | unverified | Confirm the split with PRB.T-007 and PRB.T-008 authors | author |
