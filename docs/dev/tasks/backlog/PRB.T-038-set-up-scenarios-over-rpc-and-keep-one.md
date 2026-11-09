---
id: PRB.T-038
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Set up scenarios over RPC and keep one real UI path per action

## Business Goal

**Problem:** Most scenarios spend their time building a world by clicking: create a workspace, add each project through the dialog, start each shell through the "+" modal (about eight round trips per shell by the desk analysis), and leave the mock agent before the shell can be used. S7 starts 11 shells and adds 5 projects this way, S4 and S6 start about 6 and 10 shells. None of that is what those scenarios test, it is where most of their time goes, and every click is a chance for a flake. R1 already seeds a workspace over the server API, so the approach is proven in this suite.

**Proposed solution:** Scenarios whose subject is not a dialog create their workspaces, projects and shells directly through the server API, and start plain shells without a starting script, so nothing has to be typed out of the mock agent first. For each action family one scenario keeps the real pointer path, so the dialogs stay covered. The run times before and after are recorded, not gated.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 3 PRB.T-038 Set up scenarios over RPC, keep one real UI path per action
- **Delivers:**
  - FR-10: scenarios whose subject is not the dialog set up directly through the server API; one real UI path per action family stays (add project, "+" modal, kill with confirmation, Restore, Workspaces menu).
  - FR-4 (the part a faster setup affects): no new wall-clock gate; times are recorded as a metric only.
  - NFR-1 (the run-time half): the per-scenario times fall; the target is the KPI's, set after the baseline.
  - NFR-2: setup that is deterministic by construction (no dialog race to lose).
  - Epic assumption A-7 is tested here (timings before and after).
- **Constraints respected, not delivered here:** NFR-3 (setup goes through the authenticated client the harness already uses; the throwaway-home guard is untouched), NFR-5 (pointer-only input in every scenario that drives the UI) and NFR-7 (the RPC setup lives in the one shared fixtures module that PRB.T-036 creates).
- **One deployable outcome:** After this ships, the scenarios named below finish their setup without dialogs and report their times, and a broken dialog still turns a named scenario red. The suite is faster and no less covering, which is the epic's goal.

## Current Behavior

Read on 2026-11-09 (the code search index was unavailable, so this is from reading files). The fixtures module of PRB.T-036 and the sandbox helpers of PRB.T-037 do not exist yet; this story builds on them and the names below are today's.

- **Setup helpers.** `createWorkspace` (scripts/scenarios/scenarios/workspaceUi.ts:254) clicks the Workspaces menu and fills a dialog. `addProject` (workspaceUi.ts:168) drives the Add project dialog, with the folder browser. `startShell` and `startIn` (workspaceUi.ts:376, 360) open the "+" modal on a project, pick the mock agent (`openModal` picks it unless told otherwise), choose the worktree, click Create shell and wait for the shell list. Every scenario calls them directly.
- **Leaving the agent.** `leaveAgent` (workspaceUi.ts:418) attaches to the shell, waits for the mock agent banner, types `exit` and waits for its goodbye, so the next typed line reaches the shell. It is used in S4 (many-shells.ts), S5 (close-tab.ts:55), S6 (kill-shell.ts, through `runInShell`), S7 (restart.ts), S8 (restore-shell.ts:76 and others) and in S3 (worktrees.ts, near the branch-switch stage). `agentReady` (workspaceUi.ts:402) waits for the banner.
- **What already uses RPC.** `connectRpc` (rpc.ts) gives a typed client signed in as the page or a bearer token. R1 (second-server.ts:58-66) creates a workspace and adds a project with `workspace.create` and `workspace.addProject`. S3's kill helper (worktrees.ts) calls `shell.kill`. Scenarios already follow the shell list over `subscribeShells` (workspaceUi.ts:226).
- **The start request.** `WorkspaceStartShellInput` (packages/contracts/src/workspace.ts:159) has the workspace, the project, an optional worktree choice, an optional script ("Absent for a plain shell") and the terminal size. So a plain shell can be started over the API without a starting script. Whether the server then also saves the project's last start, and whether a shell started this way gets a tab in the page, is not verified (SU-1, SU-2).
- **Where the UI is the subject.** S1 creates and refuses workspaces by the menu and dialog (boot.ts:49, :142-160). S2 is the add-project and "+" modal scenario (plus-modal.ts). S3 is the worktree choices in the modal (worktrees.ts). S6 kills from the tree with a confirmation (kill-shell.ts:106-130, `askToKill`/`answerConfirm`). S8 clicks Restore (restore-shell.ts). S7 uses the Workspaces menu to switch to and remove a workspace (restart.ts, stages AC-9 and AC-33).
- **Scenarios that set up by clicking and do not test it.** S4 (6 modal starts, 2 `leaveAgent`), S5 (workspace and 2 modal starts), S6 (about 10 modal starts), S7 (11 shells, 5 add-project dialogs), S8 (UI setup, 2 `leaveAgent`), E2-S3 and E2-S1 (starting-scripts.ts:70-76, `setUp`). The stage lists were read; the share of time each setup costs is unmeasured (SU-3).
- **Timing.** No per-scenario "before" numbers exist until PRB.T-036 records the baseline.
- **Mobile and desktop.** Nothing here touches either.

## Expected Behavior

Setup that is not the subject happens over the API; the subject still happens by the pointer. A reader of a scenario sees the world it needs built in a few lines from the shared fixtures, and the dialogs are exercised by the scenarios that own them.

- **Which scenarios keep which UI path** (the coverage map; it is the answer to "one real UI path per action family"):
  - Create workspace by the Workspaces menu: S1.
  - Add project (import, create new folder, refusals): S2.
  - Start a shell from the "+" modal, including worktree choices and the double click: S2 and S3.
  - The terminal-size stage (S2 AC-6) keeps its modal start: S2.
  - Starting the mock agent through the modal with a starting script chosen (the script dropdown and its preselection): E2-S1 and E2-S3, plus S2.
  - The "+" modal's remembered choice (the modal-default stage, S7's AC-31 stage): S7 keeps its modal start, alongside S3's remembered-choice stage.
  - Kill from the tree with a confirmation, and cancel: S6.
  - Restore on an ended shell: S8.
  - Open workspace and remove workspace by the Workspaces menu: S7 keeps the switch and the removal.
- **Everything else** creates its workspace, adds its projects and starts its shells over the API. After setup the page is brought to the workspace the way a user would (the Workspaces menu or a reload that shows it), and tabs are opened from the tree by a click.
- **Plain shells without the agent.** Where a scenario needs a plain shell, it starts one with no starting script and types into it directly. `leaveAgent` is no longer called for those. A scenario that needs the mock agent (to test it) still starts it and waits for its banner.
- **Times.** The per-scenario times from PRB.T-036's baseline and the times after this story are recorded in this ticket's handoff, per scenario, for comparison. They are not a gate.

### User Flow

1. The developer (or an agent) runs the suite, or one scenario with `--only <id>`.
2. A scenario that is not about a dialog builds its workspace, projects and shells in a few API calls and brings the page to the workspace.
3. The scenario drives the behavior it is about with the pointer.
4. The scenarios that own a dialog (coverage map above) still click through it; breaking that dialog turns one of them red.
5. The developer reads the per-scenario times to see the change.

### Edge Cases

- EC-1: A shell started over the API shows a row in the tree. Whether it also opens a tab on its own is unverified (SU-2); a scenario that needs a tab opens it from the tree by a click, as the reload scenarios already do.
- EC-2: The modal's remembered choice (S3, S7 stage AC-31) and the project's "last start" must be true for the scenarios that check them. Those scenarios start through the modal, or set the remembered state by the same means a user would, so a check on "remembered" is never satisfied by API setup that does not write it (SU-1).
- EC-3: A scenario that needs the page to show a workspace created over the API must not depend on an earlier page state (the start screen versus a remembered workspace); it brings the page there explicitly.
- EC-4: S1 and S2 run with an empty server on purpose (no workspace yet, refusals): they keep their UI-built world and are not converted.
- EC-5: The agent-start scenarios (S2's banner and double-click stages, E2-S1, E2-S3) still start the mock agent through the modal; the mock agent is not removed from the suite.
- EC-6: Terminal size. A shell started over the API needs a size; the stages that assert the grid size (S2 AC-6) keep the modal path.

### Error Handling

- ER-1: An API setup call fails: the scenario fails in a setup stage whose name says which call failed (workspace, project, shell) with the server's reason, not later with a missing-element timeout.
- ER-2: The page does not reach the workspace after API setup: the failure says the workspace was not shown, with the usual failure artifacts of PRB.T-036.
- ER-3: A dialog is broken: the scenario that owns it fails, and the scenarios that no longer click it are not the ones that report it (that is the point; the coverage map names the owner).

## Out Of Scope

- Splitting S2, S3, S7 and E2-S1 into independent scenarios: PRB.T-039. This story edits their setup lines only where the split is not needed.
- Removing restarts or changing what a restart proves: PRB.T-039 (and the must-not-change list).
- Replacing guessed typing with a prompt-ready signal, or reload timing with a layout-saved signal: PRB.T-041. Plain shells started without a script still get typed into after the page attaches; that guess is T-041's to remove, and this story must not make it worse.
- The runner, shared servers and parallel workers: PRB.T-040.
- Changing what any scenario proves, or any production code. The mouse-first rule holds.
- New scenarios for unbuilt features.
- Mobile and desktop.

## Technical Scope

- **Layers:** scenario harness only (fixtures module, scenario setup), the typed RPC client the harness already has. No server, contract or web change is planned; if the start request or the page needs a change to make API setup observable (SU-2), stop and raise it for the epic owner.
- **Docs impact:** the "Scenario tests" part of `docs/operations/development.md` and `docs/internals/testing.md` where they describe how scenarios set up; the full rewrite for the runner is PRB.T-040 (FR-15). Check AGENTS.md "Verifying" for accuracy.
- **Mobile impact:** none.

## Non-functional Requirements and Constraints

- The repo test rules hold for the code this story touches: no sleeps, polling loops, wall-clock deltas, per-test timeouts or retries (lint rules `t3code/no-real-time-wait-in-tests`, `no-polling-loop-in-tests`, `no-wall-clock-in-tests`).
- Pointer-only input in scenarios that drive the UI (mouse-first rule).
- Real PTYs, real git worktrees and real websockets stay: API setup talks to the real server, it does not mock it.
- Setup helpers live in the one fixtures module; no copy in a scenario file (epic NFR-7).
- Times are recorded for comparison, not gated (epic FR-4); no new `Date.now()` delta is added.
- The throwaway-home guard and cleanup by captured PID are unchanged (epic NFR-3).

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given the scenarios S4, S5, S6, S7, S8, E2-S1 and E2-S3, when the suite runs, then none of them calls the Add project dialog or the Workspaces menu's Create workspace to build its world, and the only "+" modal starts left in them are the ones the coverage map assigns to them (S7's remembered-choice stage, and the agent-start stages of E2-S1 and E2-S3) | manual (developer, by reading the diff against the coverage map) | FR-10 |
| AC-2  | Given the coverage map, when the suite runs, then S1 creates a workspace by the menu, S2 adds projects by the dialog and starts shells from the "+" modal, S3 starts from the modal with worktree choices, S6 kills from the tree with a confirmation, S8 clicks Restore, and S7 opens and removes a workspace by the menu, each passing | auto | FR-10, R-2 (epic) |
| AC-3  | Given the Add project dialog is broken (the refusal of a plain file as a project folder is removed, so the dialog accepts it), when the suite runs, then S2 fails and the output names it | manual (developer, recorded in the handoff; the break is made outside the committed tree and reverted) | FR-10, ER-3 |
| AC-4  | Given the "+" modal is broken (the Create shell button's click does nothing), when the suite runs, then S2 and S3 fail, and the scenarios that start by API do not hide it | manual (as AC-3) | FR-10, ER-3 |
| AC-5  | Given the kill confirmation is broken (Confirm does not send the kill), when the suite runs, then S6 fails | manual (as AC-3) | FR-10, ER-3 |
| AC-6  | Given Restore is broken (the Restore button's click does nothing), when the suite runs, then S8 fails | manual (as AC-3) | FR-10, ER-3 |
| AC-7  | Given a scenario that needs a plain shell, when it starts one, then it is started with no starting script, nothing is typed into it by the server, and the scenario does not call `leaveAgent` for it | auto | FR-10 |
| AC-8  | Given the scenarios that still start the mock agent (S2 banner and double-click stages, E2-S1, E2-S3), when they run, then they start it through the modal and see its banner exactly as before | auto | EC-5 |
| AC-9  | Given a shell started over the API, when the page is at the workspace, then the shell's row shows in the tree, and the tab is open, opening it by click if not already | auto | EC-1 |
| AC-10 | Given the modal-default stages named in the coverage map (S3's remembered choice, S7's AC-31 stage), when they run, then each starts the shell it checks through the "+" modal, so the remembered state it asserts is written by the user's path whichever way SU-1 comes out | auto | EC-2 |
| AC-11 | Given a workspace created over the API, when the scenario brings the page to it, then it shows without depending on what the page showed before | auto | EC-3 |
| AC-12 | Given S1 and S2, when they run, then they start from an empty server and their world is still built by the UI | auto | EC-4 |
| AC-13 | Given a setup call is made to fail on purpose (a project path that does not exist), when the scenario runs, then it fails in a setup stage naming the call and the server's reason | auto (harness self-test) | ER-1 |
| AC-14 | Given a workspace that never shows in the page, when the scenario waits for it, then the failure says the workspace was not shown and carries the failure artifacts | auto (harness self-test) | ER-2 |
| AC-15 | Given the baseline of PRB.T-036 and a run after this story, when the per-scenario times are compared, then the times for S4, S5, S6, S7, S8, E2-S1 and E2-S3 are written in the handoff next to each other, with the machine and method; nothing fails on a time | manual (author, in the ticket handoff) | NFR-1, FR-4, A-7 (epic) |
| AC-16 | Given two consecutive full runs after this story with no retries and no changes between them, when they finish, then both pass | auto | NFR-2 |
| AC-17 | Given the suite after this story, when the lint rules for waits and wall-clock deltas run on the scripts, then there is no new violation and no new exemption | auto (`vp run check:changed`) | NFR-7 |
| AC-18 | Given the new setup code, when the suite is searched for setup helpers, then they are in the one fixtures module and not copied into scenario files | manual (developer) | NFR-7 |
| AC-19 | Given the throwaway-home guard test in `harness.test.ts`, when it runs, then it still refuses `~/.t3` and any non-local address | auto | NFR-3 |
| AC-20 | Given the docs that describe scenario setup, when this story lands, then no sentence in them says that scenarios create their workspace and shells by clicking, or that they leave the agent first | manual (developer, docs diff review) | FR-15 (epic), NFR-7 |
| AC-21 | Given a remembered-choice stage whose remembered state was not written (the modal start replaced by an API start in a trial run), when the stage runs, then it fails | auto (harness self-test) | EC-2 |
| AC-22 | Given the stage that asserts the terminal size (S2 AC-6), when it runs, then the shell is started through the "+" modal and the grid size is asserted | auto | EC-6 |

## Dependencies

**Depends on:** PRB.T-037 (and through it PRB.T-036), as the table says. **Blocks:** PRB.T-039, then PRB.T-040. Independent of PRB.T-041.

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-037 | The sandbox lets the author try a setup call against a live server while writing the fixtures (SA-1, SU-1, SU-2), and the sandbox's importable helpers are the home of the RPC fixtures. | backlog |
| PRB.T-036 | The baseline times to compare with (AC-15), the single fixtures module this story extends, the failure artifacts ER-2 relies on, and the removal of wall-clock gates. Reached through PRB.T-037, listed because the AC depends on it. | backlog |

Blocks: PRB.T-039, because each split scenario builds its own world through these API fixtures.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | `workspace.startShell` with no script field starts a plain shell that types nothing, as the contract comment says. | assumption | unverified (contract read, behaviour not run) | Start one over a sandbox (PRB.T-037) and read its history. | author, at the start of this story |
| SU-1 | Whether a start over the API saves the project's last start the way the modal does. | unknown | unverified | Start over a sandbox, then `workspace.open` and read `lastStarts`. The result decides whether other scenarios can rely on the saved last start; AC-10 holds either way. | author, at the start of this story |
| SU-2 | Whether a shell started over the API opens a tab in a page that is showing the workspace, or only a tree row. | unknown | unverified | Run in a sandbox and look at the page. | author, at the start of this story |
| SU-3 | How much of each scenario's time is setup, and whether the saving is large. | unknown | unverified | The per-scenario times of PRB.T-036's baseline against this story's run (epic A-7). | author, when this story closes |
| SA-2 | Scenarios other than S1, S2, S3, S6, S7 (partly) and S8 (Restore) do not assert anything about the dialogs, so converting their setup does not remove a check. | assumption | unverified (stage lists read, not every assertion) | Read each converted scenario's assertions against the coverage map before deleting its UI setup. | author |
| SA-3 | The analysis's list of scenarios that keep the UI path ("S1, S2, S3 and S6") is a start; Restore (S8) and the Workspaces menu's open and remove (S7) must also keep theirs. | assumption | unverified | Epic owner confirms the coverage map. | epic owner |
