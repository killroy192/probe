---
id: PRB.T-037
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Scenario sandbox: keep a server up and drive one step

## Business Goal

**Problem:** To try one UI step against a live Probe server, an agent writes a throwaway TypeScript script: it starts a server, pairs a browser, builds state by clicking through dialogs, and throws it all away. The helpers it needs (open a signed-in page, connect to the API, make a workspace) are private to scenario files, so each script rewrites them, and each try pays a cold start. Failures give one line.

**Proposed solution:** One documented command starts a harness server on a throwaway home, optionally seeds a named fixture over the server API, opens a signed-in page that stays up, prints everything needed to use it (origin, pairing URL, home, PIDs, how to attach to the page), and runs until stopped through one printed handle, the sandbox command's own process. The helpers are importable and documented, and one scenario can run against the live sandbox without a cold start. Nothing here can reach real data or a remote server.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 2 PRB.T-037 Scenario sandbox (phase 1 of the desk analysis)
- **Delivers:**
  - FR-8: one command starts a sandbox server on a throwaway home, optionally seeds a named fixture, prints origin, pairing URL, home and PIDs, and stays up until stopped through one handle: the sandbox command's own process, whose PID it prints first.
  - FR-9: the sandbox's helpers (open a page, connect to the API, fixtures) are importable and documented in `docs/operations/development.md`; one scenario can run against a live sandbox without a cold start.
  - FR-9 (refusal half): every scenario declares whether it needs a server restart, a second server or a pristine home, so the live-sandbox path can refuse it before touching the sandbox (how it is declared is left to the plan).
  - FR-15 (sandbox half): the repo's test docs match the sandbox the day it lands.
  - NFR-3: loopback only, throwaway home, pairing URL never committed; the harness guard is not weakened.
  - NFR-5: the sandbox command and the single-scenario-against-sandbox command are each one documented line.
  - KPI (agent-drivable sandbox): exists and documented in `docs/operations/development.md`.
- **One deployable outcome:** An agent verifying a feature runs one documented command, gets a live server with a signed-in page and a fixture, drives one step, runs a scenario against it, and stops it by one PID, with no throwaway script. This is user scenario 3 of the epic.

## Current Behavior

Verified by reading `scripts/scenarios/` on 2026-11-09. PRB.T-036 is not built yet; its changes (shared fixtures module, one login per server, manifest cleanup) are assumed (see Dependencies).

- **Entry point.** Only `vp run test:scenarios` exists (`package.json`, `scripts/scenarios/run.ts`). It starts a server per scenario, runs it and tears it down (`runScenario` in `run.ts`). There is no way to leave a server running.
- **Server handle.** `startServer` (`server.ts`) starts a server on a reserved loopback port with `--base-dir <throwaway home>` and returns origin, home, `pid()`, `pairingUrl()` (mints a one-time pairing credential through the server CLI), `shellHostPid()`, `restart`, `stop` and `logs`. The shell host is a separate detached process that outlives the server.
- **Page.** `newPage` in `runScenario` (`run.ts`) is local to it: a browser context is created, a pairing URL opened, and the page returned as a `PointerPage` (no `keyboard`). The browser launcher is `browser.ts` `launchBrowser`; the browser is closed when the run ends, so no page outlives the runner and no other process can attach.
- **API client.** `connectRpc(origin, auth)` in `rpc.ts` gives a typed WebSocket RPC client signed in as a page's cookie or a bearer token. It is importable. Bearer tokens come from `issueBearerToken` in `seam.ts`.
- **Fixtures.** Setup helpers are scattered: `seedWorkspace` and `withClient` in `scenarios/second-server.ts`, `projects` and `setUp` in `scenarios/starting-scripts.ts`, UI helpers in `scenarios/workspaceUi.ts`. There are no named fixtures.
- **Guard.** `refusalReason` (`environment.ts`) refuses `--server`, `--server-url` and `--url` outright ("Scenarios only run against a server they start themselves") and `--base-dir`/`--home-dir` under `~/.t3`. `harness.test.ts` covers it. A scenario receives its server only from the runner, as a `ServerHandle` that owns the child process (`ScenarioContext` in `scenario.ts`).
- **Scenarios that fit a live server.** By grep on 2026-11-09, `close-tab.ts` (S5), `kill-shell.ts` (S6), `many-shells.ts` (S4), `boot.ts` (S1) never call `server.restart`, while `restart.ts`, `plus-modal.ts`, `restore-shell.ts`, `starting-scripts.ts`, `standalone-shell.ts` and `worktrees.ts` do. `second-server.ts` (R1) also never restarts but starts a second server, which a sandbox refuses (EC-5, AC-9), so it is not in this list. They create folders under `server.home`, so a sandbox handle must expose its home. Whether S1, S4 and S6 assume a pristine home (empty workspace list, fixed counts) is unverified (SA-3).
- **Docs.** `docs/operations/development.md` "Scenario tests" and `docs/internals/testing.md` "Scenario tests" describe only the per-scenario runner.

## Expected Behavior

### User Flow

1. The agent runs the documented sandbox command (optionally with a fixture name) in the background.
2. The command starts a server on a throwaway home, seeds the fixture over the API if one was named, opens a signed-in page, and prints, in a form a program can read without scraping logs: the origin, a pairing URL for an unpaired browser, the home, the server PID, the shell host PID, the browser PID and how a separate process drives the signed-in page (the mechanism is left to the plan). It then stays up.
3. A separate process drives the signed-in page: it performs one step (click, read, screenshot) and stops; the page and the server stay up. It can also connect to the API with the documented helper, and ask for a fresh pairing URL.
4. The agent runs one scenario against the sandbox with the documented single command; the scenario uses the sandbox's server and home and does not start another.
5. The agent stops the sandbox by stopping the sandbox command's own process (the PID printed at start); the server, shell host and browser end and the home is removed.

### Edge Cases

- EC-1: An unknown fixture name: the command refuses before starting anything and lists the known names.
- EC-2: Seeding fails partway (server up, fixture error): the sandbox stops, removes its home and exits non-zero with the error; it never stays up half seeded.
- EC-3: Two sandboxes at once, or a sandbox during `vp run test:scenarios`: each has its own home and port; the run's manifest cleanup (PRB.T-036) does not touch a live sandbox, and starting a sandbox does not stop another.
- EC-4: The sandbox command is killed with SIGKILL: the next scenario run or sandbox start cleans its leftovers by recorded PID (PRB.T-036 mechanism), and never kills a live one.
- EC-5: A scenario that restarts the server, starts a second server or needs a pristine home is run against a live sandbox: it is refused with a message that says why, before touching the sandbox.
- EC-6: A scenario is run against a sandbox that already holds the fixture's data or the leftovers of an earlier scenario: it runs against that state as it is; the docs say a sandbox is not reset between runs.
- EC-7: The bundle is stale when the sandbox starts: the same rebuild rule as the suite applies and the sandbox says which bundle it serves.
- EC-8: The agent attaches twice at once, or detaches abruptly: the page survives and the second attach works.
- EC-9: The sandbox is used from a different machine than the browser would run on: not supported; it binds loopback only (NFR-3).

### Error Handling

- ER-1: The server or browser fails to start: the command prints the reason and the server log tail, cleans up what it started and exits non-zero.
- ER-2: The sandbox is asked to target `~/.t3`, a non-loopback address or a server it did not start (including a dev server or a server of another sandbox that is no longer live): refused with a message naming the rule, the same way the suite refuses today.
- ER-3: The PID printed is stale or already gone when the agent stops it: nothing else is affected; the docs say to stop only by the printed PID, never by pattern.
- ER-4: Attach fails because the browser is gone: the helper says the page is not running and how to start a new sandbox.

## Out Of Scope

- Creating state over RPC in the existing scenarios and keeping one real UI path per action family: PRB.T-038. This story seeds only the fixtures it defines.
- Resetting a sandbox between scenario runs, snapshots and restore of a sandbox: not requested.
- Running scenarios against a remote server (epic open question 3, proposed local-only) or a dev server (`vp run dev`): refused here.
- Parallel runs, the Playwright Test runner and traces: PRB.T-040.
- The two production signals: PRB.T-041.
- A dev-server test helper for product code; mobile and desktop sandboxes.
- Driving Claude Code or any real agent CLI: the mock agent only.

## Technical Scope

- **Layers:** `scripts/scenarios` (a new entry point, the server and browser lifecycle split so a sandbox can own them, the scenario runner accepting a live sandbox, the shared fixtures module from PRB.T-036, `harness.test.ts`); a `package.json` script entry; docs.
- **Docs impact:** `docs/operations/development.md` "Scenario tests": a "Sandbox" subsection (the command, the printed fields, attaching, fixtures, helpers, running a scenario against it, stopping). `docs/internals/testing.md` scenario section: the sandbox and the exception to "scenarios only run against a server they start themselves". Rewrite statements that become false; AGENTS.md "Verifying" gets one line only if the sandbox changes how an agent verifies (check, do not pad). The `test-t3-app` skill is not changed.
- **Mobile impact:** none; no contract changes.

## Non-functional Requirements and Constraints

- NFR-3: loopback only; throwaway home under the OS temp folder; the child never inherits `T3CODE_*`, `VITE_*`, `PROBE_*`; the remote debugging endpoint of the browser is loopback only; the printed pairing URL is a secret and is never written to a tracked file or committed; the harness refuses real data and non-loopback addresses.
- The exception to "scenarios only run against a server they start themselves" is the narrowest one: only a live sandbox started by this harness, on loopback, on its own throwaway home, recognized by the harness's own record (not by a flag the user types).
- Killing is by captured pid only (AGENTS.md rule 1). The sandbox command's printed PID is the only supported way to stop a sandbox.
- Pointer-only input (`PointerPage`); the mouse-first rule holds for scenarios run against a sandbox.
- The repo test rules hold for harness code: no sleeps, polling loops or wall-clock deltas; readiness comes from facts (HTTP, process exit).
- Chromium from the existing Playwright install; Linux (devcontainer) and macOS.
- The sandbox output is read by agents: one structured line per fact group, no color codes, no secrets other than the pairing URL (NFR-5).
- Process orphaning: the sandbox must not leave the browser, server or shell host running after a normal stop.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers |
| -- | ------------------------------- | --------------------- | ------ |
| AC-1 | Given a clean checkout with a current bundle, when the sandbox command runs in the background, then it prints the origin, a pairing URL, the home, the server PID, the shell host PID and the browser PID, answers on the origin over HTTP, and is still running after the output is printed. | auto (harness test) | FR-8 |
| AC-2 | Given the printed pairing URL, when an unpaired browser opens it, then it is signed in; and the ready signed-in page is already up in the sandbox without the agent pairing again. | auto (harness test) | FR-8 |
| AC-3 | Given a running sandbox, when a separate process drives the signed-in page (clicks, reads text), stops, and drives it again, then the page and server stay up and the second round works. | auto (harness test) | FR-9, EC-8 |
| AC-4 | Given a running sandbox, when a separate process uses the API helper, then it lists the sandbox's workspaces and can request a fresh pairing URL. | auto (harness test) | FR-9 |
| AC-5 | Given each named fixture (the two fixed fixtures: `workspace`, a workspace with one git project, and `shells`, the same with two running plain shells; others are additive, see SU-1), when the sandbox starts with it, then the page shows that state and the API lists it, with no dialog clicked to build it. | auto (harness test per fixture) | FR-8 |
| AC-6 | Given an unknown fixture name, when the command runs, then it exits non-zero, lists the known names and starts no server; and given a fixture that fails while seeding, then the sandbox stops, removes its home, and exits non-zero with the error. | auto (harness test, both cases) | EC-1, EC-2 |
| AC-7 | Given a running sandbox, when the sandbox command's own process (the PID printed at start) is stopped, then the server, the shell host and the browser end and the home is removed, leaving no process or folder behind and touching no other process; a stale PID changes nothing. | auto (harness test checks the pids; a stale-pid case) | FR-8, ER-3 |
| AC-8 | Given a running sandbox and a scenario that needs no restart (S5 proposed), when that one scenario is run against it with the documented command, then it passes without starting its own server or paying a cold start, and uses the sandbox's home. | auto | FR-9 |
| AC-9 | Given a scenario that restarts the server, starts a second server or needs a pristine home, when run against a sandbox, then it is refused with the reason before the sandbox is touched; and a scenario that declares none of these needs is accepted. | auto | EC-5, FR-9 |
| AC-10 | Given a request to run a scenario against the real data folder, a non-loopback origin, a dev server, or a sandbox that is no longer live, then it is refused with a message naming the rule, and every existing `harness.test.ts` refusal case still passes. | auto (negative controls for each target) | NFR-3, ER-2 |
| AC-11 | Given a scenario run or a second sandbox starts while a sandbox is live, when the cleanup of a killed runner (PRB.T-036) runs, then the live sandbox is untouched; and given the sandbox was SIGKILLed, then the next start cleans its server, shell host, browser and home by recorded PID. | auto (harness test) | EC-3, EC-4 |
| AC-12 | Given the browser or server cannot start (missing browser, port or build failure), when the sandbox command runs, then it prints the reason and log tail, cleans up everything it started and exits non-zero. | auto (harness test with a failing server binary, like `second-server-failure`) | ER-1, EC-7 |
| AC-13 | Given the helpers and the sandbox command are documented in `docs/operations/development.md`, when an agent that has only that page and the repo drives one step (start, attach, click, read, run a scenario, stop), then it completes it without writing a throwaway script. | manual (a developer or a fresh agent session following the docs) | FR-9, NFR-5, KPI |
| AC-14 | Given the sandbox is up, when the printed browser endpoint and server address are checked, then both listen on loopback only. | auto | NFR-3, EC-9 |
| AC-15 | Given the docs after the change, when read, then the sandbox is described once, the statement that scenarios only run against a server they start themselves names the sandbox exception, and no contradictory text remains. | manual (docs diff review) | FR-15 |
| AC-16 | Given the full suite (`vp run test:scenarios`) after this story, when run twice with no retries, then both runs pass as before. | auto | NFR-2 |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-036 | The shared fixtures module, one login per server, the HTTP readiness check, the manifest-based cleanup (which must recognize a live sandbox) and the clean shell environment are all reused; the sandbox would otherwise repeat the helpers T-036 deduplicates. | not started |

**Blocks:** PRB.T-038 (RPC-first setup reuses the fixtures seeded over RPC here and the live-server mode to try changes); PRB.T-040 (the shared server per worker reuses the lifecycle split this story makes).

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| -- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | A headless Chromium launched by the harness can expose a loopback-only debugging endpoint that a second Node process attaches to with the existing Playwright library, and a signed-in context survives detach. | assumption | unverified | Spike at the start of the plan stage. | author |
| SA-2 | The server's workspace and shell RPC methods can seed the first two fixtures (workspace, project, plain shells) with no UI. | assumption | unverified | `connectRpc` already drives `workspace.*` in `second-server.ts` for workspaces and projects; confirm shells in the plan stage. | author |
| SA-3 | S5 runs against a non-pristine home. S1, S4 and S6 may assume a pristine home or fixed counts. | assumption | unverified | Read S1/S4/S6 and run S5 against a fixture-seeded sandbox. | author |
| SA-4 | Stopping the sandbox command's own process can also end the server, shell host and browser (they are recorded by the sandbox). | assumption | unverified | Harness test (AC-7). | author |
| SU-1 | Any fixtures beyond the two fixed ones (`workspace`, `shells`); later stories add fixtures as they need them. | unknown | unverified | Decide in the plan stage from what S4/S5/S6 need. | TBD (author, plan stage) |
| SU-2 | The form of the printed output (one JSON line vs key=value lines) and the command name (`scenarios:sandbox` is proposed by the analysis). | unknown | unverified | Plan stage; must be readable without scraping logs. | TBD (author, plan stage) |
| SU-3 | Whether stopping the sandbox should be able to keep the home for post-mortem debugging. | unknown | unverified | Ask the developer; default is remove. | TBD (developer, 2026-11-16) |
