---
id: PRB.T-016
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-08
---

# Choose a starting script in the Create shell modal

## Business Goal

**Problem:** Every shell started from a workspace runs one server-wide command, set by an environment variable at server start (the mock agent in dev and in the scenario harness). The modal's "Starting script" dropdown is disabled and shows "mock agent" only. A user cannot start a plain shell, or anything else, from the modal, and the harness cannot vary what it starts. Nothing else in the epic (Settings, workspace scripts, Claude Code in Probe shells) can be built until the choice is made per start.

**Proposed solution:** The user picks, for each start, Plain shell or one of their user scripts. The user list is kept on the default server (the server that serves the UI; user decision 2026-11-09), starts with "mock agent" in dev and the scenario harness, and survives reloads and restarts. The same list is offered for a workspace on any connected server (PRB.E-003), and the start runs on the workspace's server. With one server nothing differs for the user. The choice is remembered per project, and the scenario harness and dev runner stop using the environment variable. The story also settles where a program is looked up (U-1) and measures the plain-shell start time.

## Epic and Requirements

- **Epic:** PRB.E-002 Starting scripts: choose what a new shell runs
- **Candidate story:** # 1 Choose a starting script in the modal (first story of the epic)
- **Delivers:**
  - FR-1: a chosen script's command is typed once after the first prompt, in the chosen worktree, in the shell on the workspace's server; Plain shell types nothing.
  - FR-3: Plain shell first and fixed; the default server's state folder with NO saved user list gets "mock agent" where the default is enabled (dev and the scenario harness only, until U-2 is settled: SU-2). A saved list the user emptied is a saved list: it stays empty and is not seeded again.
  - FR-6: the dropdown is enabled, offers the list, and preselects the project's last choice, falling back to Plain shell when that script is no longer in the list or the project has none. The remembered choice follows a script by identity, not name (settled 2026-11-08), which matters once editing exists (PRB.T-018, PRB.T-020).
  - FR-12 (the not-in-the-list half only): a start naming a script that is not in the list at start time is refused with a message naming it. The removed or disabled by another client case is PRB.T-020.
  - FR-2 (the persistence half only): the user list is saved on the default server and survives a reload and a restart of it. Add, edit and remove from the UI are PRB.T-018.
  - NFR-1: the plain-shell click-to-prompt time is measured and checked against the 700 ms guardrail; no fixed wait is added before typing.
  - NFR-2: a damaged saved list never stops Probe starting and the modal still offers Plain shell (the "shown in Settings" half is PRB.T-018). The command is typed exactly once, only into its own shell.
  - NFR-3: logs carry the script name and program, never the full command line. Scripts are stored only in the default server's state folder and in workspace files.
  - NFR-4: zsh and bash, a second command line beyond the mock agent (A-1), the manual Claude Code check (A-2), mobile still compiles.
  - NFR-5: pick and start work with the pointer alone.
  - NFR-6: each shell start is logged, by the workspace's server, with the script name and program, or "plain".
  - NFR-7: docs updated in the same PR.
- **One deployable outcome:** A user opens the modal, chooses Plain shell or a script from their saved list (kept on the default server), and the shell starts accordingly in the chosen worktree on the workspace's server; the next start on that project preselects the same choice. This puts the per-start choice in place that every other story and phase 3 build on.

## Current Behavior

Verified by reading the code on 2026-11-08 (the code search index was unavailable).

- **Server configuration.** `PROBE_AGENT_COMMAND` is read in `apps/server/src/cli/config.ts` and carried as `agentCommand` in `apps/server/src/config.ts`. `apps/server/src/terminal/Shells.ts` builds its shell service once with that single command (`makeShells`, and the layer at the end of the file reads it from the server config).
- **Starting.** `workspace.startShell` (`WorkspaceStartShellInput` in `packages/contracts/src/workspace.ts`: workspace name, project, worktree choice, cols, rows) has no field for a script. The saved-workspaces service (`apps/server/src/savedWorkspaces/SavedWorkspaces.ts`, around line 816) always opens the shell with the agent flag set, so every start runs the server-wide command. Standalone shells opened without that flag type nothing.
- **Check and typing.** With the flag set, `Shells.open` first runs `agentProblem`/`findProgram`: the program is the first whitespace-separated word of the command (quotes stripped), looked up on the server process's own `PATH` (or a given search path). A miss fails the start with "The agent command was not found: <program>" and leaves no shell; an unset command fails with "No agent command is configured." Otherwise it starts the normal interactive shell and, in the background, waits for the prompt mark (`apps/server/src/terminal/shellReady.ts`, up to a timeout, then types anyway) and writes the command followed by a carriage return. Input for that shell waits until the command is typed. Aliases, functions and env assignments in the first word are not handled (an env assignment would be looked up as a program name).
- **Logging.** A start logs "shell started" with the shell id, cwd and, for a worktree, worktree and branch; it does not log the script or program.
- **Remembered start.** `WorkspaceLastStart` (`packages/contracts/src/workspace.ts`) holds the project and the worktree choice, with no script. It is saved with the workspace file by `rememberStart` in `SavedWorkspaces.ts`; older files are migrated on read.
- **Modal.** `apps/web/src/components/workspaces/StartShellDialog.tsx` renders the "Starting script" select disabled, with a constant `"mock agent"` as its only item. It does not send a script.
- **Harness and dev.** `scripts/scenarios/server.ts` sets `PROBE_AGENT_COMMAND` to the mock agent command, with a temporary `MOCK_AGENT_HOME`. `scripts/dev-runner.ts` (around line 342) sets the same variable to the mock agent unless the developer set one. `docs/internals/terminal-runtime.md` and `docs/internals/testing.md` describe the variable.
- **Scenarios.** `scripts/scenarios/scenarios/` has S1 to S8 from PRB.E-001 (including `plus-modal.ts`, `restart.ts`, `worktrees.ts`); S2 prints a start-to-banner time (mock agent banner, not a plain prompt) and does not enforce it.
- **One server.** Today the UI talks to one server and the user list, the workspace and the shell are all in that server. PRB.E-003 adds connections to other servers; this story must not assume that the workspace's server is the default server. How a start request for a workspace on another server gets the command is epic U-4 (cross-epic: E-003 U-7, SU-5 here); it does not gate this story.
- **User list.** No user-scripts store exists. Unverified: whether the default server's state folder already has a suitable place or format for a user-level list (see SA-2).
- **Mobile.** Verified 2026-11-08: no mobile source references `startShell` or `WorkspaceLastStart` (only a generated preview bundle does); the users are `apps/web/src/state/workspaces.ts`, `WorkspaceSidebar.tsx`, `worktreeChoice.ts` and `packages/client-runtime/src/state/workspaces.ts`. Whether mobile still compiles against the changed contracts is checked by `vp run check:changed` (SA-5).
- **Restore.** Verified 2026-11-08: `Shells.restore` (`Shells.ts`, around line 703) reopens the shell with only its saved folder and a fresh token. It never passes the agent flag, never types the command, and does not read the remembered start (`WorkspaceLastStart` is written only by `rememberStart` in `SavedWorkspaces.ts`, after a new start). Adding a script to the remembered start does not reach Restore (SA-6).
- **Remembered start saving.** Verified 2026-11-08: in `SavedWorkspaces.ts` (around line 840) a failed `rememberStart` is caught and logged as a warning, and the started shell is returned (SA-4). The remembered start already survives reload and server restart for the worktree choice (scenario `restart.ts`; SA-9).
- **Harness state.** `scripts/scenarios/server.ts` starts the server with a temporary home folder (`options.home`, with its `userdata` folder), so a file can be seeded there before start (SA-8).

## Expected Behavior

Plain shell and the user scripts are offered in the "Create shell" modal. The user's choice decides what the new shell does, per start, and replaces the server-wide command setting.

- **Plain shell:** an interactive shell opens in the chosen worktree at its prompt; nothing is typed.
- **A user script:** the same shell opens in the chosen worktree and the script's command is typed once, after the first prompt, then runs. When the command ends, the shell stays at its prompt (today's behavior, unchanged).
- **Servers (user decision 2026-11-09):** the user list belongs to the person, so it lives on the default server (the server that serves the UI), like the other settings about the person. The modal offers that list for a workspace on any connected server. The shell is opened, the command typed and the program checked on the workspace's server. In a single-server setup these are the same machine.
- **User list:** kept in the default server's state folder. A state folder with no saved list at all gets a list holding "mock agent" where the default is enabled (dev and the scenario harness enable it; any other start does not until U-2 is settled, SU-2), otherwise an empty list. A saved list that is empty is not "no list": it stays empty after a restart and is never seeded again. The list survives a reload and a server restart. In this story the list can be filled only by the defaults and by the harness seeding a file in its temporary state folder; editing from the UI is PRB.T-018.
- **Remembered choice:** the project's last successful start remembers its script, saved in the workspace file on the workspace's server beside the worktree choice; the modal preselects it. The choice follows a script by identity, not by name. If the script is no longer in the list, or the project has no remembered script, the modal preselects Plain shell (settled 2026-11-08).
- **Missing program:** the existing refusal behavior is kept for the chosen script (the program is named, no shell is left), and the check runs where the shell runs, on the workspace's server. Changing how the program is looked up, and the new messages (including naming the server), are PRB.T-017.
- **Script names (settled 2026-11-08, behavior for later stories to build on):** a script's name defaults to its command's program (the first word after any leading env assignments, whitespace trimmed) and the user can type another. Names and commands may repeat, also within one list. This story only needs the name for display, logs and the seeded entries.
- **Server-wide command:** the environment variable no longer decides what a shell runs. The scenario harness and dev runner seed their scripts in their state folder instead.
- **Logs:** each start logs, on the workspace's server, the script name and program, or "plain", never the full command line.
- **U-1 spike (output, not behavior):** a short written finding that settles which `PATH` decides "not found" and how an alias, function, env assignment or builtin first word is treated, so PRB.T-017 can be planned. This story does not change the lookup.
- **Guardrail:** the plain-shell click-to-prompt time is measured and reported.
- **Size (one story, kept):** the per-start choice, the persisted list, the remembered choice and the move off the environment variable are the shippable outcome. The U-1 spike (AC-15) and the Claude Code check (AC-14) are written or manual outputs by the author; neither blocks shipping the per-start choice. AC-15 must be done before PRB.T-017 is planned, and AC-14 before the epic closes. They stay in this story only because they use its result.

### User Flow

1. The user clicks the up-arrow button on a project; the "Create shell" modal opens (for a workspace of any connected server).
2. The Starting script dropdown is enabled. It lists Plain shell first, then the user scripts. The script of the project's last start in this workspace is preselected.
3. The user picks a script (or leaves the preselected one), chooses the worktree as before, and clicks Start.
4. The shell appears in the tree and opens in the chosen worktree. With Plain shell the prompt appears and nothing is typed. With a script, its command appears once after the first prompt and runs.
5. The next time the user opens the modal on that project, the same script is preselected. After a reload and a restart of the default server (and of the workspace's server), the list and the remembered choice are unchanged.

### Edge Cases

- EC-1: A new state folder, or one from before this epic, with NO saved user list: the list holds "mock agent" where the default is enabled (dev and the scenario harness), otherwise it is empty and the modal offers only Plain shell. A saved list that is empty (the user emptied it) is not "no list": it stays empty after a restart and is not seeded again.
- EC-2: The project has no remembered script (first start, or a workspace file saved before this story): the modal preselects Plain shell, and the existing remembered worktree choice is unaffected.
- EC-3: The remembered script is no longer in the list (the file was changed outside Probe): the modal preselects Plain shell, with no error.
- EC-4: A second, non-mock script (a plain command found on `PATH`) is in the list: it is typed once after the first prompt and runs like the mock agent (A-1).
- EC-5: The shell prints no prompt mark (a shell that is not zsh or bash): behavior is unchanged from today (the command is typed after the existing timeout); fish is PRB.T-012.
- EC-6: Two starts in different workspaces use the same user list; the remembered script is per workspace and project, not shared.
- EC-8: The workspace is on a second server (PRB.E-003). The modal offers the default server's list, not a list of that server, and a script started there runs on that server. A script whose program exists only on the default server is a missing program there (PRB.T-017).
- EC-7: The user list holds a script with an empty name written outside Probe: the story does not validate it (PRB.T-018); Probe still starts and the modal still offers every entry (the empty name is shown as the script's program). Repeated names or commands within or between lists are allowed (settled 2026-11-08) and are told apart by identity.

### Error Handling

- ER-1: The saved user list cannot be read (damaged file on the default server): Probe still starts, the modal offers Plain shell, the problem is logged; the file is not overwritten silently. Showing the problem in Settings is PRB.T-018.
- ER-2: The chosen script's program is not found: the start fails with the existing message naming the program, and no shell is left in the tree. The choice names a script that is not in the list at start time (for example the file changed outside Probe; FR-12): the start fails with a message naming the script, and no shell is left in the tree. The case of a script removed or disabled by another client meanwhile is PRB.T-020. (How "not found" is decided is PRB.T-017.)
- ER-3: Saving the remembered choice fails: the shell still starts and the failure is logged, as with the remembered worktree today (verified, SA-4).
- ER-4: A start request that names no script is treated as Plain shell, so older clients and the web client that is mid-reload do not fail. Plain shell is the default (settled 2026-11-08).

## Out Of Scope

- Add, edit and remove user scripts from the UI, validation of names and commands, and showing a damaged list in Settings: PRB.T-018.
- Naming a missing program with the new lookup rules, and keeping an exiting command's shell open as a tested requirement: PRB.T-017 (the current refusal and the shell staying at its prompt are kept as they are).
- Disabling user scripts and workspace scripts: PRB.T-019.
- A start refused because another client removed or disabled the script meanwhile (the rest of FR-12), with live updates: PRB.T-020. This story refuses only a script that is not in the list at start time (AC-10b).
- Changes after start (running shells untouched, the remembered choice falling back after an edit, Restore staying plain) and live updates to other clients: PRB.T-020. Restore is not touched here; it was checked to type nothing today (SA-6).
- Env vars and a folder per script, repository-kept scripts, separate script tabs, several user profiles, desktop and mobile UI, chat removal: as in the epic's Out list.
- fish prompt readiness: PRB.T-012.
- Changing the shell title ("Shell N · folder · program"): FR-9 belongs to PRB.T-020.

## Technical Scope

- **Layers:** server (shell start on the workspace's server, user-list storage in the default server's state folder, a start request whose shape stays open to both ways of getting the command to the workspace's server, startup of the harness and dev runner), contracts (the start request and the remembered start gain the script; a user-scripts shape), web (the Create shell modal's dropdown and its remembered choice), scenario harness and mock-agent seeding, and a written U-1 finding. No terminal rendering change.
- **Docs impact:** `docs/internals/terminal-runtime.md` (how the agent command is chosen and typed; the environment variable), `docs/internals/testing.md` (how the runner seeds the mock agent), and the dev setup text if it names the variable; the U-1 finding goes in `docs/internals/` if durable, otherwise in the ticket's handoff and `docs/dev/questions.md`. The first "Starting scripts" section in the user docs is TBD (author, 2026-11-15, at PRB.T-018, which ships the first user-visible management); this story updates any existing user-docs text about the modal only if there is some.
- **Mobile impact:** the contracts change, so mobile must still type-check; no mobile source uses the changed start request today (verified); no mobile UI.

## Non-functional Requirements and Constraints

- NFR-1: Plain shell click-to-prompt is measured and printed by the scenario on the author's machine. The 700 ms target applies only if the baseline is at or below it; if the baseline is above it, the author resets the target before PRB.T-017 starts (epic KPI, SU-3). No fixed wait is added before typing a script's command.
- NFR-2/NFR-3: a damaged list never blocks startup; scripts are stored only in the default server's state folder and in workspace files (on the workspace's server); logs never carry the full command; scenarios use a temporary state folder.
- NFR-4: zsh and bash only for typing after the prompt; headless Chromium for scenarios; the PRB.E-001 scenarios S1 to S8 still pass.
- NFR-5: the pick and the start work with the pointer alone.
- Repository rules: wire shapes are in `packages/contracts`; clients keep using the existing start command pattern; a server feature is a service method, not handler code (`AGENTS.md`); no UI animation that repaints continuously.
- Do not reuse T3's project scripts (`ProjectScript`, `t3.json` actions) for storage (epic Notes for stories).
- Do not assume the workspace's server is the default server. Keep the user list behind its own service; the plan keeps the start request shape open to both options for how the command reaches the workspace's server (carried by the request, or resolved there), because epic U-4 (cross-epic: E-003 U-7) is settled by PRB.E-003's story 2; the one-server behaviour must not depend on the answer.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a server on a fresh temporary state folder where the mock agent can run, when the user opens the modal on a project, then the Starting script dropdown is enabled and offers Plain shell first, then "mock agent" | auto | FR-3, FR-6, EC-1 |
| AC-2a | Given the modal, when the user picks Plain shell and starts, then a shell opens at its prompt in the chosen worktree and nothing is typed into it | auto | FR-1, NFR-5 |
| AC-2b | Given the plain-shell start of AC-2a, when the scenario runs, then the click-to-prompt time is printed; if the printed baseline is at or below 700 ms the scenario also asserts it is at most 700 ms, otherwise the author records the baseline and resets the target before PRB.T-017 | auto (print) / manual (author, reset) | NFR-1, SU-3 |
| AC-3 | Given the modal, when the user picks "mock agent" and starts, then the shell opens in the chosen worktree, the command appears once after the first prompt and the mock agent's banner shows | auto | FR-1, NFR-2, NFR-5 |
| AC-4 | Given a harness state folder seeded with a second script whose program is a plain command found on `PATH`, when the user starts it, then its output shows once after the first prompt in zsh, and the same holds in bash in the shell-ready tests | auto | FR-1, NFR-4, EC-4 |
| AC-5 | Given a project whose last start used a script, when the modal opens again, then that script is preselected; after a reload and a server restart it still is, and the user list is unchanged | auto | FR-2 (persistence), FR-6 |
| AC-6 | Given a project with no remembered script (a workspace file from before this story), when the modal opens, then Plain shell is preselected and the remembered worktree choice is unchanged | auto | FR-6, EC-2 |
| AC-7 | Given a remembered script that was removed from the saved list outside Probe, when the modal opens, then Plain shell is preselected and no error shows | auto | FR-6, EC-3 |
| AC-8 | Given a harness run started without the mock-agent default (the case of any install outside dev and the harness; SA-11) and a state folder with no saved list, when the modal opens, then it offers only Plain shell | auto | FR-3, EC-1 |
| AC-9 | Given a damaged saved user list, when the server starts and the modal opens, then Probe runs, the modal offers Plain shell, the problem is in the server log and the file is not overwritten | auto | NFR-2, ER-1 |
| AC-10 | Given a script whose program is not on `PATH`, when the user starts it, then the start fails naming the program and no shell is left in the tree | auto | ER-2 |
| AC-10b | Given a start request that names a script not in the list at start time, when the server handles it, then the start fails with a message naming the script and no shell is left in the tree. The removed or disabled by another client case is PRB.T-020 | auto | FR-12, ER-2 |
| AC-11 | Given a start request that names no script, when the server handles it, then a Plain shell starts | auto | ER-4 |
| AC-12 | Given a start of a script and of Plain shell, when the server log is read, then each start line carries the script name and program (or "plain") and no line contains the full command line | auto | NFR-3, NFR-6 |
| AC-13a | Given the environment variable that used to set the command, when it is set and a shell starts with Plain shell or a seeded script, then it has no effect | auto | FR-1 |
| AC-13b | Given the dev runner and the scenario harness, when they start, then they start without that variable | auto | FR-1, R-4 (epic) |
| AC-13c | Given the change, when `vp run test:scenarios` runs, then PRB.E-001 scenarios S1 to S8 pass | auto | R-4 (epic) |
| AC-14 | Given Claude Code in a seeded or locally added saved script, when the author starts it from the modal in a worktree, then its TUI takes input, resizes with the window and exits back to the prompt. Does not block shipping the per-start choice; done before the epic closes | manual (author) | NFR-4, A-2 |
| AC-15a | Given the U-1 spike, when it is done, then a written finding states which `PATH` decides "not found", tested in zsh and bash with the author's real startup files | manual (author) | U-1, FR-7 (gate) |
| AC-15b | Given the spike, when done, then the finding states how an alias as first word is treated, tested in zsh and bash | manual (author) | U-1, FR-7 (gate) |
| AC-15c | Given the spike, when done, then the finding states how a function as first word is treated, tested in zsh and bash | manual (author) | U-1, FR-7 (gate) |
| AC-15d | Given the spike, when done, then the finding states how a leading env assignment (`FOO=1 claude`) is treated, tested in zsh and bash | manual (author) | U-1, FR-7 (gate) |
| AC-15e | Given the spike, when done, then the finding states how a builtin as first word is treated, tested in zsh and bash. The whole finding (15a to 15e) is done before PRB.T-017 is planned and does not block shipping the per-start choice | manual (author) | U-1, FR-7 (gate) |
| AC-16 | Given the change, when `vp run check:changed` runs, then mobile and the other dependents of the contracts package type-check | auto | NFR-4 |
| AC-17 | Given the change, when the internals pages (`docs/internals/terminal-runtime.md`, `docs/internals/testing.md`) and any existing modal text in the docs are read, then they describe the per-start choice and no longer describe the environment variable as what decides a shell's command. The user-docs "Starting scripts" section lands with PRB.T-018 | manual (reviewer) | NFR-7 |
| AC-18 | Given the same user list and two workspaces, when each starts a shell with a different script on the same project name, then each workspace remembers its own script per project and the other is unchanged | auto | EC-6, FR-6 |
| AC-19 | Given saving the remembered choice fails, when a script is started, then the shell still starts and the failure is in the server log | auto | ER-3 |
| AC-20 | Given a shell that prints no prompt mark, when a script is started, then its command is typed once after the existing timeout, as today | auto | EC-5 |
| AC-21 | Given a saved list with an entry with an empty name, and a list with repeated names or commands within and between lists, when the server starts and the modal opens, then Probe runs and the modal offers every entry, told apart by identity; the entry with the empty name shows its program as the label | auto | EC-7 |
| AC-23 | Given a saved user list that is empty (the user emptied it), when the server restarts and the modal opens, then the list is still empty, "mock agent" is not added back and only Plain shell is offered; and a state folder with no saved list at all still gets the default where it is enabled | auto | FR-3, FR-2 (persistence), EC-1 |
| AC-22 | Given a script in the list whose name is then changed outside Probe while its identity is kept, when the modal opens, then it is still preselected for the project that remembered it | auto | FR-6 |
| AC-24 | Given the harness has a second server (PRB.E-003) and a workspace of it is open, when the user opens the modal, then it offers Plain shell and the default server's user list (the same entries as a workspace of the default server) | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story; PRB.E-003 adds and runs it) | FR-3, FR-6, EC-8 |
| AC-25 | Given the workspace of AC-24, when the user starts a script of the default server's list, then the shell opens in the chosen worktree on the second server, the command is typed there once after the first prompt, and the second server's log carries the script name and program | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story) | FR-1, NFR-6, EC-8 |

In the criteria above "the server" is the single server of a one-server setup (default server and workspace's server alike); AC-24 and AC-25 are the cases where they differ; they are verified by PRB.E-003 story 8, does not gate this story.

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.E-001 (closing) | The modal, the workspace file with its remembered start, Restore (PRB.T-008) and typing after the first prompt (PRB.T-011) | in progress; the pieces this story uses are already in the code |
| PRB.T-011 | Typing after the first prompt in zsh and bash | done |
| PRB.E-003 (not a blocker) | Carries the multi-server connection. This story works fully with one server; AC-24 and AC-25 are verified by PRB.E-003 story 8, does not gate this story (PRB.E-003 adds and runs them against its harness second server) | backlog |
| None other | This story is FIRST in PRB.E-002 | |

Stories that follow and depend on this one (not a dependency of this story):

- PRB.T-017 (a missing program is named): needs the per-start choice and the U-1 finding from this story.
- PRB.T-018 (manage user scripts in Settings): needs the persisted user list from this story.
- PRB.T-019 (disabling user scripts and workspace scripts): after PRB.T-018.
- PRB.T-020 (changes after start and live updates): after PRB.T-019.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | Typing after the first prompt works for any command line, not only the mock agent (epic A-1) | assumption | unverified | AC-4: seeded second script in a scenario, plus a second command in the zsh and bash shell-ready tests | author |
| SA-2 | The default server's state folder can hold the user list as its own file next to other saved state, without conflicting with the workspace files | assumption | unverified | Plan stage: look at the state folder's contents and how workspace files are written | author |
| SA-3 | The existing "program not found" check keeps working per start with the chosen command (epic A-5 for the final rule) | assumption | unverified | AC-10 | author |
| SA-4 | Saving the remembered start fails softly today (the shell still starts) and the same holds with a script in it | assumption | verified for today (2026-11-08: a failed `rememberStart` is caught and logged at `SavedWorkspaces.ts` around line 840); with a script in it checked by AC-19 | AC-19 | author |
| SA-5 | Mobile, desktop and other dependents compile against the changed contracts without edits beyond the contract | assumption | unverified (no mobile source uses the changed types, 2026-11-08) | AC-16 | author |
| SA-6 | Restore (PRB.T-008) reopens a plain shell today and does not type the agent command; the remembered script is not used by Restore | assumption | verified (2026-11-08: `Shells.restore` opens with only the saved folder, never the agent flag, and does not read the remembered start); epic FR-10 is tested in PRB.T-020 | none needed here | author |
| SA-7 | Claude Code typed into a ready Probe shell works like in a plain terminal (epic A-2) | assumption | unverified | AC-14 | author |
| SA-8 | The scenario harness can seed a user-list file in its temporary state folder before the server starts | assumption | verified as possible (2026-11-08: `scripts/scenarios/server.ts` takes a temporary `home` with a `userdata` folder; where the list file goes is the plan stage, SA-2) | AC-4 | author |
| SA-9 | The remembered start already survives a reload and a server restart for the worktree choice, so the script rides on the same mechanism | assumption | verified for the worktree choice (2026-11-08: saved with the workspace file; scenario `restart.ts`); with a script by AC-5 | AC-5 | author |
| SA-10 | A script can be given an identity that survives a rename and is not its name, so the remembered choice follows it (settled behavior, 2026-11-08) | assumption | unverified | Plan stage; AC-22 | author |
| SA-11 | The harness can start a server without the mock-agent default, so the no-default case can be tested (the real rule for other installs is SU-2) | assumption | unverified | Plan stage; AC-8 | author |
| SU-1 | Which `PATH` decides "not found" (the server's or the shell's after startup files), and how aliases, functions, env assignments and builtins are treated (epic U-1) | unknown | unverified | AC-15a to AC-15e, the spike in this story; owner decides before PRB.T-017 is planned | author |
| SU-2 | Whether "mock agent" can be a default user script outside the repository, or only in dev and the harness (epic U-2) | unknown | unverified | Plan stage; until then the default is dev and harness only | author |
| SU-3 | The plain-shell click-to-prompt time today, and whether it is within 700 ms (epic U-3) | unknown | unverified | AC-2b: measured before any change in this story; 700 ms applies only if the baseline is at or below it, otherwise the author resets the target before PRB.T-017 | author |
| SU-4 | Whether a workspace file with the remembered script written by this story must stay readable by older servers (a downgrade) | unknown | unverified | TBD (author, 2026-11-15); Probe has no released versions yet, so recommendation is no | author |
| SU-5 | How a start for a workspace on another server gets the command (carried by the request, or resolved from the default server) and so how a script "not in the list at start time" (AC-10b) is judged there (epic U-4, cross-epic: E-003 U-7) | unknown | unverified | Settled by PRB.E-003 story 2; AC-24 and AC-25 follow its answer and are verified by PRB.E-003 story 8. Not a gate for this story | PRB.E-003 story 2, 2026-11-15 |
