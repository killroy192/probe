---
id: PRB.T-043
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-10
updated: 2026-11-11
---

# Check and perf kinds, sets, composed scenarios and the cap gate

## Business Goal

**Problem:** A scenario today is an id, a title and a script (`scripts/scenarios/scenario.ts`). It has no kind, so S2, S3 and E2-S3 both check behavior and record durations, under lint suppressions marked temporary. Scenarios cannot be grouped or composed, so an agent cannot run "the restart checks" or build a longer flow from existing checks without writing a new script. Nothing measures the 20 s cap, and a failure does not always say what was found. PRB.T-039 cannot convert the scenarios into atomic ones until these building blocks exist.

**Proposed solution:** Give the harness the building blocks every later scenario uses: two kinds (check and perf, perf in `<scenario>.perf.ts` files), with today's timings moved out of check scenarios into perf scenarios; named sets; composed scenarios built from atomic ones; two more needs a scenario can state (a change to or dependence on server-wide state, and a server started under a condition), which the sandbox refuses; and a cap gate command. Sets and composed scenarios run in the suite and on the sandbox. Deliberate-failure self-tests prove a failure is readable from its first run.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** split from candidate # 5 (PRB.T-039) on 2026-11-10 by user decision, because one story with 35 acceptance criteria was too big to plan and review. This story is the harness part; PRB.T-039 keeps the conversion of every scenario and comes after it.
- **Delivers:**
  - FR-16: the check and perf kinds, `<scenario>.perf.ts` files, the default suite never running one, the harness refusing a scenario that mixes checks and timing, and today's timings in S2, S3 and E2-S3 moved into perf scenarios. The serial perf command is PRB.T-040's.
  - FR-17, the mechanism: composed scenarios and named sets, in the suite and on the sandbox (the sandbox part PRB.T-037 left). Old ids becoming set names, and a composed scenario from converted scenarios, are PRB.T-039's.
  - FR-19, the scenario part's proof: deliberate-failure self-tests of three kinds show a failure names scenario, stage, expected and found. Reviewing every converted assertion is PRB.T-039's; the runner part is PRB.T-040's.
  - FR-22, the command: the cap gate. The gate runs per converted scenario are PRB.T-039's.
  - FR-9, extended: two new needs a scenario can state, refused on the sandbox.
  - NFR-5: running a set, a composed scenario and the gate are each one line in the rules file.
  - NFR-6: a failure carries expected and found on top of PRB.T-036's and PRB.T-038's artifacts.
- **Provides, owned elsewhere:** FR-13 (PRB.T-040) runs sets by name; FR-4 is touched only by moving timings out of check scenarios; FR-15: this story keeps the rules file current.
- **One deployable outcome:** After this ships, no check scenario records a time, perf scenarios are separate files the suite never runs, any set or composed scenario runs by name in the suite or on a sandbox, and the cap gate command exists. The existing scenarios still run as they are, as check scenarios.

## Current Behavior

Read on `main` at `2eac97f07` on 2026-11-10 with grep and file reads; nothing was run. PRB.T-036 and PRB.T-042 are merged; PRB.T-037, PRB.T-038 and PRB.T-041 are not built.

- **Scenario contract and selection.** A scenario is `id`, `title` and `run(context)` (`scripts/scenarios/scenario.ts`); it states nothing about kind, needs, inputs or results. `--only <id>` matches one id exactly and exits 2 with `no scenario has the id …` otherwise (`run.ts:301-305`). There are no sets and no composition. The summary prints `<passed>/8 passing` from the constant `TOTAL = 8` (`run.ts:39,335`).
- **Per-scenario time.** The printed time covers the scenario from before its server starts to its end, so it includes its server start and first login (`run.ts:176,214-222,265,319`). No command compares a time to a cap; the rules file's interim instruction is one `--only <id>` run after the user's confirmation, reading the time on its `PASS` line (`.agents/rules/scenarios.md`, "Until later stories land").
- **Timings inside check scenarios.** `metric()` prints a `METRIC` line and judges nothing (`fixtures.ts:109-113`). It is called by S2 (tree node and banner after a start, `plus-modal.ts:146-157`), S3 (branch label and fork start, `worktrees.ts:194-200,288-298`) and E2-S3 (click to prompt in the harness, and start to prompt as the server measures it, `starting-scripts.ts:96-109`), under nine suppressions that read `temporary: PRB.T-039 moves this metric into a perf scenario` (written by PRB.T-042 before this split; this story removes them).
- **The limits behind them** are product criteria: a new shell's tree node within 1 s (PRB.T-004 AC-3; the old harness gate was 1000 ms); start to the agent's banner at most 2 s (PRB.E-001 NFR-1, which PRB.T-022 AC-13 also reads); a branch switch relabels the node "within about 2 seconds" (PRB.T-005 AC-26; the old harness gate was 4000 ms); click to first prompt of a plain shell at most 700 ms (PRB.E-002 NFR-1, measured on the server since PRB.T-036). PRB.T-028 AC-11 and AC-16 read E2-S3's harness-side click to first prompt through a second server. S3's fork-start time has no limit anywhere (PRB.T-005 SU-1).
- **Needs.** PRB.T-037 (not built) adds a statement of needs (restart, pristine home, second server) and the sandbox's refusals; it does not have server-wide state or a startup condition.
- **Rules file.** `.agents/rules/scenarios.md` states check vs perf, `<scenario>.perf.ts`, composition and the cap gate as rules, and holds the interim line "No sets, composed scenarios, `.perf.ts` support or cap gate command yet".

## Expected Behavior

- **Kinds.** Every registered scenario is a check scenario or a perf scenario, never both. A perf scenario lives in a `<scenario>.perf.ts` file, measures one value and asserts only the limit its product ticket states, failing on a miss with the measure, the value and the limit. A check scenario records no duration. The harness refuses a mix when it loads the registry, before anything runs: a check scenario that records a duration, or a perf scenario that asserts anything but its one measured value against its limit, is rejected naming the mix. No perf scenario has to run for that.
- **Today's timings move.** S2's tree node after a start (PRB.T-004 AC-3, 1 s), S2's start to banner (PRB.E-001 NFR-1, 2 s), S3's branch label after a switch (PRB.T-005 AC-26, 2 s), E2-S3's click to prompt as the server measures it (PRB.E-002 NFR-1, 700 ms) and E2-S3's click to prompt as the harness measures it (PRB.E-002's 700 ms, which PRB.T-028 reads) become perf scenarios. S3's fork start has no limit and no reader and is dropped (SU-1, SU-2). The check scenarios they leave keep proving every criterion they proved, without the timing. A product limit is used as written; this story sets no budget of its own and changes none.
- **Perf runs.** The default suite, every set and the cap gate never run a `.perf.ts` file. Perf scenarios run only in PRB.T-040's serial perf run (epic FR-4; user decision 2026-11-10: never run by id before it exists). Until it exists, a `.perf.ts` id given to any command is refused, saying so.
- **Stated needs, extended.** PRB.T-037's statement of needs gains two needs: a change to, or dependence on, server-wide state (for example the starting-script list, or the server's own state folders), and a server started under a condition (an environment variable, a faulty git config). The sandbox refuses both, naming the need, like the needs PRB.T-037 refuses. A condition is always met by starting a server under it, never by restarting into it. In the current runner every scenario already gets its own server; PRB.T-040 decides fresh servers from these needs (its EC-17).
- **Composed scenarios.** A composed scenario is a saved check scenario made of atomic check scenarios as steps, in a stated order. A step uses what an earlier step returned where the composed scenario hands it over (PRB.T-038's results as values) and builds the rest itself, exactly as when it runs alone. A composed scenario needs everything any of its steps needs. It passes when every step passes; when a step fails, the output names the composed scenario, the failing step, its stage, the expected and the found value, the later steps do not run, and the output lists them as not run. It is not timed against the cap; each of its steps is.
- **Named sets.** A set is a saved, named list of check scenarios (atomic or composed). Running a set runs exactly its members, each as it would run alone. A set cannot name a `.perf.ts` scenario, and ids and set names do not collide.
- **On the sandbox.** A set and a composed scenario run against a live sandbox by name, with no cold start, through the same one-line command shape as a single scenario. If any member or step states a need the sandbox refuses, the whole run is refused before anything runs, naming each refused member or step and its reason; a set never runs part of its members.
- **First-run diagnosis.** Self-tests fail on purpose in three ways (a wrong UI state, terminal output that never comes, a server that crashes mid-stage); each output names the scenario, the stage, the expected and the found value, and the artifacts hold the failing stage's server log lines, so the cause is readable from that run.
- **Changes undone in the step.** This story makes the guarantee and PRB.T-039 applies it to the converted scenarios: a change a step makes beyond the scenario's own workspace and folders while it lasts (a file or folder made unreadable or unwritable) is undone when that step ends, pass or fail.
- **Cap gate.** One command runs the chosen atomic check scenarios, or the atomic members of a set, serially, once each, and fails any whose time exceeds 20 s, naming the scenario, its time and the cap. The time it judges includes the scenario's own server start only when the scenario needs a fresh server (a restart, a pristine home, server-wide state, a condition); otherwise the server start is left out (epic KPI). It times nothing until it is told that the user has confirmed the machine is quiet; without that it stops and says to ask the user. It refuses perf and composed scenarios named directly, naming why; given a set, it times the set's atomic members and lists its composed members as not timed. A normal run prints times and never compares them to the cap.
- **Summary.** The run's summary counts what ran, passed and failed, with no fixed total.

### User Flow

1. An agent wants the kill behavior and a restart in one flow: it saves a composed scenario of existing check scenarios instead of writing a script, and runs it in the suite or on a sandbox with the rules file's one line.
2. A step fails; the output names the composed scenario, the step, the stage, expected and found, and lists the steps that did not run. The agent fixes the cause from that run.
3. An agent groups the checks it touches into a set and runs the set by name.
4. After a scenario is implemented (in PRB.T-039 and later), the agent asks the user to confirm the machine is quiet and runs the cap gate over it.
5. Before a release, the developer runs the perf scenarios with PRB.T-040's serial perf command; this story only writes them.

### Edge Cases

- **EC-1** The same atomic scenario runs alone and as a step, or twice in one composed scenario: each run creates its own names and folders, and neither reads the other's.
- **EC-2** A composed scenario hands a step something of the wrong kind: rejected before any step runs, naming the step and the input.
- **EC-3** A set on the sandbox includes a member that needs a restart (for example S7 today): the whole set is refused before anything runs, naming that member and the need.
- **EC-4** A `.perf.ts` scenario is named in a set, or given to the cap gate: refused, naming the rule. A `.perf.ts` id given to the default command is refused, saying perf scenarios run only in the serial perf run.
- **EC-5** A perf scenario misses the product limit it asserts: it fails naming the measure, the value and the limit; the limit is reported to the ticket that owns it, never changed here. This story only reviews it (AC-4); it is first exercised by PRB.T-040's perf self-tests, which run with the self-test line once the serial perf run exists.
- **EC-6** A set or composed scenario contains a long, not yet converted scenario: it runs like any member; converting it is PRB.T-039's.
- **EC-7** A step that made a folder unwritable fails inside that step: the permissions are restored anyway.

### Error Handling

- **ER-1** An id or set name matches nothing: the run exits non-zero saying so; a set naming an id that does not exist is an error before anything runs.
- **ER-2** The cap gate is started without the user's confirmation: it times nothing and says to ask the user first.
- **ER-3** A composed scenario's step fails: the remaining steps are skipped and listed as not run; the composed scenario is reported as failed at that step.
- **ER-4** A check scenario records a duration, or a perf scenario asserts something other than its limit: the registry is rejected when loaded, naming the scenario and the mix.

## Out Of Scope

- Converting the existing scenarios into atomic ones, old ids becoming set names, the account of criteria, restarts, server-wide-state and shared-server safety per scenario, S1, S4, S6 and S3's own fixes, and the gate run per converted scenario: PRB.T-039.
- The runner, parallel workers, traces, the serial perf command, retries fixed at 0 and the N-run loop: PRB.T-040.
- The library, direct setup and debug-level servers: PRB.T-038 (used here). The sandbox and its first refusals: PRB.T-037 (extended here).
- Product performance limits and changing them (epic Out). Running a perf scenario before PRB.T-040's serial perf run exists (user decision 2026-11-10).
- Parallel runs on one sandbox (no FR), CI gating, mobile and desktop.

## Technical Scope

- **Layers:** `scripts/scenarios` only: the scenario contract (kind, needs, inputs and results for composition), registration, sets, composition, the cap gate command, the default suite's exclusion of `.perf.ts`, the sandbox's handling of sets, composed scenarios and the two new needs, the perf scenarios moved out of S2, S3 and E2-S3, self-tests and `harness.test.ts`. No server, web, contracts or product code.
- **Agent CLIs:** the mock agent only.
- **Shells:** zsh and bash through the harness's isolated startup files.
- **Docs impact:** `.agents/rules/scenarios.md` only, in the same change: check vs perf and how perf scenarios run until PRB.T-040; the needs a scenario states, including the two new ones, and which the sandbox refuses; composed scenarios and named sets; one line each to run a set, a composed scenario and the cap gate, in the suite and on the sandbox; the gate's confirmation; the step-undo rule. The interim lines this story makes false are removed. `docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md are only checked for contradictions.
- **Mobile impact:** none; no contract change.

## Non-functional Requirements and Constraints

- The repo test rules and the rules file hold: no sleeps, polling loops or wall-clock reads in check scenarios; waits subscribe to an event raced against a named deadline. `.perf.ts` files may read the clock; check scenario files gain no new clock exemption. Lint passes with no `temporary: PRB.T-039` metric suppression left.
- Pointer-only input, real PTYs, websockets and restarts, the throwaway-home guard and cleanup by captured PID are unchanged (epic must-not-change list).
- No reruns (epic FR-19): each acceptance criterion is checked by one run on unchanged code; one run checks several criteria where it can.
- The cap gate runs only after the user confirms the machine is quiet, on the devcontainer, one run per scenario, no median.
- One library: no scenario file defines a helper another scenario could use (FR-21).

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given the change, when `vp run test:scenarios` runs once, then every check scenario runs and passes as before, no `.perf.ts` scenario runs, and the summary counts what ran, passed and failed with no fixed total | auto | FR-16 |
| AC-2  | Given the check scenario files, when searched and linted, then none records a duration or reads the clock, no `temporary: PRB.T-039` metric suppression remains, and lint passes | auto (`vp run check:changed`) and manual (source search in the handoff) | FR-16, FR-4 |
| AC-3  | Given two self-test registrations, a check scenario that records a duration and a perf scenario that asserts something other than its limit, when the registry is loaded, then each is rejected before anything runs, naming the scenario and the mix, and no perf scenario runs | auto (harness test) | FR-16, ER-4 |
| AC-4  | Given the perf scenarios for S2's tree node (1 s), S2's start to banner (2 s), S3's branch label (2 s), and E2-S3's click to prompt as the server and as the harness measure it (700 ms each), when their files are reviewed, then each is a `.perf.ts` file that measures one value and asserts only that limit, failing on a miss with the measure, value and limit; S3's fork-start time is gone; and the S2, S3 and E2-S3 check scenarios still prove every criterion they proved; the perf files' first run is PRB.T-040's serial perf run | manual (developer review) | FR-16, EC-5 |
| AC-5  | Given a perf scenario named in a set or given to the cap gate, when the run starts, then it is refused naming the rule; and a `.perf.ts` id given to the default command is refused, saying perf scenarios run only in the serial perf run | auto | FR-16, EC-4 |
| AC-6  | Given a composed self-test of three atomic scenarios whose second step fails, when it runs once, then the output names the composed scenario, the failing step, its stage, expected and found, and lists the third step as not run | auto (self-test) | FR-17, FR-19, ER-3 |
| AC-7  | Given an atomic scenario used as a step after a step that returns the precondition it needs, when the composed scenario runs, then the step uses that result and creates no second copy of it; when the same atomic scenario runs alone, then it builds the precondition itself and passes; and a composed self-test that uses the same atomic scenario twice passes, each use with its own names and folders | auto | FR-17, EC-1 |
| AC-8  | Given a composed scenario that hands a step an input of the wrong kind, when it is checked or started, then it is rejected before any step runs, naming the step and the input | auto | EC-2 |
| AC-9  | Given sets, when one is run by name with the rules file's line, then exactly its members run; when an id or set name matches nothing, or a set names an unknown id, then the run exits non-zero saying so; and a set given a name that is already a scenario id is rejected | auto | FR-17, ER-1 |
| AC-10 | Given a running sandbox, when one set and one composed scenario whose members are all accepted run against it, then both pass with no cold start; and when a set holding a scenario that needs a restart, and a composed scenario with a restart step, are run against it, then each is refused before anything runs, naming the member or step and its need | auto | FR-17, FR-9, EC-3 |
| AC-11 | Given two self-test scenarios, one stating a change to server-wide state and one stating a server started under a condition, when each is run against a sandbox, then it is refused before anything runs, naming the need; and when each runs in the suite, then it passes on a server of its own, the condition one on a server started under its condition | auto (self-tests) | FR-9 |
| AC-12 | Given three self-tests that fail on purpose (a wrong UI state, terminal output that never comes, a server that crashes mid-stage), when each runs once, then its output names the scenario, the stage, the expected and the found value, and the artifacts hold the server log lines of the failing stage; the developer names each cause from that run alone | auto (self-tests) and manual (developer) | FR-19, NFR-6 |
| AC-13 | Given the cap gate command, when a harness test runs it with the cap lowered for the test (no sleep), then it runs the chosen scenarios serially once each, fails the one over the cap naming the scenario, its time and the cap, leaves the server start out of the time of a scenario that needs no fresh server and counts it for one that does, and refuses perf and composed scenarios named directly, naming why; given a set with a composed member, it times the atomic members and lists the composed one as not timed; when it is started without the user's confirmation, then it times nothing and says to ask the user; and a normal run of the same scenarios prints times and never fails on the cap | auto (harness test) | FR-22, ER-2, EC-4 |
| AC-14 | Given a self-test that makes a folder unwritable in a step and then fails inside that step, when it runs once, then the folder's permissions are restored after the failure | auto (self-test) | FR-17 (steps a composed scenario can rely on), EC-7 |
| AC-15 | Given the rules file after the change, when read against the harness, then it covers everything in Technical Scope's docs list with one line each for a set, a composed scenario and the gate, the interim lines this story makes false are gone, and `docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md contradict nothing in it | manual (docs review) | FR-15 (kept), NFR-5 |
| AC-16 | Given the change, when `--selftest` runs once and `vp run check:changed` runs, then the self-tests pass or fail as designed (T2 and the new deliberate failures fail on purpose), the `harness.test.ts` guard cases pass, and typecheck and knip pass for `scripts` | auto | NFR-3 (epic), FR-21 (kept) |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-038 | The library the perf scenarios and self-tests build their preconditions with, and its composition interface (needs from explicit inputs, results returned as values, unique names per call), which composed scenarios hand over. | in progress (code on branch `e005`, tag `e005-t038`) |
| PRB.T-037 | The statement of needs and the sandbox, extended here with sets, composed scenarios and two new needs. | done |
| PRB.T-042 | The rules file this story updates and the lint rules on scenario files. | done |
| PRB.T-036 | The failure artifacts and the metrics this story turns into perf scenarios. | done |

The kinds, sets, composition, the new needs and the gate stay one story: they are one change to the scenario contract and the registry, and each of them is only usable once that contract has the others' fields.

**Blocks:** PRB.T-039, which converts every scenario with these building blocks; PRB.T-040, which builds the serial perf command for the `.perf.ts` files made here and runs sets by name.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | PRB.T-038 ships the composition interface its ticket describes, so a step can take an earlier step's result without reading leftovers. | assumption | verified (read on `e005`, 2026-11-11: kind-tagged results and `given()`; not run) | Read PRB.T-038's code and handoff before planning. | author |
| SA-2 | Moving the timings out of S2, S3 and E2-S3 removes no check: each timing judged nothing since PRB.T-036. | assumption | verified (read `fixtures.ts:109-113`, 2026-11-10; not run) | AC-1, AC-4. | author |
| SU-1 | Which limit E2-S3's harness-side click to prompt asserts, and whether S3's fork start stays. | decision | decided (user, 2026-11-10): PRB.E-002's 700 ms (PRB.T-028 reads it); S3's fork start is dropped | AC-4 | user |
| SU-2 | Which limit S3's branch-label perf scenario asserts. | decision | decided (user, 2026-11-10): PRB.T-005 AC-26's 2 s, not the old 4000 ms harness gate | AC-4 | user |
| SU-3 | The form of set names and the command lines for a set, a composed scenario and the gate. | unknown | decided (user, 2026-11-11, PRB.E-005 master plan U2): one `--only <name>` for an id, a set or a composed scenario, repeatable; `vp run scenarios:gate -- [--only <name>]... --quiet-confirmed`; self-test sets are named `T-<name>` | Plan stage; each must be one line in the rules file. | TBD (author, plan stage) |
| SU-4 | Whether the two new needs are their own values in PRB.T-037's statement or fold into an existing one. | unknown | decided (plan D5, user-approved 2026-11-11): separate `serverWide` and `condition` fields; a condition is a function of the home | Plan stage, against PRB.T-037's code and PRB.T-040 EC-17. | TBD (author, plan stage) |

## Handoff

**Built as one wave of the PRB.E-005 master plan** (`.plans/e005-master.md`, not committed), on branch `e005`, together with PRB.T-038, PRB.T-039 and PRB.T-040. Nothing in this story's steps ran a scenario, the runner or the harness tests; verification is in the epic's final phase.

**Self-test ids renumbered (master plan M1).** PRB.T-038 took T10 to T15, so this story's T10…T20 are **T16…T26**, in the same order: T16 returns a workspace, T17 takes one (or makes its own alone), T18 wrong UI state, T19 output never comes, T20 SIGKILLs its server (`serverWide: "kills its server"`), T21 composed [T16, T18, T17], T22 composed [T16, T17←1, T16, T17←3], T23 `serverWide`, T24 `condition`, T25 `revokeWrite` then fails, T26 composed [T16, T1]. Sets: `T-diagnosis` = [T18, T19, T20], `T-compose` = [T21, T22, T17, T25], `T-needs` = [T23, T24], `T-sandbox` = [T16, T17, T22], `T-restart-set` = [T16, T1], `T-gate` = [T16, T1, T22], plus `T-lib` = T10 to T15 for PRB.T-038. Every T16–T26 reference in this ticket's plan reads with these numbers; the AC texts name no ids.

**Runtime host (master plan M10).** This story ships the contract, the pure rule modules, the `server.ts` primitives and the self-tests. It does not wire them into `run.ts`, which PRB.T-040 deletes: from step 2 on, `run.ts` runs atomic checks by id only and refuses the rest. Selection, composition, step undos, condition env, the server-exit race, artifacts per step, the gate and sandbox sets run on PRB.T-040's launcher, fixtures and reporter (`cli.ts`, `testFixtures.ts`, `suite.spec.ts`, `reporter.ts`). The spawned harness cases of plan step C1 are written once, on `cli.ts`, in PRB.T-040 step 7 (master plan 10B for `harness.test.ts`, 10C for `sandbox.test.ts`). So AC-1, AC-3, AC-5 to AC-14 and AC-16 are judged on the PRB.T-040 runner.

**AC-2 source search (2026-11-11, at `5f6a76288`, not run).** Over the twelve check files in `scripts/scenarios/scenarios/` (every file there except the five `*.perf.ts`), a search for `Date.now`, `new Date(`, `performance.now`, `hrtime`, `metric(`, `METRIC`, `measure:` and `temporary: PRB.T-039` finds nothing; `temporary: PRB.T-039` occurs nowhere under `scripts/scenarios`, and no self-test file reads the clock. The lint half of AC-2 is `vp run check:changed` in the final phase. Left for PRB.T-040 10B: `lib/report.ts` still exports `metric()` with no caller (knip does not check `scripts` exports), and `harness.test.ts` (~lines 340 and 351) still expects `METRIC` lines from E2-S3 and S2; 10B deletes `metric()` and rewrites the E2-S3 case per plan D4 (it asserts `PASS E2-S3` under a slow startup file and no `METRIC` line).

**Interface as built.**

| Module | Holds |
| --- | --- |
| `scenario.ts` | `CheckScenario`, `PerfScenario` (`measure: {name, limitMs, limitFrom}`), `ComposedScenario` (`steps: {scenario, given?: {from}}[]`), `ScenarioSet {name, members}`; `defineCheck(url, {id, title, needs, covers?, takes?, returns?, run(ctx, given)})`, `definePerf(url, …)`, `defineComposed(url, …)`; `ScenarioNeeds` gains `serverWide?: string` and `condition?: {why, env(home)}`; `ResultKinds` = `workspace`, `shell`, `world` (PRB.T-039 adds kinds); `covers?: string[]` (master plan M11) |
| `registryRules.ts` | `validateRegistry(registry, readSource)` → rejections; `composedRejections(c)`; `resolveName(registry, name)` → check, composed, set, perf (refused) or unknown; `composedNeeds(c)`; `freshServerNeeded(needs)` (restart, pristineHome, serverWide, condition; master plan M12, `unshared` removed by PRB.T-039); `perfVerdict(p, ms)`; `registryOf(scenarios, sets)` |
| `compose.ts` | `runComposed(c, runId, runStep)`: steps in order, runId `${runId}s${n}`, first failure stops; returns the failed step, its stage, the not-run steps and their lines |
| `gate.ts` | `GATE_CAP_MS` (20 000), `gateCapMs(env)` (test-only `SCENARIO_GATE_CAP_MS`), `judgeGate(outcomes, capMs)` → `{lines, over}`, `gateTargets(registry, names)` → `{timed, notTimed, refusals}`, `QUIET_UNCONFIRMED`, `notTimedLine` |
| `sandboxRules.ts` | `sandboxRefusal(scenario)`, `sandboxRefusals(targets)` (all or nothing, naming each member or step) with the `serverWide` and `condition` reasons |
| `server.ts` | `startServer({env})`; `restart({env})`; `unexpectedExit()` on the handle (never resolves on an attached sandbox server) |
| `lib/expect.ts` | `expected({what, expected, found})` throwing `ExpectationError` (`<what>: expected <e>, found <f>`) |
| `lib/files.ts` | `revokeWrite(ctx, path, what, run, {unreadable?})`: runs `run` with write access taken away and registers the undo through `onStepEnd`; skipped as root |
| `registry.ts` | `checks`, `composed` (empty until PRB.T-039), `perfScenarios` (five), `sets` (empty until PRB.T-039), `selftests`, `pickedSelftests`, `selftestSets`; no `TOTAL`, no `PENDING`, no epic/story split |
| `scenarios/*.perf.ts` | `perf-tree-node` (1000 ms, PRB.T-004 AC-3), `perf-start-to-banner` (2000 ms, PRB.E-001 NFR-1), `perf-branch-label` (2000 ms, PRB.T-005 AC-26), `perf-prompt-server` (700 ms, PRB.E-002 NFR-1), `perf-prompt-harness` (700 ms, PRB.E-002 NFR-1, read by PRB.T-028) |

Commands (master plan U2): `vp run test:scenarios -- --only <name>` (id, set or composed; repeatable), `--sandbox <pid>` for the same on a sandbox, `vp run scenarios:gate -- [--only <name>]... --quiet-confirmed`; PRB.T-040 step 6 writes the root `package.json` scripts (master plan M18).

**Deviations from the plan.**
- `restart({env})` replaces the start env for that one restart only; the next plain `restart()` starts with the start env again (master plan M8 said `restart({env})` replaces it). So `restart({env: {}})` drops a condition for one restart, not for good.
- T19 builds its own expected and found (the last three lines of the shell's history) around the library's output wait, because that wait names what it awaited, the offset and the deadline but gives no "found" (assumption 4 of the plan; its step 5 addition was not done).
- `perf-prompt-server` starts its plain shell over the API rather than through the "+" modal, and reads the server's start-to-prompt time from the server log.
- Plan step B1's `serverStartMs` is dropped: PRB.T-040 times each scenario after the shared server is ready, and a fresh server's start counts (master plan M13).
- No `--set` flag, and the gate's flag is `--quiet-confirmed` (master plan M9).

**Steps and commits (branch `e005`).**

| Step | Commit | What |
| --- | --- | --- |
| ticket in progress | `be06655c0` | `tm mv` |
| 1 contract and rules | `fbdfdfff8` (merged `548288e92`) | kinds, `define*`, `registryRules.ts`, `compose.ts`, `gate.ts`, `sandboxRules.ts`, `lib/expect.ts`, `revokeWrite`, pure tests |
| B1' server primitives | `62da8f047` (merged `0907ccce9`) | start env, `unexpectedExit()` |
| 2 re-register | `cc1ecd7b3` | every scenario and self-test through `defineCheck`; new `registry.ts`; `run.ts` minimal |
| B3 perf moves | `7ff929c38` | five `.perf.ts` files; nine suppressions and the `metric()` calls gone; S3's fork-start time dropped |
| B4 self-tests | `6e5e1dbbd` (merged `b6ba1e1fb`) | T16–T26 and their sets |
| B1, B2 runtime | PRB.T-040 `87905c5f4` (reporter), `a6773ad16` (launcher); its fixtures and modes follow | hosted on PRB.T-040's runner |
| C2 rules file | this commit | `.agents/rules/scenarios.md`: kinds, needs, sets, composition, step undos, the gate, `covers`; the PRB.T-043 interim line removed. `docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md contradict nothing |
| C1 tests | PRB.T-040 step 7 | spawned cases on `cli.ts` |
