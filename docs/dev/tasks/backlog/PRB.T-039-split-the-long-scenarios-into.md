---
id: PRB.T-039
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Split the long scenarios into independent tests

## Business Goal

**Problem:** S2, S3, S7 and E2-S1 are each one linear script of 10 to 25 acceptance criteria (S2 runs about 20 stages, S3 about 20, S7 about 21 and E2-S1 10, read from their `stage =` lines). An early failure hides every later criterion, nothing can be rerun from stage N, a stage often depends on a shell or folder an earlier stage made, and the four scripts restart the server 11 times (S2 2, S3 1, S7 3, E2-S1 5) even where the stage under test has nothing to do with restarting. S4 waits with `sleep 2` for output to arrive during a reload, S6 finds its background jobs with a pattern (`sleep 1601`) that any other run on the machine would match, and S4 and S6 read "is it gone" with a count taken at one instant.

**Proposed solution:** Each of the four scenarios becomes several independent tests, each building its own fixtures (using PRB.T-038's API setup) and runnable alone. A restart stays only in a test whose subject is restart or startup behaviour. S4's sleep is replaced by output the test releases, S6's jobs carry a marker unique to the run, and S4's and S6's "is gone" checks wait for the page to settle instead of sampling once. Every old acceptance criterion maps to a running test; none is dropped.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 4 PRB.T-039 Split the long scenarios
- **Delivers:**
  - FR-11: S2, S3, S7 and E2-S1 are split into independent scenarios that each build their own repo and can run alone; restarts remain only where restart behavior is the subject.
  - FR-14 (the process-table marker for S6 only): S6 looks only for its own marker in the process table. Ports and per-workspace assertions are PRB.T-040's.
  - FR-4 and FR-12 (partly touched): only S4's sleep and the absence checks of S4 and S6; the rest of both is not changed here.
  - FR-13 (the id part): each part has its own id, the old id plus a part name, shown in the output; the old id still selects all its parts.
  - NFR-2: no race between stages that depended on each other's leftovers.
  - NFR-5: a failure names the scenario id and stage; any split test is one documented line to run alone.
  - NFR-6: failure artifacts of PRB.T-036 apply to every new test.
  - R-3 (epic risk): splitting must not lose criteria; the mapping below is the mitigation.
- **One deployable outcome:** After this ships, a failure in S2, S3, S7 or E2-S1 names one behavior, any one of their parts runs alone, and S4 and S6 stop depending on a sleep, a machine-wide process pattern and one-instant counts. This is the independence PRB.T-040 needs to share a server and run in parallel.

## Current Behavior

Read on 2026-11-09 (the code search index was unavailable; files were read directly, not run). PRB.T-036, T-037 and T-038 have not landed, so names below are today's.

- **One script per scenario, no independence.** Each `run` is one function with a `stage` variable and one try/catch that prefixes the stage (for example plus-modal.ts, worktrees.ts, restart.ts, starting-scripts.ts). A scenario builds its repo and workspace once at the start (S3: worktrees.ts:95-130; S7: restart.ts:113-120) and later stages reuse the shells and folders earlier stages made.
- **S2** (scripts/scenarios/scenarios/plus-modal.ts, 491 lines, id `S2`): stages include AC-11 (no project yet), refusals and folder list, AC-17 (a file, a denied create), AC-1/8 (import), AC-2/3/21 (first start, banner, node within 1 s), AC-4, AC-5, AC-6 (size after leaving the CLI), AC-7/12/24 (preselect, double click starts one), the PRB.T-011 contract (command once, after the prompt), AC-9, AC-10, AC-13, AC-14/15 (deleted folder), AC-14, AC-19 (log lines), AC-16 (unstartable script, with a restart carrying a git fault at line 384), AC-17 (git init fails, then a restart at line 422), AC-18 (connection drops during start), AC-25 (another workspace), AC-23 (no chat route). Two restarts.
- **S3** (worktrees.ts, 519 lines, id `S3`): stages AC-29, AC-11/1, AC-3, AC-26/27, AC-15/16, AC-2, AC-10, AC-4, AC-5/8, AC-9/7, AC-24, AC-14, AC-6, AC-13, AC-17/18, AC-19, AC-28, AC-12, AC-23 (double click), AC-22 (unstartable script) which adds a script to the saved list and restarts (worktrees.ts:470-476). One restart. The saved list is read by the server on every use (workspaceUi.ts, comment on `startingScriptsFile`; starting-scripts.ts stages AC-22 and AC-7 rewrite it with no restart), so that restart looks unnecessary (SU-1). S3 counts `[data-worktree]` globally and hard-codes `/tmp` (per the analysis; only partly re-read).
- **S7** (restart.ts, 444 lines, id `S7`): one setup of 11 shells over 5 projects and two workspaces (restart.ts:116-195), then stages AC-6, AC-7, AC-31, EC-1, AC-34 (after a restart), AC-12/13/14/23, AC-16/22, AC-29, AC-18, AC-17, AC-21, AC-19, AC-10, AC-20 (a restart that lost the shell host), AC-17 again after another restart, AC-33 (remove a workspace). Three restarts (restart.ts:209, 394, 404), the middle one with the shell host stopped.
- **E2-S1** (starting-scripts.ts:160-322): AC-21, AC-3, AC-4, AC-12 (logs), AC-5 (preselected after a restart), AC-22, AC-7, AC-23 (emptied list not seeded again, restart), AC-9 (damaged list, restart), AC-8 (no default, restart; then a second restart seeds). Five restarts (lines 241, 280, 289, 302, 309) and edits to the saved list between stages.
- **S4** (many-shells.ts): writes `sleep 2; echo during-$((1+1))-s4` into a shell (many-shells.ts:153) so that output arrives while the page reloads; the page is then checked for tabs and for the marker. Absence is read once with `count() === 0` for a closed, killed and signalled shell's tab and row (many-shells.ts:198, 230, 237).
- **S6** (kill-shell.ts): the jobs are found with `ps -A` filtered by the pattern `/^sleep 160[12]$/` (kill-shell.ts:34-44, 120-121), so any other process of that shape on the machine (another run) is matched. Absence of a tab and an alert is read once with `count()` (kill-shell.ts:127, 200).
- **Ids.** `run.ts` selects with `--only <id>` by exact id match (run.ts:140) and prints `passing/TOTAL` with `TOTAL = 8` (run.ts:29); `storyScenarios` such as E2-S1 and E2-S3 are counted separately (registry.ts).
- **Not yet verified.** That each stage is independent of the earlier ones (several look coupled: S2's AC-7 uses the earlier AC-2 shell; S7's "stay gone after another restart" uses earlier kills). Mobile and desktop: not touched.

## Expected Behavior

The four long scenarios are replaced by groups of independent tests; the old ids are still visible. Nothing is proved less than before.

- **Splits proposed by the desk analysis** (the author may regroup as long as the acceptance criteria below hold):
  - S2: modal and validation; start and double click; resize and kill; the tests that need a restart (script missing with a git fault, git init failure); workspace isolation.
  - S3: modal lists; remembered choice; fork naming; failures; concurrency (double click); the unstartable script.
  - S7: restart survival; missing folders and removal; save-failure alerts; lost shell host; workspaces.
  - E2-S1: the file-edit stages run against a running server; only the restarts that prove startup rules remain (AC-5, AC-9, AC-8, AC-23 of that scenario).
- **Own fixtures.** Each test builds the repo, workspace and shells it needs through the shared fixtures of PRB.T-038 and does not read what another test left.
- **Restarts.** A test restarts only when the restart (or a startup condition) is what it proves. The author lists every remaining restart with the behavior it proves in the ticket handoff.
- **Ids.** Each part has its own id shown in the output: the old id plus a part name. `--only <old id>` runs all of that scenario's parts; `--only <part id>` runs one. Running the parts in reverse order is not part of this story unless the current runner already supports it.
- **Account of criteria.** Before an old scenario is deleted, every one of its stages is listed against at least one test that now covers it. The list is kept in the ticket's Handoff section.
- **S4.** The command that today sleeps for 2 seconds is replaced so that the output is provably produced after the reload starts and is shown once; how is left to the plan.
- **S6.** The background jobs carry a marker no other run or scenario on the machine uses, and the scenario looks for that marker only.
- **S4 and S6 absence checks** wait until the page has settled (the element is detached, or the server has confirmed the end) rather than sampling once.

### User Flow

1. A developer or agent runs the suite; each split test shows under its old scenario id in the output.
2. A test fails; the output names the id and stage and carries the artifacts of PRB.T-036.
3. They rerun only that test with `--only <part id>` and it passes or fails the same way, whatever ran before.
4. They run `--only <old id>` to run every part of one old scenario.

### Edge Cases

- EC-1: A stage that depends on a shell or folder from an earlier stage (S2 AC-7, S7 AC-17 after restart) gets its own setup in its new test, not a leftover.
- EC-2: A criterion that needs a restart to be tested (S7 AC-6, AC-7, AC-20, E2-S1 AC-5, AC-8, AC-9, AC-23) keeps its real restart; the restart is part of the test, not shared with an unrelated one.
- EC-3: S2's two restarts (git fault, then clear) exist to change the server's startup environment (line 384), not to test restarting. Whether that stays a restart (a test that needs a fresh server) or is injected another way is open (SU-2); either way it is listed.
- EC-4: A "never appeared" check (as against "went away") has no element to wait on to detach. It waits on the fact that settles it (for example the shell list event) and then asserts absence.
- EC-5: The old ids (`S2`, `S3`, `S7`, `E2-S1`) must still select something: all of that scenario's parts (SU-3).
- EC-6: S4's reload with output arriving must still show that output once, after the reload, and S4 must not pass if the output had arrived before the reload (the point of the sleep).
- EC-7: S6's marker is unique per run and per scenario; a decoy process of the same shape started by something else is not matched.

### Error Handling

- ER-1: A split test fails: the message carries the old id, the stage, and the artifacts (screenshot, server log tail, recorder values) from PRB.T-036, not a bare stage name.
- ER-2: A stage's old setup leftover is missing in the new test: it fails at its own setup with the reason, not later with a missing element.
- ER-3: S4's release never happens (the file is never created): the test fails with a named wait, not a silent pass.

## Out Of Scope

- API setup and the real UI paths: PRB.T-038 (this story builds on it).
- The Playwright Test runner, shared servers, parallel workers, port reservation, retiring `run.ts`, `registry.ts` and `TOTAL = 8`: PRB.T-040. Until then each scenario still cold-starts its own server.
- Prompt-ready and layout-saved signals: PRB.T-041. Typing and reload guesses stay as they are here.
- Removing process-table scans from S6 entirely, and scoping every assertion to a workspace (the rest of FR-14): PRB.T-040.
- Splitting S1, S4, S5, S6, S8 (only S4's sleep and S4/S6's absence checks are in scope).
- Changing what any criterion proves, or loosening one to save time. A split test may prove less only if the ticket handoff says why and the epic owner agrees.
- A server-level test for the starting-script seeding rules (the analysis says "consider"): not part of this story.
- Mobile and desktop.

## Technical Scope

- **Layers:** scenario harness only (scenario files, the registry's entries, fixtures). No server, contract or web change.
- **Docs impact:** `docs/operations/development.md` "Scenario tests" and `docs/internals/testing.md` where they list the scenarios or ids; the full rewrite is PRB.T-040 (FR-15). Check AGENTS.md "Verifying" for accuracy.
- **Mobile impact:** none.

## Non-functional Requirements and Constraints

- Repo test rules: no sleeps, polling loops, wall-clock deltas, per-test timeouts or retries; lint rules `t3code/no-real-time-wait-in-tests`, `no-polling-loop-in-tests`, `no-wall-clock-in-tests` hold with no new exemption. The `sleep` removal in S4 must not be replaced by a different guess.
- Pointer-only input (mouse-first rule). Real PTYs, real git worktrees, real websockets and real restarts stay.
- Run time is recorded, not gated. Until PRB.T-040 shares servers, more scenarios mean more cold starts; the net serial time may rise (SU-4). That is accepted for this story and reported, not hidden.
- The 700 ms click-to-prompt budget is not gated here (epic Out).
- The ids S1 to S8 stay visible (epic FR-13).
- The throwaway-home guard and cleanup by captured PID are unchanged (epic NFR-3).

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given the stage lists of S2, S3, S7 and E2-S1 before the split, when the split lands, then each stage is listed in the ticket's Handoff section against at least one running test that covers it, and no stage is unmapped | manual (author; reviewed by the developer before the old script is deleted) | FR-11, R-3 |
| AC-2  | Given each new test, when it is run alone with `--only <part id>` on a fresh server, then it passes | auto | FR-11 |
| AC-3  | Dropped from this story: reverse order of parts is not testable with the current runner (see Expected Behavior, Ids). The number is kept so citations stay stable. | n/a | n/a |
| AC-4  | Given a test that depended on an earlier stage's leftover (S2 AC-7, S7 AC-17 after a restart), when it runs, then it builds its own fixtures and does not read what another test left | auto | EC-1, ER-2 |
| AC-5  | Given the four old scenarios had 11 restarts, when the split lands, then every remaining restart is listed in the handoff with the restart or startup behavior it proves, and restarts left only for an unrelated reason are listed as such | manual (author) | FR-11, EC-2, EC-3 |
| AC-6  | Given the restart-behaviour tests (S7 survival, lost host and gone-after-restart; E2-S1 preselect after restart, emptied list, damaged list, no default), when they run, then each performs a real server restart (and the lost-host one stops the shell host) and asserts what it proves after it | auto | FR-11, EC-2 |
| AC-7  | Given S2's script-missing stage and git-init-failure stage, when they run, then a missing script leads to the error the old stage asserted and a failing git init leads to the error the old stage asserted, whichever way the startup condition is made, and the choice is written in the handoff | auto | EC-3 |
| AC-8  | Given the E2-S1 file-edit stages (renamed script preselected, removed script falls back to Plain shell, repeated and empty names offered), when they run, then they run against a running server with no restart and pass | auto | FR-11 |
| AC-9  | Given the guard of a split test is broken (for example a refused folder is accepted, the second click of a double click starts a second shell, a killed shell comes back after a restart, a damaged list is overwritten), when the suite runs, then the split test that owns it fails and the others do not | manual (developer, recorded in the handoff; made outside the committed tree and reverted) | FR-11, R-3 |
| AC-10 | Given the PRB.T-011 contract (command once, after the prompt) lived in S2, when the split lands, then it is still checked in one test, following whatever PRB.T-036 delivers for the PRB.T-011 check, and the break named in AC-9 fails it | auto | FR-11 |
| AC-11 | Given S4's reload stage, when it runs, then the output the test checks is produced only after the reload has begun and is shown exactly once, with no fixed sleep in the command | auto | FR-4, FR-12, EC-6 |
| AC-12 | Given the release in AC-11 happens before the reload (the order is deliberately reversed), when the test runs, then it fails | auto (harness self-test) | EC-6 |
| AC-13 | Given the release is never made, when the S4 test waits for the output, then it fails with a named wait | auto (harness self-test) | ER-3 |
| AC-14 | Given S6 starts its background jobs, when it looks for them, then it matches a marker unique to this run, and it does not match a `sleep` of the same shape started by something else on the machine | auto | FR-14, EC-7 |
| AC-15 | Given a decoy process of the same shape as S6's jobs is running, when S6 runs, then it matches only its own marker and passes; the concurrency check of two copies is PRB.T-040's | auto | FR-14, EC-7 |
| AC-16 | Given the instant `count() === 0` checks of S4 (closed, killed and signalled shells' tab and row) and S6 (tab, alert), when they run, then each waits on the page settling (an element detached, or an event that proves the end) before it asserts absence, and a never-appeared check waits on its settling fact | auto | FR-12, EC-4 |
| AC-17 | Given the tab of a closed shell is deliberately still shown, when S4 or S6 runs, then the check fails and does not pass for having sampled before the page updated | auto (harness self-test) | EC-4 |
| AC-18 | Given a split test fails, when its output is read, then it carries the old scenario id, the stage, a screenshot, the server log tail and the recorder values | auto (harness self-test) | ER-1, NFR-6 |
| AC-19 | Given the suite after the split, when the output is read, then each part shows its own id (the old id plus a part name) and the ids S1 to S8 are still recognisable in it | auto | FR-13 |
| AC-20 | Given the old ids `S2`, `S3`, `S7` and `E2-S1`, when `--only` is given one of them, then it runs all of that scenario's parts and does not report "no scenario has the id" | auto | EC-5 |
| AC-21 | Given two consecutive full runs with no retries and no changes between them, when they finish, then both pass | auto | NFR-2 |
| AC-22 | Given the scripts after the split, when the lint rules for waits and wall-clock deltas run, then there is no new violation and no new exemption | auto (`vp run check:changed`) | NFR-7 |
| AC-23 | Given the per-scenario times before (PRB.T-038's) and after the split, when compared, then the numbers, including any rise from more cold starts, are in the handoff with the method; nothing fails on a time | manual (author) | NFR-1, SU-4 |
| AC-24 | Given the docs that list the scenarios and ids, when the story lands, then no statement in them describes S2, S3, S7 or E2-S1 as single scripts or contradicts the new ids | manual (developer, docs diff review) | FR-15 (epic) |

## Dependencies

**Depends on:** PRB.T-038 (the API fixtures each split test builds its own world with). **Blocks:** PRB.T-040 (a shared server per worker needs tests that do not leave state for each other, epic A-4).

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-038 | The split tests build their workspaces, projects and shells through its API fixtures; without them each part would pay UI setup again. | backlog |
| PRB.T-036 | Failure artifacts (ER-1), the rewritten PRB.T-011 check (AC-10), the offsets on frame waits, the unlock of wall-clock gates and the fixtures module. Reached through PRB.T-038. | backlog |
| PRB.T-037 | A sandbox to run one split test against a live server while splitting. Reached through PRB.T-038. | backlog |

Blocks: PRB.T-040, because parallel workers sharing a server expose the stage coupling this story removes. Independent of PRB.T-041.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SU-1 | S3's AC-22 stage and S2's AC-16 stage do not need a restart to see a script added to the saved list, because the server reads the list on every use. | unknown | unverified (inferred from a comment and from E2-S1's no-restart edits) | Run S3 AC-22 without the restart on a sandbox (PRB.T-037). | author, at the start of this story |
| SU-2 | Whether S2's git-fault restart can be replaced by another way to make `git init` fail, or stays as a fresh-server test. | unknown | unverified | Author tries; the epic's PRB.T-040 has an opt-in fresh server for it. | author |
| SU-3 | `--only S2` (and S3, S7, E2-S1) selects all parts after the split; each part has its own id (old id plus part name). Decided by this story's id rule. | assumption | unverified (the current runner matches exact ids only, so it needs a change) | AC-20 checks it. | author |
| SU-4 | The net serial time of the suite after the split, since there are more scenarios and each cold-starts its own server until PRB.T-040. | unknown | unverified | Measure before and after (AC-23). | author, when this story closes |
| SA-1 | The desk analysis's split lists are correct and complete, and no stage proves something that only holds because an earlier stage ran. | assumption | unverified (stage lists read, dependencies between stages not traced fully) | Trace each stage's dependencies while writing the AC-1 mapping. | author |
| SA-2 | The restart counts in this story (S2 2, S3 1, S7 3, E2-S1 5 = 11) are right; the desk analysis writes "3+1+8", which does not match. | assumption | unverified (counted from `restart(` calls) | Recount when starting. | author |
| SA-3 | A file or FIFO the test releases can be created from inside the shell's folder by a pointer-only scenario, and works the same on macOS and Linux. | assumption | unverified | Try it in the sandbox on both systems (epic NFR-4). | author |
| SA-4 | The mock agent and the saved-list file fixture are safe to build per test (no shared global state in `MOCK_AGENT_HOME`). | assumption | unverified | Read `scripts/mock-agent` and the harness's server setup when planning. | author |
