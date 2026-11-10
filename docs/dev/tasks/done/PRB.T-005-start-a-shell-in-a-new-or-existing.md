---
id: PRB.T-005
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-06
---

# Start a shell in a new or existing worktree

## Business Goal

**Problem:** After story 4 a user can start a shell only in a folder's own checkout. Agents running in parallel on one repository then share one working tree and step on each other's files. The user has no way, from the "+" modal, to give an agent its own isolated worktree, or to start a second shell in a worktree that already exists.

**Proposed solution:** Each project row in the sidebar gets a "+" that opens a "Create shell" modal. For a git project the modal offers **Existing** (start in any of its worktrees) or **Fork** (create a new worktree from a linked worktree or a branch). Probe names the new worktree and its branch automatically, creates it, and runs the shell there. If creating it fails, the user sees why and nothing is left behind. The modal remembers the project's last choice, so repeating a start takes one click. (Design revised with the user on 2026-11-05 and 2026-11-06 during the manual pass; see the handoff.)

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 5 Start a shell in a new or existing worktree ("Fork-or-open per agent", after story 4).
- **Delivers:**
  - FR-4: "Fork" with a chosen origin (a linked worktree or a local branch); Probe names the worktree `probe-worktree-<6 hex>`, creates it in the worktrees folder of the Probe home (the existing T3 home), gives its new branch the same name, and the shell runs in the new worktree.
  - FR-5: "Existing" lists every worktree of the project, the primary one first; a worktree may hold any number of shells (revised 2026-11-05). The primary worktree path already exists from story 4.
  - FR-3 and FR-21 (revised 2026-11-06): the "+" moves from the top of the sidebar to each project row and opens the modal for that project; importing any worktree of a repository adds the repository as the project.
  - FR-13: a failed fork shows why and creates no shell. The part about non-git folders not offering worktree or branch choices is already delivered by story 4 (FR-21) and is only kept working here.
  - FR-22 (part): the project's last choice (Existing with its worktree, or Fork with its origin) is preselected the next time the modal opens on that project, so one click on the up-arrow button starts another shell.
  - NFR-2 (part): a failed fork leaves no partial shell or half-created worktree.
  - NFR-1 (part): no continuously repainting animation in the new steps; the time limit for a worktree start is left open (SU-1) and no criterion checks it.
  - NFR-5 (part): the new steps work with mouse or touchpad alone.
  - NFR-6 (part): the server logs shell start with the worktree path and branch (FR-4).
  - NFR-7 (part): docs updated in the same PR.
  - FR-6 (part): a shell started in a new or existing worktree runs the mock agent CLI and opens as a tab.
  - FR-7 (part, per the epic's verification table): the worktree level of the tree, each worktree node labelled with its current branch and shown only while it has running shells, and the "elsewhere" mark. Story 3 owns the tree and grouping and story 4 the 1-second appearance; the node disappearing with its last shell is checked here too, because story 6's scope assigns node removal rules to stories 3, 4 and 5 (see SU-5).
  - Epic U-2 is resolved here: the default starting point is the folder's current branch (location and name are decided in FR-4). NFR-2 (failed fork) is named in the epic's S3 row; the NFR-2 owner list names only stories 6 and 8, which is noted as an epic inconsistency.
  - A-11 (epic assumption, owned by this story): learning each worktree's current branch from its HEAD, updated after a branch switch in any of its shells.
- **One deployable outcome:** A user can start a shell in a brand-new, automatically named worktree forked from a chosen origin, or in any existing worktree, and repeat that with one click; this gives each agent its own isolated checkout, which is the "fork-or-open per agent" step of the epic's workspace promise.

## Current Behavior

Verified by reading `../probe` (read only); nothing was run.

- **Terminal UI (web).** No "+" modal, worktree step or starting-point step exists yet (they come from stories 3 and 4). The nearest existing UI is chat-bound: `apps/web/src/components/BranchToolbar.tsx`, `BranchToolbarEnvModeSelector.tsx` (local versus worktree mode), `BranchToolbarBranchSelector.tsx`, `BranchPicker.tsx` and `WorktreeBaseBranchPicker.tsx` (a starting-branch picker), and `PreviousWorktreeItemContent.tsx`. `apps/web/src/components/ChatView.tsx` and `apps/web/src/components/Sidebar.tsx` also hold worktree-mode state. These are tied to a chat thread's draft and are reachable only through chat.
- **Worktree creation (server).** `createWorktree` in `apps/server/src/vcs/GitVcsDriverCore.ts` runs `git worktree add`. It takes a repository path, a starting ref, an optional new branch name and an optional base ref (input shape `VcsCreateWorktreeInput` in `packages/contracts/src/git.ts`). It is exposed as the RPC `vcs.createWorktree` (`packages/contracts/src/rpc.ts`, handler in `apps/server/src/ws.ts`) through `apps/server/src/git/GitWorkflowService.ts` and `apps/server/src/git/GitManager.ts`. The worktree location defaults to a worktrees directory under the server's base directory (`apps/server/src/config.ts`, `apps/server/src/worktreesDirectory.ts`), as `<worktrees dir>/<repo name>/<branch with slashes replaced by dashes>` (long names are shortened with a hash). The epic's decided location (the worktrees folder of the Probe home, which is the existing T3 home) matches this directory; the decided name `probe-worktree-<6 hex>` differs from today's pattern.
- **Automatic naming.** The chat launch path `apps/server/src/orchestration-v2/ThreadLaunchService.ts` generates a temporary branch name of the form `t3/<8 hex>` (`buildTemporaryWorktreeBranchName`, `WORKTREE_BRANCH_PREFIX` in `packages/shared/src/git.ts`) and may rename it later from the first message through a text-generation model. It also supports a workspace strategy `existing_worktree`. All of it is thread-bound and orchestration code; the epic replaces this naming for the new flow.
- **Failure and cleanup.** In `ThreadLaunchService.ts` an abandoned worktree is removed with `removeWorktree` (`GitVcsDriverCore.ts`) when the launch is cancelled or fails before the workspace is recorded. `createWorktree` itself creates the new branch first (`createBranchAt`) and then runs `git worktree add`; the code read does not show the branch being deleted when `git worktree add` fails. Whether a failed fork leaves a stray branch or a half-created directory is `unverified` (SA-4).
- **Listing worktrees.** `listRefs` in `GitVcsDriverCore.ts` runs `git worktree list --porcelain` and attaches a `worktreePath` to each branch (`VcsRef` in `packages/contracts/src/git.ts`), keeping only worktrees that still exist on disk. It is branch-centered: a worktree on a detached HEAD has no branch to attach to, and a worktree that is not on a branch is not listed as such. There is no call that returns the folder's worktrees as such (SA-1).
- **Commit requirement.** Nothing in the code read refuses a worktree fork in a repository with no commit; the behavior is `unverified` (SA-3).
- **Branch of a shell.** No shell-level branch tracking exists. Chat threads keep a `branch` and `worktreePath` in thread metadata (`thread.metadata.update` in `ThreadLaunchService.ts`); how a branch switch inside a terminal could be detected is `unverified` (SU-3).
- **Remembered choices.** No workspace layout holding "last worktree choice and starting point" exists yet (the workspace and layout come from stories 3 and 4). The chat flow keeps its choices in a per-thread draft (`apps/web/src/composerDraftStore.ts`).
- **Logging.** Worktree creation in the chat flow reports progress through the thread setup tracker; no log line "shell start with worktree path and branch" exists, because shells without chat do not exist yet (NFR-6 comes from story 4 onwards).

## Expected Behavior

Once this story ships, every project row in the sidebar has a "+" that opens the "Create shell" modal for that project; it is the only way to start a shell. The modal shows a "Starting script" dropdown that is disabled and reads "mock agent". A git project also gets an **Existing | Fork** switch and one dropdown; a project that is not a git repository gets neither. Everything is done with the mouse or touchpad; Enter on the up-arrow is only a shortcut.

### User Flow

1. The user adds a project with the sidebar's "Add project" dialog (story 4). Importing any worktree of a repository adds the repository; the tree shows only the project row until it has shells.
2. The user clicks "+" on a git project's row. The modal opens with Existing selected and the dropdown "Start in" listing every worktree: the primary worktree first, shown as its branch (branch icon), then each linked worktree (folder icon) with its branch (or short commit id) on the first line and "<name> worktree" on the second.
3. With Existing, the user picks a worktree and clicks the up-arrow. A tab opens with a shell running the mock agent CLI in that worktree, and the tree shows project > worktree > shell. A worktree that already has shells can take more.
4. With Fork, the dropdown "Fork from" lists the origins: linked worktrees (forking from their current commit), a branch named exactly like a linked worktree grouped with that worktree, then the remaining local branches with the primary worktree's current one first, marked "(current)". A branch checked out in a linked worktree is listed only as that worktree. The modal shows the generated `probe-worktree-<6 hex>` name. The default origin is the primary worktree's current branch.
5. The user clicks the up-arrow; a second click while the start runs is ignored, and the modal shows "Creating probe-worktree-<hex>…". Probe creates the worktree in the worktrees folder of the Probe home with a new branch of the same name at the origin's commit, then opens a tab with a shell running the mock agent CLI inside it.
6. The next time the user opens the modal on that project, it preselects the same choice (Existing with the same worktree, or Fork with the same origin). One click starts another shell; for Fork it creates another worktree with a new name.

### Edge Cases

- **EC-1.** Automatic name: two forks in the same project always get different `probe-worktree-<6 hex>` names, also when started within the same second; a name that already exists on disk or as a branch is never reused.
- **EC-2.** A project with no commit: Fork is disabled with a note; Existing still starts in the primary worktree.
- **EC-3.** The remembered worktree has been removed from disk: the modal preselects the primary worktree instead and shows no error.
- **EC-4.** The remembered origin no longer exists: the modal falls back to the primary worktree's current branch. If it was still shown and the fork then fails, ER-1 applies.
- **EC-5.** The remembered choice is one record per workspace (the last successful start). Opening the modal on another project ignores it and shows the defaults.
- **EC-6.** Any worktree, including the primary one, may hold any number of shells; nothing is hidden from the dropdown because it has shells.
- **EC-7.** A project that is not a git repository: no switch and no worktree dropdown; the shell starts in the project's folder.
- **EC-8.** Fork origins are local branches and worktrees of the project only; remote branches are not listed and Probe does not fetch before forking.
- **EC-9.** A second click on the up-arrow while a start runs is ignored: one worktree and one shell are created.
- **EC-10.** Closing the modal after choosing Fork creates nothing on disk and does not change the remembered choice.
- **EC-11.** A detached-HEAD worktree is listed with its short commit id and is a valid origin: the fork starts from its current commit.
- **EC-12.** A branch switch inside any shell of a worktree relabels that worktree's node for all of its shells (git keeps one branch per worktree).
- **EC-13.** A shell that changes directory out of its worktree stays under it, marked "elsewhere" with its location in a tooltip.
- **EC-14.** The last running shell of a worktree ends: its node disappears; the worktree stays on disk and in the modal.
- **EC-15.** Importing a linked worktree's folder adds its repository as the project (a toast says so); a subfolder of a repository is added as itself.

### Error Handling

- **ER-1.** The fork fails (for example the origin no longer exists, the destination cannot be created, or git reports an error): the modal shows why, no shell or tab is created, and the modal stays open for another try.
- **ER-2.** After any failed fork, no worktree directory, no registered worktree and no branch created by this attempt is left behind (NFR-2). A worktree or branch that existed before the attempt is never removed.
- **ER-3.** The worktree is created but the shell cannot start: the modal shows why and no shell appears. The worktree and its branch are kept and offered under Existing next time; the remembered choice is not updated.
- **ER-4.** Listing the project's worktrees fails: Existing shows the error and starts in the project's folder; Fork still works when the branches can be listed.
- **ER-5.** A failed start is not remembered.
- **ER-6.** Listing the fork origins fails: Fork shows the error and the up-arrow is disabled; Existing still works.

## Out Of Scope

- A per-workspace prefix or naming pattern for worktree and branch names: later, per the epic (here the name is always `probe-worktree-<6 hex>`).
- Letting the user type or edit the worktree or branch name: not in the epic (names are generated automatically, FR-4).
- Deleting worktrees: killing a shell never removes a worktree; only a worktree whose creation failed is cleaned up (epic Out). Kill and remove belong to story 6.
- The tree appearing within 1 second of a start: story 4. Killing a shell and the kill command: story 6 (the node-removal check here uses whatever way the harness has to end a shell, SU-5).
- Several shells running at once with separate output: story 6 (FR-9). This story starts a second shell in a worktree only as scenario setup.
- Selecting an existing agent session or an initial prompt or a harness in the modal: later epics.
- Switching the starting point after the shell started, or rebasing and syncing the new worktree with its base: out of the epic.
- Remote branches as starting points and fetching from a remote before forking: not in the epic (decided: local branches and worktrees only).
- Submodule initialization policy and the worktrees-directory setting for the new flow: not in the epic.
- Recovering from a half-written layout after a server restart: stories 7 and 8.
- Desktop and mobile clients: not required by the epic (NFR-4).

## Technical Scope

- **Layers:** terminal UI (the per-project "+", the "Create shell" modal with its Existing | Fork switch and dropdown, and the remembered choice); server (a call that lists a folder's worktrees including detached ones, worktree start, automatic naming, failure handling, log lines); contracts (the new start inputs and results, the error shape); the saved workspace layout (the remembered worktree choice and starting point); the tree (worktree level with branch labels, branch and "elsewhere" tracking); scenario harness run by `vp run test:scenarios` (S3 and the worktree and branch parts of S2 and S4 with a real git repository fixture, including a folder with no commit, a detached-HEAD worktree and a failing fork).
- **Docs impact:** `probe/docs/` pages that describe the "+" modal and starting a shell (created by story 4); the text must say where new worktrees are placed (the worktrees folder of the Probe home), how they are named (`probe-worktree-<6 hex>`) and that they are kept when a shell ends. No inherited chat-worktree docs are extended.
- **Mobile impact:** none (the epic does not require mobile). Shared contract changes must not break the existing mobile compile where it is built today; this is `unverified` and is not an acceptance criterion because of NFR-4.

## Non-functional Requirements and Constraints

- NFR-2: a failed fork leaves no partial shell or half-created worktree.
- NFR-5: every step, including the pickers, is usable with the mouse or touchpad alone; shortcuts are optional.
- NFR-6: the server logs shell start with the shell id, cwd and, for FR-4, the worktree path and branch.
- NFR-1: the story must not add continuously repainting animation (for example a spinner or progress that repaints every frame) while the fork runs. The time limit for a worktree start is not set by the epic (SU-1).
- NFR-3: the scenarios create worktrees only in throwaway data and git fixtures, never in a real repository or in the real Probe home worktrees folder (the harness uses a temporary home directory).
- Constraints from `probe/AGENTS.md`: a server feature is a service method and the transport stays thin; anything crossing the wire is typed in `packages/contracts`. Worktree creation outside the chat and orchestration code is to be reused if it can (A-2).
- Chat is not deleted in this epic: the chat-bound worktree code stays but must not be reachable from the new screen.

## Acceptance Criteria

Rewritten 2026-11-06 for the revised design; the scenario S3 is being rewritten to match.

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a git project with a primary worktree, a linked worktree and a detached one, when the user opens "+" on its row, then Existing is selected and "Start in" lists the primary worktree first as its branch (branch icon), then the linked ones with their branch or short commit id and "<name> worktree" (folder icon). | auto | FR-5, EC-11 |
| AC-2 | Given Existing with a linked worktree selected, when the user clicks the up-arrow, then a tab opens with a shell running the mock agent CLI whose cwd is that worktree, and the tree shows project > that worktree > the shell. | auto | FR-5, FR-6 (part) |
| AC-3 | Given a worktree that already has a running shell, when the user opens the modal, then it is still listed and starting there adds a second shell under the same node. | auto | EC-6 |
| AC-4 | Given Fork, when the user opens "Fork from", then it lists linked worktrees, a branch named exactly like a linked worktree grouped with it, then the other local branches with the primary's current one first and marked "(current)"; a branch checked out in a linked worktree is not listed again, no remote branch is listed, the current branch is preselected and the generated `probe-worktree-<6 hex>` name is shown. | auto | FR-4, EC-8 |
| AC-5 | Given Fork from a branch, when the user clicks the up-arrow, then a worktree with the shown name exists in the worktrees folder of the Probe home on a new branch of that name at the branch's commit, a tab opens with the mock agent CLI running in it, and the tree shows it under the project. | auto | FR-4, FR-6 (part), FR-7 (part) |
| AC-6 | Given Fork from a linked or detached worktree, when the shell starts, then the new branch points at that worktree's current commit. | auto | FR-4, EC-11 |
| AC-7 | Given two forks in one project, the second right after the first, when both complete, then they have different names and branches and nothing existing was reused. | auto | FR-4, EC-1 |
| AC-8 | Given a forked shell, when the server logs are read, then one shell-start line has the shell id, cwd, worktree path and branch. | auto | NFR-6 |
| AC-9 | Given the last start in the workspace was a fork from origin X in project P, when the user opens "+" on P, then Fork and X are preselected and one click creates another worktree. | auto | FR-22 |
| AC-10 | Given the last start in P was Existing in worktree W, when the user opens "+" on P, then Existing and W are preselected and one click starts a shell in W without creating a worktree. | auto | FR-22, FR-5 |
| AC-11 | Given no earlier start in the workspace, when the user opens "+" on a git project, then Existing with the primary worktree is preselected and one click starts there. | auto | FR-5, FR-22 |
| AC-12 | Given the remembered worktree was removed from disk, when the user opens "+", then the primary worktree is preselected and no error shows. | auto | EC-3 |
| AC-13 | Given the remembered origin no longer exists, when the user opens "+" and Fork is preselected, then the primary's current branch is selected instead and no error shows. | auto | EC-4, FR-22 |
| AC-14 | Given choices remembered for project P1, when the user opens "+" on another git project P2, then P1's choice is not applied. | auto | EC-5, FR-22 |
| AC-15 | Given a project that is not a git repository, when the user opens "+" on it, then there is no switch and no worktree dropdown and the shell starts in the project's folder. | auto | FR-21, EC-7 |
| AC-16 | Given a git project with no commit, when the user opens "+", then Fork is disabled and Existing starts in the primary worktree. | auto | EC-2 |
| AC-17 | Given Fork with an origin that no longer exists at the click, when the user clicks the up-arrow, then the modal names the cause, no shell, tab or node appears and the modal stays open. | auto | FR-13, ER-1 |
| AC-18 | Given a failed fork (AC-17), when the project's worktrees, branches and the worktrees folder are compared with before the click, then they are identical. | auto | NFR-2, ER-2 |
| AC-19 | Given a failed fork, when the user reopens the modal, then the last successful start's choice is still preselected; and given the still open modal, when the user picks a valid origin and clicks the up-arrow, then a worktree and a shell are created. | auto | ER-5, ER-1 |
| AC-20 | Given the worktree list cannot be read, when the user opens "+", then Existing shows the error and still starts in the project's folder, and Fork is still offered when branches can be listed. | auto (unit and browser test) | ER-4 |
| AC-21 | Given Fork and the origin list cannot be read, when the user looks at the modal, then it shows the error and the up-arrow does not create a worktree. | auto (unit and browser test) | ER-6 |
| AC-22 | Given a created worktree whose shell cannot start (induced by the harness), when the user clicks the up-arrow, then the modal shows why, no shell appears, the worktree and branch still exist, the remembered choice is unchanged, and the kept worktree is listed under Existing on retry. | auto | ER-3 |
| AC-23 | Given Fork, when the user clicks the up-arrow twice while the first start runs (the harness holds the fork open), then the modal shows "Creating probe-worktree-<hex>…" with the up-arrow disabled, and exactly one worktree and one shell are created. | auto | EC-9, SU-2 |
| AC-24 | Given Fork selected, when the user closes the modal, then nothing is created on disk and the next open preselects the previous choice. | auto | EC-10 |
| AC-25 | Given shells in a worktree, when the user looks at the tree, then they sit under one node labelled with the worktree ("primary · <branch>" for the project's own checkout, else "<name> · <branch>") and there is no branch level. | auto | FR-7 (part) |
| AC-26 | Given two shells in one worktree, when the user switches branch in one, then within about 2 seconds the node shows the new branch and both shells stay under it. | auto | FR-7 (part), EC-12 |
| AC-27 | Given a shell in a worktree, when the user changes directory out of it, then the row shows "elsewhere" with the location in a tooltip and stays under its worktree; back inside, the mark goes away. | auto | FR-7 (part), EC-13 |
| AC-28 | Given the last running shell of a worktree ends (ended by the harness), when the user looks at the tree, then the worktree node is gone and the worktree is still listed under Existing. | auto | FR-7 (part), EC-14 |
| AC-29 | Given the user imports a linked worktree's folder with "Add project", when the dialog closes, then the repository is the project, a toast says so, and no worktree is shown under it until it has shells. | auto | FR-21, EC-15 |
| AC-30 | Given the steps above, when the scenario drives them, then every action is done with pointer actions only. | auto | NFR-5 |
| AC-31 | Given the final story, when the author checks the shipped pages, then `probe/docs/` describes the "Create shell" modal, forking and where new worktrees go. | manual (author) | NFR-7 |
| AC-32 | Given the code review, when the fork progress is inspected, then no continuously repainting animation was added to the modal or the tree. | manual (author, code review) | NFR-1 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-004 | The "+" modal, the folder step, the up-arrow button, the local shell start and the remembered folder; this story adds the worktree and starting-point steps to it. | backlog |
| PRB.T-003 | Workspaces, the saved workspace layout (where the remembered choices live) and the shell tree. | backlog |
| PRB.T-002 | Shells that exist without a chat thread, so a shell can start in a worktree. | backlog |
| PRB.T-001 | The scenario harness (`vp run test:scenarios`), mock agent CLI and a git fixture for S3. | done (2026-11-03); no git fixture exists in the harness, so this story adds it (S3) |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | Probe can list a folder's existing worktrees from git, including those with no shell and those not on a branch (epic A-12). Current code lists worktrees only as an attribute of branches. | assumption | verified | Verified 2026-11-05: `GitVcsDriver.listWorktrees` parses `git worktree list --porcelain` including detached worktrees (GitVcsDriverCore test, S3) | author |
| SA-2 | The existing worktree creation in the server can be reused outside chat and orchestration code (epic A-2). The code lives in `apps/server/src/vcs/GitVcsDriverCore.ts` and is exposed by `vcs.createWorktree`, but its thread-bound callers are in orchestration. | assumption | verified | Verified 2026-11-05: `createWorktree` is called from `SavedWorkspaces` with an explicit path and new branch, no thread involved | author |
| SA-3 | Forking a worktree needs at least one commit, so a folder without a commit offers only its own checkout (epic A-17). | assumption | verified | Verified 2026-11-05: a folder with no commit is refused for a new worktree and offers only its checkout (SavedWorkspaces test, S3 AC-17) | author |
| SA-4 | A failed fork can be made to leave nothing behind (no directory, no registered worktree, no new branch). Today the new branch is created before `git worktree add` and no rollback of it was seen in the code. | assumption | verified | Verified 2026-11-05: `createWorktree` creates the branch before `worktree add`; `SavedWorkspaces` removes the registered worktree, its folder and the branch this attempt made (unit test with a blocked `worktree add`, S3 AC-19) | author |
| SA-5 | The mock agent CLI starts the same way inside a worktree as inside a folder's own checkout (story 4). | assumption | verified | Verified 2026-11-05 in S3: the mock agent banner appears in new and existing worktrees | author |
| SA-6 | A shell's current branch can be learned and kept up to date after a branch switch inside the shell (epic A-11; the mechanism is TBD (author, 2026-11-16)). | assumption | false | Superseded 2026-11-05 by the user: git keeps one branch per worktree, so Probe shows the worktree's current branch (read from its HEAD) instead of a per-shell branch | author |
| SU-1 | The time limit for starting a shell in a new worktree (checkout of a large repository can be slow); the epic's NFR-1 limit covers shell start only. | unknown | verified | Measured 2026-11-05: about 900 ms from click to banner for a new worktree of a tiny repository (S3); reported, not enforced | author |
| SU-2 | What the modal shows while the fork runs (the epic says nothing). Needed so a long checkout is not a lying spinner and does not repaint continuously. | unknown | verified | Decided by the user 2026-11-05: static text "Creating probe-worktree-<hex>…" with the up-arrow disabled; no percentage, no animation | author |
| SU-3 | How a branch switch inside a shell is detected (epic A-11, mechanism TBD). | unknown | verified | Decided by the user 2026-11-05: the server reads each worktree's HEAD file (no shell hooks); a switch in any shell updates the worktree node | author |
| SU-5 | How the scenario ends a shell for the node-removal check before story 6's kill exists (for example the shell's process exits). | unknown | verified | Decided 2026-11-05: the scenario kills the shell's pid from the shell list, as PRB.T-004 S2 AC-19 does | author |
| SU-4 | How the tree labels a shell in a detached-HEAD worktree (no branch name exists). | unknown | verified | Decided by the user 2026-11-02: the short commit hash. | author |

## Implementation Status and Handoff

Done 2026-11-06 on `feat/worktrees-prb-t-005` (stacked on `feat/plus-modal-prb-t-004`). Durable decisions are in `docs/dev/roadmap.md`, usage in `docs/user/workspaces.md`, shell location polling in `docs/internals/terminal-runtime.md`; the follow-up rename is PRB.T-009.

**Decisions (user)**
- 2026-11-05: branch model is the real git state. Each worktree node shows its current branch, read by the server from the worktree's HEAD; no per-shell branch and no branch level. A shell whose cwd left its worktree stays under it, marked "elsewhere" with its location in a tooltip.
- 2026-11-05: while a worktree is created, the modal shows static text "Creating probe-worktree-<hex>…" (SU-2). Defaults: the primary worktree's current branch is the default origin (U-2); SU-1 measured and reported, not enforced; SU-5 a scenario kills the shell pid.
- 2026-11-05 to 2026-11-06 (manual pass, three iterations): a workspace holds **projects** (code and saved data keep "folder" until PRB.T-009). Importing any worktree of a repository adds the repository and shows nothing else. The only start control is a "+" on each project row, opening "Create shell": a disabled "Starting script" dropdown ("mock agent"), an **Existing | Fork** switch and one dropdown. Existing lists every worktree; any worktree takes any number of shells. Fork lists linked worktrees, then same-named branches grouped with their worktree, then remaining branches (current first); branches checked out in a linked worktree are not repeated. Items: icon (branch for branches and the primary worktree, folder for linked worktrees), branch on line 1, "<name> worktree" on line 2. The repository's own checkout is called **primary** ("primary · main" in the tree). The tree shows only worktrees with running shells; there are no per-worktree buttons, hiding or worktree management (tried and dropped).

**What was built**
- Contracts: `workspace.folderGit`, `WorkspaceWorktreeChoice` on `workspace.startShell`, `WorkspaceDetail.lastStart` (old `lastFolder` files still read), `WorkspaceAddFolderResult.resolvedFrom`, `ShellSummary.folder/worktree/branch/elsewhere`.
- Server: `GitVcsDriver.listWorktrees` and `hasCommit`; `SavedWorkspaces.folderGit`, worktree starts with rollback of a failed fork, linked-worktree import resolved to its repository; `Shells` polls HEAD files and shell cwds every 2 s.
- Web: `StartShellDialog` ("Create shell", per project), rules in `worktreeChoice.ts`, tree project > worktree > shell in `WorkspaceSidebar`.
- Scenarios: S2 and S3 drive the per-project modal through `scripts/scenarios/scenarios/workspaceUi.ts`; S3 holds a fork open with a post-checkout hook for AC-23.

**Verification (2026-11-06, author; no separate verify-agent report, as for PRB.T-004)**
- Checks: focused tests (1654 across `SavedWorkspaces`, `Manager` (Shells), `GitVcsDriverCore`, `RpcAuthorization`, `ws`, contracts, client-runtime, web workspaces and the React compiler check); typecheck of contracts, client-runtime, server, web, mobile, desktop and scripts; format, lint and knip on the changed files; `vp run test:scenarios` with S1, S2, S3 and T-002 passing (S3 also passed three more runs), the self-test and `harness.test.ts`.
- AC-1 to AC-19, AC-22 to AC-30: met, by scenario S3 (the stage named after each AC); AC-15 and the no-commit case also by S2. AC-8's start line carries the worktree path and branch (S3 and `Manager.test.ts`).
- AC-20, AC-21 (one listing fails): met by `SavedWorkspaces.test.ts` ("reports a failed worktree or branch listing") and `StartShellDialog.browser.test.tsx`; real git cannot fail one listing alone.
- AC-31: met, `docs/user/workspaces.md` "Worktrees". AC-32: met, the diff adds no animation; fork progress is static text.
- SU-1: fork start-to-banner 411 to 422 ms for a tiny repository, reported and not enforced.
- Manual pass by the user in `vp run dev` (2026-11-06): accepted.
