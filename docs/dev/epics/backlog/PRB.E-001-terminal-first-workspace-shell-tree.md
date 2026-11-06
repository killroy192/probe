---
id: PRB.E-001
type: epic
parent:
phase: 1
labels: [terminal-first, testing]
created: 2026-11-02
updated: 2026-11-02
---

# Terminal-first workspace: shell tree with mock-agent shells

## Goal

A Probe user opens the browser app and finds no chat, only a workspace they named, with a tree of shells grouped by folder, worktree and branch, where a new shell (in the folder, or in a new worktree) opens as a tab running a mock Claude-Code-like CLI, running shells survive a restart and a dead agent is resumed, and every must functional requirement here is checked by an automated scenario test that needs no human and no paid model.

## Why and why now

- Building a chat per agent harness is hard and always behind. The harnesses (Claude Code and others) already work well and have good UX in their own TUIs. Probe pivots from chat-first to a terminal-first app that adds an observability and UX layer around terminal-native agent harnesses.
- Today terminals belong to a chat thread (bottom drawer) and the sidebar is a project > thread tree. Every later epic (agent status, subagents, review, context to terminal) needs shells that stand alone and a tree to hang them on.
- The scenario harness must exist before the second feature, otherwise every later epic is verified by hand.
- If skipped: later work keeps building on chat concepts we plan to delete.

## KPI

No guardrail metric (decided with the user: chat visibility is a requirement, FR-1, not a metric).

| Metric | Kind | Baseline | Target | Measured how and where | By when |
| --- | --- | --- | --- | --- | --- |
| Automated scenarios S1 to S8 (below) passing from a clean shell with one command | primary | 0 of 8 | 8 of 8 | `vp run test:scenarios` (one command, created in story 1; its output counts passing scenarios out of 8), run locally on the author's machine (the scenarios are not run in CI, user decision 2026-11-02; only the harness tests in `scripts/scenarios/harness.test.ts` run in CI) | when this epic closes |

## Users and scenarios

(Eight scenarios, above the template's 2 to 5, are kept on purpose: each carries its own requirements and the KPI counts them.)

User: the author first, then a small team of peers who run CLI agents.

Vocabulary: a **workspace** is a named collection of **projects** plus the layout of its shells (the code and saved data still call a project a "folder" until PRB.T-009), for example "sparta"; Probe creates it, or opens one it saved earlier. Probe keeps one file per workspace in its own internal folder (its folders and the layout of its shells); the user never picks a file, and the workspace name is the file's name. The tracked process of a shell is the shell itself; the mock agent CLI is a program run inside it. If the agent alone exits while its shell stays, nothing is removed or restored. A project is any directory. A git project has one or more **worktrees**: its own checkout is the **primary** worktree, and the others are linked worktrees. A project that is not a git repository has none, and git features (worktrees, branches) are unavailable for it, but it can still hold shells and tabs. A worktree has one current **branch** at a time, shared by all of its shells. A **shell** runs in a worktree, or directly in a non-git project. The "+" on a project's row starts a brand-new one. Shells that are agents will later have **subagents** under them.

1. **S1, boot and workspaces.** As a user, I open the app with no workspace and see a screen with two buttons, "Open workspace" (a scrollable dropdown of the workspaces Probe has saved, listed by name) and "Create workspace" (starts a new one). I create a workspace named "sparta" and see an empty shell tree. No control and no address reaches a chat; a link or bookmark of the former chat screens (for example a thread link) lands on the shown workspace, or on the start screen when none is shown. From the "Workspaces" button in the top left I create a second workspace, switch back to "sparta", and remove the second one (the shown workspace is unaffected).
2. **S2, local shell.** As a user, I add a project with the sidebar's "Add project" dialog (importing an existing folder, or creating a new one, which creates the directory and initializes git). I click "+" on the project's row (the only way for a user to start a brand-new shell; automatic restore relaunches in place and skips the modal). The "Create shell" modal opens with the project's primary worktree selected, and I click the up-arrow button. A tab opens with a shell running the mock agent CLI, and the shell appears in the tree under its project and worktree within 1 second. I type a line and see it echoed; no chat thread exists for it; I resize the pane and the terminal's size matches it. The next time I click "+" on that project, the modal already has the same worktree selected, and a single click on the up-arrow button starts another shell. I do all of it with the mouse; Enter is only a shortcut.
3. **S3, shell in a new worktree.** As a user, I click "+" on a git project, choose "Fork" (Probe names the new worktree automatically), select what it forks from (a linked worktree or a branch) and click the up-arrow button. The shell and mock agent run inside the new worktree. The next time I open the modal on that project it preselects "Fork" and the same origin, so the up-arrow button creates another new worktree. If the fork fails (for example the starting point no longer exists), I see why, no shell appears, and no half-created worktree is left.
4. **S4, many shells.** As a user, I run shells in two git projects and one project that is not a git repository (it offers no worktree options), and in two worktrees of one project (one of them started in an existing worktree, which may already have shells). In one project's primary worktree I start a second shell and, inside it, switch to a different branch: the worktree node shows the new branch for both of its shells. The tree groups shells by project and worktree, and each shell keeps its own output. After a browser reload everything is still there, and a reopened tab shows the shell's output history and scrollback.
5. **S5, close a tab.** As a user, I switch between two open tabs and close one, with the mouse. The terminal view is hidden but the shell keeps running and stays in the tree; selecting it in the tree opens its tab again.
6. **S6, kill a shell.** As a user, I kill a shell from the tree (after a confirmation); as an agent, I kill my own shell with a command run inside it. In both cases the shell's process ends and it leaves the tree and the saved layout, and a worktree it created stays on disk. Removing a workspace that has a running shell ends that shell's process too.
7. **S7, restart and reopen.** As a user, I have two running shells with output on screen and one shell I killed through Probe. I close the app and restart the server, then reopen the workspace. The saved layout is back: the two running shells are still the same running processes with their output history and scrollback, the tabs I had open are open again, and the shell I killed is gone for good. I then switch to another workspace and reopen the first with "Open workspace", choosing its name in the list, and the same layout is back, with shells that are still running simply shown again. A workspace I removed is gone for good and is not in the list. The workspace list is intact. A shell whose folder I deleted before reopening shows a warning that the folder was not found, nothing is restored for it, and I cannot start a new shell there; I can remove the entry with the "x" in the tree.
8. **S8, restore after the process ends.** As a user, a shell's process ends unexpectedly: the shell process is killed from outside Probe (by a signal), crashes (killed by a signal), or the machine reboots (the same case for the harness). Probe restores it in place, in the same folder, worktree and branch. A mock agent that was running is relaunched with its resume command and saved session id, and shows the same conversation continuing. Probe tries up to 3 times, automatically, with no button to press. Each death gets its own 3 attempts, with a 2 second wait between them. If all 3 attempts fail, the shell stays listed, shows an error and lets me view the last output of the dead shell. A restored shell carries a small "restored" marker. I remove it with the kill action. A shell I killed through Probe is never restored, and neither is a shell that exits on its own in the normal way, with any status (for example I typed `exit`, even after a failed command): it is simply gone. If I closed the tab before the process ended, it is still restored and its tab stays closed.

## Scope

**In:**

- A terminal-only main screen: all chat entry points hidden (no control or address reaches a chat).
- Workspaces that Probe creates (named by the user) or opens from the list of workspaces Probe saved, holding folders.
- Shells that exist without a chat thread, independent of any tab.
- A tree: workspace > folder > worktree > branch (hidden when a worktree has only one branch) > shell.
- A "+" on each project row that opens the "Create shell" modal, the only way for a user to start a brand-new shell; automatic restore relaunches in place and skips the modal. Projects are added beforehand with the sidebar's "Add project" dialog (import an existing folder, or create a new one with git initialized). For a git project the modal offers Existing (start in any worktree) or Fork (create a new worktree from a linked worktree or a branch). The modal preselects the project's last start, and the up-arrow button (or Enter) starts the shell, opens it as a tab and adds it to the tree.
- A saved workspace layout that is restored on reopening: running shells survive an app or server restart with their output history and scrollback; a shell whose process ends unexpectedly (killed from outside, crash, reboot) is restored in place, and a mock agent is relaunched with its resume command and session id (behavior like Paradev's "persistent sessions" and "resume interrupted sessions"); a shell killed through Probe, or that exits on its own in the normal way (any exit status), is removed for good.
- A start screen with "Open workspace" and "Create workspace", and a "Workspaces" button at the top left to switch, create, open and remove workspaces.
- Open a shell as a tab; close a tab without ending the shell; kill a shell from the tree or from inside the shell.
- Rename a shell (FR-16): deferred by the user, 2026-11-02.
- The mock agent CLI (prints a banner and a session id, echoes input, exits on `exit`, accepts a fixed resume command with that id and continues the same conversation; it runs inside a normal shell, so branch switches and the kill command work) and the scenario harness with S1 to S8.

**Out (non-goals, with a reason):**

- Subagent level of the tree (level under a shell): needs agent status from hooks, a later epic; the tree must leave room for it.
- Configurable launch command or script: next epic; here every shell starts the mock CLI.
- Agent status and notifications: later.
- A per-workspace prefix or naming pattern for generated worktree and branch names: later (here the name is generated with a fixed scheme).
- Selecting an existing agent session when a new shell is created: with the harness selection, the user can pick a harness (for example Claude Code) and recover a session that was run in the folder, even if it was never part of the workspace. Later.
- An initial prompt in the modal, and choosing a harness with its setup (later steps of the "+" flow, with the configurable-launch epic).
- A setting to configure each agent's resume command ("Resume Args"), and capturing a real Claude Code session id from hooks: later, with the configurable-launch and agent-state epics; here the mock CLI supports a fixed resume command and supplies its own session id.
- Deleting chat, providers and orchestration code: later remove-chat epic; here chat is only unreachable so the app stays runnable.
- Desktop and mobile: not required (user decision, 2026-11-02).
- Deleting worktrees: killing a shell never removes a worktree (only a worktree whose creation failed is cleaned up).

## Functional requirements

| ID | Requirement | Priority | Scenario |
| --- | --- | --- | --- |
| FR-1 | No visible control or route starts or opens a chat thread. Chat screens and chat-related pages (including the settings pages that belong to chat) are hidden; opening an old chat address (for example a thread link) lands on the current workspace, or on the start screen when no workspace is shown (an old chat address is a bookmark or typed link to the former chat UI, such as /threads/<id>). Removing the chat code and cleaning up these pages is a later epic | must | 1 |
| FR-2 | With no workspace, the app shows only "Open workspace" (a scrollable dropdown of the workspaces Probe saved, by name; this is how the user reaches existing workspaces) and "Create workspace" (starts a new one with a name); the workspace is the root of the shell tree. A workspace is a collection of folders (projects) and the layout of its shells | must | 1 |
| FR-24 | A "Workspaces" button at the top left lets the user switch, create, open and remove workspaces. Workspace names are unique, 1 to 64 characters, and must be valid as a file name (no path separators or reserved characters); an invalid or duplicate name is rejected with a reason. Removing a workspace force-kills its shells and forgets its layout; if it was the shown workspace the app returns to the start screen, otherwise the shown workspace stays; it never deletes folders on disk. Opening a workspace brings back its whole layout (shells still running are shown again, not recreated); choosing the shown workspace changes nothing. A removed workspace is deleted with its saved file and cannot be reopened. The list of saved workspaces survives a browser reload from story 3, because each is a saved file; which workspace is shown after a reload, and its layout, come in story 7 | must | 1 |
| FR-3 | A "+" on each project row opens the "Create shell" modal, the only control that starts a brand-new shell; automatic restore (FR-17, FR-18) relaunches in place and skips the modal. A visible up-arrow button (Enter does the same) starts the shell, opens it as a tab and adds it to the tree | must | 2 |
| FR-4 | In the modal, for a git project, a user can choose "Fork" and select what the new worktree forks from: a linked worktree, or a local branch (a branch checked out in a linked worktree is offered only as that worktree, and a branch named exactly like a linked worktree is grouped with it); Probe names the worktree `probe-worktree-<6 hex>` automatically, creates it in a Probe-owned worktrees location (see Notes for stories), and gives its new branch the same name, and the shell runs in the new worktree | must | 3 |
| FR-5 | In the modal, for a git project, a user can choose "Existing" and select any of its worktrees, the primary one first; a worktree may hold any number of shells. A project with no commit offers only Existing. The primary worktree is delivered in story 4, the rest in story 5 | must | 2, 4, 5 |
| FR-6 | A new shell has no chat thread, starts the mock agent CLI, and opens as a tab | must | 2 |
| FR-21 | Projects are added with the sidebar's "Add project" dialog: importing an existing folder (any worktree of a repository adds the repository), or creating a new one (the directory is created and git is initialized); adding starts no shell. A shell can then be started in the project's primary worktree; no worktree is created for it. A project that is not a git repository has no worktree options and runs the shell in its folder | must | 2, 4 |
| FR-22 | The modal preselects, for the project it was opened on, the choice (Existing with its worktree, or Fork with its origin) of the last start in this workspace when that start was in this project and is still possible (kept in the workspace layout); with those defaults accepted, one click on the up-arrow button starts a shell | must | 2, 3 |
| FR-7 | The tree shows workspace > project > worktree > shell, and each worktree node shows its current branch ("primary · <branch>" for the project's own checkout) (git keeps one branch per worktree, so every shell of a worktree is on that branch, decided by the user 2026-11-05). A shell whose current directory has left its worktree stays under it, marked "elsewhere". A new shell appears in the tree within 1 second of being created. A worktree node shows only while it has running shells and disappears when its last shell is gone; the worktree stays on disk and in the modal. A shell in a project that is not a git repository sits directly under its project. | must | 2, 4 |
| FR-8 | A tab shows the live terminal: typed input reaches the CLI, output renders, and after the pane is resized the terminal's size matches the pane | must | 2 |
| FR-9 | Several shells run at once across folders and worktrees, each with its own output | must | 4 |
| FR-10 | Closing a tab hides the terminal but the shell keeps running and stays in the tree; selecting it opens a tab again | must | 5 |
| FR-11 | A user can kill a shell with the "x" on its node in the tree, after a confirmation. The kill is a force-kill, so the process always ends; the node disappears and the shell is removed from the saved layout | must | 6 |
| FR-12 | A command available inside a shell force-kills that shell, so an agent can end itself | must | 6 |
| FR-13 | If forking the worktree fails (for example the starting point no longer exists), the user sees why and no shell is created. Choosing a worktree or branch for a folder that is not a git repository is not offered | must | 3 |
| FR-14 | After a browser reload with the server running, the tree, shells and open tabs are still there, and a reopened tab shows the output history and scrollback (the full history the running shell keeps; no number is promised here, and a restored shell is a new shell with no earlier history) | must | 4 |
| FR-15 | A workspace saves its layout (folders, worktrees, branches, shells, open tabs). After the app is closed and the server restarted, reopening the workspace shows the layout again; shells that were running are still the same running processes, with output history and scrollback, and the same tabs are open. The layout is saved at every change that affects it. If a saved folder or worktree was removed or moved, Probe shows a warning that it was not found and restores nothing for it; shells already running keep working, and no new shell can be started in a missing folder | must | 7 |
| FR-17 | The shell process is the one tracked. If it ends unexpectedly (killed from outside by a signal, a crash that ends the process by a signal, or a machine reboot) it is restored in place: a fresh shell in the same folder, worktree and branch, also when its tab was closed (the tab stays closed). If its folder is gone it is shown as unavailable instead (FR-15) | must | 8 |
| FR-18 | If the restored shell was running an agent with a saved session id, the agent is relaunched with its resume command and that id, so the conversation continues | must | 8 |
| FR-19 | A shell killed through Probe (from the tree, or from inside the shell with the kill command; FR-11, FR-12), or that exits on its own in the normal way (any exit status, for example the user typed `exit`, also after a failed command), is removed and never restored, also after a restart | must | 7, 8 |
| FR-20 | A restore or resume is attempted automatically, at most 3 times per death with a 2 second wait between attempts (a later death starts a fresh count). If all attempts fail, the shell stays listed, shows an error and lets the user view the last output of the dead shell; the user can remove it. A restored shell shows a small "restored" marker | must | 8 |
| FR-16 | Deferred, out of scope for now (user, 2026-11-02): a user can rename a shell. The ID is kept. | could | none |
| FR-23 | A shell that is unavailable or failed to resume can be removed from the tree and the saved layout with the same kill action | must | 7, 8 |

## Non-functional requirements

| ID | Quality | Requirement with a measurable limit | Not applicable because |
| --- | --- | --- | --- |
| NFR-1 | Performance | No continuously repainting animation in the tree or terminal area (code review). Time from "start shell" to the CLI banner visible: provisional limit 2 seconds on the author's machine, accepted by the user 2026-11-02, to confirm after measuring in story 4. | |
| NFR-2 | Reliability and recovery | Killing a shell (FR-11, FR-12) leaves no process that it started still running, checked by the scenario. A failed fork (FR-13) leaves no partial shell or half-created worktree. A resume attempt (FR-18) starts within 5 seconds of the death being detected or the workspace being reopened (provisional, accepted by the user 2026-11-02, confirm in story 8). | |
| NFR-3 | Security and privacy | Scenarios never read or write the user's real Probe data and never use a remote server. | |
| NFR-4 | Compatibility | The scenarios run in Playwright's headless Chromium (installed with `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium`), the browser `apps/web` uses for its browser tests. | Desktop and mobile build or compile: user decision 2026-11-02, handled later. |
| NFR-5 | Usability and accessibility | Every action in this epic (start, switch, close, kill, remove, switch workspace) can be done with the mouse or touchpad alone; keyboard shortcuts are optional extras, and every scenario drives the UI with pointer actions. | |
| NFR-6 | Observability | The server logs shell start and end with the shell id, cwd and, for FR-4, the worktree path and branch, and every resume attempt with its result. | |
| NFR-7 | Maintainability and docs | The project docs describe the terminal-first screen and how to run scenarios, in the same PR as the behavior. | |

## Approach

1. Build the scenario harness first, so every later step is provable (a way to run scenarios on throwaway data, the mock CLI, boot scenario).
2. Make shells stand alone: a shell is a first-class thing in a worktree, with its own life, independent of chat and of any tab.
3. Replace the chat-first screen with the terminal-only screen, workspaces and the shell tree, hiding every chat entry point.
4. Add "start shell" local, then in a new worktree, each with its scenario.
5. Add multi-shell, close tab and kill; then reload, restart survival and the saved layout; then resume after an unexpected death.

Alternatives considered: keep chat hidden behind a flag (rejected: user wants no chat at all); delete chat code first (rejected: too large and breaks the runnable app; it is a later epic); restoring only by starting fresh shells (rejected by the user: restore should work like Paradev's persistent sessions plus resume of interrupted agents); keeping killed shells as "ended" with a "New shell" button (rejected by the user: a shell killed through Probe or exiting cleanly is removed and never restored; only unexpected ends are restored).

## Stories (candidates)

| # | Title | Value in one line | Order / depends on |
| --- | --- | --- | --- |
| 1 | Scenario harness, mock agent CLI and a booting scenario skeleton (S1 reaches full scope in story 3) | Everything after this is verified automatically | first |
| 2 | Standalone shells (large story with subtasks) | Shells exist without chat and without a tab; resolves U-1 | after 1 |
| 3 | Workspaces and the terminal-only shell-tree screen | The user sees the new product; chat unreachable | after 2 |
| 4 | Start a local shell | The core promise: a shell running an agent CLI | after 3 |
| 5 | Start a shell in a new or existing worktree | Fork-or-open per agent | after 4 |
| 6 | Multiple shells, close tab, kill | Real use with many agents | after 5 |
| 7 | Reload, restart survival and saved layout | Running shells survive a reload or restart, scrollback intact; killed shells stay gone | after 6 |
| 8 | Restore and resume after an unexpected end | A shell that died comes back in place, and an agent continues its conversation | after 7 |

## Verification

- **Traceability:** every FR and NFR appears in one row.

| Requirement | Verified by | Owner |
| --- | --- | --- |
| FR-1 | Scenario S1 asserts no chat is reachable by any control or address | story 3 |
| FR-2 | Scenario S1 | story 3 |
| FR-24 | Scenario S1 (switch, create, remove) and S6 (removal ends running shells) | story 3 and story 6 |
| FR-3 | Scenarios S2 and S4 (the only way to start; up-arrow button) | story 4 |
| FR-4 | Scenario S3 | story 5 |
| FR-5 | Scenarios S2, S3 and S4 (Existing: primary and linked worktrees) | story 5 |
| FR-6 | Scenario S2 | story 4 |
| FR-21 | Scenarios S2 and S4 (non-git project), S3 (worktree import) | story 4, story 5 (worktree import) |
| FR-22 | Scenarios S2 and S3 (Existing and Fork defaults per project) | story 4 (folder) and story 5 (per-project choice and origin) |
| FR-7 | Scenarios S2 (appears within 1 second), S3 (worktree nodes, branch label, "elsewhere") and S4 (grouping) | story 3 (tree and grouping), story 4 (appears within 1 second), story 5 (worktree level and branch label) |
| FR-8 | Scenario S2 (input, output, resize) | story 4 |
| FR-9 | Scenario S4 | story 6 |
| FR-10 | Scenario S5 | story 6 |
| FR-11 | Scenario S6 | story 6 |
| FR-12 | Scenario S6 | story 6 |
| FR-13 | Scenario S3 (failing fork shows an error, no shell) | story 5 |
| FR-14 | Scenario S4 (reload, output history) | story 7 |
| FR-15 | Scenario S7 (server restart in harness, then reopen, including a missing folder) | story 7 |
| FR-17 | Scenario S8 | story 8 |
| FR-18 | Scenario S8 | story 8 |
| FR-19 | Scenarios S6 and S7 (killed shell gone after restart), S8 (clean exit gone) | story 7 and story 8 |
| FR-20 | Scenario S8 | story 8 |
| FR-23 | Scenarios S7 and S8 (remove an unavailable and a failed shell) | story 7 |
| FR-16 | Deferred (out of scope, 2026-11-02) | none |
| NFR-1 | Measurement logged in story 4; the animation rule is checked in code review (not in the KPI) | story 4 |
| NFR-2 | Scenario S3 (no half-created worktree after a failed fork), S6 (process gone, worktree kept) and S8 (resume attempt within 5 seconds) | story 5, story 6 and story 8 |
| NFR-3 | Harness test asserts it uses a throwaway data directory | story 1 |
| NFR-4 | Scenarios run in headless Chromium | story 1 |
| NFR-5 | Scenarios S1 to S8 (pointer-driven) | each story |
| NFR-6 | Scenarios read server log lines (start, end, resume attempts) | story 4, story 5 and story 8 |
| NFR-7 | Docs diff reviewed in the PR | each story |

- **KPI measurement:** run the single scenario command from a clean shell; count passing scenarios S1 to S8.
- **Automated scenarios:** S1 to S8. This epic owns the scenario harness.
- **Manual checks:** the author runs a session with a workspace of two git folders, starts a local shell and a worktree shell in each.
- **Sign-off:** the author.

## Dependencies and sequencing

- Phase 1 of `roadmap.md`. Depends on the running app (A-5). Follow-up epic, not yet created: configurable launch command and script shells. Later epics add the subagent level of the tree and agent status. The tree wording differs from the roadmap's "workspace > agent (worktree) > subagent" on purpose: this epic's tree is workspace > folder > worktree > branch > shell, and `roadmap.md` is updated to match.
- Blocks all later epics (agent state, subagent tree level, review, context, remove chat).
- U-1 (how a shell is identified without a thread) is answered by a spike at the start of story 2; the story's plan follows from it.

## Risks

| ID | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R-1 | Existing terminals are deeply tied to chat threads, so story 2 is large | high / medium | Accepted: story 2 stays one large story with subtasks; the epic is not re-planned |
| R-2 | Hiding chat leaves dead settings pages or broken links | medium / low | Chat-hidden check in S1 plus a manual click-through |
| R-3 | A scenario harness on a real server is flaky, which blocks every later epic | medium / high | Follow the repo test rules (no sleeps, no polling); fix flakiness before adding scenarios |
| R-4 | Worktree creation collides with existing worktrees or branches | medium / medium | FR-13 error path; never delete a usable worktree, only remove one whose creation failed |
| R-6 | Shells that survive a server restart need something that owns the terminals independently of the server process; this may be a large change to the existing terminal service | high / high | Decide the approach in the story 2 spike (U-1) and size story 7 from it; if too big, the epic is re-planned with the user |
| R-5 | A shell that is killed leaves child processes running (agents spawn many) | medium / medium | NFR-2 check in S6 |

## Assumptions and unknowns

| ID | Statement | Kind | Status | How and when to verify | Owner | Affects |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | A workspace is a new Probe concept, created from the start screen, opened from its dropdown, and managed from the "Workspaces" button; projects are added to it with the sidebar's "Add project" dialog | assumption | verified | Decided by the user, 2026-11-02; the add step moved out of the "+" modal in PRB.T-004 (2026-11-05) | author | FR-2, FR-21 |
| A-2 | Worktree creation exists in server code outside the chat/orchestration code and can be reused | assumption | verified | Verified in story 2: `vcs.createWorktree` works with no thread ([spike](../../research/t-002-standalone-shell-spike.md)) | author | FR-4 |
| A-3 | A fake agent CLI that a shell can run is enough to stand in for a Claude-Code-like tool | assumption | verified | Proved by PRB.T-001 | author | S2 to S8 |
| A-4 | Playwright, used as a library from a Node runner, can drive a real server in Playwright's headless Chromium (not `channel: "chrome"`) | assumption | verified | Proved by PRB.T-001 | author | KPI |
| A-5 | The toolchain installs and the app runs in the browser on this machine | assumption | verified | The author confirmed it (2026-11-02); the harness re-proves it in story 1 | author | all |
| A-6 | A running shell survives a browser reload (the server owns it, so very likely true); if false, the fix is built in story 2 | assumption | verified | Verified in story 2: a reload only detaches; scenario T-002 checks it ([spike](../../research/t-002-standalone-shell-spike.md)) | author | FR-10, FR-14 |
| A-7 | The harness can stop and restart the server within one scenario | assumption | verified | Proved by PRB.T-001 | author | FR-15 |
| A-8 | Chat can be hidden everywhere without breaking the app (routes, palette, settings links) | assumption | verified | PRB.T-003 (2026-11-05): chat routes redirect, the chat shell, palette and coordinators are unmounted, chat-only settings rows and pages are hidden; scenario S1 and the author's AC-10 pass confirm the app runs | author | FR-1 |
| A-9 | A folder's own checkout counts as a worktree in the tree, so local shells sit under it | assumption | verified | Decided by the user, 2026-11-02 | author | FR-3, FR-7 |
| A-10 | A workspace saves its layout; restore works like Paradev's: running processes survive, a process that ends unexpectedly is restored in place and an agent is resumed | assumption | verified | Decided by the user, 2026-11-02 | author | FR-15, FR-17 to FR-20 |
| A-11 | Probe can learn each worktree's current branch and show it on the worktree node, updated after a branch switch in any of its shells (decided 2026-11-05: real git state, no per-shell branch) | assumption | verified | PRB.T-005 (2026-11-05): the server reads each worktree's HEAD file every 2 s; a `git switch` in one shell relabels the node in S3 | author | FR-7 |
| A-12 | Probe can list a folder's existing worktrees from git, including those not on a branch | assumption | verified | PRB.T-005 (2026-11-05): `GitVcsDriver.listWorktrees` lists the primary, linked and detached worktrees | author | FR-5 |
| A-13 | The existing add-project flow can be reused inside the modal's folder step | assumption | false | PRB.T-004 planning (2026-11-05): only the server parts (`ProjectService`, `VcsProvisioningService`, `filesystem.browse`) and client helpers are reusable; the UI lives in the hidden command palette and always opens a chat draft, so the modal has its own folder step | author | FR-21 |
| A-14 | Terminals can keep running while the server restarts and the new server can reattach to them | assumption | false | False in story 2: a server restart ends every shell; story 7 scope pending ([spike](../../research/t-002-standalone-shell-spike.md)) | author | FR-15 |
| A-15 | The mock CLI can print a session id and accept a resume command with that id, and continue the same conversation | assumption | verified | Proved by PRB.T-001 | author | FR-18 |
| A-17 | Forking a worktree needs at least one commit, so a folder without a commit offers only its own checkout (the default worktree) | assumption | verified | PRB.T-005 (2026-11-05): a repository with no commit has Fork disabled and starts shells in its primary worktree | author | FR-4, FR-21 |
| U-1 | How much of the terminal service and drawer depends on a chat thread, and how to identify a standalone shell | unknown | verified | Resolved in story 2: `shell:<id>` owner key behind separate `shell.*` RPCs ([spike](../../research/t-002-standalone-shell-spike.md)) | author | FR-6, FR-8 |
| U-2 | Which branch a new worktree forks from by default | unknown | verified | Decided in story 5 planning (2026-11-05): the folder's current branch; the location and name are decided in FR-4 | author | FR-4 |
| U-3 | What the time from "start shell" to the CLI banner is today | 350–380 ms (S2, dev container, headless Chromium, mock CLI, 2026-11-05) | measured | Confirm the 2 s limit from it | author | NFR-1 |
| U-4 | What a reopened tab shows | unknown | verified | Decided: output history and scrollback (like Paradev), FR-14 | author | FR-10 |
| U-5 | How a shell-side kill command reaches the server (name, how it finds its own shell) | unknown | unverified | Design in story 6 | author | FR-12 |
| U-6 | What happens to a saved layout whose folder was moved or deleted | unknown | verified | Decided: warn that the folder was not found and restore nothing for it, the same for moved and removed (FR-15) | author | FR-15 |
| U-7 | How Probe tells the end of a process that must be restored (signal, owner process lost) from one that must not (a Probe kill, any normal exit). Edge `exit` after a failed command: removed (decided) | unknown | verified | Decided by the user 2026-11-02: any normal shell exit (any status, also `exit` after a failed command) is intentional and removes the shell; only death by a signal or a lost owner process (crash, kill from outside, reboot) is restored | author | FR-17, FR-19 |
| U-8 | Where saved workspaces are stored and how they are named | unknown | verified | Decided by the user 2026-11-02: one file per workspace in Probe's internal folder, the workspace name is parsed from the file name and listed in a dropdown; the file's inner format is decided in the story 3 plan | author | FR-2 |

## Open questions

- Folders in a workspace are a flat list in this epic; any further grouping would be a new epic. (owner: author, confirm in story 3)

## Notes for stories

- Claude Code subagents: per the hook docs recorded in `questions.md`, hook events inside a subagent carry `agent_id` and `agent_type` on the same session, so a subagent is not a separate shell. The subagent level of the tree is therefore built from hook events in a later epic, not from process or shell tracking. Still unverified for nested runs.
- Later, restoring a Claude Code (or other agent) conversation after a kill through Probe is done by starting a new shell and choosing the session to recover in the "+" modal (see Out of scope).
- Restore behavior reference: Paradev's public docs (terminal-integration, agent-sessions): sessions survive restarts with scrollback; interrupted agents are relaunched with e.g. `claude --resume <session-id>` taken from a per-agent "Resume Args" setting; deliberate kills disappear and clean exits stay down (Probe differs: any normal exit is removed too, FR-19); a failed resume is handled differently in Probe (FR-20). Behavioral reference only, no code copied (license).
- The scenario command is `vp run test:scenarios` (a scenario that does not exist yet is listed as pending and does not fail the run; the KPI counts passing scenarios out of 8; scenarios run locally only, the harness tests run in CI); the harness uses a temporary `--home-dir`, never `~/.t3`, and sets no `VITE_HTTP_URL` / `VITE_WS_URL`; docs go in `probe/docs/`.
- The terminal moves out of the chat-thread drawer; today it is `ThreadTerminalDrawer` and `PersistentThreadTerminals` in `apps/web`, and `apps/server/src/terminal/Manager.ts` on the server (about 148 references to a thread id). Worktree creation is `apps/server/src/git/GitWorkflowService.ts` on top of `apps/server/src/vcs/GitVcsDriver`, already called outside chat from `ws.ts` and `mcp/WorktreeMcpService.ts`. Story 2's spike only records whether shells can outlive a server stop (A-14); building that is story 7.
- Storage detail (U-8): the worktrees folder of the Probe home (the existing T3 home) holds new worktrees; saved workspaces are one file per workspace in Probe's internal folder, the name parsed from the file name; the inner format is decided in the story 3 plan.

## Done when

- [ ] The scenario command shows S1 to S8 passing from a clean shell.
- [ ] No chat control or route is reachable in the browser app.
- [ ] The project docs describe the new screen and the scenario command.
