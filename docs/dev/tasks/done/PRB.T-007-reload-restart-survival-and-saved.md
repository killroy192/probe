---
id: PRB.T-007
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, plan, implement, verify]
created: 2026-11-02
updated: 2026-11-07
---

# Reload, restart survival and saved workspace layout

## Business Goal

**Problem:** A user who runs several agent shells cannot trust the app with them. Reloading the browser, or restarting the server, must not cost them their shells, their tabs or the output on screen, and a shell they deliberately ended must not come back. Today terminals live and die with the server process, and tab layout is a browser-local setting tied to chat threads, so nothing survives a server restart and a workspace cannot be reopened later.

**Proposed solution:** After this story, a browser reload keeps the tree, the shells, the open tabs and each shell's output history. Running shells survive a server restart as the same processes, with their scrollback. A workspace saves its layout to a file that "Open workspace" can reopen. Shells killed through Probe or exited cleanly stay gone, and a shell whose folder is gone is shown as unavailable with the reason and can be removed.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** #7 Reload, restart survival and saved layout
- **Delivers:**
  - FR-14: after a browser reload with the server running, tree, shells, open tabs and each reopened tab's full output history and scrollback are back (no number is promised; a restored shell is a new shell with no earlier history).
  - FR-15: the workspace layout (folders, worktrees, branches, shells, open tabs) is saved at every change that affects it; after a server restart, reopening shows the same layout with the same running processes, history and scrollback; a saved folder or worktree that was removed or moved shows a warning that it was not found, nothing is restored for it, shells already running keep working, and no new shell can be started in a missing folder.
  - FR-24 (part): which workspace is shown after a browser reload and its layout; the saved-workspace list itself persists from story 3 and is checked here only as regression.
  - FR-19: a shell killed through Probe, or that exits on its own in the normal way (any exit status), is removed and never restored, also after a restart. (Restoring unexpected ends is story 8, FR-17.)
  - FR-23: a shell in a not-found folder, or one shown as ended, can be removed from the tree and the saved layout with the kill action (the "x" in the tree). The epic gives FR-23 to this story and says "unavailable"; the "ended" state is a minimal placeholder (an ended shell is listed and removable, nothing more); the failed-restore state is created in story 8, whose scenario S8 checks removing it with the same action.
  - FR-22 (persisted part only): the last-used modal defaults are saved and restored; the modal itself is stories 4 and 5.
  - NFR-5: every action in this story is doable with mouse or touchpad.
  - NFR-7: docs updated in the same PR.
  - Builds A-14 (terminals survive a server restart and are reattached); sized from R-6. U-6 is decided by the epic (warn, restore nothing, same for moved and removed). U-7 (a Probe kill or any normal exit is removed; only a signal or lost owner is unexpected) is decided (SU-2).
- **One deployable outcome:** A user can reload the browser or restart the server and find the same running shells, tabs and scrollback, reopen a saved workspace by name, and be sure killed or cleanly exited shells stay gone; this makes the workspace trustworthy to leave running, which the epic goal ("running shells survive a restart") requires.

## Current Behavior

Read from the code after PRB.T-002 to PRB.T-006 (2026-11-06).

- **Shells** (`apps/server/src/terminal/Shells.ts`) are terminal-manager sessions owned by `shell:<id>`. They survive a browser reload, because the server owns them (PRB.T-002, A-6 verified). They do not survive the server: the manager's scope finalizer (`Manager.ts`, around line 2796) kills every PTY, and the PRB.T-002 spike found A-14 false (`docs/dev/research/t-002-standalone-shell-spike.md`).
- **Shell records** (title, folder, worktree) and the per-shell `probe kill` tokens are in-memory maps in `Shells`, so a restart loses them.
- **History** is a bounded buffer per session (5,000 lines, 8 MiB), written to `<state dir>/logs/terminals` with a debounce. An attach snapshot carries it, so a reopened tab shows it.
- **Ends:** an ended shell, whatever the reason, stays in the manager's list with its exit code or signal. The web tree hides it (`isActiveShell`), but its tab stays until the server forgets it. A kill (`shell.kill`) forgets the shell and its history.
- **Workspaces** (`apps/server/src/savedWorkspaces/SavedWorkspaces.ts`) are one JSON file each in `<state dir>/workspaces`, holding the projects (`folders`) and the last start (the "+" modal's defaults, FR-22). A missing project folder is shown with `exists: false` and cannot start shells. The file has no tabs.
- **Web:** the shown workspace and each workspace's tabs are in-memory atoms (`apps/web/src/state/workspaces.ts`), so a reload returns to the start screen.
- **Scenarios:** S4 has a comment for its reload part; S7 is pending. The harness has `server.restart()` (same home and port).
- **Mobile**: not touched (NFR-4 in the epic: desktop and mobile out of scope).

### Decisions (2026-11-06)

- **Survival (user, SA-1):** a shell host. One detached helper process per Probe server (per state folder) owns every shell's PTY. The server talks to it over a unix socket. Stopping the server detaches from it instead of killing shells, and the next start reattaches with the same processes and their output. Chat-thread terminals keep the in-process PTY and still end with the server. Windows has no host and keeps today's behavior.
- **Tabs (user):** the open tabs and the selected tab are saved in the workspace file. The shown workspace is remembered per browser.
- **Shell records:** shells stay server-level, as PRB.T-006 decided (they record no workspace). Their records are saved in `<state dir>/shells/registry.json`, not in workspace files.
- **Where shells run:** the host belongs to the server's state folder, never to a project or worktree. A shell in a project folder, a Probe-made worktree or a worktree made by hand anywhere on disk behaves the same, and "not found" checks only whether the saved path exists.
- **Moved folders (user, 2026-11-07, manual pass):** the "not found" warning of ER-1, AC-16, AC-22 and AC-29 reads "moved" on the project, the linked worktree and the shell. A shell still running there keeps running (AC-29 as written). A project whose folder is gone leaves the workspace once no shell is in it, so AC-17's removal of the last shell also removes the project.
- **End classification (SU-2):** a Probe kill or an exit without a signal (any status) removes the shell and its history, so its tab closes. A signal exit, or a shell the host no longer has after a restart ("lost"), stays listed as ended until it is removed with the "x".

## Expected Behavior

Once the work is complete:

- A browser reload with the server running restores the workspace list, the shown workspace, the workspace tree, every shell, the open tabs and the selected tab. Reopening a tab shows the shell's full output history, which the user can scroll; no number of lines is promised. A restored shell (story 8) is a new shell and has no earlier history.
- The server can be stopped and started again (the app closed and reopened) without ending running shells. After reopening the workspace, each shell that was running is the same process as before (same process identity), with its output history and scrollback, in the same folder, worktree and branch, and the same tabs are open.
- The workspace layout (folders, worktrees, branches, shells, open tabs, last-used modal defaults from FR-22) is saved at every change that affects the layout. The user can switch away from a workspace and reopen it with "Open workspace" by choosing its name in the list of saved workspaces (epic FR-24); the same layout comes back, and shells still running are shown again, not recreated. A removed workspace is deleted with its file, so it is not in the list and nothing of it can be reopened. The last-used modal defaults are stored per workspace.
- A shell killed through Probe (tree or kill command) or that exited on its own in the normal way (any exit status) is removed from the tree and the saved layout; it is not restored after reload, restart or reopen.
- A saved folder or worktree that was removed or moved when the workspace is reopened shows a warning that it was not found. Nothing is restored for it, shells already running keep working, and no new shell can be started in the missing folder. The user can remove its entries with the kill action (the "x" in the tree).
- The workspace list (the names of the saved workspace files) is intact after a restart and after a browser reload.
- A shell whose process is gone after a server restart or reboot (an unexpected end) is shown as ended in the tree and can be removed. This is an interim state only: story 8 replaces it with automatic restore in place (FR-17; PRB.T-008 AC-1, AC-3), and a shell whose process is still alive is reattached, never restored.

### User Flow

1. The user has two running shells with output on screen, a third shell they kill from the tree, a fourth shell with no running process whose folder they will delete (EC-12), and some tabs open.
2. The user reloads the browser. The tree, the two shells and the open tabs come back; reopening a tab shows the output history and scrollback.
3. The folder of the fourth shell is deleted on disk. The user closes the app and the server stops, then starts the server again and opens the app.
4. The user reopens the workspace from the "Workspaces" button. The saved layout is back, the two shells are the same running processes with output and scrollback, the same tabs are open, and the killed shell is gone.
5. The user switches to another workspace with the "Workspaces" button, then chooses the first workspace by name in the "Open workspace" dropdown and is switched back (epic FR-24) to the same layout with its shells still running.
6. The fourth shell shows a warning that its folder was not found. The user clicks the kill action (the "x" in the tree) on it and it leaves the tree and the saved layout.
7. All steps are done with mouse or touchpad.

### Edge Cases

- EC-1: A tab was closed (shell hidden, still running) before the reload or restart. After it, the shell is in the tree, running, and its tab stays closed.
- EC-2: A shell has produced a lot of output. After reload or restart the reopened tab shows all the output the shell keeps (the epic promises no number), scrollable, with no line lost or duplicated by the reload itself. The existing retention of the shell stays as it is; changing it is out of scope.
- EC-3: A shell is a plain shell with no mock agent running in it (agent exited, shell stays). It survives reload and restart exactly like any other running shell, with nothing removed or restored for the agent alone.
- EC-4: A shell exited on its own in the normal way (any exit status, for example `exit` typed, also after a failed command) before the restart. After the restart it is not in the tree and is not restored.
- EC-5: A shell's process ended by a signal, or is gone after a server restart or reboot. It is shown as ended in the tree and can be removed. Interim only: story 8 replaces it with automatic restore in place (FR-17; PRB.T-008 AC-1, AC-3). It is not removed as a normal exit.
- EC-6: Several workspaces exist; only the opened one's shells are shown. Shells of workspaces that are not open keep running, and the server reattaches to them at start; each workspace keeps its own layout after restart.
- EC-7: `exit` typed after a failed command (non-zero status) is a normal exit and is removed (a shell ended by a signal is EC-5). Decided (U-7, SU-2).
- EC-8: The selected tab and the last-used modal defaults (FR-22) are part of the saved layout and come back after reload and restart.
- EC-9: The shown workspace survives a browser reload; the list of saved workspaces already does (story 3, AC-20).
- EC-10: A saved folder was moved to another path or removed. Both are treated the same: warning that it was not found, nothing restored for it, no new shell can be started there.
- EC-11: A shell is running (its process alive) in a folder that is then removed or moved. The shell is reattached after a restart and keeps working; the folder shows the not-found warning and no new shell can be started there.
- EC-12: A shell with no running process (ended) whose folder is missing: shown as unavailable with the not-found warning; it can be removed; nothing is restored for it.
- EC-13: Output arrives while the reload is in progress. After the reload, the tab shows the history without losing or duplicating that output.
- EC-14: A killed shell's worktree created by the shell stays on disk (epic scope: killing never deletes a worktree), so after a restart the worktree is still in the picker (FR-5 behavior, from story 5).

### Error Handling

- ER-1: A saved folder or worktree is not found at reopen: a warning that it was not found is shown on it, no process is started for it, no new shell can be started in it, and nothing else in the workspace is blocked. Shells still running in it are unaffected (EC-11).
- ER-2: A saved workspace chosen in "Open workspace" has a file that is missing, unreadable or not valid: the user sees why and no workspace is created or changed.
- ER-3: A shell recorded as running whose process is gone after a server restart or reboot (or cannot be reached): it is shown as ended in the tree and can be removed with the kill action. Interim only: story 8 replaces this with automatic restore in place (PRB.T-008 AC-3).
- ER-4: The saved layout cannot be written (for example disk full or file not writable): the user sees that the layout is not being saved; running shells are unaffected.
- ER-5: Removing an unavailable shell with the kill action fails: the user sees why and the entry stays.

## Out Of Scope

- Restoring a shell whose process ended unexpectedly (signal, reboot) and resuming a mock agent: story 8 (FR-17, FR-18).
- "Failed to resume" and Retry, and removal of a failed-to-resume shell: story 8 (FR-20, and the failed-shell half of FR-23).
- Creating the workspace concept, the start screen, the "Workspaces" button and the choice of where workspace files are stored (Probe's internal folder, name from the file name) and the file's inner format: story 3 (U-8). This story relies on them.
- Standalone shells and the spike on how the terminal service is separated from chat threads: story 2 (U-1, A-14 spike).
- Starting, closing, killing and multi-shell UI: stories 4 to 6; this story reuses the kill action.
- Moving, healing or re-pointing a missing folder or worktree: not requested; an unavailable shell is only shown and removable.
- Sharing the saved workspace file between machines or users, and picking a file by hand: not requested.
- Desktop and mobile: not required (epic decision 2026-11-02).
- Deleting chat and thread-based terminal code: later remove-chat epic.

## Technical Scope

- **Layers:** server terminal service (shell lifecycle across server restarts, sized from R-6 and the story 2 spike); server persistence of history and of the workspace layout file; contracts for the shell state shown to clients (including unavailable state with a reason); web tree and tab state (layout persistence); the "Open workspace" reopen path; scenario coverage of the S4 reload part, S7, and the after-restart parts of S6 and S8 (the server stop and start in a scenario is provided by PRB.T-001, A-7). Areas only; the approach is a plan-stage decision.
- **Docs impact:** `probe/docs/` pages describing the terminal-first screen, restart behavior and the scenario command (NFR-7); any inherited T3 doc that says terminals end with the server or are tied to threads.
- **Mobile impact:** none required (epic: desktop and mobile out of scope); mobile code must not be changed to depend on this story.

## Non-functional Requirements and Constraints

- Binds from the epic: NFR-5 (pointer-only actions; scenarios drive the UI with pointer actions), NFR-7 (docs in the same PR), NFR-3 (scenarios use a throwaway data directory, never the real Probe data, never a remote server), NFR-4 (Playwright's headless Chromium).
- NFR-1 (no continuously repainting animation in the tree or terminal area) applies to any new reconnect or unavailable-state UI.
- Server logging per NFR-6 (shell start and end with id and cwd) must still hold for reattached shells; resume-attempt logging is story 8.
- Repo rules: tests wait on events, not sleeps (a server restart in a scenario is awaited on a concrete signal, see `AGENTS.md` in `../probe`); the harness does not set `VITE_HTTP_URL` or `VITE_WS_URL`.
- Reload and restart cost with a large full history is unmeasured; the plan stage must check it against the repo performance rule (SA-7).
- Layout data written to disk must not contain secrets (assumed, SA-4).

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a workspace with two running shells in different folders, each with distinct output, and one tab open, when the browser page is reloaded with the server running, then the tree shows both shells under their folder and worktree and the open tab is open again | auto | FR-14 |
| AC-2 | Given the state of AC-1, when the user reopens a shell's tab after the reload, then it shows the shell's full earlier output, scrollable, and typed input still reaches the shell | auto | FR-14 |
| AC-3 | Given a shell with output beyond one screen, when the page is reloaded and the tab reopened, then all the output the shell kept before the reload is there to scroll, none lost or duplicated by the reload | auto | FR-14, EC-2 |
| AC-4 | Given output arriving while the page reloads, when the tab is shown again, then every line appears once, in order | auto | FR-14, EC-13 |
| AC-5 | Given a running shell whose tab is closed, when the page is reloaded, then the shell is in the tree, running, and its tab is still closed | auto | FR-14, EC-1 |
| AC-6 | Given two running shells with output on screen and a recorded process id for each, when the server is stopped and started again and the workspace is reopened, then each shell is the same process (its process id is unchanged, not a new one) and still accepts input | auto | FR-15 |
| AC-7 | Given the state of AC-6, when the workspace is reopened, then each shell shows its earlier output and scrollback, sits in the same folder, worktree and branch, and the same tabs are open | auto | FR-15 |
| AC-8 | Given a shell with no agent running in it (agent exited, shell alive), when the server is restarted and the workspace reopened, then the shell is still listed and running | auto | FR-15, EC-3 |
| AC-9 | Given a workspace with a running shell and a second workspace, when the user switches to the second workspace and then chooses the first workspace by name in the "Open workspace" list, then the first workspace is shown again with the same layout (folders, worktrees, branches, shells, tabs) and the shell still running | auto | FR-15, FR-24 |
| AC-10 | Given several workspaces, one with a running shell, when the server is restarted, then the list is intact, each workspace opens with its own layout, only the opened one's shells are shown, and the shell of the other workspace is still running | auto | FR-15, EC-6 |
| AC-11 | Given a shell killed from the tree, when the page is reloaded, then it is not in the tree | auto | FR-19 |
| AC-12 | Given a shell killed from the tree, when the server is restarted and the workspace reopened, then the shell is not in the tree, is not running and is absent when the workspace is reopened from the list | auto | FR-19 |
| AC-13 | Given a shell killed by the kill command typed inside it, when the server is restarted and the workspace reopened, then the shell is not in the tree and is not running | auto | FR-19 |
| AC-14 | Given a shell where the user typed `exit` (once with status 0 and once after a failed command, non-zero status), when the server is restarted and the workspace reopened, then the shell is not in the tree and is not restored | auto | FR-19, EC-4 |
| AC-15 | Given a running shell whose process ended by a signal while the server was running, when the page is reloaded, then the shell is still listed, shown as ended, and not removed as a normal exit (interim: superseded by PRB.T-008 AC-1, which restores it) | auto | FR-19, EC-5 |
| AC-16 | Given a saved folder that was deleted before reopening and holding an ended shell, when the workspace is reopened, then a warning that the folder was not found is shown, the shell is shown as unavailable and not restored, no new shell can be started in that folder, and the rest of the workspace is usable | auto | FR-15, ER-1, EC-12 |
| AC-17 | Given the entry of AC-16, when the user clicks the kill action (the "x" in the tree) with the pointer, then it leaves the tree and the saved layout, and stays gone after another restart and reopen | auto | FR-23 |
| AC-18 | Given an unavailable shell, when the kill action fails, then the user sees why (fault injected by the test) and the entry stays | auto | FR-23, ER-5 |
| AC-19 | Given a workspace whose saved file was made unreadable after it was saved (the generic invalid-file case is owned by story 3), when the user chooses it in "Open workspace", then an error with the reason is shown and no workspace is created or changed | auto | FR-15, ER-2 |
| AC-20 | Given a shell recorded as running whose process is gone after a server restart or reboot, when the workspace is reopened, then the shell is shown as ended in the tree and can be removed with the kill action (the reboot is simulated by killing the shell's owner process; interim: superseded by PRB.T-008 AC-3, which restores it) | auto | FR-15, FR-23, ER-3 |
| AC-21 | Given the layout file cannot be written, when the layout changes, then the user sees that the layout is not being saved and running shells keep running | auto | FR-15, ER-4 |
| AC-22 | Given a saved folder that was moved to another path, when the workspace is reopened, then it behaves as in AC-16 (warning, nothing restored, no new shell there) | auto | FR-15, EC-10 |
| AC-23 | Given a worktree a killed shell had created, when the server is restarted, then the worktree is still on disk and is listed in the "+" modal's worktree picker (it has no active shell) | auto | FR-19, EC-14 |
| AC-24 | Given every flow above, when driven by the scenario harness, then every Probe UI action (reload, tab, tree, kill, open workspace, remove) is done with pointer actions only; typing into a shell is excluded | auto | NFR-5 |
| AC-25 | Given the restart scenario, when it runs, then it uses a throwaway data directory and a local server only | auto | NFR-3 |
| AC-26 | Given the PR for this story, when reviewed, then the docs under `probe/docs/` describe reload and restart behavior and the saved workspace files, and contain no statement that terminals end with the server | manual (author, in PR review) | NFR-7 |
| AC-27 | Given the unavailable-state UI, when reviewed, then it has no continuously repainting animation | manual (author, code review) | NFR-1 |
| AC-28 | Given `exit` typed after a failed command, and separately a shell ended by a signal, when the page is reloaded, then the first is removed and the second is not removed (it is shown as ended until story 8 restores it; PRB.T-008 AC-1 then supersedes this) | auto | FR-19, EC-7 |
| AC-29 | Given a shell with a live process in a folder that is then removed or moved, when the server is restarted and the workspace reopened, then the shell is reattached and still accepts input, the folder shows the not-found warning, and no new shell can be started there | auto | FR-15, EC-11 |
| AC-30 | Given a layout change (for example a shell started, a tab closed), when the change happens, then a reopen right after the change shows it | auto | FR-15 |
| AC-31 | Given a selected tab and the workspace's last-used modal defaults (stored per workspace), when the page is reloaded and when the server is restarted and the workspace reopened, then the selected tab and the modal defaults are the same | auto | FR-14, FR-15, FR-22, EC-8 |
| AC-32 | Given a shown workspace and a workspace list, when the page is reloaded, then the same workspace is shown (the list is checked as regression) | auto | FR-24, EC-9 |
| AC-33 | Given a removed workspace, when the user opens the "Open workspace" list, then it is not listed, its file is gone and nothing of its layout can be reopened | auto | FR-15, FR-24 |
| AC-34 | Given a reattached shell after a restart, when the server log is read, then it contains a start/end line with the shell id and cwd | auto | NFR-6 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-001 | Scenario harness, mock agent CLI and the server stop and start inside one scenario (A-7) | done (2026-11-03) |
| PRB.T-002 | Standalone shells and the spike result on reattaching terminals after a server restart (A-14, U-1) | backlog |
| PRB.T-003 | Workspaces, the start screen "Open workspace" and the decision on the saved file format and location (U-8) | backlog |
| PRB.T-004 | Starting a shell and its tree entry | backlog |
| PRB.T-005 | Worktree and branch levels in the tree that must be restored | backlog |
| PRB.T-006 | Close tab, kill from the tree and by command, multi-shell (the kill action reused here) | backlog |

## Assumptions

SU-2, SU-6 and SU-7 are decided (user, 2026-11-02); no AC is blocked on them.

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | A-14 holds: terminals can keep running while the server restarts and a new server can reattach (epic A-14, R-6) | assumption | false | The PRB.T-002 spike found shells die with the server. The user chose a shell host (Decisions above), which this story builds | author |
| SA-2 | A running shell survives a browser reload because the server owns it (epic A-6) | assumption | verified | PRB.T-002 spike and AC-5 | author |
| SA-3 | The harness can stop and restart the server inside one scenario (epic A-7), with `server.restart()` (same home and port) and `server.cli([...])` on the harness handle | assumption | verified | Proved by PRB.T-001 (AC-7); the S7 scenario replaces its `pending` entry in `scripts/scenarios/registry.ts` | author |
| SA-4 | The saved layout file contains no secrets (folder paths, shell ids, branches, tab state only) | assumption | verified | The workspace file adds only shell ids; the shell registry holds paths, pids and a SHA-256 hash of each `probe kill` token, never the token | author |
| SA-5 | The existing history persistence (per-session file in the logs directory) can serve as the source of reopened-tab history after a restart | assumption | false | Not needed: the shell host keeps each shell's output (8 MiB) and the next server adopts it as the history; the history file still serves an ended shell | author |
| SA-6 | The inner format of the workspace file is decided in story 3 (storage: one file per workspace in Probe's internal folder, epic U-8) and this story only extends what it stores | assumption | verified | Versioned JSON with optional fields (`SavedWorkspaces.ts`); this story adds `tabs` | author |
| SU-2 | U-7: how Probe tells an end that must be restored from one that must not. Decided: any normal shell exit (any status, also `exit` after a failed command) is intentional and removes the shell; only death by a signal or a lost owner process is unexpected | unknown | verified | Decided by the user 2026-11-02 | author |
| SA-7 | Delivering the full history on reload stays within the repo performance rule | assumption | verified | Taking over a shell with a full 8 MiB of kept output took 128 ms over the host socket (2026-11-06); the page then gets the same capped attach snapshot as before | author |
| SU-6 | What "Open workspace" brings back for a removed workspace. Decided: nothing; removal deletes the file and layout, so it is not in the list | unknown | verified | Decided by the user 2026-11-02 | author |
| SU-7 | How a workspace is picked in "Open workspace". Decided: by name in a scrollable list built from the files in Probe's internal folder; no file is picked | unknown | verified | Decided by the user 2026-11-02 | author |

## Implementation Status and Handoff

Done 2026-11-07 on `feat/restart-survival-prb-t-007` (stacked on `feat/shell-kill-prb-t-006`). Durable decisions are in `docs/dev/roadmap.md` ("PRB.E-001 restart survival"), usage in `docs/user/workspaces.md` ("Reloads and restarts"), the shell host in `docs/internals/terminal-runtime.md`, and stopping a dev checkout's host in `docs/operations/development.md`.

**Decisions** (see Current Behavior, Decisions)
- User: a shell host per state folder; tabs saved in the workspace file.
- Planning: shells stay server-level in `<state dir>/shells/registry.json`; the shown workspace is per browser (`localStorage`); a Probe kill or an exit without a signal removes a shell, a signal or a lost host keeps it listed as ended. An ended shell has no tab and can only be removed (its last output is PRB.T-008's). The `probe kill` endpoint moved to a file rewritten at each start, so a shell started before a restart still reaches the server.

**What was built**
- Server: `terminal/shellHost/` (protocol, the `__shell-host` process, the client and `ShellHost` service); `TerminalManager.adopt` and detach at shutdown for host processes; `Shells` registry, takeover at start ("shell reattached" log), end classification, kept-as-ended list entries, `missing` from the 2 s poll, token hashes. `workspace.saveTabs`.
- Contracts: `ShellSummary.ended` and `missing`, `ShellStorageError`, `WorkspaceDetail.tabs`, `workspace.saveTabs`.
- Web: tabs seeded from and saved to the workspace file, "The layout is not being saved" alert, the shown workspace restored after a reload, ended and "not found" marks in the tree with a remove action.
- Scenarios: S7 (`restart.ts`), S4's reload part; S1 to S3 and T-002 updated for reload restore and restart survival; each scenario stops its home's shell host.

**Verification (2026-11-06, author; no separate verify-agent report)**
- Checks: focused tests (shell host, `terminal`, `savedWorkspaces`, `cli`, `auth`: 331; contracts 195; client-runtime 696; web workspaces 17; React compiler check); `check:changed` passes format, lint, knip, tests and the React compiler check. Its parallel typecheck reported 4 of 33 packages failed with no diagnostics; server, evals, web, mobile, scripts and relay each typecheck clean on their own.
- AC-1 to AC-5, AC-11, AC-15, AC-28, AC-31 (reload), AC-32: S4.
- AC-6 to AC-10, AC-12 to AC-14, AC-16 to AC-23, AC-29 to AC-31, AC-33, AC-34: S7, each stage named after its ACs. AC-20 ends the shell host while the server is down; AC-18 and AC-21 make the shell registry and workspaces folders read-only; AC-19 makes the workspace file unreadable.
- Service level: `shellHost.test.ts` (reconnect, ends while disconnected, version, idle), `Manager.test.ts` (detach at shutdown, takeover, end classification, ER-5, token after restart), `SavedWorkspaces.test.ts` (tabs).
- AC-24, AC-25: S4 and S7 drive the UI by pointer and run on a throwaway home. AC-26: docs updated. AC-27: the marks are static text, no animation.
- The end mechanism PRB.T-008 builds on: `Shells` classifies each exit at the exit event (a Probe kill, or no signal, removes; a signal keeps it as `ended: "signal"`), and at startup a registry entry the shell host no longer has becomes `ended: "lost"` (`docs/internals/terminal-runtime.md`, "Shell host").

**Manual pass (user, 2026-11-06 to 2026-11-07, `vp run dev`): accepted.** All checks passed: A1 to A4, B1 to B4, C1 to C5, D1 to D3, E1 to E4, F1. G1 and G2 cannot fail on the dev container's Mac-mounted folder, which ignores permission bits; S7 covers them on a normal disk. Found and fixed on the way:
- The shell host died at start on that mount (`chmod` on a socket fails with EINVAL), and every shell start waited 5 s for it. It now uses a umask, logs a failed start to `shell-host-v1.log`, and the server stops waiting when the host exits.
- Tab saves could land out of order, so a reload could reopen a closed tab. Saves now go one at a time per workspace.
- Web terminals kept about one page of scrollback: libghostty-vt reads `max_scrollback` as bytes, not rows. It is now 20 MB. Android's `t3_terminal_jni.cpp` passes the same 10,000 and likely has the same bug (not changed; no native build here).
- The tree reordered shells and worktrees on reload (the manager lists by last update); shells now list in start order.
- After a reload: a focus ring flashed around the tab panel while the terminal loaded, and the start screen showed for a moment before the workspace came back. Both fixed.
- Selecting a shell from a tab or the tree now focuses its terminal. The dark terminal's scrollbar thumb is visible.
- Moved folders (decision above): a deleted project now shows "moved" without opening "+" (the page reads the workspace again on window focus and when the set of moved shells changes), a deleted linked worktree is marked, and a live shell in a deleted folder is no longer also "elsewhere".

**Left for later**: PRB.T-010 (terminal text duplicated in some shells) and PRB.T-011 (agent command echoed twice); `docs/dev/ideas/`: `event-driven-shell-tracking.md` (replace the 2 s poll with shell reports and file watches where a platform allows).

