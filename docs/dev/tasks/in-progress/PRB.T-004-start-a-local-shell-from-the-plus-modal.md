---
id: PRB.T-004
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, plan, implement, verify]
created: 2026-11-02
updated: 2026-11-05
---

# Start a local shell from the plus modal

## Business Goal

**Problem:** Probe's pivot to a terminal-first app has no way to start a shell: today a terminal can only be opened inside a chat thread, and the only way to begin work is to start a chat. Without a start path, the workspace and tree built before this story stay empty and nothing can be tried, measured or built on.

**Proposed solution:** A "+" button opens a modal where the user picks or adds a folder, and clicks an up-arrow button. A tab opens with a shell running the mock agent CLI, and the shell appears in the tree. The modal remembers the last folder so the next shell is one click away. This is the core promise of the epic: a shell running an agent CLI.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 4 Start a local shell (value: "The core promise: a shell running an agent CLI"; after story 3)
- **Delivers:**
  - FR-3: the "+" button, the modal, and the up-arrow button that starts a shell, opens it as a tab and adds it to the tree. Covers the "only control that starts a brand-new shell" part; automatic restore (story 8) relaunches in place and skips the modal.
  - FR-6: a new shell has no chat thread, starts the mock agent CLI and opens as a tab.
  - FR-8: input reaches the CLI, output renders, and the terminal size matches the pane after a resize.
  - FR-21: the modal's folder step: pick a folder of the workspace or add one (import an existing folder, or create a new one with git initialized); the added folder is selected and a shell starts in its own checkout; a folder that is not a git repository skips worktree and starting-point steps.
  - FR-7 (part owned by this story): a new shell appears in the tree within 1 second of being created, in the tree under its folder (this story renders no worktree node; story 5 adds the worktree and branch levels). The tree and grouping are story 3; worktree and branch levels are story 5.
  - FR-22 (part owned by this story): the modal preselects the folder chosen last time in this workspace, so one click on the up-arrow button starts another local shell. Worktree and starting-point defaults are story 5.
  - NFR-1 (part): the first measurement of "start shell" to CLI banner visible, logged on the author's machine; the "no continuously repainting animation" rule is checked in code review for what this story adds.
  - NFR-5: start, folder choice and add-project are doable with the mouse or touchpad only; Enter is an optional extra.
  - NFR-6 (part): the server logs shell start (shell id, cwd) and end.
- **One deployable outcome:** A user with a workspace clicks "+", picks or adds a folder and clicks the up-arrow button, and gets a working mock-agent shell as a tab and in the tree, with no chat involved; this makes the terminal-first product usable for the first time.

## Current Behavior

Verified by reading `../probe` (commit 65e00bd57, main) on 2026-11-02. Stories 1 to 3 are not built yet, so there is no workspace, no standalone shell and no mock CLI in the repo.

- **"+" button:** none for shells. The sidebar's new-thread control (`apps/web/src/components/Sidebar.tsx`, `handleNewThreadClick`, `onNewThread`, `startNewThreadFromContext`) starts a chat draft thread, not a shell. A separate "add project" entry (plus icon) in the same file opens the command palette add-project flow.
- **Add-project flow:** `useNewProject` ends by starting a chat draft thread for the new project (`apps/web/src/hooks/useNewProject.ts`, `handleNewThread`). It lives in the command palette (`apps/web/src/components/CommandPalette.tsx`, `CommandPaletteAddProject.tsx`, `apps/web/src/hooks/useNewProject.ts`) and a machine dialog (`apps/web/src/components/AddProjectToMachineDialog.tsx`, `apps/web/src/lib/addProjectToMachine.ts`). It supports adding an existing folder, cloning from a remote, and creating a new project with a source-control publish step. Whether it can be embedded in another modal, and whether its create path initializes git (the server has git init code under `apps/server/src/vcs/`), is unverified (epic A-13, SA-2).
- **Terminal, web:** terminals exist only as a drawer bound to a chat thread: `apps/web/src/components/ThreadTerminalDrawer.tsx`, `PersistentThreadTerminals.tsx`, `apps/web/src/components/terminal/useThreadTerminalActions.ts`. There is no tab-based terminal view.
- **Terminal, server and contracts:** `apps/server/src/terminal/Manager.ts` (about 148 references to a thread id) and `packages/contracts/src/terminal.ts`: open, attach, write and resize inputs all carry a required `threadId`, plus `cwd`, an optional `worktreePath`, `cols` and `rows`. The terminal service starts the user's shell via a node-pty adapter (`apps/server/src/terminal/NodePtyAdapter.ts`). Standalone shells without a thread are the subject of story 2 and are not present.
- **Mock agent CLI:** none for shells. The only mock agents in the repo are chat-provider fixtures (`apps/server/scripts/acp-mock-agent.ts`, `apps/server/src/provider/testFixtures/grok-text-mock-agent.mjs`); story 1 delivers the shell mock CLI.
- **Scenario harness:** none for the epic scenarios; unrelated app scenario render files exist (`apps/web/test/appScenarios.renders.tsx`). Story 1 delivers the harness.
- **Tree:** the sidebar is a project > thread tree (`apps/web/src/components/Sidebar.tsx`, `sidebar/`). The workspace > folder > worktree > shell tree comes from story 3 and is not present.
- **Logging and timing:** no shell start/end log lines tied to a shell id and no start-to-banner measurement exist (unverified: not searched exhaustively).
- **Mobile:** not touched; out of the epic (NFR-4).

## Expected Behavior

Once this story ships, in a workspace (story 3) the user can start a shell in a folder's own checkout from the "+" modal. Resume, restore, close-tab, kill and worktree choices are not part of it.

### User Flow

1. The user is in a workspace and clicks "+". A modal opens with a folder step.
2. The user picks a folder already in the workspace, or adds one through the add-project flow: importing an existing folder, or creating a new one (the directory is created and git is initialized). The added folder becomes selected.
3. For a git folder, this story offers no worktree control: the shell always runs in the folder's own checkout on its current branch, and no worktree or starting-point step is shown (the worktree picker arrives in story 5). For a folder that is not a git repository, no worktree or branch step is shown at all.
4. The user clicks the up-arrow button (Enter does the same, as an extra).
5. A tab opens with a shell running the mock agent CLI, which prints its banner and a session id. The shell appears in the tree under its folder within 1 second of the start action (the up-arrow click). No chat thread exists for it.
6. The user types a line and sees it echoed. The user resizes the pane and the terminal's size matches the pane.
7. The next time the user clicks "+" in this workspace, the same folder is preselected, and one click on the up-arrow button starts another shell.
8. Each start logs the shell start with its id and cwd; the time from the start action to the visible banner is measured and logged for NFR-1.

### Edge Cases

- **EC-1:** The workspace has no folder yet. The modal opens on the folder step with no folder selected, the up-arrow button is disabled, and the user can add a folder from there.
- **EC-2:** The user adds a new folder (create). The directory is created, git is initialized, the folder is selected and a shell can be started right away in its own checkout, without creating a worktree. A git folder without any commit also starts in its own checkout, as every git folder does in this story.
- **EC-3:** The user adds an existing folder that is not a git repository. It is selected, no worktree or branch controls are offered, and the shell runs in the folder and sits directly under it in the tree.
- **EC-4:** The user adds an existing git folder. It is selected and starts in its own checkout, which is its default worktree.
- **EC-5:** The user starts a second shell in the same folder and checkout. Both appear in the tree, each with its own output.
- **EC-6:** The user closes the modal without starting. No shell, tab, tree node or folder change results beyond a folder the user already added.
- **EC-7:** The user clicks the up-arrow button a second time while the first start is still in progress. The second click is ignored: exactly one shell, tab and tree node result.
- **EC-8:** The last-used folder was removed from the workspace or from disk before the next open. The modal does not preselect it and shows the folder step normally.
- **EC-9:** Adding or creating a folder from the modal does not open a chat draft, thread or chat route (the existing flow does today).
- **EC-10:** The user has started a shell in workspace A and then opens workspace B. The modal in B does not preselect A's folder; a workspace with no earlier start has no default.

### Error Handling

- **ER-1:** The chosen folder no longer exists on disk when the user clicks the up-arrow button. The user sees why, no shell, tab or tree node is created, and the modal stays open.
- **ER-2:** The shell or the mock CLI cannot start (for example the mock CLI is missing). The user sees why, the modal stays open, no half-created tab or tree node remains, and the failure is logged with the cwd.
- **ER-3:** Adding a folder fails (the path is not a directory, creating the directory is denied, or git init fails). The user sees why, the folder is not added to the workspace and the modal stays usable.
- **ER-4:** The connection to the server is lost while starting. The user sees that the start did not happen and can try again; no shell is shown that the server does not have. The exact wording is TBD (see SU-5).

## Out Of Scope

- Clone from a remote and publishing a new project: part of the existing add-project flow, not tested here. They stay visible in the modal as in the existing flow (default, SU-7); hiding them is a later decision.
- Selecting an existing worktree or "new worktree" and choosing a starting point: story 5 (FR-4, FR-5, FR-13).
- Remembered worktree choice and starting point (the rest of FR-22), worktree and branch levels of the tree (the rest of FR-7): story 5. Tree and grouping: story 3.
- Closing a tab, kill, rename and many-shell behavior: story 6.
- Reload and server restart survival, saved layout, scrollback after reopening: story 7 (FR-14, FR-15).
- Restore and resume after an unexpected end, including the "Failed to resume" state: story 8.
- Workspaces, start screen and the "Workspaces" button: story 3. The mock CLI and scenario harness: story 1. Standalone shells: story 2.
- Choosing a harness, an initial prompt, a configurable launch command: the next epic (epic Out of scope).
- Removing chat code: a later epic.
- Desktop and mobile: not required (NFR-4).

## Technical Scope

- **Layers:** terminal-first web UI (the "+" button, the modal and its folder step, the use of the add-project flow, the tab that shows the live terminal, the tree node for the new shell); server (starting a standalone shell in the chosen folder running the mock CLI, shell start/end logs, folder-is-git detection, creating a directory and initializing git for a new folder, if the add-project flow does not already do it: unverified, see SA-2); contracts (any wire change needed to start a shell without a thread, following story 2); the scenario for S2 as far as this story covers it; the first NFR-1 measurement. Areas only; how they fit together is decided in the plan stage.
- **Docs impact:** `probe/docs/` pages that describe the terminal-first screen and how to run scenarios (NFR-7): add how a shell is started from "+". Remove inherited chat-start wording that this story makes untrue if any (to be found in the plan stage).
- **Mobile impact:** none; mobile is not required for the epic. It must not be made worse knowingly, but no compile check is required (NFR-4 handled later).

## Non-functional Requirements and Constraints

- NFR-1: no continuously repainting animation in what this story adds (modal, tab, tree node). Time from the start action to the banner visible is measured on the author's machine, provisional limit 2 seconds, which is reported, not enforced (no pass or fail on it); the limit is confirmed from this measurement and is TBD (author, 2026-11-09).
- The shell appears in the tree within 1 second of being created (FR-7).
- NFR-5: every action in the flow works with pointer actions alone; shortcuts are optional extras, and the scenario drives it with pointer actions.
- NFR-6: the server logs shell start with shell id and cwd, and shell end.
- NFR-3: scenarios use a throwaway data directory and never touch `~/.t3` or a remote server.
- NFR-7: docs are updated in the same PR as the behavior.
- Repo rules: follow `probe/AGENTS.md`.
- The existing add-project flow is reused rather than rebuilt (FR-21); if SA-2 proves false, the author re-plans this part.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a workspace with one git folder, when the user clicks "+", then a modal opens with the folder step and the folder can be selected with the pointer. | auto | FR-3 |
| AC-2 | Given the modal with a git folder selected, when the user clicks the up-arrow button, then a tab opens with a shell whose cwd is the folder's own checkout and which shows the mock CLI banner and a session id. | auto | FR-3, FR-6, FR-21 |
| AC-3 | Given a shell was just started, when the tree is read, then it contains a node for that shell under its folder within 1 second of the up-arrow click. | auto | FR-7 (part) |
| AC-4 | Given a started shell, when the server and the client state are read, then no chat thread exists for it and the tab shows no chat composer or thread header. | auto | FR-6 |
| AC-5 | Given an open shell tab, when the user types a line and submits it, then the terminal shows that line echoed by the mock CLI. | auto | FR-8 |
| AC-6 | Given an open shell tab, when the pane is resized, then the shell's reported columns and rows equal the columns and rows the terminal view computes for the new pane size. | auto | FR-8 |
| AC-7 | Given a shell was started earlier in this workspace, when the user clicks "+" again, then the same folder is preselected and one click on the up-arrow button starts another shell in it. | auto | FR-22 (part), FR-3 |
| AC-8 | Given the modal, when the user adds an existing git folder through the add-project flow, then the folder is selected and a shell started in it runs in that folder and sits under that folder in the tree. | auto | FR-21, EC-4 |
| AC-9 | Given the modal, when the user creates a new folder through the add-project flow, then the directory exists, git is initialized, the folder is selected, no worktree is created, and a shell can be started in its own checkout, also when the new git folder has no commit. | auto | FR-21, EC-2, SA-5 |
| AC-10 | Given the modal, when the user adds a folder that is not a git repository, then no worktree or branch controls exist (this story offers none for git folders either) and the started shell runs in that folder and sits directly under it in the tree. | auto | FR-21, FR-7 (part), EC-3 |
| AC-11 | Given a workspace with no folder, when the user opens the modal, then the up-arrow button is disabled until a folder is selected or added. | auto | FR-21, EC-1 |
| AC-12 | Given a started shell, when the user starts a second shell in the same folder, then both shells are in the tree and each keeps its own output. | auto | FR-3, EC-5 |
| AC-13 | Given the modal is open, when the user closes it without starting, then no shell, tab or tree node was created. | auto | FR-3, EC-6 |
| AC-14 | Given the last-used folder was removed from the workspace or deleted from disk, when the user opens the modal, then it is not preselected. | auto | FR-22 (part), EC-8 |
| AC-15 | Given the chosen folder was deleted from disk, when the user clicks the up-arrow button, then an error with the reason is shown, the modal stays open, and no shell, tab or tree node is created. | auto | FR-3, ER-1 |
| AC-16 | Given the mock CLI cannot be started, when the user clicks the up-arrow button, then an error with the reason is shown, the modal stays open, no tab or tree node remains, and the server log records the failure with the cwd. | auto | FR-6, NFR-6, ER-2 |
| AC-17 | Given adding a folder fails (path is not a directory, creating the directory is denied, or git init fails), when the user submits it, then the reason is shown, the folder is not in the workspace and the modal stays usable. | auto | FR-21, ER-3 |
| AC-18 | Given the harness drops the connection to the server during the start, when the start does not complete, then the user sees that it did not happen, no shell is shown that the server does not have, and the user can start again. | auto | FR-3, ER-4 |
| AC-19 | Given a shell is started, when the server log is read, then it contains a start line with the shell id and cwd, and an end line when the scenario ends the shell's process from outside. | auto | NFR-6 |
| AC-20 | Given the full flow from "+" to a shell, when the scenario drives it, then every step is done with pointer actions only (Enter is never used). | auto | NFR-5 |
| AC-21 | Given a started shell, when the scenario measures the time from the start action to the banner visible, then the value is recorded in a log or report on the author's machine; there is no pass limit until SU-1 confirms the provisional 2 seconds. | auto | NFR-1 |
| AC-22 | Given the code added by this story, when it is reviewed, then it has no continuously repainting animation in the modal, tab or tree. | manual (author, code review) | NFR-1 |
| AC-23 | Given the modal, when the user adds or creates a folder through the add-project flow, then no chat draft, thread or chat route is opened. | auto | FR-21, EC-9 |
| AC-24 | Given a start is in progress, when the user clicks the up-arrow button again, then exactly one shell, tab and tree node exist for that start. | auto | EC-7 |
| AC-25 | Given a shell was started in workspace A, when the user opens the modal in workspace B, then A's folder is not preselected and the up-arrow button stays disabled until a folder is chosen. | auto | FR-22 (part), EC-10 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-001 | Scenario harness, mock agent CLI (incl. session id) and the boot scenario skeleton; the harness must be able to make the mock CLI unstartable, drop the server connection and end a shell's process from outside (SA-8) | done (2026-11-03); the harness does not yet provide those three helpers, so this story adds them to `scripts/scenarios/` (SA-8) |
| PRB.T-002 | Standalone shells: a shell without a chat thread | backlog |
| PRB.T-003 | Workspaces, the terminal-only screen and the tree that the new shell is added to | backlog |

The reuse of the add-project flow inside the modal is checked by this story (epic A-13, see SA-2).

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | Stories 1, 2 and 3 land first, so a mock CLI, standalone shells, workspaces and the tree exist when this story is planned (epic order). | assumption | verified | PRB.T-001 and PRB.T-002 done; PRB.T-003 implemented on `feat/workspaces-prb-t-003` (verify pending), checked 2026-11-05 | author |
| SA-2 | The existing add-project flow (import existing, create new with git init) can be reused inside the modal's folder step (epic A-13). | assumption | false | Checked in planning 2026-11-05: only the server parts and client helpers are reusable (`ProjectService`, `VcsProvisioningService`, `filesystem.browse`, `client-runtime` browse helpers). The UI lives in the unmounted `CommandPalette.tsx` and always opens a chat draft (`useNewProject.ts:125`, `CommandPalette.tsx:1766`), so the modal has its own folder step. The create path in the existing flow (`projects.createNew`) cannot choose a location | author |
| SA-6 | No shell start/end logging and no start-to-banner measurement exist today (not searched exhaustively). | assumption | verified | Checked 2026-11-05: `apps/server/src/terminal/` has no start or exit info logs, and the server logs to the console only | author |
| SA-8 | Story 1's harness can make the mock CLI unstartable, drop the connection and end a shell's process from outside (needed by AC-16, AC-18, AC-19). Checked 2026-11-03: PRB.T-001 does not provide them (the handle has `restart`, `cli`, `pairingUrl`, `openPage` only). This story adds the three helpers to the harness. | assumption | false | Add them in this story's plan | author |
| SA-7 | The server logs a shell end for a shell whose process the scenario ends from outside (kill arrives in story 6; the epic tracks the shell process, so `exit` in the mock CLI alone does not end the shell). AC-19's end line is checked that way. | assumption | verified | S2 AC-19 (2026-11-05): SIGKILL on the shell pid logs "shell ended" with the shell id; the mock CLI's `exit` returns to the shell | author |
| SA-3 | A shell can be told the pane's size at start and on resize, and the terminal size can be read back for the scenario. Today the contracts carry cols and rows (`packages/contracts/src/terminal.ts`). | assumption | verified | S2 AC-6 (2026-11-05): after a pane resize, `stty size` in the shell equals the columns the view reports | author |
| SA-4 | A git folder's own checkout is its default worktree and counts as a worktree in the epic's model (A-9, decided); this story renders no worktree node. | assumption | verified | Decided by the user, 2026-11-02 | author |
| SA-5 | Folders without a commit run only in their own checkout (epic A-17), so "create new folder" needs no commit to start a shell. | assumption | verified | S2 AC-9 (2026-11-05): a created folder has `.git` and no commit, and a shell starts in it with no worktree | author |
| SU-1 | Time from the start action to the banner today (epic U-3). | unknown | unverified | Measured 2026-11-05 by S2 (AC-21): 350–380 ms in the dev container (headless Chromium, mock CLI). The 2-second limit still needs the author's confirmation (2026-11-09) | author |
| SU-2 | Where the preselected folder is remembered. | unknown | verified | Decided by the user 2026-11-02: one record per workspace, kept in that workspace's saved layout (FR-22); the format comes from story 3. | author |
| SU-5 | Wording and form of the "start did not happen" message when the connection is lost (ER-4). | unknown | verified | Default from planning 2026-11-05: "The shell did not start: the connection to the server was lost. Try again." | author |
| SU-7 | Whether clone and publish stay visible in the modal's folder step. Default: yes, as in the existing flow | unknown | false | Not built: the modal has its own folder step (SA-2), with import and create only. Clone and publish are not offered; decide at review whether a later story adds them | author |
| SU-6 | How the user tells a folder is a git repository in the folder step (epic does not say whether the modal labels it). | unknown | verified | Default from planning 2026-11-05: folder rows show a "git" badge; the server reports `isGitRepository` per folder | author |

## Implementation Status and Handoff

Implemented on `feat/plus-modal-prb-t-004` (stacked on `feat/workspaces-prb-t-003`), 2026-11-05. Plan checkpoints 1 to 6 are done.

**Decisions (user, 2026-11-05)**
- Agent launch is server-side: the server reads `PROBE_AGENT_COMMAND`; the dev runner and the scenario harness set it to the mock CLI. `shell.open` with `agent: true` checks the command's first word resolves (else `ShellLaunchError`, nothing kept), starts the normal interactive shell and writes the command as its first input. The next epic replaces it with a configurable launch command.
- A folder is a project (registered with `ProjectService.bootstrap`, which reuses an existing one) and its path is saved in the workspace file: `{"version":1,"folders":[{"path"}],"lastFolder":path|null}`; both fields are optional, so PRB.T-003 files still decode.
- "Create new folder" takes a parent path and a name; a failed `git init` or registration removes the directory it made (ER-3).
- `Shells` is a `Context.Service` (`t3/terminal/Shells`), and `SavedWorkspaces` uses it for `workspace.startShell`.
- Tabs and the active tab live in web memory (story 7 saves the layout); the tree groups shells by matching their cwd to the workspace's folders.

**Decision (user, 2026-11-05, after the manual pass): two dialogs.** "+" opens **Start shell**, which only picks a folder and starts a shell: it has no "Add folder", and folders gone from disk are not listed. The sidebar's "Add project" icon opens **Add folder to workspace**, which only imports or creates a folder and starts no shell. ACs that say a folder is added "in the modal" (AC-1, AC-8 to AC-11, AC-17, AC-23) are met through the second dialog; S2 adds a folder there, then picks it in "+". The tree keeps a deleted folder, marked "missing" (`WorkspaceFolder.exists`).

**Where things are**
- Contracts: `WorkspaceDetail`, `WorkspaceAddFolderInput` (import | create), `WorkspaceStartShellInput`, `WorkspaceFolderError`; RPCs `workspace.addFolder` (settings write) and `workspace.startShell` (terminal operate), both client-guarded. `workspace.open` now returns the detail.
- Server: `apps/server/src/terminal/Shells.ts` (agent command, start, failed-start and end logs), `apps/server/src/savedWorkspaces/SavedWorkspaces.ts` (folders, `lastFolder` only while in the workspace and on disk).
- Web: `components/workspaces/StartShellDialog.tsx` and `AddFolderDialog.tsx` (the server folder list is the shared Autocomplete; `serverLocation.ts` decides the "(remote server)" label), the sidebar's "+" and the enabled "Add project" icon, the folder and shell tree, and tabs in `WorkspaceScreen.tsx` (`ShellTerminal` is shared with `ShellView`).
- Harness: `server.restart({ env })`, `server.logs()`, `connectionCutter` in `browser.ts`, and shared waits in `support.ts`. S2 is `scenarios/plus-modal.ts`.

**Verification so far**
- Focused tests pass: contracts, RPC authorization, `SavedWorkspaces`, the `Manager.test.ts` Shells block, `ws.test.ts`, CLI config and the dev runner.
- Per-package typecheck passes for contracts, client-runtime, web, server, scripts, mobile and desktop; knip, lint, format and the React compiler coverage test pass. `check:changed`'s parallel typecheck and knip fail on this container with no errors printed (memory), as in PRB.T-003.
- `vp run test:scenarios --rebuild`: S1, S2 and T-002 pass (2/8 passing, 6 pending). S2 passed repeatedly. Removing the double-click guard makes S2 fail at AC-24 (mutation check). The selftest and `harness.test.ts` pass.
- Start to banner: 350–380 ms (AC-21).

**Open**
- AC-22 is a manual code review: the modal, tabs and tree add no animation. Only the existing button hover and press transitions run.
- SU-7: clone and publish are not in the folder step (see the table above).
- The user's manual pass in the dev app is still to do.
