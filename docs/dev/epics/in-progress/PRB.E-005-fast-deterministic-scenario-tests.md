---
id: PRB.E-005
type: epic
parent:
phase: 1
labels: [testing]
created: 2026-11-09
updated: 2026-11-11
---

# Fast, deterministic scenario tests

## Goal

The developer and the agents building Probe get a scenario suite of saved, atomic, composable scenarios, in which no atomic check scenario runs longer than a set cap, that passes or fails the same way on every run, explains a failure on its first run so nothing is ever run twice, and can be run as any chosen set or composition, in the suite or, where it needs no restart or fresh server, against a live server, with the rules for writing it in one agent rules file that loads for the e2e files.

## Why and why now

Terminal-first behavior is proven only by the scenario harness (`vp run test:scenarios`), and every new feature adds or extends a scenario. The harness is now the slowest and least trustworthy part of the loop. Evidence is in [scenario-harness-analysis](../../research/scenario-harness-analysis.md) (a desk analysis of 2026-11-09; claims marked unverified there were not run):

- Every scenario cold-starts its own server and runs one after another (13 cold starts, one per registered scenario), and most set up workspaces, projects and shells by clicking through dialogs, which is not what they test.
- The suite used waits the repo's own test rules forbid (polling, wall-clock deltas), typed into a terminal before it was ready, and ran the developer's real shell config; S2 (PRB.T-011 "exactly once") was seen failing, and the shell config is the suspected cause (A-1, unverified). PRB.T-036's fixes for these were merged on 2026-11-10; its baseline and handoff are still open.
- The web bundle was rebuilt only when missing, so after a web change the suite tested the old UI. This cost the project two debugging sessions in one day (fixed in the PRB.T-036 merge).
- Scenarios mix purposes: three are single scripts of 15 to 25 acceptance criteria, and S2 and E2-S3 both check behavior and measure time. An early failure hides the rest, nothing can be rerun from stage N, and an agent cannot run "just the restart behavior".
- There is no way to keep a server up and drive one step, so agents write throwaway TypeScript. Those scripts prove something once and are lost; the next agent writes them again.
- When a scenario fails, people rerun it to find out why. A failure that needs a rerun to understand is a scenario that does not log enough.
- The rules for writing scenarios are spread over AGENTS.md "Verifying", `docs/internals/testing.md` and `docs/operations/development.md`, and they have drifted already (development.md still says the bundle is built only when missing). An agent that edits a scenario has no single place to read, and nothing loads the rules when it opens a scenario file.

If we skip it, each new feature makes the suite slower and flakier, a red run stops meaning "broken", agents keep rewriting the same throwaway checks, and the "prove it with a scenario" rule in AGENTS.md loses its value.

## KPI

The primary KPI caps how long one check scenario may run, not how long the whole suite runs: the suite grows with every feature, so its total is not a stable target, while the cap keeps each scenario small (user decision, 2026-11-10). Perf scenarios (FR-16) are excluded from the cap entirely, and so are composed scenarios (FR-17), whose steps are each held to it. A first baseline was taken on 2026-11-09 after an invalid first attempt (stale bundle, `bc` missing): single scenarios took 13 s (S5) to 51 s (E2-S1), each including about 13 s of fixed cost (runner start, browser launch, one server start); the full serial run took 346 s; S2 failed, and S4 and S7 each failed once. The cap is 15 s (user decision, 2026-11-10). It is not measured on every run: it is a separate gate check (FR-22), run once after a scenario is implemented and again only when the user asks, each time after the user confirms that nothing running in the background slows the machine significantly. Normal runs never compare a time to the cap. The gate times each scenario once, with no median or best-of, because a scenario that passes only on some runs is the problem this epic removes. PRB.T-036 took the baseline the same way (2026-11-10).

| Metric | Kind | Baseline | Target | Measured how and where | By when |
| ------ | ---- | -------- | ------ | ---------------------- | ------- |
| Longest atomic check scenario: the largest per-scenario time in a cap gate run (atomic check scenarios only; perf scenarios excluded, and composed scenarios excluded because each of their steps is an atomic scenario under the cap; time from the scenario's start to its end as the runner prints it, including its own server start when it needs a fresh one, excluding runner start and browser launch; rebuilt bundle, no retries) | primary | 41.0 s (S7), 2026-11-10, one serial run on a rebuilt bundle on the devcontainer (PRB.T-036); no scenario is atomic yet, and only S5, T-002, E2-S3, E2-S4 and R1 were under 15 s; per-scenario times in PRB.T-036 | 15 s (user, 2026-11-10) | The cap gate check (FR-22) on the devcontainer, one run per scenario, after the user confirms the machine is quiet; met when every atomic check scenario passed its gate | Gated per scenario as each is implemented in PRB.T-039; met for all of them when PRB.T-040 closes, with one gate run of the whole suite the user confirms (the cap assumes a shared server, A-13) |
| Flake rate: share of N consecutive runs with any failure, counting both the full check suite and the serial perf run, no retries, no code changes between runs | guardrail | 3 of 7 full runs had a failure (S8 2/7, S6 1/7), 2026-11-10, check suite only (no perf run yet), PRB.T-036; all from typing before the prompt mark after `leaveAgent` | 0 failures in N runs, perf run included; N = 7 (user, 2026-11-10) | A loop of N runs of the suite and of the perf run on the devcontainer, recorded failures per scenario | Measured when the last story closes |

## Users and scenarios

Users: the developer, and the agents building features.

1. As a developer, I run the whole suite after a change, including a web change, and get a trustworthy answer about the current code fast, so that I run it before every push.
2. As a developer, I run the suite ten times in a row and it is green every time, so that a red run always means a real regression.
3. As an agent verifying a feature, I pick the saved scenarios that cover exactly what I changed, compose them with others into a bigger flow when I need one, and run that set against a sandbox server. Anything new I check, I first save as a scenario, so the next agent can reuse it and I never write a throwaway script.
4. As an agent or developer with a failing scenario, one run tells me which scenario and stage failed, what was expected and what happened, with a screenshot, the server's debug log and a trace, so that I never rerun it to find out why.
5. As an agent writing or changing a scenario, I get the e2e rules loaded as soon as I touch the e2e files, from one place that matches the harness, so that I do not hunt through AGENTS.md and three docs that disagree.

## Scope

**In:**

- Fix the sources of lying and flakes in the current harness (phase 0 of the analysis; done in PRB.T-036).
- One scoped agent rules file for writing and running scenarios, and the removal of what it replaces from AGENTS.md, `docs/internals/testing.md` and `docs/operations/development.md`.
- A shared e2e library of reusable setup, steps, waits and logging helpers. Workspaces, projects and shells are set up directly through the server API where the UI is not the subject, and one real UI path stays per action family.
- Making every scenario atomic: one purpose each, with checks and perf scenarios separate, so that each runs alone and scenarios can be composed into saved bigger ones.
- A sandbox mode for agents: a live harness server, named fixtures, and running saved scenarios or sets by id against it.
- Logging that makes a first failure readable, including debug-level log lines added to product code where a scenario needs them.
- A row for `.agents/rules/` in the AGENTS.md documentation table, so the place is listed like every other.
- A runner that runs scenarios in parallel while sharing a server between them, with traces and selection by id or set.
- Two small production signals ("prompt ready" and "layout saved"), the page's per-tab attached state, and a kill's removal that follows the shell process's end, so tests wait on facts instead of guesses.

**Out (non-goals, with a reason):**

- Unit tests (`*.test.ts`) and web browser tests (`*.browser.test.tsx`): their rules stay in AGENTS.md "Verifying" and `docs/internals/testing.md` (user decision, 2026-11-10). Browser tests are component tests in Vitest browser mode with mocks and no real server, not e2e.
- Making scenarios a CI gate: the user has not asked for it; CI owns the unit and browser suites.
- Dropping or weakening what the scenarios prove. Splitting, regrouping, composing and moving them to a new runner (FR-11, FR-13, FR-16, FR-17) keep every acceptance criterion they prove today. The following stay real because they are the point of the suite (the analysis's "must not change" list): real PTYs, real git worktrees, real websockets; real server restarts (a restart is not a page reload); abrupt-kill and lost-host cases; pointer-only input (mouse-first rule); the throwaway-home guard and cleanup by captured PID; the mock agent as the agent stand-in; the second-server path (R1, seam); the PRB.T-011 contract end to end.
- Product performance budgets and the cost of the production changes themselves (for example PRB.E-002's 700 ms click-to-prompt, or what the prompt-ready signal costs per shell): they are product requirements owned by product epics (user decision, 2026-11-10). This epic only provides the perf scenario kind and the serial perf run that check such budgets.
- Ad-hoc probes against the sandbox: the sandbox runs saved scenarios only (user decision, 2026-11-10).
- Behavior or timing under a developer's own shell config: scenarios run an isolated shell by design, because that is what makes them deterministic (user decision, 2026-11-10). Effects of real users' shell setups belong to product epics.
- Info-level product logging added for tests: diagnostic lines go at debug level, which the default production level hides (FR-20).
- Rule loading for agent harnesses other than Claude Code beyond the AGENTS.md pointer line (see R-9).
- Adding agent-status or other new product behavior, and new scenarios for unbuilt features: separate epics.
- Chat-era tests and the frozen provider adapters.
- Mobile: no mobile code changes; the signals change a shared contract that mobile reads, and mobile must still compile.
- Desktop: no impact, the suite drives the browser build only.

## Functional requirements

FR-1 to FR-15 keep their numbers because PRB.T-036 to PRB.T-041 cite them; FR-9, FR-11 and FR-15 were rewritten on 2026-11-10.

| ID    | Requirement | Priority | Scenario |
| ----- | ----------- | -------- | -------- |
| FR-1  | Running the suite after a web or contracts change rebuilds the bundle first and prints which bundle was used; a stale bundle can no longer be tested silently. | must | 1 |
| FR-2  | Scenario servers run with an isolated shell config, so the same scenario behaves the same on any developer or agent machine. | must | 2 |
| FR-3  | The PRB.T-011 contract (command typed after the first prompt, banner after it) is checked as an order on the raw history, not as "appears exactly once". | must | 2 |
| FR-4  | No check scenario gates on elapsed wall-clock time; durations are recorded only by perf scenarios (FR-16), which run only in the separate serial perf run. | must | 1, 2 |
| FR-5  | A wait for terminal output cannot be satisfied by output that arrived earlier, and "nothing arrived since" can be asserted. | must | 2 |
| FR-6  | A failed scenario leaves a screenshot, the server log tail and the last recorded values; under the new runner it also leaves a trace. | must | 4 |
| FR-7  | Checks that cannot run as root are skipped with a stated reason, or run another way; they never pass vacuously. | should | 2 |
| FR-8  | One command starts a sandbox server on a throwaway home, optionally seeds a named fixture, prints origin, pairing URL, home and PIDs, and stays up until stopped by the printed PID. | must | 3 |
| FR-9  | A saved scenario (one registered in the suite under an id; an agent writing a new one registers it first and iterates on it there) can be run by id against a live sandbox without a cold start, and the sandbox runs nothing else: there is no entry point for an ad-hoc script. Scenarios that restart the server, need a pristine home, need a second server, change or depend on server-wide state, or need a server started under a condition (an environment variable, a faulty git config) are refused on the sandbox with a reason. Once sets and composed scenarios exist (FR-17), they run on the sandbox the same way. The sandbox commands are in the e2e rules file (FR-15). | must | 3 |
| FR-10 | Scenarios whose subject is not the dialog create workspaces, projects and shells directly through the server API; one real UI path per action family stays (add project, "+" modal, kill with confirmation, Restore, Workspaces menu). | must | 1 |
| FR-11 | Every scenario that exists when PRB.T-039 starts (today S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4, plus E2-S2 or E2-S5 if they landed as long scenarios) is replaced by atomic scenarios (FR-16) that each build their own repo and can run alone; restarts remain only where restart behavior is the subject; every old acceptance criterion maps to a new scenario. | must | 3, 4 |
| FR-12 | Tests wait on a "terminal prompt ready" state and a "layout saved" state exposed by the app, never type into a terminal or reload on a guess; polling for a process to exit is replaced by the shell's ended event plus one process check where the server owns the pid. | must | 2 |
| FR-13 | Scenarios run in parallel, several sharing one server, with a fresh server only for scenarios that restart, need a pristine home, change or depend on server-wide state, or need a server started under a condition; a scenario or a named set can be selected by id, and every old id (S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4) stays findable as a set name in the output, so counts other tickets cite stay resolvable. Scenarios not built yet (E2-S2, E2-S5) are written by their own stories in PRB.E-002 (PRB.T-019 writes E2-S2, PRB.T-020 writes E2-S5) under the e2e rules file, as atomic scenarios plus a set under the same id; this epic does not build them. | must | 1, 3 |
| FR-14 | Scenarios are isolated from each other: no global process-table patterns, no fixed ports reserved by bind-and-release, assertions scoped to the scenario's own workspace. | must | 2 |
| FR-15 | The rules for writing and running scenarios live in one agent rules file, scoped to the e2e files (the harness, its scenarios and the mock agent), that loads when an agent reads or edits them. AGENTS.md, `docs/internals/testing.md` and `docs/operations/development.md` keep at most a one-line pointer to it (AGENTS.md also lists the rules folder in its documentation table) and restate none of it; the rules file links to the general test rules in AGENTS.md instead of copying them. Every story that changes harness behavior updates the file the same day. | must | 5 |
| FR-16 | Every scenario has one purpose and is one of two kinds: a check scenario asserts behavior and never records a duration; a perf scenario measures and asserts only its own budget. No scenario is both. A perf scenario lives in a file named `<scenario>.perf.ts`; the default suite never runs a `.perf.ts` file and the serial perf run runs only those. | must | 3, 4 |
| FR-17 | A composed scenario is a saved scenario built from atomic scenarios as its steps, in a stated order; it runs and fails like any scenario and names the step that failed. A named set of scenarios runs exactly its members. Both run on the sandbox (FR-9) as well as in the suite. | must | 3 |
| FR-18 | No throwaway scenarios: every scripted check that drives a harness or sandbox server is a saved scenario in the suite; nobody writes a one-off driver script. The rules file states this, and reviews reject evidence produced by an unsaved driver script. The manual and integrated checks AGENTS.md requires (a `test-t3-app` pass, before/after captures, a runtime transcript) are not scripted scenarios and are unaffected. | must | 3 |
| FR-19 | No scenario, check or perf, is rerun unchanged on unchanged code to get a pass, a reading or a diagnosis; running again after changing the scenario or the code is normal work, and a determinism loop of N runs (the KPI's flake loop, or a story's own N-run check of a fix) is the only deliberate repeat, because it measures the rule. A failing scenario is diagnosable from its first run: the output names the scenario, the stage, what was expected and what was found, and the artifacts (FR-6) carry the log lines around the failure. A failure whose cause needed a rerun to find is a defect of the scenario and is fixed in it (more logging or a sharper assertion), never by a retry. A perf scenario passes or fails on one isolated run: its budget is set so that one run meets it, never as a median or best of several. Timing the runner prints for every scenario (NFR-6) is not the scenario recording a duration. | must | 4 |
| FR-20 | Scenario servers run at debug log level, and the failure artifacts include the server's debug log and the browser console. Product code may gain debug-level log lines that a scenario needs; they are off at the production default level. | must | 4 |
| FR-21 | One shared e2e library holds every reusable setup, step, wait, fixture and logging helper; a scenario file holds only its own steps and assertions and defines no helper another scenario could use. | must | 3, 5 |
| FR-22 | The 15 s cap is checked by a separate gate check, never by a normal run: it runs the chosen atomic check scenarios serially, once each, and fails any that exceeds the cap. It runs once after a scenario is implemented, and again only when the user asks. Before it runs, the agent asks the user to confirm that nothing in the background slows the machine significantly. Normal runs print timing (NFR-6) but never compare it to the cap. | must | 1 |

## Non-functional requirements

| ID    | Quality | Requirement with a measurable limit | Not applicable because |
| ----- | ------- | ----------------------------------- | ---------------------- |
| NFR-1 | Performance | Every atomic check scenario passes the 15 s cap gate (KPI, FR-22), even though atomic scenarios each set up their own state. | |
| NFR-2 | Reliability and recovery | 0 failures in N consecutive full runs with no retries and no per-test timeout arguments; a runner killed abruptly leaves no stray server or shell host after the next run's cleanup (by captured PID). | |
| NFR-3 | Security and privacy | The throwaway-home guard stays: the harness refuses `~/.t3` and any non-local server address, never inherits `T3CODE_*` or `VITE_*`, and never edits agent CLIs' global config. The sandbox binds loopback only and prints a pairing URL that is never committed. Debug log lines added to product code never print tokens, pairing URLs or cookies. | |
| NFR-4 | Compatibility (OS, browsers, agent CLIs, mobile impact) | Runs on Linux in the devcontainer and on macOS; Chromium only, from the browser install the repo already has. Agent CLIs: the mock agent only; Claude Code and others are not exercised. Mobile impact: none; mobile still compiles after the signal contract changes. | |
| NFR-5 | Usability and accessibility | Running one scenario, one set and the sandbox are each one line in the rules file; a failure names the scenario id and stage. The mouse-first rule holds: scenarios keep pointer-only input. | |
| NFR-6 | Observability (logs, status, how we tell it broke) | Every failure ships a screenshot, the server's debug log tail, the browser console and the last recorded values (FR-6, FR-20), with expected and found values (FR-19); the per-scenario timing is printed on every run so a slowdown is visible. | |
| NFR-7 | Maintainability and docs | One shared e2e library and no duplicate helpers across scenario files (FR-21); one rules file that no other doc restates (FR-15); AGENTS.md "Verifying" is checked for accuracy and keeps the unit and browser rules. | |

## Approach

Make the suite honest first, then write down the rules, then make it reusable, atomic and fast, and finally remove the last guesses. Each step leaves the suite runnable.

1. Fix what lies or flakes today in one pass, and take the baseline (FR-1 to FR-7). The fixes are merged; the baseline is still to record.
2. Write the e2e rules in one scoped rules file and cut what it replaces from AGENTS.md and the docs. Every later step works under these rules and updates the file in the same change.
3. Give agents a sandbox that runs saved scenarios against a live server, so checking one thing costs no cold start and leaves a reusable scenario behind.
4. Build the shared e2e library: direct setup through the server API, with one real UI path per action family, and the waits and logging helpers every scenario uses. Scenario servers log at debug level.
5. Replace every scenario with atomic ones, split checks from perf scenarios, and add composed scenarios and named sets, so a failure points at one behavior and any part runs alone or in a bigger flow.
6. Move to a runner that shares a server per worker and runs in parallel, with traces and selection.
7. Add the two small app signals, so tests stop guessing readiness. They must land before the parallel runner is declared flake-free, because parallel load is what exposes guessed waits.

Fallback: if A-4 (scenarios can share a server) or A-5 (the new runner works with the existing browser) is false, keep the current Node runner with a server per scenario and still deliver every other story. Under the fallback FR-13 drops its shared server (parallel lanes each start their own) and FR-6 drops the trace. If A-4 is false for scenarios run one after another (checked first in PRB.T-037), FR-9 also changes: the sandbox gives each scenario a fresh workspace on the same server, or refuses scenarios that leave state behind, and says which. Every other FR stands. The A-5 spike ran first in PRB.T-037, before the sandbox was built, so the sandbox, the library and composition are not built on a runner that is about to change without knowing it. If every scenario then pays a cold start, the epic owner re-checks the cap. The A-4 check ran on the sandbox's first slice (start a server, run one scenario by id), built before the rest of the sandbox. Desk reading (PRB.T-037, 2026-11-10): no two scenarios can share a server as written (fixed workspace name and folders, E2-S4's server-wide starting-script list); S6 cannot share one until its process-table pattern is fixed (FR-14, PRB.T-039). Result (PRB.T-037, 2026-11-10): A-5 is true, and A-4 is true for S5 then S4 once they name what they make by run, so no Fallback applies so far.

Alternatives considered: only parallelizing the current runner (loses to flaky waits and shared global state, which would get worse under load); deleting scenarios or loosening checks to save time (rejected, the must-not-change list exists for this); a mock server instead of a real one (rejected, restarts, PTYs and websockets are the product); keeping long scenarios and adding "rerun from stage N" (rejected, it does not let an agent run or compose one behavior); keeping the rules in AGENTS.md and the docs (rejected by the user: they load for every task, not when an agent touches the e2e files, and they have drifted already).

## Stories (candidates)

PRB.T-036 to PRB.T-041 exist as tickets; the rules story is PRB.T-042 (created 2026-11-10). PRB.T-036's AC-21, its baseline constraint ("median of 3") and its full-run target wording were amended before the baseline was recorded: the baseline is per-scenario times from one gate-style run (serial, one run, after the user confirms the machine is quiet), no median, and the target is the 15 s per-scenario cap. PRB.T-037 to PRB.T-041 were reworked through the story skill on 2026-11-10, and PRB.T-039 was then split: its building blocks moved to PRB.T-043 (user decision, 2026-11-10); PRB.T-039 is now titled "Convert every scenario into atomic, composable check scenarios". PRB.T-042 is done (2026-11-10), and PRB.T-037 is done (2026-11-11).

| #   | Title | Value in one line | Order / depends on | Owns (FR) |
| --- | ----- | ----------------- | ------------------ | --------- |
| 1   | PRB.T-036 Scenario quick fixes: clean shell, auto rebuild, no wall-clock gates, failure artifacts, one fixtures module (phase 0, one story by decision) | The suite stops lying and flaking, and yields the baseline | First (code merged 2026-11-10; baseline and handoff left) | FR-1, FR-2, FR-3, FR-4 (no wall-clock gates in check scenarios), FR-5, FR-6 (screenshot, log tail, recorded values), FR-7 |
| 2   | PRB.T-042 Scenario rules load from one scoped file, and lint enforces them in scenario files | Agents get the right rules the moment they touch a scenario; the docs stop disagreeing | After PRB.T-036; before PRB.T-037 | FR-15 (creates the file and the pointers; each later story keeps it current), FR-18 (the no-throwaway rule), FR-4 (the test lint rules also run on scenario files, A-15) |
| 3   | PRB.T-037 Scenario sandbox: keep a server up and run saved scenarios against it | Checking one thing costs no cold start and leaves a reusable scenario | After the rules story; starts with the A-5 spike (moved from PRB.T-040's SA-1) and a check of A-4 for scenarios run one after another | FR-8, FR-9 (single scenarios and the refusals; sets and composed scenarios on the sandbox come with FR-17) |
| 4   | PRB.T-038 Shared e2e library: direct setup over the API, one real UI path per action, waits and debug logging | Scenarios get short, reuse one toolkit and log enough to explain a failure | After PRB.T-037 | FR-10, FR-20, FR-21 |
| 5a  | PRB.T-043 Check and perf kinds, sets, composed scenarios and the cap gate (split from # 5, 2026-11-10) | Scenarios get the building blocks to be checks or measures, grouped and composed, and timed against the cap | After PRB.T-038 | FR-16 (kinds, `.perf.ts`, today's timings moved into perf scenarios), FR-17 (the mechanism, including the sandbox), FR-19 (deliberate-failure self-tests), FR-22 (the gate command), FR-9 (two new needs: server-wide state, a server started under a condition) |
| 5b  | PRB.T-039 Convert every scenario into atomic, composable check scenarios | A failure names one behavior; any scenario runs alone or inside a bigger one | After PRB.T-043 | FR-11, FR-9 (converts the "not yet safe" refusals), FR-17 (old ids as sets, a composed scenario from converted ones), FR-19 (expected and found in every assertion), FR-22 (one gate per scenario it implements), FR-14 (process-table marker in S6: no global `ps` pattern that matches other runs); touches FR-4 only by replacing wall-clock waits in the scenarios it splits |
| 6   | PRB.T-040 Run scenarios on the Playwright Test runner with a shared server and parallel workers | The suite runs in parallel on shared servers; traces and selection | After PRB.T-039; must not close before PRB.T-041 | FR-13, FR-14 (ports with no bind-then-release race; assertions scoped per workspace, for example S3's page-wide `[data-worktree]` count), FR-4 (the serial perf command), FR-6 (trace); FR-19's runner part (retries fixed at 0 in the runner config, no repeat option in the documented commands); the N-run flake loop, documented in the rules file as the only sanctioned repeat; keeps the sandbox (FR-9) and the cap gate (FR-22) working on the new runner, with one whole-suite gate at close; the parallel-load check of FR-12 and A-11 |
| 7   | PRB.T-041 Prompt-ready and layout-saved signals | Tests wait on facts, not guesses | After PRB.T-036 and the rules story; independent of stories 3 to 6; lands before PRB.T-040 closes | FR-12 (verified with serial N runs if PRB.T-040 has not landed; the parallel-load check and A-11 belong to PRB.T-040) |

FR-4 is split: PRB.T-036 removes wall-clock gates; PRB.T-043 moves every timing into perf scenarios (FR-16); PRB.T-040 builds the serial perf command. FR-12 is owned by PRB.T-041; PRB.T-036 and PRB.T-039 only touch it. Whichever of PRB.T-038, PRB.T-039 and PRB.T-041 lands last switches the library's waits and the scenarios to the signals. PRB.T-041 ships as one unit (prompt-ready, layout-saved and the process-end wait), because the flake-free claim in PRB.T-040 needs all three.

Docs: the rules story writes the rules file and cuts the duplicates. After that, each story updates the rules file in the change that alters the harness, never in a final docs story. PRB.T-036's AC-22 (docs no longer say the bundle is built only when missing, or that E2-S3 fails above its budget) is met by the rules story when it replaces the stale text; PRB.T-036 may close with AC-22 handed to the rules story; PRB.T-036's AC-22 is amended through `tm` to say so. The rules story starts after PRB.T-036's code merge (done), not after it closes.

## Verification

- **Traceability:** every FR and NFR above appears in one row; none is left unverified.

| Requirement | Verified by (scenario test / measurement / manual check) | Owner |
| ----------- | -------------------------------------------------------- | ----- |
| FR-1 | Manual check: change a web source file, run the suite. Pass: the printed bundle line shows a rebuild and the changed UI is what the scenarios drive. | developer |
| FR-2 | Run S2 (or its atomic successors) on a machine with a heavy shell config (the devcontainer's oh-my-zsh). Pass: green in N runs (N from the KPI). | developer |
| FR-3 | The PRB.T-011 contract scenario passes; a deliberate break of the order makes it fail (harness self-test). Pass: both outcomes as stated. | developer |
| FR-4 | Review: no wall-clock delta in a check scenario (a source search of check scenarios finds none, and the lint rule `t3code/no-wall-clock-in-tests` flags a deliberate delta in a scenario file, see A-15); the serial perf run runs every perf scenario and nothing else. Pass: lint clean, or the source search named by the rules story finds none; and the perf run holds. | developer |
| FR-5 | Harness self-test: a wait given an offset ignores earlier output. Pass: the self-test is green and fails when the offset is removed. | developer |
| FR-6 | Harness self-test: a deliberate failure. Pass: it leaves the screenshot, log tail, recorded values (and a trace after PRB.T-040). | developer |
| FR-7 | Run as root, then as non-root. Pass: skipped checks print a reason as root; the same checks execute as non-root. | developer |
| FR-8 | Manual check of the sandbox command. Pass: it prints origin, pairing URL, home and PIDs, stays up, and stops when the printed PID is killed with no stray process. | developer |
| FR-9 | Manual check, at the close of PRB.T-037: an agent following only the rules file runs two saved scenarios one after the other against a sandbox; a path to an unsaved script, and a restart scenario, are refused. Pass: both runs succeed with no cold start after the first, and both refusals name a reason. The set and composed parts are checked in the FR-17 row. | developer |
| FR-10 | Measurement: a recorded before/after table of round trips and times per scenario; PRB.T-038 counts the "before" round trips itself at its start, and the threshold is set by the epic owner from that count. Pass: the table meets the threshold and the run still exercises the one UI path per family. | developer |
| FR-11 | Mapping table in PRB.T-039 from every old acceptance criterion to a new scenario; each new scenario runs alone by id. Pass: no old AC is unmapped and every mapped scenario passes alone. | developer |
| FR-12 | Scenarios using the signals run N times under parallel load. Pass: 0 failures in N runs and no polling for process exit left. | developer |
| FR-13 | Run with several parallel lanes, then run one set by name. Pass: every old id is findable as a set name in the output, the suite is green, restart scenarios used a fresh server, and the set ran exactly its members. | developer |
| FR-14 | Run two suites at the same time on one machine. Pass: both exit 0 and leave no stray processes. | developer |
| FR-15 | Manual check: an agent session that opens a scenario file has the rules file loaded (Claude Code shows it in context); docs diff review of AGENTS.md, `docs/internals/testing.md` and `docs/operations/development.md`. Pass: the rules load, and each of the three files holds at most a one-line pointer for scenarios and contradicts nothing in the rules file. | developer |
| FR-16 | Review of every scenario file plus a harness self-test: a check scenario that records a duration, or a perf scenario that asserts behavior, fails the run. Pass: the self-test fails both deliberate mixes, every perf scenario is a `.perf.ts` file, the default suite runs no `.perf.ts` file and the perf run runs nothing else. | developer |
| FR-17 | Harness self-test: a composed scenario of three atomic ones with a deliberate failure in the second; then one set and one composed scenario run against a sandbox (manual). Pass: the output names the composed scenario and the failing step, a named set runs exactly its members, and both run on the sandbox with no cold start. | developer |
| FR-18 | Review: the rules file states the rule; the sandbox refuses unsaved scripts (FR-9 row). Pass: both hold. | developer |
| FR-19 | Harness self-tests with deliberate failures of three kinds (wrong UI state, missing terminal output, server crash). Pass: each first-run output names the scenario, stage, expected and found, and the artifacts contain the server log lines from the failing stage; the developer identifies each cause from that run alone. The rules file forbids rerunning an unchanged scenario on unchanged code to get a pass, a reading or a diagnosis (the N-run loop excepted), and the runner offers no retry option. | developer |
| FR-20 | Self-test failure on a scenario server, plus a production-default start. Pass: the artifacts include debug-level server lines and the browser console; a server started with no log flag and no `T3CODE_LOG_LEVEL` prints none of the debug lines. | developer |
| FR-21 | Review against the rules file: no helper is defined in more than one scenario file or outside the library. Pass: none found; `vp run typecheck` and knip pass for `scripts`. | developer |
| FR-22 | Manual check: implement one atomic scenario, run the gate after confirming with the user; run a normal suite run. Pass: the gate asks for the confirmation, times the scenario once and fails a deliberately slowed one; the normal run prints times and never fails on the cap. | developer |
| NFR-1 | Same as FR-22. Pass: every atomic check scenario passed its gate. | developer |
| NFR-2 | N-run loop; kill the runner abruptly mid-run, then start a new run. Pass: 0 failures in N runs (N from the KPI) and no stray processes by captured PID after the next run. | developer |
| NFR-3 | Review: guard test in `harness.test.ts` still refuses `~/.t3` and remote addresses; review of the added debug log lines. Pass: the test is green, the sandbox binds loopback only, and no added line prints a token, pairing URL or cookie. | developer |
| NFR-4 | Run on macOS and Linux; `vp run typecheck` for mobile affected packages. Pass: suite green on both and typecheck exits 0. | developer |
| NFR-5 | Manual check of the commands in the rules file and of the failure output. Pass: each command is one line, and a failure names the scenario id and stage. | developer |
| NFR-6 | Same as FR-6, FR-19 and FR-20, plus the timing lines in the output. Pass: those rows pass and per-scenario timing prints on every run. | developer |
| NFR-7 | Same as FR-15 and FR-21. Pass: both rows pass. | developer |

- **KPI measurement:** the cap gate check (FR-22): per-scenario times of the atomic check scenarios from one run on a rebuilt bundle with no retries, after the user confirms nothing heavy runs in the background; never a median, and never part of a normal run. Flake rate over N consecutive runs (N = 10 proposed) of the check suite and of the serial perf run, with no retries and no changes between runs. Baseline taken in PRB.T-036; the final numbers by the same method.
- **Automated scenarios:** this epic is about the scenario suite itself. Its own behavior is covered by `scripts/scenarios/harness.test.ts` and the `--selftest` cases; every existing scenario (S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4, or their atomic successors) must still pass and keep proving what it proves today (acceptance criteria cited by other tickets stay resolvable, see Dependencies).
- **Manual checks:** the rules file loading in an agent session; sandbox use from the rules file only (developer or an agent following it); macOS run; the 10-run loop.
- **Sign-off:** the developer.

## Dependencies and sequencing

- Phase 1 in [docs/dev/roadmap.md](../../roadmap.md) (labels: testing). It does not block product epics, and none of them is a prerequisite.
- Story order: PRB.T-036, then the rules story, PRB.T-037, PRB.T-038, PRB.T-043, PRB.T-039, PRB.T-040 in sequence. PRB.T-041 needs PRB.T-036 and the rules story and is independent of the others, but it lands before PRB.T-040 closes so the flake-free claim holds.
- The rules file lives in `.agents/rules/`, with `.claude/rules` a symlink to it, the same pattern as `.agents/skills` and `.claude/skills` (user decision, 2026-11-10).
- Other epics and tickets that cite scenarios:
  - PRB.E-002: its KPI guardrail (click-to-prompt) is checked by E2-S3; Since the PRB.T-036 merge it records the server-measured time as a metric; nothing gates it. PRB.T-017 (done) added E2-S4.
  - PRB.T-019 and PRB.T-020 (PRB.E-002) write E2-S2 and E2-S5; when they start after the rules story, they follow the e2e rules file (FR-13).
  - PRB.E-003 and PRB.T-028: PRB.T-028 replays E2-S1 to E2-S5 two-server steps and reads E2-S3's click-to-prompt time.
  - After this epic, E2-S3's timing is a perf scenario that runs only in the serial perf command built in PRB.T-040 (a documented command, run on request and before a release, not part of the default or parallel suite). The budget and how PRB.E-002 and PRB.T-028 cite it stay with those tickets.
  - PRB.T-039 replaces every scenario with atomic ones and PRB.T-040 moves the runner, so PRB.T-028 must be planned against whichever scenario shapes exist when it starts; by then it composes atomic scenarios instead of replaying long ones.
  - This epic keeps every acceptance criterion that PRB.T-016 to PRB.T-020 and PRB.T-028 cite: AC numbers stay resolvable, and where a split or move renames one, PRB.T-039 records a mapping note old AC to new scenario.
- Tools: a new test-runner dependency may be added and the current library-only browser automation replaced (user decision, 2026-11-09; the package is in Notes for stories); the production signals and debug log lines touch `apps/server`, `apps/web` and `packages/contracts` (user decision, 2026-11-09; debug logging, 2026-11-10).
- Any story that changes a contract keeps mobile compiling.

## Risks

| ID  | Risk | Likelihood / impact | Mitigation |
| --- | ---- | ------------------- | ---------- |
| R-1 | Shared servers hide bugs that only appear on a pristine home | medium / medium | Keep `fresh server` opt-in for restart and pristine-home scenarios; the must-not-change list keeps real restarts. |
| R-2 | Direct setup stops covering the dialogs | medium / high | One real UI path per action family stays (FR-10); verified by FR-10 row. |
| R-3 | Splitting into atomic scenarios loses acceptance criteria | medium / high | Map every old AC to a new scenario before deleting the old one (FR-11 row). |
| R-4 | Parallel runs expose latent races, so the suite gets flakier first | high / medium | Land the signals (PRB.T-041) before PRB.T-040 closes; run the N-run loop in parallel mode. |
| R-5 | The signals add a contract that mobile or desktop breaks on | medium / medium | Small state change only; `vp run typecheck` for dependents. Their per-shell server cost is a product requirement, owned outside this epic. |
| R-6 | Time moves from the suite to maintaining a new runner | low / medium | Keep the PASS/FAIL output and ids; retire the old runner last. |
| R-7 | A baseline taken on one machine is not comparable to later runs | medium / low | Always gate on the devcontainer, with the same method, after the user confirms the machine is quiet. |
| R-8 | Some behaviors cannot be checked atomically under the cap (a restart with many shells, a long composed flow) | medium / medium | Such a behavior becomes a composed scenario of atomic steps, each under the cap; a step that still cannot fit is split further, or the cap is raised by the epic owner for every scenario; there are no per-scenario exceptions. Land the library's direct setup (PRB.T-038) before the split (PRB.T-039) so setup does not eat the cap (A-13). |
| R-9 | Agents in harnesses that do not read `.agents/rules` (Codex and others) miss the e2e rules | medium / medium | The one-line pointer in AGENTS.md names the rules file; the sandbox refuses unsaved scripts whatever the harness (FR-9). |
| R-10 | Debug log lines added for scenarios grow noisy or leak secrets | low / medium | Debug level only, off by default (A-12); NFR-3 review of every added line. |
| R-11 | Composition turns into hidden coupling: a composed scenario breaks when an atomic one changes, or atomic scenarios start depending on each other's leftovers | medium / medium | Each atomic scenario sets up its own preconditions through the library and runs alone (FR-11); a composed scenario names its steps, so a break points at one step (FR-17). |

## Assumptions and unknowns

| ID  | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner | Affects (FR / NFR / story) |
| --- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- | -------------------------- |
| A-1 | The S2 PRB.T-011 failure is caused by the developer's shell config redrawing the typed command, and also fails on plain `main`. | assumption | false (PRB.T-036, 2026-11-10: S2 on `main` failed with and without isolation, because main's order check read page frames; with the raw-output check it passes with the developer's own shell config) | Run S2 on `main` with and without an isolated shell config, in PRB.T-036. | author | FR-2, FR-3, PRB.T-036 |
| A-2 | The S4 tab-list flake comes from a reload with the layout save still in flight. | assumption | verified (PRB.T-041 T-041c, 2026-11-10: a reload with the save held back brings the old tab strip back) | Reproduce with a deliberate delay on the save, in PRB.T-041. | author | FR-12, PRB.T-041 |
| A-3 | The first prompt is already known to the server, so the "prompt ready" signal needs no new terminal work. | assumption | partly true | Read again 2026-11-10 after the PRB.T-036 merge: every wrapped shell started through `Shells.open` is scanned (plain shells in the background, only logged); restore and takeover are not. PRB.T-041 publishes the result and covers restore and takeover. | author | FR-12, PRB.T-041 |
| A-4 | Scenarios are independent enough, once scoped to their own workspace, to share one server per worker. | assumption | one after another: verified for S5 then S4 on one sandbox (PRB.T-037, 2026-11-10); the set run and parallel: unverified | First, at the start of PRB.T-037: run two existing non-restart scenarios back to back on one server (the sandbox's case). Then in PRB.T-039: every sandbox-accepted atomic scenario run one after another as one set on one sandbox (its AC-3); in PRB.T-040: in parallel. | author | FR-9, FR-13, FR-14, PRB.T-037, PRB.T-040 |
| A-5 | `@playwright/test` at the version `apps/web` already uses works with the existing cached Chromium and needs no new browser download. | assumption | verified (PRB.T-037, 2026-11-10: 1.60.0 ran a test on the cached headless shell with no download, and tracing works) | Spike at the start of PRB.T-037. | author | FR-13, PRB.T-037, PRB.T-040 |
| A-6 | Throwaway servers can be stopped with SIGKILL without losing data a scenario checks. | assumption | unverified | Run the suite once with SIGKILL teardown in PRB.T-036; restart scenarios stay graceful where they test it. | author | NFR-2, PRB.T-036 |
| A-7 | Direct server-API setup removes most of the per-shell round trips and a large part of the run time. | assumption | unverified | Compare timings before and after in PRB.T-038. | author | NFR-1, PRB.T-038 |
| A-8 | The scenario harness is the slowest part of the developer's loop. | assumption | unverified | Compare the baseline full-run time with the other pre-push checks (`vp run check:changed`) in PRB.T-036. | author | Goal, KPI, PRB.T-036 |
| A-9 | The 13 cold starts (one per scenario) and UI-driven setup, as the desk analysis found, are most of the run time. | assumption | unverified PRB.T-036's baseline has no split; PRB.T-038's before and after times. | author | NFR-1, PRB.T-036, PRB.T-038 |
| A-10 | The web bundle is rebuilt only when missing, so a web change is silently not tested. | assumption | verified | Fixed in the PRB.T-036 merge (2026-11-10): `scripts/scenarios/bundle.ts` rebuilds when any input is newer than `dist`. | author | FR-1, PRB.T-036 |
| A-11 | Parallel load exposes waits that are only guesses today. | assumption | unverified | Run the atomic scenarios in parallel before and after PRB.T-041 (PRB.T-040). | author | FR-12, FR-13, R-4, PRB.T-040, PRB.T-041 |
| A-12 | Debug-level server log lines are off in production by default, so adding them for scenarios costs users nothing. | assumption | verified | Read 2026-11-10: `T3CODE_LOG_LEVEL` defaults to `Info` (`apps/server/src/cli/config.ts:97`) and sets the minimum log level (`apps/server/src/serverLogger.ts:48`); `--log-level` overrides it. Debug lines are below the default. | author | FR-20, NFR-1, R-10, PRB.T-038 |
| A-13 | With direct setup and a shared server, atomic scenarios that each set up their own state fit under the cap. | assumption | unverified | The cap gate of each scenario as PRB.T-039 implements it, and one whole-suite gate when PRB.T-040 closes. | author | NFR-1, R-8, PRB.T-038, PRB.T-039 |
| A-14 | Claude Code loads a rules file from `.claude/rules` with path globs when an agent reads or edits a matching file, also when `.claude/rules` is a symlink to `.agents/rules`. | assumption | unverified | First step of the rules story: one rule file, open a scenario file in a fresh session, check that the rule is in context. | author | FR-15, R-9, rules story |
| A-15 | The repo's test lint rules (`no-wall-clock-in-tests`, `no-real-time-wait-in-tests`, `no-polling-loop-in-tests`) apply to files in `scripts/scenarios`, so a clean lint run means something there (PRB.T-036 SA-4 doubts it). | assumption | false | Read 2026-11-10: each rule matches only `.test.`/`.spec.` file names (`oxlint-plugin-t3code/rules/no-wall-clock-in-tests.ts:6`). PRB.T-042 widens the three rules to scenario files (user decision, 2026-11-10). | author | FR-4, PRB.T-036, rules story |
| A-16 | The harness runs on macOS as it does on Linux (no macOS-specific handling exists in `scripts/scenarios` today). | assumption | unverified | The developer runs the suite once on a Mac when PRB.T-040 lands, outside the devcontainer. | developer | NFR-4, PRB.T-040 |
| U-1 | Per-scenario times, and the flake rate today. | unknown | verified (PRB.T-036 baseline, 2026-11-10; see the KPI table) | Baseline run on a rebuilt bundle, serial, in PRB.T-036 (its AC-21). | TBD (author, 2026-11-09) | KPI, NFR-1, NFR-2 |
| U-2 | What N and what FR-10 round-trip threshold are right. | unknown | decided: N = 7 (user, 2026-11-10); FR-10 unit and threshold (user, 2026-11-11, in PRB.T-038's Handoff): suite setup after at most 50 % of before (561 round trips), and every scenario with 19 or more convertible setup round trips except S2 cuts its own setup by at least 40 % | N: decide after U-1, by the end of PRB.T-036. FR-10 round-trip unit and threshold: set from PRB.T-038's own "before" count at its start (FR-10 Verification row). | epic owner (N by the end of PRB.T-036; threshold at the start of PRB.T-038) | KPI |
| U-3 | Whether the web app has a log level that production hides, so web-side diagnostic lines can follow the same rule as the server's, or whether web diagnostics must stay in the browser console only under a dev flag. | unknown | unverified | Read the web app's logging when planning PRB.T-038. | TBD (author, PRB.T-038 plan) | FR-20, PRB.T-038 |

Row A-2 is already in `docs/dev/questions.md`; A-1 and A-5 were answered and removed from it. A-4, A-9, A-11, A-13 and U-1 span several tickets and go there after approval; A-15 spans tickets too and go there; A-14 and U-3 follow if a second story comes to depend on them.

## Open questions

- Decided (user, 2026-11-10): the serial perf run, like the cap gate, starts only after the user confirms the machine is quiet (PRB.T-040 SU-3); perf scenarios are first run there, never by id before it exists (PRB.T-039 SU-6).
- Decided (user, 2026-11-09, recorded in roadmap.md): the serial perf run is a documented command, run on request and before a release, not part of the default or parallel suite. Built in PRB.T-040; it is where every perf scenario (FR-16) runs.
- Decided (assistant default, 2026-11-10; the user may veto): the sandbox stays local-only and never points scenarios at a remote server (NFR-3).
- Decided (assistant default, 2026-11-10; the user may veto): the rules file is the single source for running scenarios as well as writing them; `docs/operations/development.md` keeps a one-line pointer, plus the mock agent CLI and `PROBE_SEED_MOCK_AGENT` text, which describe `vp run dev`, not the suite.

## Notes for stories

- The e2e rules the user set (2026-11-10), for the rules story to write down and every later story to follow:
  - Maintain one library of reusable e2e utils; scenario files do not grow their own helpers.
  - Scenarios are atomic, composable and focused on one purpose; no scenario both checks and measures. An agent runs exactly the set it needs and composes scenarios into bigger ones; this also makes parallel runs easier.
  - Never create a throwaway scenario: every scenario is saved for later use or composition.
  - Scenarios are deterministic: if a scenario has to be rerun to see why it failed, it is a bad scenario, and the first run must make the cause clear. Running a scenario several times is forbidden during testing, perf scenarios included (user, 2026-11-10): no rerunning an unchanged scenario on unchanged code to get a pass, a reading or a diagnosis. Running again after a change is normal; the epic's N-run flake loop is the one deliberate repeat, because it measures that rule.
  - The 15 s per-scenario cap is a separate gate check, run once after a scenario is implemented and later only when the user asks, each time after the user confirms nothing in the background slows the machine; it is never measured on a normal run.
  - Scenarios run an isolated shell; how a developer's own shell setup affects behavior or timing is not the suite's concern.
  - Perf scenarios are named `<scenario>.perf.ts`. A perf budget a story sets (in this epic or in a product epic) must be one that a single isolated perf run meets every time; the story sets it with headroom over the value it saw, and the N-run loop of the perf run confirms it.
  - Scenarios log enough to show the problem. Adding log lines to product code for that is fine, at debug level, which production does not print by default.
- Rules file mechanics: `.agents/rules/<name>.md` with `paths` globs covering `scripts/scenarios/**` and `scripts/mock-agent/**`; `.claude/rules` is a symlink to `.agents/rules`, like `.claude/skills`. What moves into it: the "Scenario tests" section of `docs/internals/testing.md`, the "Scenario tests" section of `docs/operations/development.md` (except the mock agent and `PROBE_SEED_MOCK_AGENT` text for `vp run dev`), and the scenario bullet of AGENTS.md "Verifying" (which keeps one pointer line). Also fix `testing.md`'s opening line, which says AGENTS.md carries the same rules.
- Composition shape, for PRB.T-043 to decide: an atomic scenario declares what it needs (a fixture from the library) and what it leaves (for example a shell id); a composed scenario passes one step's result to the next. Named sets are lists of ids; the old ids S1 to S8 can become set names.
- Mechanisms behind the FRs, for stories to choose from: isolated shell config via a clean rc directory (FR-2); ordered-history check on the raw history (FR-3); offsets on websocket frame waits (FR-5); readiness without log parsing and faster teardown by SIGKILL with a manifest of captured PIDs (NFR-2, A-6); `gone()` polling replaced by the ended event (FR-12); `@playwright/test` at the version `apps/web` already uses (Dependencies, A-5); the sandbox helpers and the shared library (FR-8, FR-9, FR-21); scenario servers started with `--log-level Debug` and the browser console recorded per page (FR-20).
- Phase 0 of the analysis (0.1 to 0.10), the sandbox design, RPC-first setup, the split plans for S2, S3, S7, E2-S1 (and S4 and S6 `sleep` replacements) and the Playwright Test design (worker-scoped server fixture, test-scoped workspace and page, opt-in fresh server, a small reporter printing the same PASS/FAIL lines, retire `run.ts`, `registry.ts` and `TOTAL = 8` last) are in the analysis; stories take them from there. The split plans cover four scenarios; PRB.T-039 extends them to all.
- The repo's test rules apply to the harness itself: no sleeps, no polling loops, no wall-clock deltas, no per-test timeout arguments or retries, and the mouse-first rule (pointer-only scenarios). Lint rules `t3code/no-real-time-wait-in-tests`, `no-polling-loop-in-tests` and `no-wall-clock-in-tests` must hold for check scenarios, or each exemption states a reason; perf scenarios are the stated exemption for wall-clock reads, which the `.perf.ts` name lets lint match by file. PRB.T-036's SA-4 says these rules may not match `scripts/scenarios` at all.
- Smaller items from the analysis for stories to pick up: trim S1's repeated chat URLs (PRB.T-039), dedupe R1's tokens (PRB.T-038 AC-11), a per-run unique value instead of the global `sleep 1601` in S6 (PRB.T-039, FR-14), `/tmp` hard-coded in S3.

## Done when

- [x] A baseline of per-scenario times and the flake rate exists in PRB.T-036.
- [ ] Every atomic check scenario has passed the 15 s cap gate, and the gate is a separate command the user can ask for, not part of a normal run.
- [ ] N consecutive runs of the suite and of the perf run, no retries, no changes between them, show 0 failures.
- [ ] The e2e rules file exists, loads when an agent touches the e2e files, and AGENTS.md, `docs/internals/testing.md` and `docs/operations/development.md` only point to it.
- [ ] The sandbox command exists, runs saved scenarios, sets and composed scenarios by id, and refuses anything else.
- [ ] One shared e2e library holds every helper; scenario servers log at debug level and failures carry that log and the browser console.
- [ ] Every scenario is atomic and either a check or a perf scenario in a `.perf.ts` file; every old acceptance criterion maps to a running scenario; at least one composed scenario and one named set exist.
- [ ] The suite runs in parallel on shared servers (or, under the A-4/A-5 fallback, in parallel lanes with a server each), selects by id or set, and every old id is findable as a set.
- [ ] Setup is direct except one real UI path per action family, and the FR-10 table meets its threshold.
- [x] The rules file states the no-throwaway rule, and the sandbox refuses unsaved scripts.
- [ ] A deliberate failure of each kind is diagnosable from its first run.
- [ ] Two suites run at the same time on one machine both pass with no stray processes, and scenario shells run with an isolated shell config.
- [ ] The bundle is rebuilt automatically; no check scenario gates on wall-clock time; perf scenarios run only in the serial perf run.
- [ ] The prompt-ready and layout-saved signals are in and used; mobile still compiles.
