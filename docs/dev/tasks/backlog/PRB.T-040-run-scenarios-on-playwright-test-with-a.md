---
id: PRB.T-040
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Run scenarios on Playwright Test with a shared server and parallel workers

## Business Goal

**Problem:** The suite runs its scenarios one after another, and every scenario cold-starts its own server, shell host and pairing subprocess and then tears them down (up to 5 s for the server and 5 s for the shell host). A failure is one line, with no trace, and a scenario can only be picked by id. The custom runner is also a small test framework of its own (selection, reporting, cleanup, timeouts) that the team maintains instead of using one.

**Proposed solution:** After PRB.T-039 the scenarios are small and independent. This story runs them on Playwright Test, in parallel workers, with one server per worker shared by the scenarios that run on it, and a fresh server only for the scenarios that restart or need a pristine home. A failed scenario leaves a trace as well as the screenshot and log tail of PRB.T-036. The ids S1 to S8 stay visible and the same PASS and FAIL lines are printed. The 700 ms click-to-prompt budget is gated only in a dedicated serial perf run. The old runner, its registry and the fixed total of 8 are removed, and the test docs are rewritten the same day.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 5 PRB.T-040 Run scenarios on the Playwright Test runner with a shared server and parallel workers (phase 4 of the analysis)
- **Delivers:**
  - FR-13: parallel workers sharing one server per worker; a fresh server only where a scenario restarts or needs a pristine home; selection by id or name; ids S1 to S8 visible in the output.
  - FR-14: isolation between scenarios: no global process-table patterns, no port reserved by bind-and-release, assertions scoped to the scenario's own workspace. Split as in the epic: this story owns the port reservation (no bind-then-release race) and the per-workspace scoping of assertions (S3's page-wide `[data-worktree]` count); PRB.T-039 owns removing S6's process-table marker, and this story only checks it is gone.
  - FR-4 (the gate half only): PRB.T-036 only records the server-measured click-to-prompt time. This story builds the dedicated serial perf command and the gate above 700 ms (AC-15); the parallel suite never gates on it.
  - FR-6 (the trace half): a failed scenario also leaves a trace.
  - FR-15 (the runner half): `docs/internals/testing.md` and the "Scenario tests" part of `docs/operations/development.md` describe the new runner the same day it lands; AGENTS.md "Verifying" is checked.
  - NFR-1 (the speed half): the full-run time is printed per scenario and in total, compared with the PRB.T-036 baseline; the target is set by the epic owner (TBD there).
  - EC-6 (the worker bound): the number of parallel workers is bounded, settable and documented (AC-26).
  - NFR-2: no retries, no per-test timeout arguments; a runner killed with SIGKILL leaves nothing the next run cannot clean up by captured PID.
  - NFR-3: the throwaway-home guard stays.
  - NFR-4: Linux and macOS; Chromium only, from the existing Playwright install.
  - NFR-5: the single-scenario command is one documented line; a failure names the scenario id and stage; scenarios stay pointer-only.
  - NFR-6: per-scenario timing is printed on every run.
  - NFR-7: one fixtures module stays the only place for setup helpers; docs rewritten, not appended to.
- **One deployable outcome:** `vp run test:scenarios` runs the scenarios in parallel on Playwright Test, prints the same PASS and FAIL lines with timings, leaves a trace for each failure, and a separate serial command gates the 700 ms budget. This is the step that turns the earlier stories' work into the epic's primary KPI (full-run time).

## Current Behavior

Read on 2026-11-09 (`scripts/scenarios/`); the PRB.T-036 to PRB.T-039 changes had not landed, so this is the starting point those stories change. The code search index was unavailable.

- **Runner.** `scripts/scenarios/run.ts` is one Node script behind `vp run test:scenarios` (root `package.json:41`). It launches one Chromium (`launchBrowser`, `browser.ts:6-24`) with Playwright's own signal handlers turned off so the runner can stop its servers first (`browser.ts:7-12`), and runs the selected scenarios one after another in a loop (`run.ts:149-166`). A failure is caught and printed as `FAIL    <id> <title>: <first message>`; a pass as `PASS    <id> <title>`; a scenario without a `run` as `PENDING` (`run.ts:150-165`). The summary is `scenarios: <n>/8 passing, ...` from a constant `TOTAL = 8` (`run.ts:29`, `168-172`). Every action has a 10 s timeout (`run.ts:30`, `98`).
- **Servers.** Each scenario gets its own throwaway home and server (`run.ts:70-119`, `startOwnedServer`), and the server and the shell host (by the pid file in the home) are stopped and the home deleted when it ends. A second server for a scenario goes through `startSecondServer` (`scenario.ts:12-16`), also stopped with the scenario. `ServerHandle` (`server.ts:20-37`) offers `restart`, `logs`, `pairingUrl`, `cli`, `stopShellHost`.
- **Port.** `reservePort` (`server.ts:63-76`) binds port 0, reads the port, closes the socket and returns it; the server is started on that port later (`server.ts:144`, `159-161`), so another process can take it in between.
- **Cleanup and signals.** `run.ts:32-49` keeps a list of cleanups and runs them on SIGINT, SIGTERM and SIGHUP. `harness.test.ts` (around lines 123-190) spawns `run.ts` as a subprocess and asserts on its output text: the refusal for real data and server addresses, the browser-not-found message, the server-cannot-start message, `PASS`/`FAIL` lines for the self-tests, the `1/8 passing` summary, that a bystander server is left alone and that an interrupted run leaves no server or home.
- **Guard.** `environment.ts:22-69` parses the runner's own flags (`--only`, `--selftest`, `--rebuild`, `--browser`, `--server-bin`) and `refusalReason` (`environment.ts:45-69`) refuses `--base-dir`, `--home-dir`, `--server*`, `--url`, and `T3CODE_HOME`/`T3CODE_BASE_DIR` pointing under `~/.t3`. The server child never inherits `T3CODE_*`, `VITE_*` or `PROBE_*` (`server.ts:49-61`).
- **Registry.** `registry.ts:17-40` lists S1 to S8 (`scenarios`), four story scenarios (`standaloneShell` T-002, `secondServer` R1, and the two in `starting-scripts.ts`, E2-S3 and E2-S1) and the self-tests T1, T2, T3 (T3 only when picked with `--only`).
- **Restarts.** Scenarios that restart the server or stop the shell host: S2 (`plus-modal.ts:384,422`), S3 (`worktrees.ts:474`), S7 (`restart.ts:104-105`), S8 (`restore-shell.ts:113-114`), T-002 (`standalone-shell.ts:132`), E2-S1 and E2-S3 (`starting-scripts.ts:125,332`) and the self-test T1. S1, S4, S5, S6 and R1 do not restart (grep, 2026-11-09).
- **Process-table pattern.** S6 lists the whole process table with `ps -A` and matches a command-line regex (`kill-shell.ts:34-44`) for the jobs it starts with `sleep 1601`/`sleep 1602` (`kill-shell.ts:120`); two suites at the same time would see each other's matches. PRB.T-039 replaces it with a run-unique marker; this story checks that no pattern another run could satisfy remains.
- **Global assertions.** S3 counts `[data-worktree]` across the whole page (`worktrees.ts:139`, `225`) and uses `/tmp` (`worktrees.ts:202`). `gone()` polls (`support.ts:50-58`).
- **Library.** `scripts/package.json:18` depends on `playwright-core` 1.60.0 and `apps/web/package.json:103` on `playwright` 1.60.0 (`@vitest/browser-playwright` at line 100). `knip.jsonc:80` lists `playwright-core` as an ignored dependency. The container's Playwright cache holds only `chromium_headless_shell-1223` (`~/.cache/ms-playwright`, 2026-11-09). `@playwright/test` is not installed (unverified until the spike, SA-1).
- **Docs.** `docs/internals/testing.md` "Scenario tests" says a Node runner owns the server process and uses Playwright as a library because Vitest browser mode cannot restart a real server, that each scenario gets its own home, server and browser context, that a new scenario replaces its `pending` entry in `registry.ts`, and that self-tests run only with `--selftest`. `docs/operations/development.md:284-305` describes `PASS`/`FAIL`/`PENDING` with "how many of the 8 pass", `--only`, `--selftest`, `--rebuild`, `--browser` and the per-scenario shell-host stop. `AGENTS.md:186` names `vp run test:scenarios` and `-- --only <id>`.
- **700 ms.** Only E2-S3 gates, with a `Date.now()` delta in the page's process (`starting-scripts.ts:40`, `111-118`). PRB.T-036 replaces it with a server-side measurement; the exact form is unverified (SA-3).
- **Mobile and desktop.** Nothing in `apps/mobile` or `apps/desktop` imports the harness (unverified; checked by `vp run check:changed`).

## Expected Behavior

- **One command, parallel.** `vp run test:scenarios` runs the suite on Playwright Test with several scenarios at the same time. Scenarios that do not restart or need a pristine home share a server (with its shell host) on a throwaway home instead of each starting one; the number of servers started is lower than the number of scenarios, and each server and home is stopped and deleted when the run ends. The number of parallel workers is bounded and can be set. The web bundle step of PRB.T-036 runs once for the run.
- **Per-scenario isolation.** Each scenario gets its own workspace and its own browser page on the shared server, and checks only what is in its own workspace. A scenario that restarts the server, stops the shell host, or needs a pristine home asks for a fresh server of its own, with its own home and port, and nothing else runs on that server.
- **Ids and lines.** Scenario titles keep the ids from the registry (S1 to S8, and the ids PRB.T-039 gives the split scenarios, T-002, R1, E2-S1, E2-S3). The run prints one `PASS    <id> <title>` or `FAIL    <id> <title>: <reason>` line per scenario, in the order they finish, with that scenario's time, and a final summary counted from the results (no fixed total). The PASS and FAIL lines keep their format; the `harness.test.ts` assertions on the `n/8 passing` summary line are rewritten for the counted summary, and its other expectations (refusals, cleanup, bystander) keep holding.
- **Selection.** One documented line runs one scenario by id or by name; an id that matches nothing is an error.
- **Failures.** A failed scenario leaves the screenshot, server log tail and last recorded values of PRB.T-036 and a trace; the output names the scenario id and stage. Nothing is retried. No test sets its own timeout.
- **Serial perf run.** PRB.T-036 only records the server-measured click-to-prompt time; this story adds a separate documented command that runs only the click-to-prompt scenario on one worker, reads that time, and fails above 700 ms. The parallel suite prints the same number and never fails on it.
- **Cleanup.** Interrupt (SIGINT, SIGTERM, SIGHUP) stops every server and shell host the run started and deletes their homes. After SIGKILL of the runner, the next run's cleanup (PRB.T-036's manifest) removes what is left, by captured PID.
- **Guard and compatibility.** The runner still refuses real data and server addresses before anything starts, never lets the server inherit `T3CODE_*`, `VITE_*` or `PROBE_*`, and keeps handing scenarios a page without `keyboard`. It uses the Chromium that is already installed for the web browser tests.
- **Removed.** The custom runner, its registry and the fixed total of 8 no longer exist; the library-only Playwright justification is gone from the docs.

### User Flow

1. The developer (or an agent) changes code and runs `vp run test:scenarios`.
2. The bundle step runs once; workers start, each with one server; PASS and FAIL lines appear as scenarios finish, each with its time; the summary and total time follow, and the exit code is non-zero if any scenario failed.
3. For a failure, the developer reads the id, stage and reason, opens the trace and screenshot, and reruns only that scenario with the one-line command.
4. Before a release or when the startup path changes, the developer runs the serial perf command and reads the server-measured click-to-prompt time against 700 ms.

### Edge Cases

- EC-1: One scenario is selected: only the servers it needs start; no idle worker servers.
- EC-2: A scenario leaves shells running when it ends: later scenarios on the same worker do not see them, and they stop with the worker's server and shell host at the end of the run.
- EC-3: A scenario that restarts the server runs beside other scenarios: the others are unaffected, since it has a server of its own.
- EC-4: Several servers start at the same moment: none fails because another took its port.
- EC-5: Two suites run at the same time on one machine (for example two agents): neither sees the other's processes, ports, or homes.
- EC-6: The machine is slow or loaded: a step that is too slow fails the scenario with its stage; there is no retry and no longer timeout set per test. The number of workers is bounded and can be set (SU-1).
- EC-7: A check that cannot run in this environment (for example as root, PRB.T-036) is reported as skipped with its reason, never as a pass.
- EC-8: The run is interrupted while scenarios are running (Ctrl-C): every started server and home is cleaned up; the exit code is non-zero.
- EC-9: A scenario needs a second server (R1): it gets one on its own home and port, stopped when the scenario ends, also when the scenario fails.

### Error Handling

- ER-1: The Chromium cannot start: the run fails before any server starts, naming the browser and how to install it.
- ER-2: A worker's server cannot start: every scenario on that worker fails with the server's output; other workers continue; no process or home is left.
- ER-3: A forbidden target (`~/.t3`, a server address, a path under real data) is asked for: the run refuses before launching anything and exits with a non-zero status naming the reason.
- ER-4: A scenario fails: its result is FAIL with id, stage and reason, and the run continues with the others and exits non-zero.
- ER-5: The perf run measures above 700 ms: it fails naming the measure and the limit.

## Out Of Scope

- Cold-start speed-ups, the sandbox, direct setup and the split of long scenarios: PRB.T-036 to PRB.T-039 (this story needs their results).
- The prompt-ready and layout-saved signals: PRB.T-041.
- Making scenarios a CI gate: not asked for (epic Out).
- Changing what any scenario proves, or removing real PTYs, real git worktrees, real restarts and SIGKILL cases (epic Out; the must-not-change list).
- Browsers other than Chromium, running on other machines, sharding across machines, and mobile or desktop clients.
- Deciding whether the perf run is part of a release routine: epic open question, owner developer (SU-2).
- Setting the full-run time target: the epic owner, after the PRB.T-036 baseline (epic U-2).

## Technical Scope

- **Layers:** the scenario harness (`scripts/scenarios`: runner, server and browser fixtures, result output, guard, cleanup), the Playwright dependency of the scripts package and the dependency checks that name it (knip), the root test command and a second command for the perf run, the harness tests that spawn the runner, and docs. No server, web or contracts code.
- **Docs impact:** `docs/internals/testing.md` "Scenario tests" is rewritten (it justifies a Node runner using Playwright as a library; remove the pending-entry and `--selftest` text); `docs/operations/development.md` "Scenario tests" is rewritten for the new commands, output, selection, trace and the perf run; `AGENTS.md` "Verifying" (line 186) is checked and corrected if its command or wording is no longer accurate. Both docs sections change together with the code.
- **Mobile impact:** none; no mobile or contract change. `vp run check:changed` for the scripts package still passes.

## Non-functional Requirements and Constraints

- Repo test rules apply to the harness itself: no sleeps or polling loops, no `Date.now()`/`performance.now()` deltas, no per-test timeout argument, no `retry`; lint rules `t3code/no-test-timeout-or-unreasoned-skip`, `no-wall-clock-in-tests`, `no-real-time-wait-in-tests`, `no-polling-loop-in-tests` hold, or each exemption states a reason.
- Mouse-first: scenarios keep receiving a page without `keyboard` (typing into a terminal or field stays allowed).
- The guard (NFR-3) holds in the new runner: no path to `~/.t3`, no remote server, never inherit `T3CODE_*`, `VITE_*`, `PROBE_*`, never edit agent CLIs' global config; cleanup is by captured PID, never by pattern (AGENTS.md rule 1).
- Compatibility: the existing cached Chromium; no new browser download; Linux devcontainer and macOS.
- `@playwright/test` is added at the version already used (1.60.0, epic A-5); anything else new needs a reason.
- The PASS/FAIL line format and the ids stay stable for tools that read them (R-6 in the epic).
- Performance: the shared server and parallel workers must not make a scenario depend on timing. The 700 ms gate runs on one worker, nothing else running in that run.

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given the full suite, when `vp run test:scenarios` runs, then every scenario prints a `PASS    <id> <title>` or `FAIL    <id> <title>: <reason>` line carrying S1 to S8 (or their PRB.T-039 successors), T-002, R1, E2-S1 and E2-S3, a time per scenario, and a summary counted from the results; the exit code is non-zero if any failed | auto | FR-13, NFR-6 |
| AC-2  | Given a run with more than one worker, when it finishes, then the output shows at least two scenarios were running at the same time and fewer servers were started than scenarios run (scenarios share servers) | auto | FR-13 |
| AC-3  | Given a self-test where two scenarios on the same worker each create a workspace and a shell, when both run, then each sees only its own workspace and shells; the same self-test fails when its assertion is made global (negative control: a page-wide count that the other scenario's nodes break) | auto | FR-14, EC-2 |
| AC-4  | Given a scenario that restarts the server and one that stops the shell host, when they run in the same run as non-restarting scenarios, then each runs on its own fresh server and home, the other scenarios stay green, and each of those servers is stopped afterwards | auto | FR-13, EC-3 |
| AC-5  | Given a port another process takes after the harness chose it, when a server starts, then it still starts, on a port that is free, with no failed run; and starting several servers at once never fails with "address in use" | auto | FR-14, EC-4 |
| AC-6  | Given the scenario sources, when they are reviewed, then no scenario matches processes by a command-line pattern that another run's processes could also satisfy (S6's `sleep 1601`/`ps -A` check, owned by PRB.T-039, now matches only a run-unique marker), and no assertion counts nodes outside the scenario's own workspace (S3's page-wide `[data-worktree]` count, owned by this story, is scoped) | manual (author, with a search of the sources) | FR-14 |
| AC-7  | Given two full suites started at the same time on one machine, when both finish, then both pass and neither's process checks saw the other's processes | manual (developer) | FR-14, EC-5 |
| AC-8  | Given a failing scenario (the deliberate self-test), when the run ends, then the output names the scenario id and stage, a screenshot, the server log tail, the recorder's last values and a trace exist, the other scenarios still ran and the exit code is non-zero; and a run without a failing scenario is green and exits zero (negative control) | auto | FR-6, NFR-6, ER-4 |
| AC-9  | Given the documented one-line command with an id, when it runs, then only that scenario runs and only the servers it needs start; given an id or name that matches nothing, then the run exits with a non-zero status saying so | auto | NFR-5, EC-1 |
| AC-10 | Given a request for real data (`~/.t3`, a path under it by flag or by `T3CODE_HOME`/`T3CODE_BASE_DIR`) or for a server address, when the suite is started, then it refuses before any server or browser starts and exits non-zero; and a server started by the harness has none of `T3CODE_*`, `VITE_*`, `PROBE_*` from the outside | auto | NFR-3, ER-3 |
| AC-11 | Given a browser that cannot start, or a server binary that cannot start, when the suite runs, then the output names the browser or the server with its output, and every server that did start is stopped and its home deleted | auto | ER-1, ER-2 |
| AC-12 | Given a second server in R1 and in a self-test whose second server cannot start, when the scenario ends, then both servers are stopped and their homes deleted, also on failure | auto | EC-9, ER-2 |
| AC-13 | Given a run, when SIGINT is sent to the runner, then every server, shell host and home it started is gone and the exit is non-zero; given SIGKILL, when the next run starts, then it removes what was left by captured PID and a stray process of another run is untouched | auto (SIGINT); manual (SIGKILL, developer) | NFR-2, EC-8 |
| AC-14 | Given a server already running on the machine (a bystander), when the suite runs twice in a row, then both runs pass and the bystander is untouched and still answering | auto | NFR-2, EC-5 |
| AC-15 | Given the dedicated perf command, when it runs, then it uses one worker, runs only the click-to-prompt scenario, prints the server-measured time and passes at or below 700 ms; given the gate applied to a deliberately slowed prompt (self-test), then it fails naming the measure and the 700 ms limit (negative control) | auto | FR-4, NFR-1, ER-5 |
| AC-16 | Given the parallel suite, when the same scenario runs, then it prints the same click-to-prompt number and passes whatever the value is (no gate in the parallel run) | auto | FR-4 |
| AC-17 | Given a machine where a check cannot run (a root-only gap in PRB.T-036), when the suite runs, then the check is reported as skipped with its reason and is not counted as a pass | auto | EC-7 |
| AC-18 | Given the scenario and harness sources, when `vp run check:changed` and the lint rules run, then no scenario sets a per-test timeout or a retry, none uses a wall-clock delta, sleep or polling loop without a stated reason, and a scenario that tries to use keyboard input on the page is rejected (negative control) | auto | NFR-2, NFR-5, NFR-7 |
| AC-19 | Given the repository after the change, when it is searched, then `run.ts`, `registry.ts`, the fixed `TOTAL`, the `PENDING` output and the library-only Playwright justification are gone and the fixtures module is the only place for setup helpers | manual (reviewer) | FR-15, NFR-7 |
| AC-20 | Given the docs after the change, when `docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md "Verifying" are read against the code, then no sentence contradicts the new commands, output, selection, trace or perf run and the old text is rewritten, not appended to | manual (docs diff review, developer) | FR-15, NFR-7 |
| AC-21 | Given the devcontainer's cached Chromium and no network, when the suite runs, then no browser is downloaded; and given a Mac, when the suite runs, then it passes | auto (Linux); manual (macOS, developer) | NFR-4 |
| AC-22 | Given PRB.T-041 landed, when ten consecutive full runs with several workers and no retries or code changes between them run, then all ten pass | manual (developer, loop) | FR-13, NFR-2 |
| AC-23 | Given the baseline of PRB.T-036, when the full suite runs three times on the devcontainer with several workers, then the median full-run time and per-scenario times are recorded next to the baseline; the target is set by the epic owner (TBD) | manual (developer) | NFR-1 |
| AC-24 | Given the sandbox of PRB.T-037, when a scenario is run against a live sandbox server, then it still works with the new runner | auto | FR-13, NFR-5 |
| AC-25 | Given a web source file changed since the last build, when the suite starts with several workers, then the bundle step runs once for the whole run and prints which bundle was used | auto | FR-1 (kept), NFR-1 |
| AC-26 | Given the documented way to set the number of parallel workers, when a run is started with a value, then no more than that many scenarios run at once; and without a value the bound is the documented default | auto | EC-6 |

## Dependencies

Depends on: PRB.T-039, PRB.T-038, PRB.T-037, PRB.T-036, PRB.T-041. Blocks: nothing in PRB.E-005; closing this story closes the epic's last open item together with the docs.

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-039 | Parallel workers need small independent scenarios that each build their own repo; a 25-criterion script cannot be shared or reordered | backlog |
| PRB.T-038 | Each scenario creates its own workspace, projects and shells directly through the API; without it each scenario's setup is too slow and too UI-coupled to share a server | backlog |
| PRB.T-037 | The sandbox's helpers and its single-scenario-against-a-live-server path must keep working under the new runner (AC-24) | backlog |
| PRB.T-036 | Provides the bundle step, the server-side prompt measure, the failure artifacts, the cleanup manifest and the fixtures module that this story builds on | backlog |
| PRB.T-041 | Must land before this story closes: parallel load exposes guessed waits, and the flake-free claim (AC-22) depends on the signals. Not needed to start | backlog |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | `@playwright/test` 1.60.0 works with the cached `chromium_headless_shell` and needs no new download (epic A-5) | assumption | unverified (the cache holds only `chromium_headless_shell-1223`, 2026-11-09) | Spike at the start of this story; AC-21 | author |
| SA-2 | Scenarios, once scoped to their own workspace, are independent enough to share one server per worker (epic A-4) | assumption | unverified | AC-2, AC-3, AC-7; shown by PRB.T-039 and this story | author |
| SA-3 | PRB.T-036 delivers a server-side click-to-prompt measure that a test can read from outside the server, the one-time bundle step, the failure artifacts and the cleanup manifest | assumption | unverified (PRB.T-036's body was not yet written when this was drafted, 2026-11-09) | Read PRB.T-036 when planning; reconcile before the plan | author |
| SA-4 | PRB.T-039 leaves scenarios that each build their own repo and do not depend on state another scenario made | assumption | unverified | Read the split scenarios when planning; AC-3 | author |
| SA-5 | The run, bundle step, guard and cleanup behave the same when started by the Playwright Test runner as by `run.ts`, including that Playwright's own signal handling must not exit before servers stop (today it is switched off, `browser.ts:7-12`) | assumption | unverified | AC-13 | author |
| SA-6 | The existing `PASS`/`FAIL` lines can be printed unchanged so that `harness.test.ts` expectations keep working apart from the summary line | assumption | unverified | AC-1 | author |
| SA-7 | A free port can be had without the bind-and-release race, for example by retrying a start or reading the port the server bound; `serve` supports one of them | assumption | unverified | Plan stage; AC-5 | author |
| SA-8 | A minority of tests need a fresh server after PRB.T-039 splits the long scenarios (today seven of twelve call restart, so the saving depends on the split) | assumption | unverified (restart count verified by grep, 2026-11-09; the saving is not) | Count after PRB.T-039; AC-23 | author |
| SA-9 | Nothing in `apps/mobile` or `apps/desktop` imports the harness, so this story needs no change there | assumption | unverified | `vp run check:changed` on the scripts package; search for imports when planning | author |
| SU-1 | How many workers are right on the devcontainer and on a Mac, and whether load changes pass rates | unknown | unverified | Measure with 2, 4 and the default; set a bound; TBD (author, before the plan) | author |
| SU-2 | Whether the perf run is on request or a documented routine before releases (epic open question) | unknown | unverified | Decide with the developer | developer |
| SU-3 | Whether `vp run test:scenarios -- --only <id>` or a Playwright-native filter is the one-line selection, and how a name is matched | unknown | unverified | Decided in the plan; must be one documented line (AC-9) | author |
