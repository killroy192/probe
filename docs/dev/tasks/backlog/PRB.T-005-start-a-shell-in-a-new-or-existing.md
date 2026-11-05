---
id: PRB.T-005
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, plan]
created: 2026-11-02
updated: 2026-11-02
---

# Start a shell in a new or existing worktree

## Business Goal

**Problem:** After story 4 a user can start a shell only in a folder's own checkout. Agents running in parallel on one repository then share one working tree and step on each other's files. The user has no way, from the "+" modal, to give an agent its own isolated worktree, or to start a second shell in a worktree that already exists.

**Proposed solution:** For a git folder, the "+" modal gets a worktree step (an existing worktree, none, or "new worktree") and, for "new worktree", a starting-point step. Probe names the new worktree and its branch automatically, creates it, and runs the shell there. If creating it fails, the user sees why and nothing is left behind. The modal remembers the last worktree choice and starting point, so repeating a start takes one click.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 5 Start a shell in a new or existing worktree ("Fork-or-open per agent", after story 4).
- **Delivers:**
  - FR-4: "new worktree" with a chosen starting point (branch or existing worktree); Probe names the worktree `probe-worktree-<6 hex>`, creates it in the worktrees folder of the Probe home (the existing T3 home), gives its new branch the same name, and the shell runs in the new worktree.
  - FR-5: the existing-worktree picker (lists the folder's worktrees that have no active shell, plus "new"; an active shell is any shell still in the tree) and the "none" choice with the starting-point step skipped. The "none" path itself already exists from story 4; this story adds the picker and the skip rule.
  - FR-13: a failed fork shows why and creates no shell. The part about non-git folders not offering worktree or branch choices is already delivered by story 4 (FR-21) and is only kept working here.
  - FR-22 (part): the remembered worktree choice and starting point (existing worktree, none, or "new worktree") are preselected on the next open, so one click on the up-arrow button starts another shell. The remembered folder is delivered by story 4.
  - NFR-2 (part): a failed fork leaves no partial shell or half-created worktree.
  - NFR-1 (part): no continuously repainting animation in the new steps; the time limit for a worktree start is left open (SU-1) and no criterion checks it.
  - NFR-5 (part): the new steps work with mouse or touchpad alone.
  - NFR-6 (part): the server logs shell start with the worktree path and branch (FR-4).
  - NFR-7 (part): docs updated in the same PR.
  - FR-6 (part): a shell started in a new or existing worktree runs the mock agent CLI and opens as a tab.
  - FR-7 (part, per the epic's verification table): the worktree and branch levels of the tree. A shell's branch is the one it was started on and is updated when the user switches branch inside that shell; the branch level is hidden while all shells of a worktree are on one branch. Story 3 owns the tree and grouping and story 4 the 1-second appearance; the node disappearing with its last shell and the worktree staying in the picker are checked here too, because story 6's scope assigns node removal rules to stories 3, 4 and 5 (see SU-5).
  - Epic U-2 is resolved here: the default starting point is the folder's current branch (location and name are decided in FR-4). NFR-2 (failed fork) is named in the epic's S3 row; the NFR-2 owner list names only stories 6 and 8, which is noted as an epic inconsistency.
  - A-11 (epic assumption, owned by this story): learning a shell's current branch, recorded at start and updated on a branch switch inside the shell.
- **One deployable outcome:** A user can start a shell in a brand-new, automatically named worktree forked from a chosen starting point, or in an existing worktree, and repeat that with one click; this gives each agent its own isolated checkout, which is the "fork-or-open per agent" step of the epic's workspace promise.

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

Once this story ships, in the "+" modal of a workspace, a git folder offers a worktree step after the folder step, and a starting-point step after "new worktree". A folder that is not a git repository offers neither. Everything is done with the mouse or touchpad; Enter on the up-arrow is only a shortcut.

### User Flow

1. The user clicks "+" and selects a git folder (folders are added beforehand with the sidebar's "Add project" dialog, decided in story 4).
2. The worktree step shows three choices: an existing worktree of the folder, none (the folder's own checkout on its current branch), or "new worktree". The existing-worktree list shows only the folder's worktrees that have no active shell (including detached-HEAD ones); a worktree that already has an active shell is not offered. On the first open the preselected choice is none; later opens preselect the remembered choice (FR-22).
3. If the user selects none or an existing worktree, the starting-point step is skipped. The user clicks the up-arrow button; a tab opens with a shell running the mock agent CLI in that checkout, and the shell appears under its folder and worktree in the tree.
4. If the user selects "new worktree", Probe shows the automatically generated worktree and branch name, and the starting-point step lets the user select the branch or an existing worktree the new worktree forks from. The folder's current branch is preselected as the starting point.
5. The user clicks the up-arrow button; a second click while the start runs is ignored. Probe creates the worktree `probe-worktree-<6 hex>` in the worktrees folder of the Probe home with a new branch of the same name from the chosen starting point, then opens a tab with a shell running the mock agent CLI inside the new worktree. The shell appears in the tree under its folder, the new worktree and its branch.
6. The next time the user clicks "+" in this workspace, the modal preselects the same folder, the same worktree choice ("new worktree", or the existing worktree, or none) and, for "new worktree", the same starting point. One click on the up-arrow button starts another shell: for "new worktree" this creates another new worktree with a new automatic name; an existing worktree is preselected again only while it still has no active shell, otherwise the modal falls back to the default choice.

### Edge Cases

- **EC-1.** Automatic name: two new-worktree starts in the same folder always get different `probe-worktree-<6 hex>` names, also when started within the same second; a name that already exists on disk or as a branch is never reused (a random name that collides is replaced by another).
- **EC-2.** A folder with no commit (SA-3, A-17): the new-worktree choice is not offered; the folder's own checkout stays available.
- **EC-3.** The remembered existing worktree has been removed from disk since the last start: the modal does not preselect it and falls back to the default choice; it does not fail on open.
- **EC-4.** The remembered starting point (a branch or worktree) no longer exists: the modal falls back to the default starting point (the folder's current branch) instead of failing on open. If it was still shown as selected and the fork then fails, ER-1 applies.
- **EC-5.** The remembered choices are a single record per workspace (kept in that workspace's saved layout) of the last successful start. When the user selects a different folder than the remembered one, its worktree choice and starting point are not applied and the defaults are used.
- **EC-6.** A worktree that has an active shell is not listed in the picker; once its last shell ends it is listed again. Because of this, scenarios that need several shells in one checkout use the folder's own checkout ("none"), which may hold several shells.
- **EC-7.** A folder that is not a git repository: no worktree step, no starting-point step, no remembered worktree choice is applied (kept from story 4).
- **EC-8.** The starting point list contains local branches and existing worktrees of the folder only; remote branches are not listed and Probe does not fetch before forking.
- **EC-9.** The user clicks the up-arrow button a second time while the first start is in progress: the second click is ignored and only one worktree and one shell are created.
- **EC-10.** The user closes the modal after choosing "new worktree" but before starting: nothing is created on disk, and the remembered choice is not updated.
- **EC-11.** A worktree on a detached HEAD is listed in the picker and is a valid starting point: the new worktree forks from its current commit.
- **EC-12.** The user switches to a different branch inside a shell: the worktree node shows the new branch for all of its shells (git keeps one branch per worktree; decided 2026-11-05).
- **EC-13.** A shell in a worktree is started on the worktree's branch (for a new worktree, the new `probe-worktree-<6 hex>` branch). A detached-HEAD worktree node is labelled with the short commit hash (SU-4, decided). A shell that changes directory to outside its worktree stays under it and is marked "elsewhere".
- **EC-14.** The last shell of a worktree or branch ends: its node disappears from the tree, and the worktree stays in the picker (FR-7).

### Error Handling

- **ER-1.** The fork fails (for example the starting point no longer exists, the destination cannot be created, or git reports an error): the user sees a message that says why, no shell and no tab is created, and the modal stays open so the user can change the starting point and retry.
- **ER-2.** After any failed fork, no worktree directory, no registered worktree and no new branch created for this attempt is left behind (NFR-2); this is the only cleanup the epic allows. A worktree or branch that existed before the attempt is never removed.
- **ER-3.** The worktree is created but the shell cannot start: the user sees why and no shell appears. The created worktree and its branch are kept: only a worktree whose creation failed is cleaned up. The remembered choices are not updated (only a successful start updates them), and on retry the user can pick the kept worktree (it has no active shell, so it is listed) or choose "new worktree" to create another; Probe never reuses it automatically and never removes it.
- **ER-4.** Listing the folder's worktrees fails (for example git is unavailable): the worktree step shows the error and does not offer the existing-worktree choice; "none" stays available, and so does "new worktree" with branches as starting points if they can be listed.
- **ER-5.** A failed fork is not remembered: the last successful choices stay as the defaults.
- **ER-6.** Listing the starting points fails: the starting-point step shows the error and the up-arrow button does not start a new worktree; the user can go back to "none" or an existing worktree.

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

- **Layers:** terminal UI (the worktree step, the existing-worktree picker, the starting-point step and the remembered choices inside the "+" modal); server (a call that lists a folder's worktrees including detached ones, worktree start, automatic naming, failure handling, log lines); contracts (the new start inputs and results, the error shape); the saved workspace layout (the remembered worktree choice and starting point); the tree (worktree and branch levels, branch tracking); scenario harness run by `vp run test:scenarios` (S3 and the worktree and branch parts of S2 and S4 with a real git repository fixture, including a folder with no commit, a detached-HEAD worktree and a failing fork).
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

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a git folder with its own checkout and two linked worktrees, one with an active shell and one without, when the user opens the worktree step in the "+" modal, then the picker lists only the linked worktree without a shell, the own checkout is offered as "none" (it is not listed a second time), and "new worktree" is offered. | auto | FR-5, EC-6 |
| AC-2 | Given the worktree step, when the user selects an existing worktree and clicks the up-arrow button, then the starting-point step was never shown, a tab opens with a shell running the mock agent CLI whose cwd is that worktree, and the shell appears under that worktree in the tree. | auto | FR-5, FR-6 (part) |
| AC-3 | Given a git folder with at least one commit, when the user selects "new worktree", then the modal shows a generated `probe-worktree-<6 hex>` name, the starting-point step lists the folder's local branches and existing worktrees (no remote branches), and the folder's current branch is preselected. | auto | FR-4, EC-8 |
| AC-4 | Given "new worktree" and a starting branch selected, when the user clicks the up-arrow button, then a new worktree named `probe-worktree-<6 hex>` exists (with the name the modal showed) in the worktrees folder of the Probe home on a new branch of the same name that points at the starting branch's current commit, a tab opens with a shell running the mock agent CLI whose cwd is the new worktree, and the shell appears under the folder and the new worktree in the tree. | auto | FR-4, FR-6 (part), FR-7 (part) |
| AC-5 | Given "new worktree" with an existing worktree selected as the starting point, when the user starts the shell, then the new worktree forks from that worktree's current commit and the shell runs in the new worktree. | auto | FR-4 |
| AC-6 | Given a worktree on a detached HEAD with no active shell, when the user opens the worktree step, then it is listed in the picker labelled with the short commit hash, and when it is chosen as the starting point of a new worktree, then the new worktree's branch points at the detached worktree's current commit. | auto | EC-11, FR-5, FR-4 |
| AC-7 | Given two "new worktree" starts in the same folder (the second within the same second), when both complete, then there are two worktrees with different `probe-worktree-<6 hex>` names and branches and one shell in each; no existing worktree or branch was reused. | auto | FR-4, EC-1 |
| AC-8 | Given a started new-worktree shell, when the server logs are read, then they contain one shell-start line with the shell id, the cwd, the worktree path and the branch. | auto | NFR-6 |
| AC-9 | Given the last start used "new worktree" from branch X in folder F, when the user clicks "+" again in the same workspace, then F, "new worktree" and X are preselected, and one click on the up-arrow button creates a second new worktree and opens a shell in it. | auto | FR-22 |
| AC-10 | Given the last start used an existing worktree W and W has no active shell now (its shell was killed), when the user clicks "+" again, then W is preselected and one click on the up-arrow button starts a shell in W without creating a worktree; while W has an active shell it is not listed and the default choice is preselected. | auto | FR-22, FR-5 |
| AC-11 | Given a git folder and no earlier start in the workspace, when the user opens the worktree step, then none is preselected, and when the user starts, then the starting-point step was never shown and the shell runs in the folder's own checkout. | auto | FR-5, FR-22 |
| AC-12 | Given the last start used "none", when the user clicks "+" again, then none is preselected and one click starts a shell in the folder's own checkout. | auto | FR-22, FR-5 |
| AC-13 | Given the remembered worktree W was removed from disk, when the user clicks "+", then W is not preselected, the modal opens with the default choice and shows no error. | auto | EC-3 |
| AC-14 | Given the remembered starting point no longer exists, when the user clicks "+" and "new worktree" is preselected, then the folder's current branch is selected instead and the modal shows no error. | auto | EC-4, FR-22 |
| AC-15 | Given choices remembered for folder F1, when the user selects another git folder F2, then F1's worktree choice and starting point are not applied to F2. | auto | EC-5, FR-22 |
| AC-16 | Given a folder that is not a git repository, when the user selects it in the modal, then no worktree step and no starting-point step are shown and the shell starts in the folder. | auto | FR-13, FR-21, EC-7 |
| AC-17 | Given a git folder with no commit, when the user opens the worktree step, then "new worktree" is not offered and the folder's own checkout can still be started. | auto | EC-2 |
| AC-18 | Given "new worktree" with a starting point that no longer exists at the moment of the click, when the user clicks the up-arrow button, then the modal shows a message that names the cause, no shell, tab or tree node appears, and the modal stays open. | auto | FR-13, ER-1 |
| AC-19 | Given a failed fork (AC-18), when the folder's worktrees, branches and the worktrees directory are compared with the state before the click, then they are identical: no new directory, no registered worktree, no new branch. | auto | NFR-2, ER-2 |
| AC-20 | Given a failed fork, when the user opens the modal again, then the choices remembered from the last successful start are still the ones preselected. | auto | ER-5 |
| AC-21 | Given a failed fork, when the user picks a valid starting point in the still open modal and clicks the up-arrow button, then a worktree and a shell are created. | auto | ER-1 |
| AC-22 | Given the worktree list cannot be read, when the user opens the worktree step, then it shows the error, does not offer the existing-worktree choice, and starting with none in the folder's own checkout still works; "new worktree" with branches as starting points is still offered when branches can be listed. | auto | ER-4 |
| AC-23 | Given "new worktree" selected and the starting-point list cannot be read, when the user looks at the modal, then it shows the error and the up-arrow button does not create a worktree. | auto | ER-6 |
| AC-24 | Given a worktree that has an active shell, when the user opens the worktree step, then it is not listed; and given the folder's own checkout with two shells, then "none" is still offered and starts a third. | auto | EC-6 |
| AC-25 | Given a created worktree whose shell cannot start (the failure is induced by the scenario harness), when the user clicks the up-arrow button, then the modal shows why, no shell or tab appears, and the created worktree and its branch still exist; the remembered choices are not updated, and on retry the kept worktree is listed in the existing-worktree step and can be picked, or "new worktree" creates another (the earlier one stays). | auto | ER-3 |
| AC-26 | Given "new worktree" selected, when the user clicks the up-arrow button a second time while the first start is in progress (the harness holds the fork open), then the second click is ignored and exactly one worktree and one shell are created. | auto | EC-9 |
| AC-27 | Given "new worktree" selected, when the user closes the modal without starting, then nothing is created on disk and the next open preselects the previous remembered choices. | auto | EC-10, FR-22 |
| AC-28 | Given shells in a worktree, when the user looks at the tree, then the shells sit under one node for that worktree, labelled with the worktree (the folder's own checkout as "checkout") and its current branch, and there is no separate branch level. | auto | FR-7 (part) |
| AC-29 | Given two shells in one worktree, when the user switches branch inside one of them, then within about 2 seconds the worktree node shows the new branch and both shells stay under it. | auto | FR-7 (part), EC-12 |
| AC-30 | Given a shell in a worktree, when the user changes directory inside it to a place outside that worktree, then the shell stays under its worktree and its row shows "elsewhere" with the new location; back inside the worktree, the mark goes away. | auto | FR-7 (part), EC-13 |
| AC-31 | Given the last shell of a worktree ends (ended by the harness), when the user looks at the tree, then that worktree node is gone and the worktree is still listed in the picker of the "+" modal. | auto | FR-7 (part), EC-14 |
| AC-32 | Given the steps above, when the scenario drives all of them, then every action (select folder, worktree, starting point, up-arrow, close) is done with pointer actions only. | auto | NFR-5 |
| AC-33 | Given the final story, when the author checks the shipped pages, then `probe/docs/` describes starting a shell in a new or existing worktree and where new worktrees go. | manual (author) | NFR-7 |
| AC-34 | Given the code review of the story, when the fork progress is inspected, then no continuously repainting animation was added to the modal or the tree. | manual (author, code review) | NFR-1 |

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
| SA-1 | Probe can list a folder's existing worktrees from git, including those with no shell and those not on a branch (epic A-12). Current code lists worktrees only as an attribute of branches. | assumption | unverified | Prove at the start of this story with a git fixture that has a detached-HEAD worktree and a worktree without a shell. | author |
| SA-2 | The existing worktree creation in the server can be reused outside chat and orchestration code (epic A-2). The code lives in `apps/server/src/vcs/GitVcsDriverCore.ts` and is exposed by `vcs.createWorktree`, but its thread-bound callers are in orchestration. | assumption | unverified | Read and call it from a test without a thread, before the modal depends on it. | author |
| SA-3 | Forking a worktree needs at least one commit, so a folder without a commit offers only its own checkout (epic A-17). | assumption | unverified | Run `git worktree add -b` in an empty repository in a fixture. | author |
| SA-4 | A failed fork can be made to leave nothing behind (no directory, no registered worktree, no new branch). Today the new branch is created before `git worktree add` and no rollback of it was seen in the code. | assumption | unverified | Force a failing `git worktree add` in a fixture and list branches and worktrees afterwards. | author |
| SA-5 | The mock agent CLI starts the same way inside a worktree as inside a folder's own checkout (story 4). | assumption | unverified | Check in the first scenario of this story. | author |
| SA-6 | A shell's current branch can be learned and kept up to date after a branch switch inside the shell (epic A-11; the mechanism is TBD (author, 2026-11-16)). | assumption | false | Superseded 2026-11-05 by the user: git keeps one branch per worktree, so Probe shows the worktree's current branch (read from its HEAD) instead of a per-shell branch | author |
| SU-1 | The time limit for starting a shell in a new worktree (checkout of a large repository can be slow); the epic's NFR-1 limit covers shell start only. | unknown | unverified | Measure in the first scenario and decide with the author. TBD (author, 2026-11-16). | author |
| SU-2 | What the modal shows while the fork runs (the epic says nothing). Needed so a long checkout is not a lying spinner and does not repaint continuously. | unknown | verified | Decided by the user 2026-11-05: static text "Creating probe-worktree-<hex>…" with the up-arrow disabled; no percentage, no animation | author |
| SU-3 | How a branch switch inside a shell is detected (epic A-11, mechanism TBD). | unknown | verified | Decided by the user 2026-11-05: the server reads each worktree's HEAD file (no shell hooks); a switch in any shell updates the worktree node | author |
| SU-5 | How the scenario ends a shell for the node-removal check before story 6's kill exists (for example the shell's process exits). | unknown | verified | Decided 2026-11-05: the scenario kills the shell's pid from the shell list, as PRB.T-004 S2 AC-19 does | author |
| SU-4 | How the tree labels a shell in a detached-HEAD worktree (no branch name exists). | unknown | verified | Decided by the user 2026-11-02: the short commit hash. | author |

## Implementation Status and Handoff

Plan stage done (2026-11-05). The working plan is `.plans/PRB.T-005-worktrees.md` (gitignored, local); this section is enough to continue without it. Branch: `feat/worktrees-prb-t-005`, stacked on `feat/plus-modal-prb-t-004`.

**Decisions (user, 2026-11-05)**
- Branch model is the real git state: each worktree node in the tree shows its current branch, read by the server from the worktree's HEAD; no per-shell branch and no branch level (epic FR-7, S4, A-11 and AC-28 to AC-30 rewritten). A shell whose cwd left its worktree stays under it, marked "elsewhere" with its location (the server reads each shell's cwd).
- While a worktree is created, the "+" dialog shows static text "Creating probe-worktree-<hex>…" (SU-2).
- The tree labels the own checkout "checkout · <branch>"; a linked worktree by its directory name (plus the branch when it differs); non-git folders have no worktree node.
- The worktree step lives in the "+" (Start shell) dialog; folders are added in the separate Add folder dialog (story 4).
- Defaults: U-2 the folder's current branch is the default starting point; SU-1 measured and reported, not enforced; SU-5 a scenario kills the shell pid.

**Approach**
- Server: `GitVcsDriver.listWorktrees` (porcelain, incl. detached) and `hasCommit`; `SavedWorkspaces.folderGit` (worktrees, branches, proposed name, separate errors) and `startShell` with a worktree choice (checkout, existing, new with rollback of only what the attempt created); `lastStart` replaces `lastFolder`; `Shells` keeps folder and worktree per shell and polls HEAD files and shell cwds every ~2 s.
- Web: worktree and starting-point steps in `StartShellDialog`; tree folder > worktree > shell.
- Scenario S3 with git fixtures (linked, detached, no commit) and a post-checkout hook that holds a fork open (AC-26); AC-22/AC-23 (listing failures) are covered by unit and browser tests, since real git cannot fail one listing but not the other.

**Not done**
- Everything (plan checkpoints 1 to 5).
