---
id: PRB.T-036
type: story
parent: PRB.E-005
phase: 1
labels: [testing, implement]
created: 2026-11-09
updated: 2026-11-09
---

# Scenario quick fixes: clean shell, auto-built bundle, no wall-clock gates, readable failures

## Business Goal

**Problem:** The scenario suite (`vp run test:scenarios`) can pass or fail for reasons unrelated to Probe. It runs the developer's own shell config, so S2's PRB.T-011 check ("the agent command shows exactly once") likely fails on plain `main` (unverified at runtime, epic A-1). It tests an old web bundle after any web change, because the bundle is rebuilt only when missing. Three scenarios fail a run on elapsed milliseconds, so a busy machine turns a pass into a failure. Frame waits can be satisfied by an earlier frame, so a pass may not prove its claim. A failure prints one line with no screenshot or server log. Teardown can wait up to 10 s per scenario, a killed runner leaves servers behind, and the same helper is written up to three times. No baseline of run time or flake rate exists, so no later story can show it helped.

**Proposed solution:** One pass that makes the suite honest without changing what any scenario proves: scenario servers run with an isolated shell config; the PRB.T-011 contract is checked as an order on the raw history; the web bundle is rebuilt whenever it is stale and the run says which bundle it used; wall-clock gates become recorded metrics, with the click-to-prompt time measured on the server and recorded (the serial perf command is built in PRB.T-040; the click-to-prompt budget belongs to PRB.E-002); frame waits carry offsets; readiness comes from the server answering over HTTP; one login is reused per server; throwaway servers stop fast and leftovers of a killed runner are cleaned by captured PID; checks that cannot run as root say so; a failure leaves a screenshot, the server log tail and the last recorded values; helpers live in one shared module. The story also records the baseline the epic's KPI needs.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 1 PRB.T-036 Scenario quick fixes (phase 0 of the desk analysis, one story by decision, 2026-11-09)
- **Delivers:**
  - FR-1: a stale bundle can no longer be tested silently; the run rebuilds first and prints which bundle it used.
  - FR-2: scenario servers run with an isolated shell config.
  - FR-3: the PRB.T-011 contract is checked as an order on the raw history.
  - FR-4: no scenario gates on elapsed wall-clock time; durations are recorded; the click-to-prompt time is measured on the server and recorded as a metric, with no pass/fail gate (the dedicated serial perf command is built in PRB.T-040; product budgets such as the 700 ms belong to PRB.E-002; the perf run is decided: on request and before a release).
  - FR-5: a frame wait cannot be satisfied by an earlier frame, and "nothing arrived since" can be asserted.
  - FR-6 (without the trace, which needs the PRB.T-040 runner): a failure leaves a screenshot, the server log tail and the recorder's last values.
  - FR-7: checks that cannot run as root are skipped with a stated reason, never pass vacuously.
  - NFR-2 (teardown half): a runner killed with SIGKILL leaves nothing behind after the next run's cleanup.
  - NFR-3: the throwaway-home guard and the clean child environment stay.
  - NFR-6: per-scenario timing printed on every run.
  - NFR-7 (shared fixtures half): one shared fixtures module, no duplicate helpers.
  - KPI: the baseline cells (longest atomic check scenario, flake rate) are filled from a run on a rebuilt bundle (epic KPI amended 2026-11-10: a 15 s per-scenario cap, not a full-run time).
- **One deployable outcome:** A developer or agent runs `vp run test:scenarios` and gets an answer that is about the current UI, does not depend on their shell config or machine speed, names where it failed with evidence, and comes with timings; the epic gets the baseline numbers it needs to set targets. Every later story in the epic builds on this honest suite.

## Current Behavior

Verified by reading `scripts/scenarios/` on 2026-11-09. The desk analysis was not run; the claims below that need a run are marked unverified.

- **Shell config.** `childEnv` in `scripts/scenarios/server.ts` copies the whole ambient environment and removes only `T3CODE_*`, `VITE_*` and `PROBE_*`, so `HOME`, `ZDOTDIR` and `SHELL` reach the server and its shells. Probe's zsh wrapper sources the user's own `.zshrc` (the zsh startup files in `apps/server/src/terminal/shellReady.ts`), so in this container the shells run the devcontainer's prompt theme. That this makes S2 fail on `main` is unverified (epic A-1).
- **PRB.T-011 check.** S2 (`scenarios/plus-modal.ts`) strips OSC sequences from the shell history, then requires that the start of `scripts/mock-agent/mock-agent` appears once and the text does not start with `node `. It does not check an order against the first prompt mark (`]133;B`, used as `PROMPT_MARK` in `scenarios/starting-scripts.ts`). E2-S1 (`starting-scripts.ts`) has a similar "exactly once" count of `session: mock-`.
- **Bundle.** `ensureWebBundle` (`run.ts`) builds only when `apps/web/dist/index.html` is missing or `--rebuild` is passed. It prints nothing about which bundle was used when it skips the build.
- **Wall-clock gates (enforced).** S2 fails if the tree node takes more than 1000 ms (`plus-modal.ts`); S3 fails if the branch label takes more than 4000 ms (`worktrees.ts`); E2-S3 fails above 700 ms click-to-prompt (`starting-scripts.ts`, `PROMPT_LIMIT_MS`). S2 and S3 also print start-to-banner times that are not enforced. The 700 ms time is measured in the harness around a click and a received frame, so it includes the browser and the harness (a server-side measurement does not exist yet; unverified whether the server records the needed timestamps, see SU-2). Whether the repo lint rules `t3code/no-wall-clock-in-tests` and its siblings apply to `scripts/scenarios` is unverified (SA-4); `support.ts` `gone()` also polls with a wall-clock deadline, which PRB.T-041 replaces.
- **Frame waits.** `recorder().until(what, match, from = 0)` in `support.ts` takes an optional start offset. Many `until` calls across the scenarios pass none (the count is unverified; a grep of `.until(` finds about 50 uses in `scenarios/`), for example S2's second banner in `plus-modal.ts`, E2-S1 in `starting-scripts.ts` and some in `workspaceUi.ts`. There is no "nothing arrived since" helper.
- **Readiness.** `waitUntilReady` (`server.ts`) resolves when the server's output contains `server is ready`, and rejects if the process exits first.
- **Login.** `newPage` in `runScenario` (`run.ts`) creates a new browser context per page and, for a signed-in page, mints a pairing URL by running the server CLI and opens it. Every `openPage` therefore costs a CLI process start.
- **Teardown.** `stopChild` (`server.ts`) sends SIGTERM and escalates to SIGKILL after 5 s; `stopShellHost` waits up to 5 s. `cleanups` in `run.ts` are in memory only, so a runner killed with SIGKILL leaves its servers and shell hosts running and its homes (`probe-scenario-*` in the system temp folder) on disk. SIGINT, SIGTERM and SIGHUP are handled.
- **Root.** The chmod-based failure checks are in S1 (`scenarios/boot.ts`), S2 (`scenarios/plus-modal.ts`) and S7 (`scenarios/restart.ts`). They have no guard; as root, `chmod` does not stop writes, so the failure never happens (the container user here is uid 1000, so this was not run as root: unverified).
- **Failures.** `main` in `run.ts` prints `FAIL <id> <title>: <message>` and nothing else; the page, server logs (`server.logs()` exists) and recorder values are discarded with the scenario.
- **Duplicated helpers.** `check` is defined in `boot.ts`, `second-server.ts` and `workspaceUi.ts`; `alert` in `boot.ts` and `restart.ts`; `endedRow` in `restart.ts` and `restore-shell.ts`; `createWorkspace` in `boot.ts` and `workspaceUi.ts`. `second-server.ts` holds `withClient` and `seedWorkspace`; `starting-scripts.ts` holds `projects`, `setUp` and `restartAndReload`. Most shared helpers are in `workspaceUi.ts`.
- **Guard.** `refusalReason` (`environment.ts`) refuses `--base-dir`, `--home-dir`, `--server`, `--server-url`, `--url` and a `T3CODE_HOME` under `~/.t3`; `harness.test.ts` covers it. The throwaway home is `probe-scenario-*` under the OS temp folder (`createThrowawayHome`).
- **Baseline.** None exists; the epic records the first attempt as invalid (stale bundle, `bc` missing).

## Expected Behavior

### User Flow

1. The developer changes a web or contracts file and runs `vp run test:scenarios`. The run says it is rebuilding the bundle, builds it, and prints which bundle (the build it just made, with its time) the scenarios use. On the next run with no change it prints that it reuses the bundle, with the same identification.
2. Each scenario's server and shells start with an empty, isolated shell config, whatever the developer's shell setup is. Git still works for the fixtures.
3. S2 passes or fails on the order of the raw history: the agent command is typed after the first prompt mark and the banner comes after it.
4. Scenario output shows each scenario's duration as it finishes and the full-run total at the end. The 1000 ms, 4000 ms and 700 ms checks no longer fail a run; their values are printed as metrics (the click-to-prompt one measured on the server).
5. The click-to-prompt scenario reports the server-measured time as a metric in its output; it never fails the run on that time.
6. Waits on frames take an offset, and a scenario can assert that no frame matching something arrived since a point.
7. A scenario that fails prints its id, stage and message, and the run output names where the screenshot, the server log tail and the last recorded values were saved.
8. After a runner is killed with SIGKILL, the next run (or a documented cleanup command) stops the servers and shell hosts it left, by the pids recorded when they started, and removes their homes. A sandbox or another live run is never touched.
9. Run as root, the checks that depend on file permissions print `SKIP <id> <check>: <reason>`.
10. The maintainer records the baseline: per-scenario times on a rebuilt bundle, serially, from one run after the user confirms nothing in the background slows the machine (no median, epic FR-22), and the flake rate over N runs (N = 10 proposed), in this ticket's Handoff.

### Edge Cases

- EC-1: Only contracts (or a shared package the web bundle imports) changed, not `apps/web/src`: the bundle is still stale and is rebuilt.
- EC-2: `apps/web/dist` is missing: it is built (today's behavior).
- EC-3: `--rebuild` is passed: it rebuilds even when current (today's behavior).
- EC-4: A scenario restarts the server (S2, S7, S8, T-002, E2-S1, E2-S3): the reused login still works after the restart, or a new one is minted exactly once, and the scenario still proves what it proves today. Restarts stay graceful where restart behavior is the subject.
- EC-5: A scenario asks for an anonymous page (S1): it stays anonymous; reuse never signs it in.
- EC-6: Two servers in one scenario (R1): each server has its own login; the second server's login is never taken from the first.
- EC-7: A recorded pid in the cleanup list now belongs to a different process (pid reuse), or its owning runner is still alive: it is not killed.
- EC-8: The failure happens before any page exists, on the second server, or during teardown: the artifacts that can exist are saved; missing ones are skipped silently.
- EC-9: A very slow or loaded machine: recorded durations exceed the old limits and nothing fails because of it.
- EC-10: A frame wait is given an offset past the frames received so far: it waits for new frames and does not resolve from older ones.
- EC-11: The user's shell is not zsh or bash (fish and others are not wrapped by Probe): the isolation still gives the scenario a clean, deterministic shell, or the run states what is used. Which shell the throwaway environment selects is unverified (SU-3).

### Error Handling

- ER-1: The bundle build fails: the run stops with the build's error and exit code and tests nothing; it never falls back to an old bundle.
- ER-2: The server does not answer its readiness check in time or exits first: the failure includes the server's log tail. A server that prints a ready line but does not serve is not "ready".
- ER-3: Pairing or login fails: the failure says so, with the server log tail, and no scenario step runs signed out by accident.
- ER-4: Saving a failure artifact fails (disk full, page closed): the original scenario error is still the one reported, with a note that the artifact is missing.
- ER-5: The cleanup list is unreadable or corrupt: the run warns and continues; it never falls back to killing by name or path pattern (AGENTS.md rule 1).
- ER-6: A SIGKILL teardown leaves a shell the host owned (the host is killed without ending its children): the story verifies none survives, or the teardown also ends them by captured pid (SU-4).

## Out Of Scope

- Setting up workspaces, projects and shells over the server API: PRB.T-038.
- Splitting S2, S3, S7 and E2-S1, replacing S4's `sleep 2` and S6's global `sleep 1601` regex, and the `/tmp` hard-coded in S3: PRB.T-039.
- Replacing `gone()` polling, typing-before-ready and reload-with-save-in-flight: PRB.T-041 (the signals) and PRB.T-039/PRB.T-040.
- Port reservation without a bind-and-release race, global process-table patterns and workspace scoping of assertions: PRB.T-040 (FR-14).
- The Playwright Test runner, traces, parallel workers, per-scenario selection by name, the serial perf command: PRB.T-040. The failure artifacts here are written by the current runner; the trace half of FR-6 is PRB.T-040.
- The sandbox: PRB.T-037. The manifest this story writes must not break it (see Dependencies).
- R1's duplicate tokens: PRB.T-038 (AC-11). S1's repeated chat URLs: PRB.T-039.
- Setting N for the KPI: epic U-2, after the baseline. The cap (15 s) is set (epic, 2026-11-10).
- Making scenarios a CI gate; changing what any scenario proves (the epic's must-not-change list).
- The serial perf command: PRB.T-040. The 700 ms budget: PRB.E-002 (PRB.E-005 Out); the measurement itself is here.

## Technical Scope

- **Layers:** `scripts/scenarios` (runner, server handle, browser, support, scenarios, self-tests, `harness.test.ts`); possibly a small server-side timing record for the 700 ms measurement (SU-2, may overlap PRB.T-041's prompt-ready signal; any production change here is allowed by the 2026-11-09 decision but is to be kept to a timestamp and no new stream traffic); no new script entry.
- **Docs impact:** `docs/operations/development.md` "Scenario tests" (bundle behavior, the paragraph that says S2 prints times and E2-S3 fails above 700 ms, failure artifacts, cleanup, root skips) and `docs/internals/testing.md` scenario section (waits with offsets, the shared fixtures module, no wall-clock gates). Rewrite the statements that become false; do not append. AGENTS.md "Verifying" is checked and left unchanged unless it names a rebuild flag or timing gate.
- **Mobile impact:** none. No contract changes expected; if the 700 ms measurement needs a contract field (SU-2), mobile must still compile (`vp run typecheck` for dependents).

## Non-functional Requirements and Constraints

- The repo test rules apply to harness code: no sleeps, polling loops or wall-clock deltas as a way to decide pass or fail, no per-test timeout arguments, no retries. A remaining clock read is a recorded metric and states why (epic notes for stories).
- Pointer-only input stays (the `PointerPage` type); the mouse-first rule holds.
- The must-not-change list holds: real PTYs, git, websockets, real restarts, real SIGKILL and lost-host cases, the throwaway-home guard, cleanup by captured PID, the mock agent, the second-server path, the PRB.T-011 contract end to end.
- NFR-3: the harness still refuses `~/.t3`, non-local addresses and `--server*` flags; the server child still never sees `T3CODE_*`, `VITE_*` or `PROBE_*` from the parent; the harness never edits agent CLIs' global config; isolation must not write to the developer's real `HOME`.
- NFR-1: any server-side timing adds no continuous repaint and no extra websocket traffic.
- Killing is by captured pid only. Teardown by SIGKILL applies to throwaway servers; restart scenarios keep a graceful stop where graceful stop is what they test.
- Linux (devcontainer) and macOS must both work (NFR-4); Chromium only.
- Baseline method (epic KPI): devcontainer, rebuilt bundle, serial, no retries, one run after the user confirms the machine is quiet; no median.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers |
| -- | ------------------------------- | --------------------- | ------ |
| AC-1 | Given a web or contracts source file is newer than the built bundle, when the suite starts, then it rebuilds first and prints which bundle the scenarios use (build time or identifier); with the build current, it prints that it reuses it and does not rebuild. | manual (developer; no temporary edit of tracked files: use a file touch in a throwaway copy or a real change on a branch) | FR-1, EC-1, EC-2, EC-3 |
| AC-2 | Given the bundle build fails, when the suite starts, then it exits non-zero with the build error and runs no scenario. | auto (harness test with a build command that fails) | FR-1, ER-1 |
| AC-3 | Given the developer's `HOME`/`ZDOTDIR` contain a startup file that prints a marker, when any scenario's shell starts, then the marker never appears in the shell's history; and when isolation is switched off the same marker appears (negative control). | auto (harness self-test) | FR-2, NFR-3 |
| AC-4 | Given isolated shells, when git is used by the fixtures (init, commit, worktree), then it works and no scenario depends on the developer's git or shell config; the broken-gitconfig cases in S1/S2 still fail as designed. | auto (S1, S2, S3 pass) | FR-2, EC-11 |
| AC-5 | Given the raw history of a shell started with an agent, when S2 checks the PRB.T-011 contract, then it passes only if the command is typed after the first prompt mark and the banner comes after the command; a history with the command before the mark, or the banner before the command, fails the check (negative control, harness self-test on recorded histories), and S2 passes with a prompt that redraws the line. | auto | FR-3 |
| AC-6 | Given the run on a slow or loaded machine, when the S2 tree-node time, the S3 branch-label time or the click-to-prompt time exceeds its old limit, then the scenario still passes and the value is printed as a metric; the click-to-prompt value is the one measured on the server. | auto (a scenario run with an injected delay shows the value over the old limit and PASS) | FR-4, EC-9 |
| AC-7 | Given the scenario sources, when searched for elapsed-time comparisons that decide pass or fail, then none remain; each remaining clock read is a recorded metric with a stated reason. | manual (review by the developer; lint coverage of `scripts/scenarios` is SA-4) | FR-4 |
| AC-8 | Given a plain shell started from the modal, when E2-S3 runs, then the click-to-prompt time as measured on the server is recorded in the run output and the old harness-side wall-clock assertion is gone. | auto (the scenario passes with the metric printed; a search of the scenario finds no comparison against 700) | FR-4, NFR-1 |
| AC-9 | Given every frame wait in the scenarios, when read, then each has an offset (or a stated reason it is a first wait); and given a wait with an offset, when an earlier matching frame exists, then the wait ignores it and resolves only on a newer one. | auto (harness self-test for the offset) and manual (review of every call) | FR-5, EC-10 |
| AC-10 | Given a "nothing since" assertion, when a matching frame arrives after the point, then it fails; when none arrives, it passes; and no assertion of it passes vacuously because the recorder was empty. | auto (harness self-test, both outcomes) | FR-5 |
| AC-11 | Given a server that exits before it serves, a server that prints the ready line but never answers HTTP, and a server that never starts, when started, then each fails with a message that includes the log tail; a normal server is ready as soon as it answers over HTTP, whatever it prints. | auto (harness test, with `second-server-failure` kept) | NFR-2, ER-2 |
| AC-12 | Given a scenario opens several pages, when it opens them, then no pairing subprocess runs per page (one login per server run is fine); an anonymous page stays anonymous; a second server has its own login; after a server restart the page is still signed in or a single new login is minted. | auto (count of pairing processes started in a scenario; S1, R1, S7 pass) | EC-4, EC-5, EC-6, ER-3 |
| AC-13 | Given a normal run, when a scenario ends, then its server is stopped without the SIGTERM grace wait and its home and shell host are removed; scenarios whose subject is a graceful restart still restart gracefully and pass. | auto (per-scenario teardown time is printed and near zero; S2, S7, S8, E2-S1 pass) | NFR-2 |
| AC-14 | Given the runner was killed with SIGKILL mid-run, when the next run (or the documented cleanup) starts, then the servers and shell hosts it left are stopped by their recorded pids and the homes removed, with no leftover process or home afterwards; a recorded pid that no longer matches the process it started, or whose owning runner is alive, is left alone, and a corrupt list only warns. | auto (harness test that kills a runner, then checks pids; a second case with a reused pid) | NFR-2, EC-7, ER-5, ER-6 |
| AC-15 | Given the suite runs as root, when a permission-based check is reached, then it prints `SKIP` with a reason (or runs another way that still fails when the guarded behavior is broken); run as a non-root user, the same checks execute and pass. | manual (developer runs once as root in a container, once as the normal user); the non-root run is also auto | FR-7 |
| AC-16 | Given a scenario fails, when the run ends, then the output names the scenario id, stage, a screenshot, the server log tail and the recorder's last values, all saved outside the removed home; failing before a page exists, or on a second server, still saves what exists; a failing save does not hide the original error. | auto (`--selftest` deliberate failure checks the files; a case without a page; a case with an unwritable artifact folder) | FR-6, NFR-6, EC-8, ER-4 |
| AC-17 | Given any full run, when it ends, then every scenario's duration and the total are printed, whether it passes or fails. | auto | NFR-6 |
| AC-18 | Given the shared fixtures module, when the scenario sources are searched, then each helper (`check`, `alert`, `endedRow`, `createWorkspace`, `withClient`, `seedWorkspace`, `projects`, `setUp`, restart-and-come-back) is defined once; `vp run typecheck` and knip pass for `scripts`. | manual (developer review) with typecheck and knip auto | NFR-7 |
| AC-19 | Given the guard, when the harness is given `~/.t3`, a `--server`, `--url` or other non-local target, or ambient `T3CODE_*`/`VITE_*`/`PROBE_*` variables, then it refuses or strips them as before and the new isolation never writes to the real `HOME`. | auto (`harness.test.ts` unchanged cases pass; a case that the isolated home is not the real one) | NFR-3 |
| AC-20 | Given the changes are in, when all scenarios (S1 to S8, T-002, R1, E2-S1, E2-S3) run twice in a row with no retries and no changes between runs, then both runs pass, and the `--selftest` run behaves as before. | auto | FR-2, FR-3, NFR-2 |
| AC-21 | Given the baseline method, when it is run before the other changes land and after them, then per-scenario times (one serial run on a rebuilt bundle, after the user confirms the machine is quiet, no median) and the flake rate over N runs are recorded in this ticket's Handoff, with S2's outcome on unmodified `main` with and without isolation (epic A-1). | manual (developer) | KPI, A-1, A-6 |
| AC-22 | Given the docs, when read after the change, then no statement says E2-S3 fails above 700 ms in the suite, that the bundle is rebuilt only when missing, or describes helpers that moved. | manual (docs diff review); handed to the epic's rules story (PRB.E-005, 2026-11-10), which replaces the stale text, so this ticket may close without it | NFR-7, FR-15 |
| AC-23 | Given the developer's `SHELL` is fish or another shell Probe does not wrap, when a scenario's shell starts under isolation, then it is the same deterministic shell as with zsh or bash (or the run prints which shell it uses) and the PRB.T-011 order check still passes. | auto (harness self-test with `SHELL` set to an unwrapped shell) | EC-11, FR-2 |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| None | First story of PRB.E-005; the baseline must be taken before the other stories change timing. | n/a |

**Blocks:** PRB.T-037 (the sandbox reuses the server handle, shared login and fixtures module, and must not be killed by the cleanup this story adds: cleanup recognizes live owners); PRB.T-038 (RPC setup lives in the shared module); PRB.T-041 (may supply the server-side prompt-ready timestamp the perf run needs, SU-2; this story must not wait for it).

**Cross-story:** PRB.T-040 later replaces the runner; the failure artifacts, the cleanup and the timing output must be portable to it (R-6).

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| -- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | An isolated shell config removes the S2 failure (epic A-1) and S2 also fails on plain `main`. | assumption | unverified | Run S2 on `main` with and without isolation; record in Handoff. | author |
| SA-2 | SIGKILL of a throwaway server loses no data any scenario checks (epic A-6). | assumption | unverified | One full run with SIGKILL teardown; restart scenarios stay graceful. | author |
| SA-3 | A pairing login (cookie session) outlives a server restart on the same home, so the shared login survives S2/S7/S8's restarts. | assumption | unverified | Read the session store; run S7. | author |
| SA-4 | The lint rules `no-wall-clock-in-tests` and its siblings do not match `scripts/scenarios` (files are not `*.test.ts`), so AC-7 needs review, not lint. | assumption | unverified | Run oxlint on a scenario file with a `Date.now()` delta. | author |
| SA-5 | Chromium (the existing Playwright install) can save a screenshot of a page whose server just crashed. | assumption | unverified | Self-test case (AC-16). | author |
| SA-6 | The baseline can be taken in the devcontainer with `bc` replaced by the runner's own timing output. | assumption | unverified | First baseline run. | author |
| SU-1 | N for the flake loop and the time target (epic U-2). | unknown | unverified | Decide after the baseline. | TBD (author, 2026-11-09) |
| SU-2 | Whether the server already records a start-request-to-first-prompt time, or a small production timestamp is needed (and whether it is the same as PRB.T-041's prompt-ready signal). | unknown | unverified | Read `Shells.ts` and `shellReady.ts` when planning; agree with PRB.T-041. | TBD (author, plan stage) |
| SU-3 | Which shell and `SHELL` value a throwaway environment gives the server, and whether it affects bash vs zsh coverage. | unknown | unverified | Read `Shells.ts` shell selection when planning. | TBD (author, plan stage) |
| SU-4 | Whether killing the shell host with SIGKILL ends its shells (process group) or leaves orphans that need pid-based cleanup. | unknown | unverified | Run on Linux and macOS; check pids after teardown. | TBD (author, plan stage) |
| SU-5 | Whether S1, S2 and S7's root-only chmod checks have a no-root equivalent (for example a read-only mount), or are skipped only. | unknown | unverified | Decide when planning; skipping with a reason is acceptable (FR-7). | TBD (author, plan stage) |

## Handoff

Filled during implementation.

- Baseline (AC-21): TBD (author, at implementation) - per-scenario times from one gate-style run, flake rate.
- S2 on `main`, with and without isolation (SA-1): TBD (author, at implementation).
- Failure triage order for this story (one story by decision): bundle (AC-1, AC-2), then isolation and the PRB.T-011 order (AC-3 to AC-5), then metrics and waits (AC-6 to AC-10), then readiness, login and teardown (AC-11 to AC-14), then root skips and artifacts (AC-15, AC-16), then baseline and docs (AC-21, AC-22).
