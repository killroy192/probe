---
id: PRB.E-005
type: epic
parent:
phase: 1
labels: [testing]
created: 2026-11-09
updated: 2026-11-09
---

# Fast, deterministic scenario tests

## Goal

The developer and the agents building Probe get a scenario suite that finishes quickly, passes or fails the same way on every run without retries, and can be driven one step at a time against a live server, so nobody writes a throwaway script to poke the UI.

## Why and why now

Terminal-first behavior is proven only by the scenario harness (`vp run test:scenarios`), and every new feature adds or extends a scenario. The harness is now the slowest and least trustworthy part of the loop. Evidence is in [scenario-harness-analysis](../../research/scenario-harness-analysis.md) (a desk analysis of 2026-11-09; claims marked unverified there were not run):

- Every scenario cold-starts its own server and runs one after another (12 cold starts), and most set up workspaces, projects and shells by clicking through dialogs, which is not what they test.
- The suite uses waits the repo's own test rules forbid (polling, wall-clock deltas), types into a terminal before it is ready, and runs the developer's real shell config, so S2 (PRB.T-011 "exactly once") is likely to fail on plain `main`.
- The web bundle is rebuilt only when missing, so after any web change the suite tests the old UI. This cost the project two debugging sessions in one day.
- Three scenarios are single scripts of 15 to 25 acceptance criteria; an early failure hides the rest and nothing can be rerun from stage N.
- There is no way to keep a server up and drive one step, which is why agents write throwaway TypeScript.

If we skip it, each new feature makes the suite slower and flakier, a red run stops meaning "broken" and the "prove it with a scenario" rule in AGENTS.md loses its value.

## KPI

A first baseline was taken on 2026-11-09 after an invalid first attempt (stale bundle, `bc` missing): full serial run 346 s; single scenarios 13 s (S5) to 51 s (E2-S1), each including about 13 s of fixed cost (runner start, browser launch, one server start); S2 and, once, S7 failed. PRB.T-036 repeats it as the median of 3 and measures the flake rate over N runs before any fix lands. The target and N are set by the epic owner by the end of PRB.T-036, which records the baseline. Both KPIs are defined over the full suite, whatever the number of scenarios after splitting.

| Metric | Kind | Baseline | Target | Measured how and where | By when |
| ------ | ---- | -------- | ------ | ---------------------- | ------- |
| Full-run wall time of `vp run test:scenarios` (the full suite, whatever the scenario count; rebuilt bundle, no retries) | primary | 346 s (5 min 46 s), one serial run on the devcontainer, rebuilt bundle, 2026-11-09; single run, not the median of 3 (the method in this row stays the target method) | TBD (epic owner, set by the end of PRB.T-036) | Serial per-scenario times and the total, recorded by the runner's own timing output on the devcontainer, median of 3 runs | Target set by the end of PRB.T-036; met when PRB.T-040 closes |
| Flake rate: share of N consecutive full runs with any failure, no retries, no code changes between runs | guardrail | not measured at N = 10 yet. Seen on 2026-11-09: S2 failed in every run (a known failure also on `main`), S4 failed once in one full run and S7 failed once in a single-scenario run, both passing otherwise; N = 10 proposed; N = 10 proposed | 0 failures in N runs | A loop of N full runs on the devcontainer, recorded failures per scenario | N set by the end of PRB.T-036; measured when the last story closes |

## Users and scenarios

Users: the developer, and the agents building features.

1. As a developer, I run the whole suite after a change and get a trustworthy answer fast, so that I run it before every push.
2. As a developer, I run the suite ten times in a row and it is green every time, so that a red run always means a real regression.
3. As an agent verifying a feature, I start a sandbox server, seed a named fixture and drive one step against it, so that I do not write a throwaway script or pay a cold start per try.
4. As an agent or developer with a failing scenario, I see which stage failed, with a screenshot, the server log tail and a trace, and can rerun only that scenario, so that I do not rerun a 25-criterion script.
5. As a developer changing the web app, I run the suite and it tests my change, never a stale bundle, so that a pass proves the current UI.

## Scope

**In:**

- Fix the sources of lying and flakes in the current harness (phase 0 of the analysis; the list is in Notes for stories).
- A sandbox mode for agents (live harness server, named fixtures, documented helpers).
- Setting up workspaces, projects and shells directly through the server API where the UI is not the subject, keeping one real UI path per action family.
- Splitting the long scenarios into independent ones.
- A runner that runs scenarios in parallel while sharing a server between them, with traces and per-scenario selection.
- Two small production signals ("prompt ready" and "layout saved") so tests wait on facts instead of guesses.
- The repo's own test docs and rules that these changes make inaccurate, including `docs/internals/testing.md` and the "Scenario tests" section of `docs/operations/development.md`.

**Out (non-goals, with a reason):**

- Making scenarios a CI gate: the user has not asked for it; CI owns the unit and browser suites.
- Dropping or weakening what the scenarios prove. Splitting, regrouping and moving them to a new runner (FR-11, FR-13) keep every acceptance criterion they prove today. The following stay real because they are the point of the suite (the analysis's "must not change" list): real PTYs, real git worktrees, real websockets; real server restarts (a restart is not a page reload); abrupt-kill and lost-host cases; pointer-only input (mouse-first rule); the throwaway-home guard and cleanup by captured PID; the mock agent as the agent stand-in; the second-server path (R1, seam); the PRB.T-011 contract end to end.
- Gating the 700 ms click-to-prompt budget in the parallel suite: load makes it meaningless there. It is measured on the server and gated only in a dedicated serial perf run (user decision, 2026-11-09).
- Adding agent-status or other new product behavior, and new scenarios for unbuilt features: separate epics.
- Chat-era tests and the frozen provider adapters.
- Mobile: no impact (nothing mobile-facing changes; it must still compile, and the production signals are server and web only).
- Desktop: no impact, the suite drives the browser build only.

## Functional requirements

| ID    | Requirement | Priority | Scenario |
| ----- | ----------- | -------- | -------- |
| FR-1  | Running the suite after a web or contracts change rebuilds the bundle first and prints which bundle was used; a stale bundle can no longer be tested silently. | must | 5 |
| FR-2  | Scenario servers run with an isolated shell config, so the same scenario behaves the same on any developer or agent machine. | must | 2 |
| FR-3  | The PRB.T-011 contract (command typed after the first prompt, banner after it) is checked as an order on the raw history, not as "appears exactly once". | must | 2 |
| FR-4  | No scenario gates on elapsed wall-clock time in the suite; durations are recorded as a metric, and the 700 ms click-to-prompt budget is a server-measured gate in a separate serial perf run. | must | 1, 2 |
| FR-5  | A wait for terminal output cannot be satisfied by output that arrived earlier, and "nothing arrived since" can be asserted. | must | 2 |
| FR-6  | A failed scenario leaves a screenshot, the server log tail and the last recorded values; under the new runner it also leaves a trace. | must | 4 |
| FR-7  | Checks that cannot run as root are skipped with a stated reason, or run another way; they never pass vacuously. | should | 2 |
| FR-8  | One command starts a sandbox server on a throwaway home, optionally seeds a named fixture, prints origin, pairing URL, home and PIDs, and stays up until stopped by the printed PID. | must | 3 |
| FR-9  | The sandbox's helpers (open a page, connect to the API, fixtures) are importable by an agent and documented in `docs/operations/development.md`; one scenario can run against a live sandbox without a cold start. | must | 3 |
| FR-10 | Scenarios whose subject is not the dialog create workspaces, projects and shells directly through the server API; one real UI path per action family stays (add project, "+" modal, kill with confirmation, Restore, Workspaces menu). | must | 1 |
| FR-11 | S2, S3, S7 and E2-S1 are split into independent scenarios that each build their own repo and can run alone; restarts remain only where restart behavior is the subject. | must | 4 |
| FR-12 | Tests wait on a "terminal prompt ready" state and a "layout saved" state exposed by the app, never type into a terminal or reload on a guess; polling for a process to exit is replaced by the shell's ended event plus one process check where the server owns the pid. | must | 2 |
| FR-13 | Scenarios run in parallel, several sharing one server, with a fresh server only for scenarios that restart or need a pristine home; a scenario can be selected by id or name, and the ids S1 to S8 stay visible in the output. | must | 1 |
| FR-14 | Scenarios are isolated from each other: no global process-table patterns, no fixed ports reserved by bind-and-release, assertions scoped to the scenario's own workspace. | must | 2 |
| FR-15 | The repo's test docs and rules match the new runner and sandbox the same day they land. | must | 3 |

## Non-functional requirements

| ID    | Quality | Requirement with a measurable limit | Not applicable because |
| ----- | ------- | ----------------------------------- | ---------------------- |
| NFR-1 | Performance | Full-run time reaches the KPI target (TBD after baseline). The two production signals add no continuous repaint and no extra websocket traffic beyond one small state change per terminal or layout save; terminal output stream is unchanged. The prompt-ready signal adds a server-side output scan to every shell start (A-3 is false), which stops at the first prompt mark; its cost is measured with ten shells running and must not show in the 700 ms click-to-prompt time. The 700 ms click-to-prompt budget is unchanged and gated in a serial perf run. | |
| NFR-2 | Reliability and recovery | 0 failures in N consecutive full runs with no retries and no per-test timeout arguments; a runner killed abruptly leaves no stray server or shell host after the next run's cleanup (by captured PID). | |
| NFR-3 | Security and privacy | The throwaway-home guard stays: the harness refuses `~/.t3` and any non-local server address, never inherits `T3CODE_*` or `VITE_*`, and never edits agent CLIs' global config. The sandbox binds loopback only and prints a pairing URL that is never committed. | |
| NFR-4 | Compatibility (OS, browsers, agent CLIs, mobile impact) | Runs on Linux in the devcontainer and on macOS; Chromium only, from the browser install the repo already has. Agent CLIs: the mock agent only; Claude Code and others are not exercised. Mobile impact: none; mobile still compiles after the signal contract changes. | |
| NFR-5 | Usability and accessibility | The sandbox command and the single-scenario command are each one documented line; a failure names the scenario id and stage. The mouse-first rule holds: scenarios keep pointer-only input. | |
| NFR-6 | Observability (logs, status, how we tell it broke) | Every failure ships a screenshot, server log tail and last recorded values (FR-6); the per-scenario timing is printed on every run so a slowdown is visible. | |
| NFR-7 | Maintainability and docs | One shared fixtures module, no duplicate helpers across scenario files; `docs/internals/testing.md` (scenario section) and `docs/operations/development.md` "Scenario tests" are rewritten, not appended to, when the runner changes; AGENTS.md "Verifying" is checked for accuracy. | |

## Approach

Make the suite honest first, then fast, then parallel, then remove the last guesses. Each step leaves the suite runnable.

1. Fix what lies or flakes today in one pass, starting with the baseline measurement (FR-1 to FR-7). This also produces the baseline numbers.
2. Give agents a sandbox so they stop writing throwaway scripts. It is independent of speed work and pays off immediately.
3. Replace UI-driven setup with direct setup, keeping one real UI path per action family so the dialogs stay covered.
4. Split the long scenarios so a failure points at one behavior and each scenario can run alone.
5. Move to a runner that shares a server per worker and runs in parallel, with traces and selection.
6. Add the two small app signals so tests stop guessing readiness. They must land before the parallel runner is declared flake-free, because parallel load is what exposes guessed waits.

Fallback: if A-4 (scenarios can share a server) or A-5 (the new runner works with the existing browser) is false, keep the current Node runner with a server per scenario and still deliver PRB.T-036, PRB.T-037, PRB.T-038, PRB.T-039 and PRB.T-041. The A-5 spike runs first in PRB.T-040, before anything else in that story, so the fallback is known early. The full-run target is then re-set by the epic owner.

Alternatives considered: only parallelizing the current runner (loses to flaky waits and shared global state, which would get worse under load); deleting scenarios or loosening checks to save time (rejected, the must-not-change list exists for this); a mock server instead of a real one (rejected, restarts, PTYs and websockets are the product).

## Stories (candidates)

All six exist as tickets. PRB.T-036 stays one story (user decision): its baseline measurement is recorded first inside it, before any fix lands.

| #   | Title | Value in one line | Order / depends on | Owns (FR) |
| --- | ----- | ----------------- | ------------------ | --------- |
| 1   | PRB.T-036 Scenario quick fixes: clean shell, auto rebuild, no wall-clock gates, failure artifacts, one fixtures module (phase 0, one story by decision) | The suite stops lying and flaking, and yields the baseline | First | FR-1, FR-2, FR-3, FR-4 (no wall-clock gates; the server-side click-to-prompt time recorded as a metric only; the gate is PRB.T-040), FR-5, FR-6 (screenshot, log tail, recorded values), FR-7 |
| 2   | PRB.T-037 Scenario sandbox: keep a server up and drive one step | Agents stop writing throwaway scripts | After PRB.T-036 | FR-8, FR-9 (including the sandbox docs in `docs/operations/development.md`) |
| 3   | PRB.T-038 Set up scenarios over RPC, keep one real UI path per action | Most per-shell round trips disappear | After PRB.T-037 | FR-10 |
| 4   | PRB.T-039 Split the long scenarios | A failure names one behavior; any scenario reruns alone | After PRB.T-038 | FR-11, FR-14 (process-table marker in S6: no global `ps` pattern that matches other runs); touches FR-4 only by replacing wall-clock waits in the scenarios it splits |
| 5   | PRB.T-040 Run scenarios on the Playwright Test runner with a shared server and parallel workers | Full-run time falls; traces and selection | After PRB.T-039; must not close before PRB.T-041 | FR-13, FR-14 (ports with no bind-then-release race; assertions scoped per workspace, for example S3's page-wide `[data-worktree]` count), FR-4 (the 700 ms gate and the dedicated serial perf command), FR-6 (trace), FR-15 (runner docs, `docs/internals/testing.md`) |
| 6   | PRB.T-041 Prompt-ready and layout-saved signals | Tests wait on facts, not guesses | After PRB.T-036; independent of PRB.T-037 to PRB.T-040; lands before PRB.T-040 closes | FR-12 |

FR-4 is split: PRB.T-036 removes wall-clock gates and records the server-measured click-to-prompt time as a metric; PRB.T-040 builds the dedicated serial perf command and the 700 ms gate. FR-12 is owned by PRB.T-041; PRB.T-036 and PRB.T-039 only touch it. PRB.T-041 ships as one unit (prompt-ready, layout-saved and the process-end wait), because the flake-free claim in PRB.T-040 needs all three.

Docs (FR-9, FR-15) are written in the story that changes the behaviour, not in a final docs story: PRB.T-037 for the sandbox, PRB.T-040 for the runner.

## Verification

- **Traceability:** every FR and NFR above appears in one row; none is left unverified.

| Requirement | Verified by (scenario test / measurement / manual check) | Owner |
| ----------- | -------------------------------------------------------- | ----- |
| FR-1 | Manual check: change a web source file, run the suite. Pass: the printed bundle line shows a rebuild and the changed UI is what the scenarios drive. | developer |
| FR-2 | Run S2 on a machine with a heavy shell config (the devcontainer's oh-my-zsh). Pass: S2 is green in N runs (N from the KPI). | developer |
| FR-3 | S2 (PRB.T-011 contract) passes; a deliberate break of the order makes it fail (harness self-test). Pass: both outcomes as stated. | developer |
| FR-4 | Review: no wall-clock delta in the suite (lint rule `t3code/no-wall-clock-in-tests` is clean); the serial perf run reports the server-measured click-to-prompt time. Pass: lint clean, and the perf run exits 0 with a value at or under 700 ms. | developer |
| FR-5 | Harness self-test: a wait given an offset ignores earlier output. Pass: the self-test is green and fails when the offset is removed. | developer |
| FR-6 | Harness self-test: a deliberate failure. Pass: it leaves the screenshot, log tail, recorded values (and a trace after PRB.T-040). | developer |
| FR-7 | Run as root, then as non-root. Pass: skipped checks print a reason as root; the same checks execute as non-root. | developer |
| FR-8 | Manual check of the sandbox command. Pass: it prints origin, pairing URL, home and PIDs, stays up, and stops when the printed PID is killed with no stray process. | developer |
| FR-9 | An agent drives one step against a sandbox using only the documentation (manual check); a scenario runs against it. Pass: both succeed without reading code. | developer |
| FR-10 | Measurement: a recorded before/after table of round trips and times per scenario, with the threshold set from the baseline (TBD by the end of PRB.T-036). Pass: the table meets the threshold and the run still exercises the one UI path per family. | developer |
| FR-11 | Each split scenario runs alone by id. Pass: every old acceptance criterion maps to a running scenario (mapping table in the story) and all pass. | developer |
| FR-12 | Scenarios using the signals run N times under parallel load. Pass: 0 failures in N runs and no polling for process exit left. | developer |
| FR-13 | Run with several parallel lanes. Pass: output shows ids S1 to S8, the suite is green, and restart scenarios used a fresh server. | developer |
| FR-14 | Run two suites at the same time on one machine. Pass: both exit 0 and leave no stray processes. | developer |
| FR-15 | Docs diff review. Pass: no statement in the test docs, `docs/operations/development.md` or AGENTS.md "Verifying" contradicts the new runner or sandbox. | developer |
| NFR-1 | KPI timing runs; perf run for the 700 ms budget; check the signals add no repaint or extra stream. Pass: full-run time meets the KPI target, the perf run is at or under 700 ms, and there is no added repaint or stream traffic. | developer |
| NFR-2 | N-run loop; kill the runner abruptly mid-run, then start a new run. Pass: 0 failures in N runs (N from the KPI) and no stray processes by captured PID after the next run. | developer |
| NFR-3 | Review: guard test in `harness.test.ts` still refuses `~/.t3` and remote addresses. Pass: the test is green and the sandbox binds loopback only. | developer |
| NFR-4 | Run on macOS and Linux; `vp run typecheck` for mobile affected packages. Pass: suite green on both and typecheck exits 0. | developer |
| NFR-5 | Manual check of the documented commands and failure output. Pass: each command is one line, and a failure names the scenario id and stage. | developer |
| NFR-6 | Same as FR-6 plus the timing lines in the output. Pass: FR-6 passes and per-scenario timing prints on every run. | developer |
| NFR-7 | Docs diff review; the fixtures module is the only place for setup helpers. Pass: no duplicate helper across scenario files and the docs are rewritten, not appended. | developer |

- **KPI measurement:** serial per-scenario times and total full-run time, on a rebuilt bundle with no retries, median of 3 runs; flake rate over N consecutive full runs (N = 10 proposed) with no retries and no changes between runs. Baseline taken first inside PRB.T-036, before its fixes land; the final numbers by the same method.
- **Automated scenarios:** this epic is about the scenario suite itself. Its own behavior is covered by `scripts/scenarios/harness.test.ts` and the `--selftest` cases; all twelve existing scenarios (S1 to S8, T-002, R1, E2-S1, E2-S3, or their split successors) must still pass and keep proving what they prove today (acceptance criteria cited by other tickets stay resolvable, see Dependencies).
- **Manual checks:** sandbox use from documentation only (developer or an agent following the docs); macOS run; the 10-run loop.
- **Sign-off:** the developer.

## Dependencies and sequencing

- Phase 1 in [docs/dev/roadmap.md](../../roadmap.md) (labels: testing). It does not block product epics, and none of them is a prerequisite.
- Story order: PRB.T-036, then PRB.T-037, PRB.T-038, PRB.T-039, PRB.T-040 in sequence. PRB.T-041 needs only PRB.T-036 and is independent of PRB.T-037 to PRB.T-040, but it lands before PRB.T-040 closes so the flake-free claim holds.
- Other epics and tickets that cite scenarios:
  - PRB.E-002: its KPI guardrail (700 ms click-to-prompt) is checked by E2-S3; PRB.T-016 (done) asserts it today.
  - PRB.E-003 and PRB.T-028: PRB.T-028 replays E2-S1 to E2-S5 two-server steps and reads E2-S3's 700 ms.
  - After this epic, E2-S3's 700 ms check is owned by the server-side measurement recorded as a metric in PRB.T-036 and gated only in the dedicated serial perf command built in PRB.T-040 (a documented command, run on request and before a release, not part of the default or parallel suite).
  - PRB.T-039 splits E2-S1 and PRB.T-040 moves the runner, so PRB.T-028 must be planned against whichever scenario shapes exist when it starts.
  - This epic keeps every acceptance criterion that PRB.T-016 to PRB.T-020 and PRB.T-028 cite: AC numbers stay resolvable, and where a split or move renames one, the owning story records a mapping note old AC to new scenario.
- Tools: a new test-runner dependency may be added and the current library-only browser automation replaced (user decision, 2026-11-09; the package is in Notes for stories); the production signals touch `apps/server`, `apps/web` and `packages/contracts` (user decision, 2026-11-09).
- Any story that changes a contract keeps mobile compiling.

## Risks

| ID  | Risk | Likelihood / impact | Mitigation |
| --- | ---- | ------------------- | ---------- |
| R-1 | Shared servers hide bugs that only appear on a pristine home | medium / medium | Keep `fresh server` opt-in for restart and pristine-home scenarios; the must-not-change list keeps real restarts. |
| R-2 | Direct setup stops covering the dialogs | medium / high | One real UI path per action family stays (FR-10); verified by FR-10 row. |
| R-3 | Splitting loses acceptance criteria | medium / high | Map every old AC to a new scenario before deleting the old one (FR-11 row). |
| R-4 | Parallel runs expose latent races, so the suite gets flakier first | high / medium | Land the signals (PRB.T-041) before PRB.T-040 closes; run the N-run loop in parallel mode. |
| R-5 | The prompt-ready signal adds one output scan to every shell start (A-3 is false), a per-shell server cost that grows with the number of shells; the signals may also add a contract that mobile or desktop breaks on | medium / medium | Scan only until the first prompt mark, then stop and unsubscribe; measure the cost of one more shell with ten shells running (AGENTS.md performance rule); small state change only, no repaint; `vp run typecheck` for dependents. |
| R-6 | Time moves from the suite to maintaining a new runner | low / medium | Keep the PASS/FAIL output and ids; retire the old runner last. |
| R-7 | A baseline taken on one machine is not comparable to later runs | medium / low | Always measure on the devcontainer, with the same method, median of 3. |

## Assumptions and unknowns

| ID  | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner | Affects (FR / NFR / story) |
| --- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- | -------------------------- |
| A-1 | The S2 PRB.T-011 failure is caused by the developer's shell config redrawing the typed command, and also fails on plain `main`. | assumption | unverified | Run S2 on `main` with and without an isolated shell config, in PRB.T-036. | author | FR-2, FR-3, PRB.T-036 |
| A-2 | The S4 tab-list flake comes from a reload with the layout save still in flight. | assumption | unverified | Reproduce with a deliberate delay on the save, in PRB.T-041. | author | FR-12, PRB.T-041 |
| A-3 | The first prompt is already known to the server, so the "prompt ready" signal needs no new terminal work. | assumption | false | Read `apps/server/src/terminal/Shells.ts` (2026-11-09): the output queue and prompt-mark wait exist only when a starting script is chosen (`script !== null`); a plain shell start has no scan. The signal in PRB.T-041 adds a scan to every shell start. | author | FR-12, NFR-1, R-5, PRB.T-041 |
| A-4 | Scenarios are independent enough, once scoped to their own workspace, to share one server per worker. | assumption | unverified | Prove in PRB.T-039 and PRB.T-040 by running the split scenarios in parallel. | author | FR-13, FR-14, PRB.T-040 |
| A-5 | `@playwright/test` at the version `apps/web` already uses works with the existing cached Chromium and needs no new browser download. | assumption | unverified | Spike at the start of PRB.T-040. | author | FR-13, PRB.T-040 |
| A-6 | Throwaway servers can be stopped with SIGKILL without losing data a scenario checks. | assumption | unverified | Run the suite once with SIGKILL teardown in PRB.T-036; restart scenarios stay graceful where they test it. | author | NFR-2, PRB.T-036 |
| A-7 | Direct server-API setup removes most of the per-shell round trips and a large part of the run time. | assumption | unverified | Compare timings before and after in PRB.T-038. | author | NFR-1, PRB.T-038 |
| U-1 | Per-scenario and full-run times, and the flake rate today. | unknown | unverified | Baseline run on a rebuilt bundle, serial, in PRB.T-036. | TBD (author, 2026-11-09) | KPI, NFR-1, NFR-2 |
| U-2 | What N and what time target are right. | unknown | unverified | Decide after U-1, by the end of PRB.T-036. | epic owner (by the end of PRB.T-036) | KPI |
| A-8 | The scenario harness is the slowest part of the developer's loop. | assumption | unverified | Compare the baseline full-run time with the other pre-push checks (`vp run check:changed`) in PRB.T-036. | author | Goal, KPI, PRB.T-036 |
| A-9 | The 12 cold starts and UI-driven setup, as the desk analysis found, are most of the run time. | assumption | unverified | Per-scenario timing split (server start, setup, body) in the PRB.T-036 baseline. | author | NFR-1, PRB.T-036, PRB.T-038 |
| A-10 | The web bundle is rebuilt only when missing, so a web change is silently not tested. | assumption | unverified | Cheap to verify first in PRB.T-036: change a web file and run one scenario on `main`. | author | FR-1, PRB.T-036 |
| A-11 | Parallel load exposes waits that are only guesses today. | assumption | unverified | Run the split scenarios in parallel before and after PRB.T-041 (PRB.T-040). | author | FR-12, FR-13, R-4, PRB.T-040, PRB.T-041 |

Rows A-1, A-2 and U-1 span several tickets; they go to `docs/dev/questions.md` after approval.

## Open questions

- What full-run time target and what N for the flake loop? Owner: epic owner, by the end of PRB.T-036, after the baseline (U-1, U-2).
- Decided (assistant default, 2026-11-09; the user may veto): the dedicated serial perf run for the 700 ms budget is a documented command, run on request and before a release, not part of the default or parallel suite. Built in PRB.T-040.
- Should the sandbox be allowed to point scenarios at a remote server, or stay local-only? Proposed: local-only (NFR-3). Owner: developer.

## Notes for stories

- Mechanisms behind the FRs, for stories to choose from: isolated shell config via a clean rc directory (FR-2); ordered-history check on the raw history (FR-3); offsets on websocket frame waits (FR-5); readiness without log parsing and faster teardown by SIGKILL with a manifest of captured PIDs (NFR-2, A-6); `gone()` polling replaced by the ended event (FR-12); `@playwright/test` at the version `apps/web` already uses (Dependencies, A-5); the sandbox helpers and one shared fixtures module (FR-8, FR-9, NFR-7).
- Phase 0 of the analysis (0.1 to 0.10), the sandbox design, RPC-first setup, the split plans for S2, S3, S7, E2-S1 (and S4 and S6 `sleep` replacements) and the Playwright Test design (worker-scoped server fixture, test-scoped workspace and page, opt-in fresh server, a small reporter printing the same PASS/FAIL lines, retire `run.ts`, `registry.ts` and `TOTAL = 8` last) are in the analysis; stories take them from there.
- The repo's test rules apply to the harness itself: no sleeps, no polling loops, no wall-clock deltas, no per-test timeout arguments or retries, and the mouse-first rule (pointer-only scenarios). Lint rules `t3code/no-real-time-wait-in-tests`, `no-polling-loop-in-tests`, `no-wall-clock-in-tests` must hold for new scenario code or each exemption states a reason.
- When PRB.T-040 lands, rewrite the Scenario tests section of `docs/internals/testing.md` (it justifies using Playwright as a library with a Node runner) and "Scenario tests" in `docs/operations/development.md`, and check AGENTS.md "Verifying".
- Smaller items from the analysis for stories to pick up: trim S1's repeated chat URLs, dedupe R1's tokens, a per-run unique value instead of the global `sleep 1601` in S6, `/tmp` hard-coded in S3.

## Done when

- [ ] A baseline of per-scenario and full-run times and the flake rate exists in PRB.T-036.
- [ ] Full-run time meets the target set after the baseline (TBD).
- [ ] N consecutive full runs, no retries, no changes between them, show 0 failures.
- [ ] The sandbox command exists and is documented in `docs/operations/development.md` (PRB.T-037), and an agent can drive one step with it.
- [ ] The bundle is rebuilt automatically; no scenario gates on wall-clock time; the 700 ms budget is gated in the serial perf run only.
- [ ] S2, S3, S7 and E2-S1 are split; every old acceptance criterion maps to a running scenario.
- [ ] The prompt-ready and layout-saved signals are in and used; mobile still compiles.
- [ ] `docs/internals/testing.md` and `docs/operations/development.md` describe the new runner and sandbox, and nothing contradicts them.
