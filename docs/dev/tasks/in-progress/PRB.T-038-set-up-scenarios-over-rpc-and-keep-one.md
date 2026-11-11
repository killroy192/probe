---
id: PRB.T-038
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-11
---

# Shared e2e library: direct setup over the API, one real UI path per action, waits and debug logging

## Business Goal

**Problem:** Most scenarios spend their time building a world by clicking: create a workspace from the Workspaces menu, add each project through the dialog, start each shell through the "+" modal (about eight round trips per shell by the desk analysis), then type `exit` into the mock agent before the shell can be used. None of that is what S4 to S8 or the E2 scenarios test, and every click is a chance for a flake. The helpers are spread over five modules, one of them inside the scenarios folder, and scenario files still define their own copies of shared helpers, so the next scenario (and PRB.T-039's atomic ones) would copy them again. When a scenario fails, the artifacts hold an info-level server log and nothing from the browser, so the cause often needs a rerun, which the epic forbids.

**Proposed solution:** One shared e2e library that every scenario and the sandbox use. It sets up workspaces, projects and shells directly through the server API, keeps one real pointer path per action family in the scenario that owns it, offers the waits (an event raced against one named deadline) and the logging helpers, and returns what it built so later scenarios can be composed from atomic ones. Scenario servers log at debug level, and a failure's artifacts carry that log and the browser console.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 4 PRB.T-038 Shared e2e library: direct setup over the API, one real UI path per action, waits and debug logging
- **Delivers:**
  - FR-10: scenarios whose subject is not the dialog create workspaces, projects and shells directly through the server API; one real UI path per action family stays (add project, "+" modal, kill with confirmation, Restore, Workspaces menu), with the before/after round-trip and time table of the epic's FR-10 row.
  - FR-20: scenario servers run at debug log level; the failure artifacts include the server's debug log and the browser console; product code may gain debug-level lines a scenario needs, off at the production default.
  - FR-21: one shared e2e library holds every reusable setup, step, wait, fixture and logging helper; a scenario file holds only its own steps and assertions.
  - NFR-7 (library half): no duplicate helpers across scenario files.
  - NFR-3 (the part this story touches): no debug line added to product code, and nothing the library logs, prints a token, pairing URL or cookie.
  - Epic assumption A-7 is tested here (round trips and times before and after).
- **Touched, not delivered:** FR-12 only through the epic's switch rule (whichever of PRB.T-038, PRB.T-039 and PRB.T-041 lands last switches the library's waits to the signals); FR-15 only by keeping the rules file current (PRB.T-042 owns it).
- **One deployable outcome:** After this ships, every scenario builds its world from the one library in a few API calls, the dialogs are still exercised by the scenarios that own them, and a failure's artifacts carry the debug server log and the browser console; the suite is faster, no less covering, and ready for PRB.T-039 to split it into atomic, composable scenarios.

## Current Behavior

Verified by reading files on 2026-11-10 (the `cocoindex-code` MCP was not available; searched with grep). Nothing was run. PRB.T-036's code is merged; PRB.T-042 has since merged (done); PRB.T-037 is not built yet.

- **Where helpers live today (five modules, one inside the scenarios folder).**
  - `scripts/scenarios/support.ts`: `check`, `recorder` (frame and value waits with `until` and `nothingSince`), `alive`, `gone`, `follow`, `pageFrames`.
  - `scripts/scenarios/fixtures.ts` (PRB.T-036's fixtures module): `projects` (a git repo with a linked worktree and a plain folder), `setUp` (creates the workspace "sparta" by the UI and adds projects by the dialog), `restartAndReload`, `withClient`, `seedWorkspace` (workspace and one project over the API, used by R1), `unlessRoot`, `metric`, `expectLogged`, `logEntries`, `serverPromptMs`, `shellOutput`, `agentTypedOnceAfterPrompt`, `MOCK_AGENT_LINES`.
  - `scripts/scenarios/scenarios/workspaceUi.ts`: about 50 pointer and API helpers (`createWorkspace`, `addProject`, `openModal`, `startIn`, `startShell`, `shellList`, `history`, `typeLine`, `openFromTree`, `closeTab`, `askToKill`, `answerConfirm`, `killFromTree`, `allGone`, `reloadShowing`, `openWorkspace`, `gitOk`, `agentReady`, `leaveAgent`, the starting-scripts file helpers). It sits in the scenarios folder, and `fixtures.ts:13` imports from it.
  - `scripts/scenarios/rpc.ts` (`connectRpc`, `environmentId`) and `scripts/scenarios/seam.ts` (`issueBearerToken`).
- **Helpers still defined in scenario files, or duplicated** (grep, 2026-11-10):
  - The shell-list follower: `standalone-shell.ts:32-39` writes its own `subscribeShells` follower; `workspaceUi.ts:241` `shellList` is the same thing.
  - The prompt mark and OSC stripping: `starting-scripts.ts:47-49` (`PROMPT_MARK`, `withoutOsc`) and `fixtures.ts:182-183` (`PROMPT_MARK`, `OSC`).
  - The mock agent banner literal `Mock Agent v1`: `plus-modal.ts:151,255`, `worktrees.ts:291`, `workspaceUi.ts:440,457`, beside `MOCK_AGENT_LINES` in `fixtures.ts:217`.
  - "Is this shell running": `close-tab.ts:38` (`running`) and `restart.ts:468` (`isRunning`).
  - The Workspaces menu and create dialog: `boot.ts:28` (`workspacesMenu`) beside `workspaceUi.ts:384` (`openWorkspace`) and the menu clicks inside `createWorkspace` (`workspaceUi.ts:287`); S3 fills the start screen's create dialog inline (`worktrees.ts:124-127`).
  - "The page shows workspace X": `restart.ts:56` (`shown`), `boot.ts:17` (`shownWorkspace`), and the same wait inside `createWorkspace` and `reloadShowing` (`workspaceUi.ts:291,380`).
  - Tab reads: `restart.ts:43-54` (`openTabs`, `selectedTab`) beside `workspaceUi.ts:63,315` (`tabs`, `shellTab`).
  - Modal start and script selection: `starting-scripts.ts:53,59` (`selectedScriptKey`, `startModal`) beside `workspaceUi.ts:94,215` (`selectedScript`, `startFromModal`).
  - Agent waits: `agentReady` and `leaveAgent` (`workspaceUi.ts:433-464`) each attach and wait for the banner.
  - Single-use helpers another scenario could use: `restoreButton` and `restoreFromTree` (`restore-shell.ts:29-37`), `lastStartOf` (`restart.ts:62`), `listNames`, `projectPaths`, `runtimePid` (`second-server.ts:24-43`), `openShell` (`standalone-shell.ts:14`), `pidsRunning` (`kill-shell.ts:34`), `expectOnlyPlain` (`starting-scripts.ts:334`).
  - The same preamble in S4 to S8: make a folder in the home, `openPage`, `setViewportSize` (9 scenario files plus `fixtures.ts:30`), `pageFrames`, `connectRpc`, `shellList`, `createWorkspace`, `addProject` (for example `close-tab.ts:31-48`).
  - The stage label: every long scenario keeps its own `let stage` and a catch that prefixes it (10 files, for example `close-tab.ts:42,117`).
  - Tokens minted twice: R1 issues the second server's bearer token (`second-server.ts:71`) and `saveServerInBrowser` issues another for the same server (`seam.ts:40`), one CLI start each (the analysis's "R1 tokens minted twice").
  - Fixed names: the workspace name `"sparta"` is written in `fixtures.ts` and in 8 scenario files, so two setups on one server would collide.
- **UI setup that is not the subject.** By call sites of `startShell(` (runtime counts may be higher in loops): S4 `many-shells.ts` 6, S5 `close-tab.ts` 2, S6 `kill-shell.ts` 9, S7 `restart.ts` 11, S8 `restore-shell.ts` 5, each after `createWorkspace` and `addProject` by the UI; `leaveAgent` is called in S3 to S8. E2-S1, E2-S3 and E2-S4 (`starting-scripts.ts:79,179,363`) create the workspace and add projects by the UI through `setUp`.
- **Where the UI is the subject.** S1 creates and refuses workspaces by the menu and dialog (`boot.ts`). S2 adds projects by the dialog and starts from the "+" modal, including the terminal size (`plus-modal.ts`). S3 is the worktree choices in the modal (`worktrees.ts`), and its stage AC-29 imports a linked worktree through the Add project dialog and waits for its notice (`worktrees.ts:131-136`). S6 kills from the tree with a confirmation (`askToKill`, `answerConfirm`). S8 clicks Restore (`restore-shell.ts:33`). S7 opens and removes workspaces by the Workspaces menu (`restart.ts:207,396-414,440`) and checks the modal's remembered choice (stage AC-31, `restart.ts:267`). E2-S1, E2-S3 and E2-S4 drive the modal's starting-script dropdown and its starts.
- **What already uses the API.** R1 seeds workspaces and projects with `seedWorkspace` (`second-server.ts:70-77`); the `restart-persistence` self-test creates a workspace over the API; T-002 opens a standalone shell with `shell.open`; S2, S3 and T-002 kill with `shell.kill`.
- **Starting a shell over the API.** The "+" modal itself calls `workspace.startShell` (`apps/web/src/state/workspaces.ts:399-413`), so an API start runs the same server method. `WorkspaceStartShellInput` (`packages/contracts/src/workspace.ts:159-168`) takes the workspace, project, an optional worktree, an optional script ("Absent for a plain shell") and a size. The server starts no script when none is given and saves the project's last start for every start (`apps/server/src/savedWorkspaces/SavedWorkspaces.ts:839-885`). The page adds a tab, and updates its own copy of the last starts, only for a shell it started itself (`workspaces.ts:414-430`); a shell started over the API gets no tab. Whether its tree row shows in a page already showing the workspace was not run (SA-3).
- **Waits.** `recorder().until` (`support.ts:42-61`) and `server.logged` (`server.ts:278-292`) subscribe to values and race a deadline that fails with "Timed out waiting for <what>". The deadlines are three separate 10 s constants (`support.ts:12`, `server.ts:22`, the page action timeout `run.ts:40`), and Playwright's own `waitFor` failures name a locator, not what the scenario awaited. `gone()` (`support.ts:109-116`) polls a pid for up to 5 s; PRB.T-041 replaces it where the shell list reports the pid, and S6's background jobs keep a bounded loop (PRB.T-042 SA-6).
- **Logging and artifacts.** Scenario servers start with `--log-level info` (`server.ts:227-228`) into a 4 MiB in-memory buffer (`server.ts:17,236`). A failure saves `error.txt`, a screenshot per page, the last 200 log lines per server (`run.ts:41,112-158`) and `recorders.json`, under the OS temp folder (`environment.ts:83-87`). Nothing listens to the browser console (no `console` or `pageerror` listener in `scripts/scenarios`). The server's level defaults to Info (`apps/server/src/cli/config.ts:97`, epic A-12, verified). The web app has no log level of its own (grep of `apps/web/src` for `logLevel`, `LogLevel`, `console.debug`, 2026-11-10: none).
- **Timing.** The per-scenario "before" round-trip count is a desk count from the code (orchestrator, 2026-11-10, `main` at `f24dbcdf8`, not run); it and the FR-10 threshold are in the Handoff. PRB.T-036's baseline times (its AC-21) were recorded on 2026-11-10 and are in PRB.T-036's Delivered section.
- **Mobile and desktop.** Nothing here touches either.

## Expected Behavior

Setup that is not the subject goes over the API; the subject still happens by the pointer. A scenario reads as its own steps and assertions on top of the library, and the dialogs are exercised by the scenarios that own them.

- **The library.** One library, separate from the scenario files, holds every reusable setup, UI step, wait, fixture and logging helper. Each duplicate listed in Current Behavior exists once in it. The sandbox's named fixtures (PRB.T-037) are built from the same setup, not a second copy. A scenario file defines no helper another scenario could use.
- **Coverage map: who keeps which UI path** (one real UI path per action family):
  - Create workspace by the Workspaces menu and by the start screen's button: S1.
  - Add project (import, create new folder, refusals): S2.
  - Import a linked worktree through the Add project dialog, and its notice: S3 (stage AC-29).
  - Start from the "+" modal, including worktree choices, the double click and the terminal-size stage (S2 AC-6): S2 and S3.
  - Starting-script dropdown and starts through it: E2-S1, E2-S3, E2-S4, plus S2's agent stages.
  - The modal's remembered choice: every start in S3 stays a modal start, and in S7 the last start in its workspace before the restart that stage AC-31 compares against (`restart.ts:216,267-271`).
  - Kill from the tree with a confirmation, and cancel: S6.
  - Restore on an ended shell: S8.
  - Open and remove a workspace by the Workspaces menu: S7 (S6's own workspace removal by the menu stays as a subject step).
  - Remove a project by its row's hover action and a confirmation: S6 (`kill-shell.ts:206-222`).
  - Close a tab: S5, and S4 and S7 where closing is part of their subject.
- **Everything else** creates its workspace, adds its projects and starts its shells over the API, then brings the page to the workspace the way a user would and opens tabs from the tree by a click.
- **Plain shells.** A scenario that needs a plain shell starts one with no starting script and does not leave a mock agent first. It does not type into it before the shell has shown its first prompt.
- **Waits.** Every library wait subscribes to an event (a frame, a shell-list change, a log entry, a page state) and races it against a deadline from one place in the library; a missed event fails with a message that names what was awaited and the deadline. A time-based check loop stays only where no event exists, with the missing event named next to it, or where the signals switch rule below leaves a wait for PRB.T-041, with a PRB.T-042 temporary suppression that names PRB.T-041. No fixed sleep. A scenario file sets no deadline of its own.
- **Signals switch rule.** If PRB.T-041 has landed when this story lands, the library's typing, reload and process-end waits use its signals in this story. If not, they keep today's waits, and whichever of PRB.T-039 and PRB.T-041 lands last switches them (epic, Stories).
- **Logging.** Every server the harness starts runs at debug level: a scenario's server, a second server, and the sandbox's server. A failure's artifacts carry the server's debug log lines from the failing stage's start to the failure, for each server the scenario started, and the browser console of every page it opened. The library records what each setup call asked for and what it got back (workspace names, project paths, shell ids and pids) where the artifacts include it. Product code may gain debug lines a scenario needs; none prints at the production default level.
- **What the library offers PRB.T-043 and PRB.T-039** (so atomic scenarios can be composed; the composition shape is PRB.T-043's, the conversion PRB.T-039's):
  - **Needs, stated as inputs.** Each setup helper builds one precondition from what it is given (the server, a page, or an earlier helper's result) and nothing else. It never reads what another scenario left, and no state carries between scenarios through the library.
  - **Results, as values.** Each helper returns what it created (workspace name, project paths and kinds, worktree paths, shell ids and pids, the page showing the workspace, the shell-list and frame followers), so a composed scenario passes one step's result to the next.
  - **No collisions.** Names and folders are unique per call; the library never assumes an empty server. A scenario that needs a pristine server says so through PRB.T-037's declaration and does not get it from the library.
  - **Same on every server.** The helpers work the same against the runner's server and a live sandbox.
  - **What a scenario leaves.** Everything a setup created stays on the server until that server is torn down. The library offers the remove steps (kill a shell, remove a project or workspace) over the API and, for the owning scenarios, by the UI. It does not clean up on its own; whether a scenario must remove its state on a shared server is PRB.T-039's and PRB.T-040's call.
- **Measurement.** At its start this story counts the setup round trips per scenario (FR-10's "before"), and the epic owner sets the threshold from that count. After the change it records the same count and the per-scenario times, before and after, in this ticket's handoff. Times are recorded, never gated.

### User Flow

1. The developer or an agent runs the suite, or one scenario with `--only <id>`.
2. A scenario that is not about a dialog builds its workspace, projects and shells in a few library calls over the API, and brings the page to the workspace.
3. It drives the behavior it is about with the pointer.
4. The scenarios that own a dialog (coverage map) still click through it; when that dialog breaks, one of them fails and names its stage.
5. A scenario fails. Its first run's artifacts hold the debug server log of the failing stage, the browser console, a screenshot, the recorder values and what the setup created, so the developer finds the cause without a rerun.
6. An agent writing a new scenario finds in the rules file where the library is, what it offers and the coverage map, and uses it instead of writing a helper.

### Edge Cases

- **EC-1** A shell started over the API gets no tab of its own (the page adds tabs only for shells it started). A scenario that needs a tab opens it from the tree by a click.
- **EC-2** The server saves the last start for API starts too, but a page already showing the workspace updates its copy only for its own starts. Stages that assert the modal's remembered choice start the shell they check through the modal, so the check is never satisfied by setup that skipped the user's path.
- **EC-3** The page before setup shows the start screen or a remembered workspace: bringing it to the workspace works from either (SA-8).
- **EC-4** S1 needs an empty server (no workspace yet, refusals; PRB.T-037 declares it pristine). S2 needs only a workspace with no project yet, and the dialog is its subject: both keep their UI-built world.
- **EC-5** Scenarios that test the mock agent (S2's agent stages, E2-S1, E2-S3) still start it through the modal and wait for its banner.
- **EC-6** Terminal size: an API start passes a size; the stage that asserts the grid size (S2 AC-6) keeps its modal start.
- **EC-7** The same setup runs twice on one server (a sandbox, a composed scenario): both succeed with distinct names and folders.
- **EC-8** A long scenario at debug level produces more log output than the artifact can hold: the failing stage's lines are still in it.
- **EC-9** Several pages, an anonymous page, or a second server: the console of each page and the debug log of each server are in the artifacts, each labelled.
- **EC-10** A scenario restarts the server after API setup (S7): its shells and workspaces survive as they did after UI setup, since the modal uses the same server method.
- **EC-11** A wait with no event to subscribe to (S6's background jobs ending): it stays a bounded check loop that names the missing event (PRB.T-042 EC-6 class (c)).
- **EC-12** PRB.T-041 lands before or after this story: the switch rule decides who moves the waits to the signals.

### Error Handling

- **ER-1** An API setup call fails: the scenario fails in a setup stage whose message names the call (workspace, project, shell) and the server's reason, not later with a missing-element timeout.
- **ER-2** The page does not reach the workspace after API setup: the failure says which workspace was not shown, with the usual artifacts.
- **ER-3** A UI path is broken: the scenario that owns it in the coverage map fails and names its stage; scenarios that set up over the API do not hide it and are not the ones expected to report it.
- **ER-4** Saving the browser console or the debug log fails (closed page, unwritable folder): the original scenario error is still the one reported, with a note that the piece is missing (as PRB.T-036 ER-4).
- **ER-5** A wait passes its deadline: the failure names what was awaited, from which offset where it has one, and the deadline.

## Out Of Scope

- The check and perf kinds, `.perf.ts`, composed scenarios, named sets, the cap gate (FR-22) and the deliberate-failure self-tests of FR-19: PRB.T-043. Splitting scenarios into atomic ones: PRB.T-039. This story converts the setup of today's scenarios in place and offers the library interface above; it does not split anything or run the cap gate.
- Cleaning up a scenario's state on a shared server, assertions scoped to a workspace, ports (FR-14): PRB.T-039 and PRB.T-040.
- The prompt-ready, layout-saved and process-end signals: PRB.T-041 (this story only follows the switch rule).
- The sandbox command, its refusals and the A-4 check: PRB.T-037.
- The runner, traces, parallel workers and the serial perf run: PRB.T-040.
- Info-level product logging (epic Out) and product performance budgets.
- Changing what any scenario proves; the epic's must-not-change list holds.
- S1's repeated chat URLs (an analysis small item): scenario content, not setup; PRB.T-039 (its AC-31). R1's duplicate tokens are in scope here (AC-11).
- New scenarios for unbuilt features; mobile and desktop.

## Technical Scope

- **Layers:** the scenario harness (`scripts/scenarios`: the library, scenario setup, the server handle's log level, failure artifacts, self-tests); the typed RPC client it already has. Product code only for debug-level log lines a scenario needs (server; the web side only once SU-1 is settled). No contract change is planned; if API setup needs one to be observable, stop and raise it with the epic owner.
- **Docs impact:** the e2e rules file PRB.T-042 creates in `.agents/rules/`: where the library is and what it offers (setup, steps, waits, logging, the interface for composition), the coverage map and the rule that a new scenario sets up over the API unless the UI path is its subject, the waiting rule as the library implements it, and the debug log and browser console in the artifacts. The interim instructions PRB.T-042 wrote for FR-10, FR-20 and FR-21 are replaced, not appended to. No other doc restates any of it (`docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md are not edited for scenario rules).
- **Mobile impact:** none; no contract change expected.

## Non-functional Requirements and Constraints

- The repo test rules hold in the library and the scenarios: no sleeps, polling loops, wall-clock deltas, per-test timeout arguments or retries; the lint rules PRB.T-042 widens to scenario files pass, and each suppression keeps its PRB.T-042 class and reason.
- Pointer-only input in every scenario that drives the UI (mouse-first rule).
- Real PTYs, git worktrees and websockets stay: setup talks to the real server and mocks nothing.
- The throwaway-home guard, the clean child environment and cleanup by captured PID are unchanged (NFR-3).
- Nothing the library logs, and no product debug line, prints a token, pairing URL or cookie (NFR-3). Artifacts stay under the OS temp folder, never in the repo.
- Product debug lines stay below the production default level (`T3CODE_LOG_LEVEL`, default Info).
- One run, no reruns: each time measurement is one run on unchanged code (epic FR-19); the before and after runs are of different code. AC-22's after counts and times are read from AC-25's one suite run, and every `auto` criterion is checked by that run, the one `--selftest` run or `vp run check:changed`, except AC-12's one sandbox run.
- The library has no knowledge of a particular scenario; it does not import from scenario files.

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given S3, S4, S5, S6, S7, S8, E2-S1, E2-S3 and E2-S4 after the change, when read against the coverage map, then none creates a workspace by the UI, none adds a project by the dialog except S3's stage AC-29, and the only "+" modal starts left are the ones the map assigns to them | manual (developer, diff review against the map) | FR-10 |
| AC-2  | Given the coverage map, when the suite runs, then each owner drives its UI path and passes (S1 creates by the menu; S2 adds by the dialog and starts from the modal, including the grid-size stage S2 AC-6; S3 imports a linked worktree by the dialog (AC-29) and starts with worktree choices; S6 kills with a confirmation and cancels; S8 clicks Restore; S7 opens and removes by the menu; E2-S1, E2-S3, E2-S4 start through the script dropdown) | auto (suite) and manual (review of each owning stage against the map) | FR-10, ER-3, EC-6, R-2 (epic) |
| AC-3  | Given a scenario that needs a plain shell, when it runs, then the shell is started over the API with no starting script, the server types nothing into it, no mock agent is left first, and nothing is typed before the shell's first prompt has shown | auto | FR-10 |
| AC-4  | Given S2's agent stages, E2-S1 and E2-S3, when they run, then they start the mock agent through the modal and see its banner as before | auto | EC-5 |
| AC-5  | Given a shell started over the API, when the page shows the workspace, then the shell's row is in the tree, and the scenario opens its tab from the tree by a click | auto | EC-1 |
| AC-6  | Given S3 and S7's stage AC-31, when they run, then every shell S3 starts goes through the modal, and S7's last start in its workspace before the restart (the one AC-31 compares against) goes through the modal | auto | EC-2 |
| AC-7  | Given a workspace created over the API, when the library brings a page to it from the start screen and from another remembered workspace, then it shows in both cases | auto (harness self-test) | EC-3 |
| AC-8  | Given S1 and S2, when they run, then S1 starts from an empty server, S2 from a workspace with no project, and both build their world by the UI | auto | EC-4 |
| AC-9  | Given one server, when the same library setup runs twice, then both succeed and return distinct workspace names and folders, and neither reads the other's state | auto (harness self-test) | FR-21, EC-7 |
| AC-10 | Given the library, when its setup helpers are read, then each takes what it needs as inputs and returns what it created as a value (names, paths, shell ids and pids, page, followers), none keeps state that a later scenario reads, and the remove steps (kill a shell, remove a project or workspace) exist over the API | manual (developer review) | FR-21 |
| AC-11 | Given the scenario sources, when reviewed against the rules file, then each duplicate in Current Behavior is defined once, in the library, and R1 mints each server's bearer token once; no scenario file defines a helper another scenario uses or could use; the library imports nothing from scenario files; `vp run typecheck` and knip pass for `scripts` | manual (developer review) and auto (typecheck, knip) | FR-21, NFR-7 |
| AC-12 | Given the sandbox's named fixtures (PRB.T-037), when read, then they are built from the library's setup and not a second copy; and given one scenario accepted on the sandbox, when it runs once against a sandbox, then it builds its world with the same library calls as on the runner's server and passes | manual (developer review) and auto (the sandbox run) | FR-21 |
| AC-13 | Given the library's waits, when reviewed, then each subscribes to an event and races a deadline from one place; a check loop remains only where no event exists and names it, or where the switch rule leaves it for PRB.T-041 under a temporary suppression naming PRB.T-041; no fixed sleep remains; no scenario file passes its own deadline | manual (review: event subscription, one deadline source, named missing events) and auto (lint: no sleep, polling loop or clock read without a PRB.T-042 suppression, permanent with its class or temporary naming its story) | FR-21, EC-11 |
| AC-14 | Given a wait whose event never comes, when it fails, then the message names what was awaited, its offset where it has one, and the deadline | auto (harness self-test) | ER-5 |
| AC-15 | Given a setup call that fails on purpose (a project path that does not exist), when the scenario runs, then it fails in a setup stage naming the call and the server's reason | auto (harness self-test) | ER-1 |
| AC-16 | Given a page asked to show a workspace that does not exist, when the wait ends, then the failure says which workspace was not shown and the artifacts are saved | auto (harness self-test) | ER-2 |
| AC-17 | Given a deliberate failure on a scenario server, when the run ends, then the artifacts hold debug-level server lines from the failing stage and the console of every page opened, each labelled by server or page, including a second server and an anonymous page | auto (harness self-test) | FR-20, EC-9 |
| AC-18 | Given a failure after more log output than the artifact keeps, when the artifacts are read, then they still hold the server lines from the failing stage's start to the failure | auto (harness self-test) | FR-20, EC-8 |
| AC-19 | Given a server started with no log flag and no `T3CODE_LOG_LEVEL`, when it runs the code paths of every debug line this story adds, then it prints none of them; and no added line prints a token, pairing URL or cookie | auto (test) and manual (review of each added line) | FR-20, NFR-3 |
| AC-20 | Given the console or the debug log cannot be saved (a closed page, an unwritable folder), when a scenario fails, then its original error is reported with a note naming the missing piece | auto (harness self-test) | ER-4 |
| AC-21 | Given a deliberate failure after setup, when the artifacts are read, then they list what each setup call asked for and got back, and contain no token, pairing URL or cookie, except the Playwright traces, which are kept unmasked as the main debug aid and documented as never to be shared | auto (harness self-test) and manual (review) | FR-21, NFR-3 |
| AC-22 | Given the setup round trips counted at this story's start and the epic owner's threshold (set 2026-11-11, see Handoff), when the change is in, then a table in the handoff gives per scenario the round trips and times before and after, each time from one run with its method and machine, and the after counts meet the threshold; nothing fails on a time | manual (author, in the handoff; threshold by the epic owner) | FR-10, A-7 (epic) |
| AC-23 | Given whether PRB.T-041 has landed when this story lands, when the library is reviewed, then its typing, reload and process-end waits use the signals if it had, and otherwise the handoff names the story that switches them | manual (review) | EC-12, FR-12 (touched) |
| AC-24 | Given the rules file after this story, when read, then it says where the library is and what it offers (including the composition interface), gives the coverage map and the direct-setup rule, the waiting rule as implemented and the debug log and console in artifacts; the interim instructions for FR-10, FR-20 and FR-21 are gone; no other doc restates them | manual (docs review) | FR-15 (epic, kept current), NFR-7 |
| AC-25 | Given the change, when `vp run test:scenarios` runs once, `--selftest` runs once and `vp run check:changed` runs, then every scenario passes as before, the self-tests behave as before (T2 fails by design) and the new ones pass, S7 still proves restart survival with API-created state, and the `harness.test.ts` guard cases still pass | auto | EC-10, NFR-3, Out Of Scope |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-037 | Epic order; its named fixtures move into or are built from the library (AC-12), and its A-4 check says whether scenarios can share a server one after another, which the no-collision rule serves. | done (merged 2026-11-11; A-4 sequential verified) |
| PRB.T-042 | The rules file this story updates (AC-24) and the lint rules on scenario files the library must pass. | done |
| PRB.T-036 | The fixtures module, failure artifacts, offsets and isolated shell this story builds on; its baseline (AC-21) may give the "before" times (SU-3). | done (2026-11-10) |


**Blocks:** PRB.T-043 (composed scenarios hand over the library's results; perf scenarios use its setup); PRB.T-039 (atomic scenarios build their own world through the library); PRB.T-040 through it. Independent of PRB.T-041 apart from the switch rule.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | `workspace.startShell` with no script starts a plain shell into which the server types nothing. | assumption | verified (read `SavedWorkspaces.ts:839-885`; not run) | AC-3 at runtime. | author |
| SA-2 | A plain shell in the isolated shell config shows a first-prompt mark the library can wait for before typing. | assumption | verified (answered by PRB.T-041: `promptReady` in the shell list for every wrapped shell, plain ones included; read, not run) | AC-3 at runtime. | author |
| SA-3 | A shell started over the API shows a tree row in a page already showing the workspace (the tree follows the server's shell list). | assumption | unverified | AC-5 at the start of implementation. | author |
| SA-4 | The scenarios outside the coverage map do not assert dialog behavior in their setup, so converting it removes no check. | assumption | unverified (stage lists read, not every assertion) | Read each converted scenario's assertions against the map when planning. | author |
| SA-5 | The coverage map is complete, including Restore (S8), the menu's open and remove (S7), the start screen's create (S1), project removal (S6), close tab (S5) and E2-S4's dropdown starts. | assumption | verified (confirmed by the user, 2026-11-10) | – | epic owner |
| SA-6 | Debug-level server output stays small enough that the harness keeps the failing stage's lines and the run time does not rise noticeably. | assumption | unverified | Measure one scenario's debug volume when planning; AC-18 and the after times of AC-22. | author |
| SA-7 | API setup removes most per-shell round trips and a large part of the run time (epic A-7). | assumption | unverified | AC-22. | author |
| SA-8 | A page already open on the start screen, or showing another workspace, can reach a workspace created over the API after it loaded (the Workspaces menu or start screen lists it). | assumption | unverified | AC-7 at the start of implementation. | author |
| SU-1 | Whether the web app can hide diagnostic lines in production (it has no log level today), or web diagnostics stay out until a decision (epic U-3). | unknown | verified (plan D4: no web diagnostic lines; the browser console is captured instead; epic U-3 stays open for a later story) | – | author |
| SU-2 | What counts as one setup round trip, and the FR-10 threshold (epic U-2). The epic disagrees with itself on when: its FR-10 Verification row says from this story's own "before" count, its U-2 row says by the end of PRB.T-036; this story follows the FR-10 row. | unknown | verified (decided by the user, 2026-11-11) | Decided: one round trip is one awaited harness operation that crosses a process boundary (pointer action, page wait or read, RPC/HTTP call, CLI process, terminal typing or wait); restarts are counted separately. Threshold: suite-wide setup after ≤ 50 % of before (≤ 561 RT), and every scenario with CONVERT ≥ 19 except S2 cuts its own setup by ≥ 40 %. Unit, before count and threshold: Handoff. | epic owner (user) |
| SU-3 | Whether the "before" times come from PRB.T-036's baseline or from this story's own single run at its start. | unknown | verified (user, 2026-11-11: one serial run at `ebb9d3287` in the final verification) | At the start. The baseline exists (PRB.T-036 Delivered, 2026-11-10: serial, one run, rebuilt bundle), but it predates PRB.T-037's per-run names in S4 and S5. | TBD (author, at the start of this story) |
| SU-4 | PRB.T-037 plans two named fixtures (`workspace`: one git project; `shells`: the same with two running plain shells, its AC-5) in the shared fixtures module this story grows into the library, and per-run names for scenarios accepted on the sandbox. Unknown: what it actually ships, and whether its per-run names cover the library's no-collision rule or need extending. | unknown | verified (plan D7: PRB.T-037's `workspace` and `shells` fixtures are rebuilt on the library's setup; a per-trail counter extends the per-run names) | – | author |

## Handoff

**FR-10 unit and threshold (user, 2026-11-11; settles SU-2).** One round trip (RT) is one awaited harness operation that crosses a process boundary: P pointer action, W page wait or read, R RPC/HTTP call, C CLI process or restart, T terminal typing or wait. Not counted: local fs/git work, browser bookkeeping, the runner's own server start; restarts are counted separately. Buckets per scenario: CONVERT (setup that moves to the API), KEEP (setup that stays UI because it is the coverage map owner's path, or a judgment call), SUBJECT (the scenario's own subject). **Threshold:** suite-wide setup (CONVERT + KEEP) after ≤ 50 % of before (≤ 561 RT), and every scenario with CONVERT ≥ 19 except S2 cuts its own setup by ≥ 40 % (the "setup after ≤" column). The after count uses the same unit, from the code after the change.

**Before (desk count by the orchestrator, 2026-11-10, read from `main` at `f24dbcdf8`, not run).** Total 2581 RT; setup 1123. A "+"-modal `startShell` costs 11 to 18 RT. Rough after-estimate: setup about 350-400.

| Scenario | CONVERT | KEEP | SUBJECT | Setup after ≤ |
| -------- | ------- | ---- | ------- | ------------- |
| S1 | 0 | 5 | 283 | – |
| S2 | 19 | 36 | 246 | – (excepted) |
| S3 | 59 | 20 | 300 | 47 |
| S4 | 155 | 21 | 76 | 105 |
| S5 | 51 | 13 | 25 | 38 |
| S6 | 184 | 15 | 69 | 119 |
| S7 | 249 | 49 | 148 | 178 |
| S8 | 106 | 19 | 62 | 75 |
| T-002 | 0 | 10 | 22 | – |
| R1 | 1 | 15 | 22 | – |
| E2-S3 | 19 | 13 | 34 | 19 |
| E2-S1 | 31 | 7 | 133 | 22 |
| E2-S4 | 19 | 7 | 38 | 15 |
| Sum | 893 | 230 | 1458 | 561 (suite) |

**Notes from the count for the implementer.**
- SA-4 risk: `scripts/scenarios/scenarios/many-shells.ts` (~line 74) and `close-tab.ts` (~line 61) count tabs the modal opened; after API starts they need tabs opened from the tree first (EC-1).
- S3's duplicate add of `repo` (`worktrees.ts` ~line 143) is a check ("repository added twice") and must stay, as an API `workspace.addProject`.
- An API fork needs a caller-supplied worktree name.
- S3's `leaveAgent` becomes a "Plain shell" pick in the modal (S3 keeps every start a modal start).
- Judgment calls in the count: S8's tree kills (15 RT, counted SUBJECT; CONVERT if "kill from the tree: S6" is read strictly) and S2's first sparta create (4 RT, counted KEEP per EC-4).
- SUBJECT dominates S1, S2 and S3, so their 20 s cap depends on PRB.T-039's split, not on this story.

**Interface as built (`e005`, step 7).** One library folder, `scripts/scenarios/lib/`, no barrel; it imports nothing from `scenarios/`, `selftest/`, `run.ts` or `registry.ts`. `support.ts`, `fixtures.ts`, `rpc.ts` and `scenarios/workspaceUi.ts` are gone; the second-server seam moved to `lib/seam.ts` and takes its token from `serverToken`.

| Module | Holds |
| --- | --- |
| `lib/deadlines.ts` | The only deadline source: `WAIT_MS`, `ACTION_MS`, `START_MS`, `PROCESS_END_MS`/`PROCESS_END_STEP_MS` (the server's SIGKILL wait and processes it does not own), `SELFTEST_SHORT_MS`; type `Deadline`; `seconds()` for messages |
| `lib/waits.ts` | `check`, `recorder` (`mark`/`until`/`nothingSince`), `recorderTails`/`resetRecorders`, `waitFor(locator, what, opts?)`, `follow`, `alive`, `gone` |
| `lib/trail.ts` | `Trail` (`stage`, `within`, `current`, `note`, `notes`, `addServer`, `addPage`, `logSizes`, `save`), `createTrail`, `StageFailure {stage, cause}` with message `at stage "<s>": <cause>` |
| `lib/api.ts` | `connectApi(server, auth)`, `withClient`, `environmentId`, `issueBearerToken`, `serverToken(server)` (memoized per `ServerHandle`), `call(trail, method, input, run)`, `SetupError` |
| `lib/setup.ts` | `setupOn(ctx, {as?})` -> `Setup` (`client`, `shells`, `folder`, `repo`, `workspace`, `project`, `shell`, `killShell`, `removeProject`, `removeWorkspace`, `close`); `world(ctx, spec)`; `given(kind, value, build)`; result types tagged `folder`, `repo`, `workspace`, `project`, `shell`, `world`, `page` (`SetupResults`); `workspaceNames`, `projectPaths`, `mockAgent`; `sandboxFixtures`, `selftestFixtures`; `setUp` (the UI-built world the signal-wait self-tests keep) |
| `lib/navigate.ts` | `showWorkspace(page, ws)`, `openTab(page, shell)`, `reloadShowing`, `restartAndReload(ctx, page, ws, previous, env?)` (returns a new `Setup`), `layoutSaved`, `layoutState(s)`, `recordLayoutStates` |
| `lib/shells.ts` | `followShells`, `followOutput`, `history`, `shellsIn`, `runningIn`, `running`/`isRunning`, `openShell`, `lastStartOf`, `pidsRunning`, `writeLine` (over the API, after the first prompt), `survivors`, `shellEnded`, `agentReady`/`leaveAgent` (one output follower), `agentTypedOnceAfterPrompt`, `PROMPT_MARK`, `stripOsc`, `MOCK_AGENT_LINES` |
| `lib/ui/*.ts` | `workspacesMenu`, `addProject`, `plusModal`, `tree`, `tabs`, `terminal` (`shellReady`, `typeLine`), `dialog` (alerts and dialogs) |
| `lib/network.ts` | `pageFrames` |
| `lib/serverLog.ts` | `expectLogged`, `logEntries`, `serverPromptMs` |
| `lib/files.ts` | `git`, `gitOk`, the starting-scripts file helpers, `runtimePid` |
| `lib/report.ts` | `unlessRoot`, `redact`, `metric` (PRB.T-043 removes it) |
| `lib/seam.ts` | `saveServerInBrowser` |

`ScenarioContext` gained `scenarioId`, `trail` and `onStepEnd(what, undo)` (master plan M2: one hook, not `defer`; undos run in reverse when the scenario ends, pass or fail). Pages open at 1200×800 with their console on the trail; `startSecondServer` adds `second-server`. Servers start at `--log-level debug` (`logLevel: null` starts one without the flag) and append to `<home>/harness/server.log`; `ServerHandle` has `logMark()`/`logSince(mark)`. `addServer` records the mark at registration, so `<label>.log` is the scenario's own time on that server. Artifacts: `error.txt`, `page-<n>-<label>.png` and `.console.txt`, `<label>.stage.log`, `<label>.log`, `setup.json`, `recorders.json`, each saved on its own and redacted. The runner prints `scenarios: <id> <label> log=<KiB>KiB` per server. Self-tests T10 to T15 are registered (T10, T11 in `--selftest`; T12 to T15 picked).

**Signals (AC-23).** PRB.T-041 landed first (merged before this story's work began, `4eaf87ecb`), so the switch rule put the signals in this story: the typing wait reads the tab's ready and attached states, `writeLine` and `setup.shell` wait for `promptReady` in the shell list, reloads and restarts wait for the layout saved, and shell ends wait for the end event before one pid check. Nothing is left for PRB.T-039 to switch.

**Verification is deferred to the final phase (PRB.E-005 master plan §4).** Nothing in steps 1 to 7 ran a scenario, the runner or the harness tests. AC-22's times ("before" at `ebb9d3287`, "after" at tag `e005-t038`, one serial run each, after the user confirms a quiet machine; the after run is at debug log level) and AC-25 are measured at tag `e005-t038`, because PRB.T-039 later replaces these scenarios and PRB.T-040 retires `run.ts`. The self-tests T10 to T15 are judged again in the tip's `--selftest` run. A defect found at the tag is fixed at the tip with a test when its code survives there (`lib/`, `server.ts`); otherwise it is recorded as tag-only.

**Steps and commits (branch `e005`).**

| Step | Commit | What |
| --- | --- | --- |
| 1 move to `lib/` | `a12ae7f61` | Five old modules split into `lib/`; `Trail` minimal; `scenarioId`, `trail`, `onStepEnd` on the context |
| 2 waits | `f44357365` | `waitFor`, named failures, `SELFTEST_SHORT_MS`, T14 |
| 3 logs and artifacts | `a2d317f65` (merge `049f657ab`) | Debug level, log file and marks, console capture, viewport, labelled artifacts, `redact`, T15 |
| 4 setup API | `394feb897` (merge `cf76205cf`) | `lib/api.ts`, `lib/setup.ts`, `showWorkspace`/`openTab`, fixtures on setup, T10 to T13 |
| 5 one home per step | `ddfc0e2cb` | `lib/ui/*`, `lib/shells.ts`; `writeLine` waits for the first prompt (AC-3) |
| 3B harness cases | `cf8b86d88` (merge `97555bbfa`) | AC-15 to AC-21 and T12/T13 cases in `harness.test.ts` |
| 6 conversions | `8b62b6b3c`, `2303e95cc`, `e3fecb0bf`, `6a0e931d2` (merges `7d4eec242`, `c31e9cf15`, `431389426`); fold `417136249` | S4, S5, S8, T-002, R1; S6, S7; S3, E2; S1, S2, signals, self-tests |
| 7 rules, count, handoff | this commit | Rules file (AC-24), after count, this handoff |

**Deviations from the plan.**
- One cleanup hook, `onStepEnd(what, undo)`, instead of `defer` (master plan M2).
- `StageFailure` is `{stage, cause}` with message `at stage "<s>": <cause>`, not `<id> failed at <stage>` (M4); the runner prints the id.
- `addServer` records the log mark at registration, so `<label>.log` is the scenario's own time on a server, not the whole log (M7).
- `lib/seam.ts` stays (moved, not deleted), `lib/ui/dialog.ts` was added, and `server.ts`'s own deadlines (the 5 s SIGKILL wait and its loop step) moved into `lib/deadlines.ts`.
- 2B broke `harness.test.ts`'s T2/T3 and artifact-name assertions; 3B fixed them. 2C left the `writeLine` prompt wait to step 5 and the T12/T13 harness cases to 3B.
- 4c deleted the unused `projects()` fixture; the fold made `restartAndReload` take the workspace and return a new `Setup`, moved the starting-script lookup into `lib/setup.ts` (`mockAgent`) and deleted `seedWorkspace`.
- The tag is `e005-t038`, not `e005-t038-done`. The after count is written here directly, not through `tm` (which does not write ticket bodies).

**Open for the final phase and for PRB.T-039.**
- S7 AC-6: the kept modal start is now S7's fork (its comment says stages AC-31 and AC-23 read it); the shell `inMoved` became an API start. Whether "the last start before the restart" is that fork is for the V6 review.
- SA-3 risk: S8 starts API shells after the page shows the workspace, and waits for the tree row.
- Left for PRB.T-039: S7's and S8's shell-host stops and the duplicate "left the list" wait in S6 and S3.
- 3C: the `EADDRINUSE` detection is a substring match on the server's start error, not yet seen against a real taken port.

**After count (desk count, 2026-11-11, `e005` at `be06655c0`, read from the code, not run).** Same unit, conventions and buckets as the before count. Restarts stay out of the buckets; the runner's own server start is not counted. The viewport `setViewportSize` P1 left every preamble (the runner sets the viewport when it makes the context).

| Scenario | CONVERT | KEEP | SUBJECT | Setup after (before) | Setup after ≤ | |
| -------- | ------- | ---- | ------- | -------------------- | ------------- | - |
| S1 | 0 | 5 | 283 | 5 (5) | – | |
| S2 | 19 | 45 | 263 | 64 (55) | – (excepted) | |
| S3 | 15 | 26 | 309 | 41 (79) | 47 | pass |
| S4 | 36 | 25 | 99 | 61 (176) | 105 | pass |
| S5 | 16 | 15 | 26 | 31 (64) | 38 | pass |
| S6 | 34 | 16 | 89 | 50 (199) | 119 | pass |
| S7 | 54 | 37 | 174 | 91 (298) | 178 | pass |
| S8 | 22 | 19 | 70 | 41 (125) | 75 | pass |
| T-002 | 0 | 9 | 26 | 9 (10) | – | |
| R1 | 0 | 18 | 17 | 18 (16) | – | |
| E2-S3 | 8 | 16 | 39 | 24 (32) | 19 | **fail** |
| E2-S1 | 9 | 6 | 162 | 15 (38) | 22 | pass |
| E2-S4 | 8 | 6 | 46 | 14 (26) | 15 | pass |
| Sum | 221 | 243 | 1603 | **464 (1123)** | 561 (suite) | pass |

- **Suite:** setup 464 RT, 41 % of 1123, under the ≤ 561 threshold.
- **E2-S3 misses its own threshold** (24 against ≤ 19). Its CONVERT fell from 19 to 8; KEEP rose from 13 to 16 because its one restart's reload and reconnect cost 10 RT, not 6: `restartAndReload` waits for the layout saved before the stop and again inside the reload (W2 each), and the new setup connection adds a shell follower (R1). Without the second layout wait it would be 22, still over. This is for the epic owner: accept, or slim the restart path in `lib/navigate.ts` (the layout wait inside the reload is redundant right after one before the stop).
- **S2's CONVERT is not converted**: stage AC-25 still creates athens by the menu and imports its repo by the dialog (19 RT, `plus-modal.ts` ~485-493). S2 is excepted, and its world stays UI-built by EC-4, but those 19 RT could go over the API. Its KEEP rose 36 → 45 from the heavier restart path and the start-screen create.
- **Why KEEP and SUBJECT rose:** PRB.T-041's signals made the helpers wait for more page state. The typing wait is 7 RT, not 4 (tab attribute plus the ready check), `writeLine` waits for the first prompt, a shell end waits for its end event (about 20 new sites), and each reload or restart waits for the layout saved. `startFromModal` now reads the alert and result, which adds 2 to 3 RT where the E2 and S2 stages had a bare click before. The scenarios check no more than before.
- **Judgment calls:** `showWorkspace` counted CONVERT, on its start-screen branch (6 RT), since an API-made workspace is never remembered on a fresh page; tree-opened tabs that replace modal-made ones are CONVERT; every `leaveAgent` is gone (CONVERT 0); S7's kept modal fork stays in its old CONVERT stage at 11 RT (with "mock agent" preselected; 14 if not); S8's API kills count SUBJECT as before (CONVERT 28, setup 47 when read strictly); S6's background-job and neighbour typing count SUBJECT (setup 66 if counted as KEEP). Every reading passes except E2-S3.

**Review of AC-1, AC-10, AC-11, AC-13 (read-only, 2026-11-11, `be06655c0`).** For the developer's sign-off at V6.
- **AC-1 met.** S3's only dialog add is AC-29 and every S3 start is a modal start. S7's one modal start is its fork. Its menu open and remove steps are S7's own. S6's tree kills and its project and workspace removals are S6's. The E2 scenarios start only through the dropdown. S8 kills over the API (D6). Nit: S7 AC-20's `killFromTree` is cleanup only, and could go over the API.
- **AC-10 mostly met.** The remove steps exist over the API. Module state is keyed per server (tokens) or per trail (the counter). Gaps:
  - `setUp` (UI-built, default name `sparta`, returns nothing) is still in `lib/setup.ts` for the signal-wait self-tests.
  - `ShownPage` has no frame follower, although the plan's §1 lists one; scenarios call `pageFrames` themselves.
  - The recorder registry in `lib/waits.ts` is module-level, which matters for PRB.T-040's parallel workers.
  - There is no `lib/ui` step for S6's project removal.
- **AC-11 partial.** Every duplicate listed in Current Behavior has one home in `lib/`. No `let stage` remains. The library imports no scenario. R1 mints each server's token once. Helpers still written out in scenario files:
  - the "shell leaves the list" wait, in six files;
  - S7's local `restart()`, which differs from `restartAndReload` only by stopping the shell host;
  - the `[data-missing]` row locator (S7, S8);
  - the prompt mark as frame text (E2, besides `lib/shells.ts`);
  - "the shell's latest list entry" (S3, S7, S8) and "SIGKILL, then wait for the end" (S4, S6, S7, S8).
  - Nits: the start-screen "Open workspace" locator is inline in six places; S2 and R1 use fixed names; S3 uses fixed folder paths.
  - PRB.T-039's split is the natural place to fold all of these.
- **AC-13 met.** Every library wait races an event against a `lib/deadlines.ts` deadline and names both. The one check loop is the class (c) process-end loop. No fixed sleep. No scenario passes a deadline number. Nits:
  - `run.ts` polls the sandbox at a literal 250 ms.
  - S1, S2, S3, E2 and signals still call Playwright's own `waitFor` about 50 times. Those inherit `ACTION_MS`, but their failures name a locator, not the milestone.
