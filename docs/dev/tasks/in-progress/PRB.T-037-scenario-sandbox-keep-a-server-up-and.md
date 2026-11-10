---
id: PRB.T-037
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-10
---

# Scenario sandbox: keep a server up and run saved scenarios against it

## Business Goal

**Problem:** Every scenario run cold-starts its own Probe server, so an agent that wants to check one behavior pays a server start each time. Agents that want a live server write throwaway TypeScript instead: it starts a server, builds state, drives a step, proves something once and is lost, and the next agent writes it again. Nothing tells a scenario whether it can share a server, so nothing can refuse one that would break a shared server (a restart, a second server, a check that needs an empty home, fixed names another run already used).

**Proposed solution:** One command keeps a harness server up on a throwaway home (optionally seeded with a named fixture), prints what is needed to use and stop it, and lets saved scenarios run against it by id with no cold start. The sandbox runs saved scenarios only: there is no way to run an unsaved script against it, and scenarios that restart the server, need a pristine home, need a second server, or are not yet safe on a shared server are refused with the reason. Before the sandbox is built, two assumptions the whole epic rests on are checked: the Playwright Test runner works with the existing browser (A-5), and scenarios can share a server when run one after another (A-4).

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 3 PRB.T-037 Scenario sandbox: keep a server up and run saved scenarios against it. It starts with the A-5 spike (moved from PRB.T-040's SA-1) and a check of A-4 for scenarios run one after another.
- **Delivers:**
  - FR-8: one command starts a sandbox server on a throwaway home, optionally seeds a named fixture, prints origin, pairing URL, home and PIDs, and stays up until stopped by the printed PID.
  - FR-9 (single scenarios and the refusals): a saved scenario runs by id against a live sandbox without a cold start; nothing else runs there (no entry point for an unsaved script); restart, pristine-home and second-server scenarios, and scenarios not yet converted for a shared server, are refused with a reason. Sets and composed scenarios on the sandbox come with FR-17 in PRB.T-043.
  - FR-15 (sandbox part): the sandbox commands are written into the e2e rules file PRB.T-042 creates, in the same change.
  - FR-18 (enforcement part): the sandbox refuses unsaved scripts (epic FR-18 row).
  - NFR-3: loopback only, throwaway home, pairing URL never committed; the harness guard is not weakened.
  - NFR-5: starting the sandbox, running one scenario against it and stopping it are each one line in the rules file.
  - NFR-6 (sandbox part): a scenario run against the sandbox prints its timing and, on failure, leaves the same artifacts as in the suite.
  - Epic A-4 (one after another) and A-5: checked first; the epic's Fallback applies if either is false.
- **One deployable outcome:** An agent starts one sandbox, runs two saved scenarios against it one after the other with no second server start, sees an unsaved script and a restart scenario refused with reasons, and stops it by one PID, all from the rules file and without writing a throwaway script (user scenario 3 of the epic).

## Current Behavior

Verified by reading the code on 2026-11-10 (the `cocoindex-code` MCP was not available; read and grep only). PRB.T-036's code is merged.

- **Entry point.** Only `vp run test:scenarios` exists (`package.json:41`, `scripts/scenarios/run.ts`). `main` in `run.ts` cleans leftovers of killed runs, opens this run's manifest, rebuilds the bundle when stale (`ensureWebBundle`, using `bundle.ts`, whose inputs are `apps/web` and every workspace package it uses), launches one browser, then for each selected scenario starts a fresh server, runs the scenario and tears it down (`runScenario`). `--only <id>` selects one scenario; `--selftest` selects the self-tests. Nothing can leave a server running or run a scenario against a server the run did not start.
- **Scenario contract.** `Scenario` (`scenario.ts`) is `id`, `title` and `run(context)`; it states nothing about what it needs from its server. `ScenarioContext` gives `server` (a `ServerHandle`), `openPage`, `openAnonymousPage` and `startSecondServer`. The registry (`registry.ts`) holds S1 to S8, the story checks (T-002, R1, E2-S3, E2-S1, E2-S4), the self-tests T1, T2, T4 and the picked self-test T3. A scenario's id is its only name; there is no way to pass a script path.
- **Server handle.** `startServer` (`server.ts`) reserves a loopback port (`127.0.0.1`), starts `apps/server/src/bin.ts serve` with `--base-dir <home>` and `--log-level info`, and is ready when the server answers its environment descriptor over HTTP (`waitUntilServing`). The handle has `stop`, `kill`, `restart`, `logs`, `logged`, `pairingUrl` (mints a pairing credential through the server CLI), `cli`, `shellHostPid` and `stopShellHost`. The shell host is a separate process whose pid the server writes into the home.
- **What the scenarios need from their server** (grep for `restart`, `stop`, `startSecondServer`, 2026-11-10):
  - Restart the server: S2 (`plus-modal.ts:408,448`), S3 (`worktrees.ts:473`), S7 (`restart.ts:97-101`), S8 (`restore-shell.ts:120-122`), T-002 (`standalone-shell.ts:147`), E2-S3 (`starting-scripts.ts:112`), E2-S1 (`restartAndReload`, `starting-scripts.ts:251-318`), T1 (`restart-persistence.ts:19`), T4 (`one-login.ts:21`).
  - A second server: R1 (`second-server.ts:49`), T3 (`second-server-failure.ts:16-18`), T4 (`one-login.ts:26`).
  - Neither: S1, S4, S5, S6, E2-S4, T2.
  - A pristine home: S1 checks the start screen shows no tree (`boot.ts:24`) and that the Workspaces menu lists exactly the names it created (`boot.ts:144` and on).
  - Fixed names: S1, S4, S5 and S6 create a workspace named "sparta" (`boot.ts:129`, `many-shells.ts:52`, `close-tab.ts:45`, `kill-shell.ts:100`), and E2-S1, E2-S3 and E2-S4 do through `setUp` (`fixtures.ts:29-35`); `projects` makes fixed folders under the home and a linked worktree on a fixed branch `topic` (`fixtures.ts:16-26`); S4, S5 and S6 use fixed folders under `<home>/folders`. Two of these run one after another on one server would collide on the name "sparta" before any shared server state is reached.
  - Process table: S6 finds its shell's background jobs by matching every process on the machine (`pidsRunning`, `kill-shell.ts:34-44,119-121`), so another live run's S6 jobs would match too (FR-14, owned by PRB.T-039).
  - Server-wide state: E2-S4 rewrites the server's starting-script list in the home (`starting-scripts.ts:355-361`), which every later scenario on the same server would see.
- **Fixtures.** `seedWorkspace` (`fixtures.ts:72-84`) creates a workspace and imports a project folder over the server API with a bearer-token client (`withClient`, `fixtures.ts:53-64`; tokens from `issueBearerToken`, `seam.ts:23`). There are no named fixtures.
- **Guard.** `refusalReason` (`environment.ts:49-76`) refuses `--server`, `--server-url` and `--url` ("Scenarios only run against a server they start themselves"), refuses `--base-dir` and `--home-dir`, and refuses `T3CODE_HOME`/`T3CODE_BASE_DIR` under `~/.t3`. `childEnv` (`server.ts:60-77`) strips `T3CODE_*`, `VITE_*` and `PROBE_*`. `harness.test.ts` covers the guard.
- **Cleanup.** Each run writes a manifest named by its own pid under `<tmp>/probe-scenario-runs/` (`cleanup.ts:14`, `openManifest`). `cleanLeftovers` skips a manifest whose runner is still the same live process (pid and start time) and otherwise kills the recorded servers and the shell host and shells found through their homes, by pid only (`cleanup.ts:144-186`, `killServerTree`). A long-lived process with its own manifest is therefore left alone while it lives.
- **Failure artifacts.** A failed scenario saves `error.txt`, a screenshot per open page, each server's log tail and the recorders' last values under `<tmp>/probe-scenario-artifacts/<run start>/<id>/` (`saveArtifacts`, `run.ts:112`), outside the home. Per-scenario timing is printed on every run (`run.ts:315`).
- **Bundle while a server runs.** The server reads static files from the bundle folder per request (`apps/server/src/http.ts:586-640`) and loads the bundle's asset manifest once (`loadImmutableBuildAssets`, `http.ts:515`). Whether a running server serves a bundle rebuilt after it started correctly is unverified (SA-6). Server code is loaded once at start.
- **Browser and runner versions.** `scripts/package.json` depends on `playwright-core` 1.60.0; `apps/web` uses `playwright` 1.60.0 (`apps/web/package.json:103`). `@playwright/test` is not a dependency anywhere in the repo (outside `.repos/`). The browser cache (`~/.cache/ms-playwright`) holds only `chromium_headless_shell-1223`. A-5 is unverified.
- **Docs.** No sandbox is documented. The e2e rules file `.agents/rules/scenarios.md` exists (PRB.T-042, done) and says there is no sandbox yet; `docs/operations/development.md` and `docs/internals/testing.md` describe only the per-scenario runner.

## Expected Behavior

### User Flow

1. **Spike (A-5), before any sandbox work.** The author runs one Playwright Test run of `@playwright/test` at 1.60.0 (the `playwright` version `apps/web` uses) against the cached Chromium headless shell, with no browser download, and records the result in this ticket's handoff. If it fails, the epic's Fallback applies: the current Node runner stays, with a server per scenario in the suite; the sandbox is built on it as below; FR-13 drops its shared server and FR-6 its trace (the epic owner amends PRB.T-040, and re-checks the cap if every scenario then pays a cold start). Either way this story builds no new runner.
2. **Check (A-4, one after another), before the rest of the sandbox is built.** Two non-restart scenarios (S5 and S4 proposed; S6 is not, because it matches the whole process table, `kill-shell.ts:34-44`, which PRB.T-039 fixes under FR-14), each using workspace names and folders that no earlier run on that server used, run one after another on one server, using only saved harness code (no throwaway driver script, FR-18): the first slice of the sandbox (start, and run one scenario by id against it) is built for this check, and the refusals, fixtures and docs follow it. A failure caused only by a name or folder the scenario picks itself counts as scoping, which this story fixes for every scenario it accepts on the sandbox; A-4 is false if the second scenario fails, or behaves differently than on its own server, because of other state the first left on the server. The author records the result and what the second scenario met in the handoff. If A-4 is false, the epic's Fallback applies to FR-9: the sandbox either gives each scenario a fresh workspace on the same server, or refuses scenarios that leave state behind, and the refusal says which; which of the two is decided by the developer from the check's findings (SU-4), and is recorded in the handoff before the sandbox is built. If the choice is to refuse scenarios that leave state behind, the acceptance criteria that run scenarios on the sandbox (AC-8, AC-12, AC-13, AC-22) are rewritten in this ticket for that branch and the story is reviewed again before the sandbox is built.
3. The agent reads the rules file and starts the sandbox with its one-line command in the background, optionally naming a fixture.
4. The sandbox starts a server on a throwaway home, seeds the named fixture over the server API, and prints, in a form a program can read without scraping logs: the sandbox's own PID first (the stop handle), the origin, a pairing URL, the home, the server PID, the shell host PID once a shell host runs, and which bundle it serves. It then stays up.
5. A person can open the pairing URL in a browser to look at the sandbox (a manual look, not a scripted check).
6. The agent runs one saved scenario by id against the sandbox with the rules file's one-line command, naming the sandbox by its printed sandbox PID. The scenario uses the sandbox's server and home, starts no server of its own, prints PASS or FAIL with its timing, and leaves the sandbox up.
7. The agent runs a second saved scenario, or the same one again after changing the scenario or code the run loads itself (EC-7), against the same sandbox; it runs against whatever state earlier runs left (the sandbox is not reset between runs).
8. Anything else is refused before the sandbox is touched: a path to a script, an id that is not registered, or a scenario that states it needs a restart, a pristine home or a second server, or that is not yet safe on a shared server. Every registered scenario this story does not make safe for a shared server (fixed names, server-wide state, or a process-table pattern) states that, and its refusal names the story that converts it (PRB.T-039). The message names the reason and, for a script or an unknown id, says that the sandbox runs saved scenarios only and points at the rules file's section on registering one.
9. The agent stops the sandbox by stopping the printed sandbox PID. The server, the shell host and its shells end and the home is removed, unless the sandbox was started with the keep-home option (SU-5): then the home stays for post-mortem reading, its path is the one printed at start, and the developer removes it.

### Edge Cases

- **EC-0** The bundle is stale or missing when the sandbox starts: the suite's rule applies (FR-1): it is rebuilt first, and the sandbox prints which bundle it serves.
- **EC-1** An unknown fixture name: the sandbox refuses before starting anything and lists the known names.
- **EC-2** Seeding fails partway (server up, fixture error): the sandbox stops what it started, removes its home and exits non-zero with the error; it never stays up half seeded.
- **EC-3** Two sandboxes at once, or a sandbox while `vp run test:scenarios` runs: each has its own home and port; the suite's leftover cleanup never touches a live sandbox, and starting a sandbox stops no other.
- **EC-4** The sandbox is killed with SIGKILL: the next suite run or sandbox start cleans its server, shell host, shells and home by recorded PID, and never a live sandbox's.
- **EC-5** A scenario run against the sandbox is interrupted or killed: the sandbox stays up; the run's own processes (browser, pages) end; whatever the scenario created on the server stays.
- **EC-6** The sandbox holds a fixture's data or an earlier run's leftovers: an accepted scenario runs against that state as it is and must not depend on its absence; the rules file says a sandbox is not reset between runs.
- **EC-7** Web, contracts or server sources changed since the sandbox started, or the bundle the sandbox serves was rebuilt since (by a suite run or `--rebuild`): a run against it is refused with the changed file named and an instruction to start a new sandbox, so a run never tests code older than the checkout without saying so (FR-1's rule carried to the sandbox). A change to code a run loads itself (scenario files and their steps) needs no new sandbox; a change to harness code the sandbox process loaded at start (its server handle, shell isolation, cleanup) is refused the same way as a source change.
- **EC-8** A scenario fails on the sandbox: the output names the scenario id, stage, expected and found, and the artifacts (error, screenshots, the sandbox server's log tail, recorded values) are saved outside the sandbox home; the sandbox stays up and the next accepted scenario still runs.
- **EC-9** A second scenario run is started against a sandbox while one is running: it is refused, saying that one scenario runs at a time on a sandbox (parallel runs on one sandbox are not in PRB.E-005; no FR covers them).
- **EC-10** The same scenario is run again on one sandbox after the scenario or code the run loads itself changed: it does not collide with its earlier run's workspace names or folders. (Rerunning it unchanged on unchanged code is forbidden by the rules file, FR-19; the sandbox does not police that.)
- **EC-11** A scenario that does not state its needs: treated as not yet safe on a shared server, and refused on the sandbox with a reason saying its needs are not stated.
- **EC-12** Self-tests: accepted or refused by the same rule as any scenario (T2 runs; T1, T3 and T4 are refused).
- **EC-13** The sandbox is used from another machine: not supported; it binds loopback only (NFR-3).
- **EC-14** Two sandboxes are live: a run goes to the sandbox whose printed PID it names and never to the other; a run naming a PID that is not a live sandbox is refused (ER-2).

### Error Handling

- **ER-1** The server cannot start (missing server binary, port, failing start): the sandbox prints the reason and the server log tail, cleans up what it started and exits non-zero.
- **ER-2** A run targets anything other than a live sandbox this harness started: `~/.t3`, a non-loopback address, a dev server, a `--server`/`--url` flag, or a sandbox that is no longer running. It is refused with a message naming the rule, the same way the suite refuses today; a sandbox is recognized by the harness's own record, never by an address the user types.
- **ER-3** No process has the printed sandbox PID any more when the agent stops it: nothing else is affected (a PID the OS has already reused for another process is not guarded against; the sandbox's leftovers are then cleaned by EC-4); the rules file says to stop a sandbox only by its printed PID, never by pattern (AGENTS.md rule 1).
- **ER-4** The sandbox ends while a scenario runs against it: the scenario fails with a message that the sandbox ended, saves the artifacts that still exist, and no server is started in its place.
- **ER-5** An accepted scenario tries what it did not state (a restart, a stop, a second server, stopping the shell host): the attempt fails the scenario with a message naming the need it did not state; the sandbox server and shell host keep running with the same PIDs.
- **ER-6** A script path or an unregistered id: refused before anything runs, as in User Flow step 8.

## Out Of Scope

- Sets and composed scenarios on the sandbox: PRB.T-043 (FR-17).
- Ad-hoc use of the sandbox: attaching to a sandbox page from another process, driving one step, a page the sandbox keeps open for that, or any driver script (user decision, 2026-11-10; epic Out). The earlier draft of this story included them; they are dropped.
- The shared e2e library, direct setup over the API for the existing scenarios, and the debug log level of scenario servers: PRB.T-038. This story defines only the named fixtures the sandbox seeds, in the shared fixtures module PRB.T-038 grows into the library.
- Making every existing scenario sandbox-safe, and scoping every assertion to the scenario's own workspace (FR-14): PRB.T-039 and PRB.T-040. This story makes safe only the scenarios it accepts on the sandbox (at least two).
- The Playwright Test runner, parallel workers, traces: PRB.T-040. Parallel runs on one sandbox: not in PRB.E-005 (no FR); the sandbox refuses a second concurrent run (EC-9). The A-5 spike only checks that the runner works with the existing browser.
- The 15 s cap gate (FR-22): PRB.T-043. Timings printed on the sandbox are never compared to the cap.
- Resetting, snapshotting or restoring a sandbox: not requested.
- Running scenarios against a remote server or a dev server (`vp run dev`): refused (epic decision, local-only sandbox).
- The prompt-ready and layout-saved signals: PRB.T-041.
- Driving Claude Code or any real agent CLI: the mock agent only.
- Desktop and mobile: the sandbox drives the browser build only.

## Technical Scope

- **Layers:** `scripts/scenarios` (a sandbox entry point; the runner able to run one scenario against a live sandbox; each scenario's statement of its needs; per-run names for the scenarios accepted on the sandbox; the named fixtures in the shared fixtures module; leftover cleanup aware of sandboxes; `harness.test.ts` and self-tests); a script entry in the root `package.json`; possibly the `@playwright/test` dependency, only if the A-5 spike's files are kept (SU-3). No server, web, contracts or product code.
- **Docs impact:** the e2e rules file from PRB.T-042 (`.agents/rules/`): the sandbox commands (start, run one scenario by id, stop), the printed fields, the fixtures, what is refused and why, that a sandbox is not reset between runs, that a source change needs a new sandbox, and how to state a new scenario's needs; it replaces the interim sandbox instruction PRB.T-042 writes. `docs/operations/development.md`, `docs/internals/testing.md` and AGENTS.md are not changed (they keep only PRB.T-042's pointer, FR-15).
- **Mobile impact:** none; no contract changes.

## Non-functional Requirements and Constraints

- Order: the A-5 spike and the A-4 check come first and their results are in the handoff before the rest of the sandbox is built (epic Approach, Fallback).
- FR-18 holds for this story's own work: every scripted check, including the A-4 check, is saved harness code or a saved scenario; the A-5 spike drives no Probe server, so its evidence is a runtime transcript in the handoff.
- FR-19 holds: each acceptance criterion is checked by one run; nothing is rerun unchanged to get a pass or a diagnosis. Where several criteria run the same scenario (S5 in AC-2, AC-8, AC-12), each run checks a different behavior of the harness or sandbox, not the scenario's own result; where one run can serve several criteria, it does. A failure on the sandbox is readable from its first run (EC-8).
- NFR-3: loopback only; the throwaway home is under the OS temp folder; the server never inherits `T3CODE_*`, `VITE_*` or `PROBE_*`; the pairing URL is a secret, never written to a tracked file or committed; `~/.t3` and non-loopback addresses stay refused.
- The exception to "scenarios only run against a server they start themselves" is the narrowest one: only a live sandbox started by this harness, on loopback, on its own throwaway home, recognized by the harness's own record.
- Killing is by captured PID only (AGENTS.md rule 1); the printed sandbox PID is the one supported way to stop a sandbox.
- Waits follow the repo's test rules and the user's 2026-11-10 decision: readiness and stop come from events (an HTTP answer, a process exit), raced against a deadline that fails with a named message; no fixed sleeps, no polling where an event exists.
- Pointer-only input (`PointerPage`): the mouse-first rule holds for scenarios run on the sandbox.
- The sandbox output is read by agents: one structured line per fact group, no color codes, no secret other than the pairing URL.
- No process outlives a normal stop: server, shell host and shells end with the sandbox.
- Linux (devcontainer) and macOS; Chromium from the existing browser install only (NFR-4).

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given the cached Chromium headless shell and no browser download allowed, when one Playwright Test run of `@playwright/test` 1.60.0 tries to open a page in it, then the result (A-5 true or false), the transcript and, if false, the Fallback taken are in this ticket's handoff before any sandbox work is merged. | manual (author, runtime transcript in the handoff) | A-5, epic Fallback |
| AC-2  | Given two non-restart scenarios (S5 and S4 proposed) that use names and folders no earlier run on the server used, when they run one after another on one server through saved harness code, then the result (A-4 false only if the second fails or behaves differently because of state the first left on the server other than names and folders it picked itself; a scoping failure is fixed and the check run again after the change), what the second scenario met, and, if false, the developer's choice between the two Fallback branches, are in the handoff before the rest of the sandbox is built. | auto (the run) and manual (handoff entry) | A-4, FR-9, epic Fallback |
| AC-3  | Given a current bundle (a stale one is rebuilt first, EC-0), when the sandbox command runs in the background, then it prints the sandbox PID first, the origin, a pairing URL, the home, the server PID and which bundle it serves (and the shell host PID once one runs), with no color codes and no secret other than the pairing URL; it answers on the origin over HTTP and is still running after the output is printed; the server's environment holds no ambient `T3CODE_*`, `VITE_*` or `PROBE_*` variable; and no file in the checkout contains the pairing URL. | auto (harness test) | FR-8, NFR-3, EC-0 |
| AC-4  | Given the printed pairing URL, when an unpaired browser opens it, then it is signed in to the sandbox. | auto (harness test) | FR-8 |
| AC-5  | Given each named fixture (`workspace`, a workspace with one git project; `shells`, the same with two running plain shells; more are added by later stories, SU-1), when the sandbox starts with it, then the server API lists that state, built with no dialog clicked. | auto (harness test per fixture) | FR-8 |
| AC-6  | Given an unknown fixture name, when the sandbox command runs, then it exits non-zero, lists the known names and starts no server; given a fixture that fails while seeding, then the sandbox stops what it started, removes its home and exits non-zero with the error. | auto (harness test, both cases) | FR-8, EC-1, EC-2 |
| AC-7  | Given a running sandbox with a shell running in it, when the printed sandbox PID is stopped, then the server, the shell host and its shells end and the home is removed, touching no other process; given a sandbox started with the keep-home option, then the same processes end and the home is left in place; stopping a PID with no live process changes nothing. | auto (harness test checks the recorded pids; a stale-pid case) | FR-8, ER-3 |
| AC-8  | Given a running sandbox started with the `shells` fixture, when S5 and then S4 (or the two scenarios AC-2 used) are run by id against it with the rules file's command, then both pass, the server PID is the same before, between and after, no run starts a server of its own, each run prints its timing, and the sandbox is still up. | auto | FR-9, NFR-6, EC-6 |
| AC-9  | Given a running sandbox, when S7 (restart), R1 (second server), S1 (pristine home), S6 (not yet safe on a shared server), the self-tests T1, T3 and T4, and a scenario that states no needs are each run against it, then each is refused before the sandbox is touched, with a message naming the need (for S6 also PRB.T-039; for the last, that no needs were stated); the server PID and the workspace list are unchanged afterwards. | auto | FR-9, EC-11, EC-12 |
| AC-10 | Given a running sandbox, when a path to a script file, or an id that is not registered, is given to the run command, then it is refused before anything runs, saying that the sandbox runs saved scenarios only and naming the rules file's section on registering a scenario. | auto | FR-9, FR-18, ER-6 |
| AC-11 | Given an accepted scenario that tries a restart, a stop, a second server or stopping the shell host on the sandbox (a self-test that runs only when picked by id, so `--selftest` and the suite are unchanged; the check of stated needs applies on the sandbox only), when it runs, then it fails with a message naming the need it did not state, and the sandbox server and shell host keep the same PIDs. | auto (self-test) | ER-5 |
| AC-12 | Given a running sandbox, when a deliberate-failure self-test that fails in a named stage with an expected and a found value (T2 extended to do so) runs against it, then the output names the scenario id, the stage, the expected and the found value, the artifacts (error, screenshot, the sandbox server's log tail, recorded values) are saved outside the sandbox home, and S5 run next still passes on the same sandbox. | auto | EC-8, NFR-6, FR-9, FR-19 |
| AC-13 | Given the same accepted scenario run twice on one sandbox (the second time after a change to the scenario), when the second run starts, then it does not collide with the first run's workspace names or folders. | auto (harness test with a changed scenario fixture; no unchanged rerun, FR-19) | EC-10 |
| AC-14 | Given a run against the real data folder, a non-loopback origin, a dev server, a `--server`/`--url` flag, or a sandbox that is no longer running, when it starts, and given a sandbox start with `T3CODE_HOME` or a home flag under `~/.t3`, then each is refused with a message naming the rule, and every existing `harness.test.ts` refusal case still passes. | auto (harness test, one negative control per target) | NFR-3, ER-2 |
| AC-15 | Given the sandbox is up, when the address its server listens on is checked, then it is loopback only. | auto | NFR-3, EC-13 |
| AC-16 | Given a live sandbox, when a suite run or a second sandbox starts and runs its leftover cleanup, then the live sandbox is untouched; given a scenario run against the sandbox is killed, then the sandbox stays up and the run's own browser ends; given the sandbox was SIGKILLed, then the next suite start and the next sandbox start each clean its server, shell host, shells and home by recorded PID. | auto (harness test) | EC-3, EC-4, EC-5 |
| AC-17 | Given a web, contracts or server source file newer than the sandbox's start, when a scenario is run against the sandbox, then it is refused, naming the file and saying to start a new sandbox. | auto (harness test on a throwaway source tree; no edit of tracked files) | EC-7 |
| AC-18 | Given a scenario running against a sandbox, when a second run is started against the same sandbox, then it is refused, saying one scenario runs at a time there. | auto (harness test) | EC-9 |
| AC-19 | Given a sandbox whose server ends while a scenario runs against it, when the run continues, then the scenario fails saying the sandbox ended, saves the artifacts that exist, and no server is started in its place. | auto (harness test) | ER-4 |
| AC-20 | Given a server that cannot start (a missing server binary), when the sandbox command runs, then it prints the reason and log tail, cleans up what it started and exits non-zero. | auto (harness test, like `second-server-failure`) | ER-1 |
| AC-21 | Given the rules file after the change, when read, then starting the sandbox, running one scenario by id against it and stopping it are each one line; it states the printed fields, the fixtures, the refusals and their reasons, that a sandbox is not reset between runs, that a source change needs a new sandbox, and how a new scenario states its needs; PRB.T-042's interim sandbox instruction is gone; and no other doc describes the sandbox. | manual (docs review) | FR-15, NFR-5 |
| AC-22 | Given only the rules file and the repo, when a developer or a fresh agent session starts a sandbox, runs two saved scenarios one after the other against it, tries an unsaved script and a restart scenario, and stops it, then both runs pass with no cold start after the first, both refusals name a reason, and no throwaway script was written. | manual (developer or fresh agent session; epic FR-9 row) | FR-9, FR-18, NFR-5 |
| AC-23 | Given the change, when `vp run test:scenarios` and `--selftest` each run once, then every scenario passes or fails as before (T2 failing by design), and `vp run check:changed` passes. | auto | Out Of Scope (suite unchanged) |
| AC-24 | Given two live sandboxes, when a scenario is run naming the first one's printed PID, then it runs on the first (its server PID and home are the first's) and the second sandbox's workspace list is unchanged. | auto (harness test) | EC-14 |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-036 | The sandbox reuses the server handle, HTTP readiness, one login per server, the isolated shell, the manifest cleanup (which skips a live owner), the failure artifacts and the shared fixtures module. | code merged 2026-11-10; ticket in progress |
| PRB.T-042 | The sandbox commands go into the e2e rules file it creates; it also writes the interim sandbox instruction this story replaces. | done |

**Blocks:** PRB.T-038 (the library grows from the shared fixtures module and the named fixtures defined here); PRB.T-043 (sets and composed scenarios run on this sandbox, FR-17, and two new needs it refuses); PRB.T-039 (converts the scenarios refused here as not yet safe on a shared server); PRB.T-040 (keeps the sandbox working on the new runner, and depends on the A-5 result recorded here). PRB.T-038 and PRB.T-039 as written today still plan ad-hoc sandbox use (importable sandbox helpers, looking at a page, running one step of S3 without its restart); their rework must drop that, because this sandbox runs saved scenarios only.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | `@playwright/test` 1.60.0 runs with the cached `chromium_headless_shell-1223` and needs no browser download (epic A-5). | assumption | verified (2026-11-10, Handoff) | Spike, first step of this story (AC-1). | author |
| SA-2 | Scenarios that pick their own names and folders per run can share one server one after another (epic A-4, sequential case); verified for S5 then S4 (2026-11-10, Handoff). By desk reading, S4 and S5 need nothing but per-run names; S6 also matches the whole process table (`kill-shell.ts:34-44`), so it is not safe while another run is live; S1 needs a pristine home; E2-S4 changes the server's starting-script list, server-wide state. | assumption | verified (2026-11-10): S5 then S4, Handoff AC-2; `sandbox.test.ts` runs both on one server | Check, second step of this story (AC-2). Verified 2026-11-10 for S5 then S4. | author |
| SA-3 | The server API can seed both fixtures (workspace, project, plain shells) with no UI. `seedWorkspace` already does workspaces and projects (`fixtures.ts:72-84`); shells are unchecked. | assumption | verified (2026-11-10): `workspace.startShell` starts the plain shells; `sandbox.test.ts` checks both fixtures over the API | Plan stage; AC-5. | author |
| SA-4 | Stopping the sandbox's own process can end the server, the shell host and its shells, which the sandbox records. | assumption | verified (2026-11-10): `sandbox.test.ts` start/stop test, also with `--keep-home` | Harness test (AC-7). | author |
| SA-5 | The existing leftover cleanup already leaves a live sandbox alone if the sandbox owns its manifest as a runner (`cleanup.ts:179`); a scenario run against the sandbox must not record the sandbox's server in its own manifest. | assumption | verified (2026-11-10): `sandbox.test.ts` cleanup test; a run on a sandbox records no server | Harness test (AC-16). | author |
| SA-6 | A running server serves a bundle rebuilt after it started correctly (`http.ts` reads files per request but loads the asset manifest once). This story refuses either way (EC-7); relaxing that for web-only changes is later work. | assumption | unverified | Not needed for this story; read `http.ts` if a later story wants the relaxation. | author |
| SU-1 | Fixtures beyond `workspace` and `shells`; later stories add what they need. | decision | decided (author, 2026-11-10): `workspace` and `shells` only; later stories add theirs to `sandboxFixtures` in `fixtures.ts` | Plan stage, and later stories. | TBD (author, plan stage) |
| SU-2 | The command names (the analysis proposes `scenarios:sandbox`), the run-against-sandbox form, and the printed format (one JSON line or key=value lines). | decision | decided (author, 2026-11-10): `vp run scenarios:sandbox`, `vp run test:scenarios -- --sandbox <pid> --only <id>`, one `sandbox: <key>=<value>` line per fact | Plan stage; must be readable without scraping logs and be one line each in the rules file. | TBD (author, plan stage) |
| SU-3 | Whether the A-5 spike's files are kept in the repo (as the seed of PRB.T-040) or only its transcript. | decision | decided (author, 2026-11-10): transcript only; no `@playwright/test` dependency is added here | Handoff. | author |
| SU-4 | If A-4 is false: whether the sandbox gives each scenario a fresh workspace or refuses scenarios that leave state behind (epic Fallback). | decision | decided (user, 2026-11-10): a fresh workspace per scenario | Applies only if AC-2 finds A-4 false. | user |
| SU-5 | Whether stopping a sandbox can keep its home for post-mortem debugging. Failure artifacts are saved outside the home already. | decision | decided (user, 2026-11-10): yes, as an opt-in at start; the default removes the home | AC-7 | user |

## Handoff

### AC-1, the A-5 spike (2026-11-10): A-5 is true

`@playwright/test` 1.60.0 runs one test against the cached `chromium_headless_shell-1223` with no browser download. Done outside the repo (a scratch folder, `npm install @playwright/test@1.60.0` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`); the run had `PLAYWRIGHT_DOWNLOAD_HOST` pointed at a closed loopback port, so any download would have failed. The test set page content, asserted a heading with `expect(...).toBeVisible()`, and ran with `trace: "on"`. `~/.cache/ms-playwright` (listing with times and `du`) was identical before and after. Transcript (Node 26.12.1, Linux devcontainer):

```
$ node node_modules/@playwright/test/cli.js --version
Version 1.60.0
$ PLAYWRIGHT_DOWNLOAD_HOST=http://127.0.0.1:9 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node node_modules/@playwright/test/cli.js test
(node) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
Running 1 test using 1 worker
browser version: 148.0.7778.0
executable: /home/vscode/.cache/ms-playwright/chromium-1223/chrome-linux/chrome
  ✓  1 tests/a5.spec.mjs:2:1 › opens a page in the cached headless shell (104ms)
  1 passed (526ms)
exit=0
test-results/…/trace.zip written
cache unchanged
```

For PRB.T-040: `browserType().executablePath()` names the full `chromium-1223` build, which is not installed, but a headless launch uses the headless shell and works; do not check that path. Node 26 prints the `DEP0205` warning on every worker start. A trace is written, so FR-6's trace is available. No Fallback.

### AC-2, the A-4 check (2026-11-10): A-4 is true for S5 then S4

The sandbox's first slice is built and was used for the check: `vp run scenarios:sandbox` (`scripts/scenarios/sandbox.ts`) starts one server on a throwaway home, records itself (origin, home, server pid, log file) in its own run manifest, prints `sandbox: <key>=<value>` lines with its own pid first, and stays up until its pid is stopped; `vp run test:scenarios -- --sandbox <pid> --only <id>` runs one saved scenario against it (`attachServer` in `server.ts`: no server started, restart/stop/second server/stopping the shell host fail naming the need). S4 and S5 were scoped first: `ScenarioContext.runId` is new for every run, and both put it in their workspace name (`sparta-<runId>`) and folders (`<home>/folders/<runId>/…`). No throwaway script was written.

One sandbox (pid 65745, server pid 65756), then S5, then S4, each run once:

```
PASS    S5 close a tab and reopen it from the tree (8.0 s, teardown 4 ms)
PASS    S4 run many shells, each with its own output (16.9 s, teardown 5 ms)
```

The server pid was 65756 before, between and after. What S4 met: S5's workspace `sparta-5529b9` with its plain project and two shells still running with their tabs closed; S4 made `sparta-723c87` beside it. S4's assertions that could see other state (six tabs, tabs and selection after a reload, the tree after a reload, the shell list) all held. Stopping pid 65745 ended the server, the shell host and all six shells, and removed the home, the manifest and the log file. No Fallback; SU-4's branch does not apply.

### The rest of the sandbox (after the go-ahead, 2026-11-10)

Built on the first slice, all in `scripts/scenarios`. The commands and rules are in `.agents/rules/scenarios.md` ("Registering a scenario", "The sandbox").

- Every scenario states `needs` in its own file (`Scenario.needs`, `scenario.ts`). Accepted on a sandbox: S4, S5 and the self-tests T2, T5, T6. Refused: S1 (`pristineHome`); S2, S3, S7, S8, T-002, E2-S1, E2-S3, T1 (`restart`); R1, T3 (`secondServer`); T4 (both); S6 and E2-S4 (`unshared`, naming PRB.T-039). A test keeps every registered scenario stating its needs.
- The refusals (`sandboxRules.ts`, `sandboxTarget` in `run.ts`) all run before the sandbox is touched: a script path or an unknown id, a stated need, no stated needs, a record that is not a live loopback throwaway sandbox (`findSandbox`), a source or bundle newer than the sandbox (`staleSandboxFile`: web, server and their workspace packages, the harness files the sandbox loaded), a second run (`lockSandbox`). A run that tries what it did not state fails naming it (`attachServer`); a run whose sandbox ends fails at once and starts no server.
- Named fixtures (`sandboxFixtures` in `fixtures.ts`, for PRB.T-038's library) take the `runId` and build over the API: `workspace` and `shells`. `selftest-fails` is a self-test fixture, accepted but not listed.
- T2 now fails in a named stage with an expected and a found value. T5 (tries each need it did not state) and T6 (names a workspace and folder by its run, with a note the test changes between runs, for AC-13) are picked self-tests.
- The sandbox exits when its server ends on its own, prints `shell-host-pid` when the first shell host appears, and `--keep-home` leaves the home.

Not done: the lock takeover after a killed run is not atomic. Two runs taking over the same dead lock at the same instant could both run; one run per sandbox is the normal use, so it is left.

### Verification (2026-11-10)

- `scripts/scenarios/sandbox.test.ts`: 13 tests (6 unit, 7 spawned), first run 12/12, then the four tests changed after verification 4/4 (14 to 27 s each). Covers AC-3 to AC-20 and AC-24.
- `vp run test:scenarios -- --selftest`: T1 and T4 pass, T2 fails by design (with its stage, expected and found), as before.
- `vp run check:changed`, after rebasing on PRB.T-036's merge (`112548d01`): every step passes, tests 144/144 in 5 files. The `harness.test.ts` SIGKILL cleanup failure seen before the rebase was PRB.T-036's, fixed on `main`. The rebase needed one change: the sandbox's server handle (`attachServer`) reads raw shell output (`rawOutput`, new on `main`) from the sandbox's home, as a harness server does.
- No scenario or test failed because of a product bug.
- verify-story-implementation: fail on AC-13 (fixed since by T6 and its test), AC-22 and the full-suite half of AC-23; no gate scored 0.

Open:

- AC-23: one full `vp run test:scenarios` run, held by the developer while other sessions run scenarios.
- AC-22: the manual walkthrough by the developer or a fresh agent session from the rules file alone.

