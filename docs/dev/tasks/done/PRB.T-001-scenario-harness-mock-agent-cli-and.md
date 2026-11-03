---
id: PRB.T-001
type: story
parent: PRB.E-001
phase: 1
labels: [testing]
created: 2026-11-02
updated: 2026-11-03
---

# Scenario harness, mock agent CLI and booting scenario skeleton

## Business Goal

**Problem:** The terminal-first epic (PRB.E-001) promises eight scenarios, S1 to S8, that prove it without a human and without a paid model. Today there is no command that starts Probe on throwaway data, drives it in a browser, and reports pass or fail, and there is no fake agent for a shell to run. Without them every later story would be verified by hand, or not at all.

**Proposed solution:** Give the author one command that runs scenarios against a freshly started Probe on a throwaway data directory in headless Chromium, plus a mock agent CLI that behaves like a Claude-Code-like tool (banner, session id, echo, exit, resume). One booting scenario proves the whole path works end to end, so later stories only add scenarios.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 1 Scenario harness, mock agent CLI and a booting scenario skeleton (S1 reaches full scope in story 3)
- **Delivers:**
  - NFR-3: the harness uses a throwaway data directory and never touches the user's real Probe data or a remote server.
  - NFR-4: scenarios run in Playwright's headless Chromium (the browser `apps/web` uses for its browser tests), installed with `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium`; CI caches it under `~/.cache/ms-playwright`.
  - NFR-5 (part): the harness drives the UI with pointer actions, so later scenarios cannot depend on keyboard-only paths.
  - NFR-7 (part): the docs describe how to run scenarios.
  - KPI (epic): creates the single scenario command that counts S1 to S8.
  - Proves assumptions A-3, A-4, A-5, A-7 and A-15 (see Assumptions).
- **One deployable outcome:** The author runs one command from a clean shell and sees a booting scenario pass on a throwaway server in headless Chromium, and can run the mock agent CLI by hand; this contributes to the epic goal because every later story is checked by adding scenarios instead of by hand.

## Current Behavior

Verified by reading `/Users/Dzmitry_Lahunouski/dev/probe-org/probe` at commit 65e00bd57 (drafted 2026-11-02).

- **Scenario command:** none. `package.json` has `dev`, `test` (`vp run -r test`), `test:cached`, `test:perf:v2-wire` and `mobile:e2e`, but no `test:scenarios`.
- **Browser tests:** `apps/web/vite.config.ts` defines a `browser` Vitest project (Playwright provider, headless Chromium, `src/**/*.browser.test.{ts,tsx}`) that renders components inside the test runner, plus a `renders` project (`apps/web/test/*.renders.tsx`) that mounts the whole app per test but only through `scripts/render-metrics.ts`. Setup is in `apps/web/test/browserSetup.ts` and `apps/web/test/render.tsx`. Both run test code inside the page, so neither can stop and restart a real server.
- **Existing end-to-end precedent:** `scripts/mobile-e2e.ts` and `scripts/mobile-showcase.ts` start showcase environments (servers) and drive devices; they are mobile-only and need a device pool. No web equivalent found.
- **Throwaway data directory:** `scripts/dev-runner.ts` accepts `--home-dir` (equivalent to `T3CODE_HOME`), and a linked worktree defaults to its own `.t3`. `docs/operations/development.md` says never to run a server against the live `~/.t3/userdata`. Whether the server can be started and stopped by a test with a given home directory is unverified (A-7).
- **Fake agents:** `apps/server/scripts/dev-replay-agent.ts` is a replay ACP agent for the chat provider path (`docs/operations/development.md`, "Replay provider"). It is not a terminal program and has no banner, session id or resume command. No mock agent CLI exists.
- **Server and terminals:** `apps/server/src/terminal/Manager.ts` owns terminals and is keyed by chat thread id; not touched by this story.
- **Web app screen:** routes in `apps/web/src/routes/` are chat-first (`_chat.*`). The start screen with "Open workspace" and "Create workspace" does not exist yet (built in story 3).
- **Auth for a fresh server:** `apps/server/src/bin.ts pair` mints a pairing token (`AGENTS.md`); how a harness browser gets in without a human is unverified (SU-3).
- **Docs:** `docs/internals/testing.md` holds the test rules; `docs/operations/development.md` covers dev servers. Neither mentions scenarios.

## Expected Behavior

One command starts Probe on a throwaway data directory, opens it in headless Chromium, runs the scenarios that exist, lists scenarios not built yet (S2 to S8) as pending without failing the run, stops everything, and reports. Harness self-test scenarios (AC-7, AC-8) are not part of that run; they are selected with `vp run test:scenarios -- --selftest`, which runs T1 (restart keeps data) and T2 (a deliberate failure) and exits non-zero by design. The `--chrome` option became `--browser <path>` (path to a browser executable). Each scenario gets its own throwaway home, server and browser context, not one per run. The runner prints `scenarios: ready`, then `scenarios: <id> server pid=… home=…` for each scenario. At this point the only scenario is a boot skeleton. The mock agent CLI can be run in any normal terminal and behaves as the epic describes.

The mock agent CLI: prints a banner and a session id when started; echoes each input line; exits with status 0 on `exit`; accepts a fixed resume command with a session id and then continues the same conversation (the earlier conversation is shown again, and new input is added to it).

### User Flow

1. The author, in a clean shell, runs `vp run test:scenarios`.
2. The harness creates a throwaway data directory, starts Probe on it, and opens headless Chromium against it, driving the UI with pointer actions only.
3. The boot scenario loads the app's first page and passes when the page is past `/pair`, "Add project" is visible and "Something went wrong." is not shown (SU-4).
4. The harness stops the server and the browser and removes the throwaway data.
5. The command prints which scenarios passed, failed or are pending, and how many of the 8 pass, and exits with a status that says so.
6. Separately, the author runs the mock agent CLI in a plain terminal, types a line and sees it echoed, types `exit` and sees it end, then starts it again with the resume command and the saved session id and sees the same conversation continue.

### Edge Cases

- EC-1: The command is run twice in a row (or while a dev server is running on this machine); neither run is disturbed by leftover data or processes of the other or of an earlier run. Each scenario has its own throwaway home, server and browser context.
- EC-2: A scenario stops the server and starts it again on the same throwaway data directory (needed by S7 and S8, story 7 and story 8); the data written before the stop is still there after the start.
- EC-3: The mock agent CLI receives `exit` after other input; it ends with status 0 and does not print a second banner.

### Error Handling

- ER-1: A scenario fails: the command names the failing scenario and the reason and exits with a non-zero status, and the other scenarios still run and are reported.
- ER-2: The server or the browser cannot start (for example the browser is not installed): the command stops with a clear message that says what is missing, instead of hanging.
- ER-3: The harness is pointed at the user's real Probe data directory or a remote server: it refuses to run and says why; it never writes there (NFR-3).
- ER-4: A run is interrupted or fails midway: the server and browser processes it started are stopped and the throwaway data is removed; nothing it did not start is stopped.

## Out Of Scope

- The scenarios S2 to S8 and the full S1: they are built in the stories that deliver their requirements (S1 in story 3, S2 in story 4, S3 in story 5, S4 to S6 in story 6, S7 in story 7, S8 in story 8). This story only provides where they will live and a way to run them.
- Standalone shells, the start screen, workspaces, the "+" modal: stories 2 to 4.
- The mock agent CLI being launched by Probe inside a shell: story 4 (here it is run by hand and by the harness directly).
- The mock CLI's behavior for an unknown session id (a failing resume): decided with story 8 (SU-2).
- Real Claude Code session ids, a configurable resume command ("Resume Args"): later epics (epic Out of scope).
- Desktop and mobile verification: not required (epic NFR-4 note, user decision 2026-11-02).
- Running scenarios in CI: the KPI is measured locally on the author's machine (decided by the user 2026-11-02, SU-6). Only the harness tests (`scripts/scenarios/harness.test.ts`) run in CI; the scenarios themselves are not a CI gate.
- Deleting chat code: later remove-chat epic.

## Technical Scope

- **Layers:** a scenario runner (command, throwaway environment, server start and restart, browser driver); a mock agent CLI program; a boot scenario; test-support only, under `scripts/scenarios/` and `scripts/mock-agent/`. No change to the product's contracts, server API, terminal service or web screens is expected; if the plan finds one is needed, it goes back to the author. It also touches `.github/workflows/ci.yml`: the generic Test job now installs and caches Chromium so `scripts/scenarios/harness.test.ts` can run.
- **Docs impact:** `probe/docs/internals/testing.md` ("Scenario tests") and `probe/docs/operations/development.md` ("Scenario tests"). NFR-7 requires the docs in the same PR.
- **Mobile impact:** none (desktop and mobile are out of the epic by user decision, 2026-11-02); the change must not break their existing builds.

## Non-functional Requirements and Constraints

- NFR-3: scenarios never read or write the user's real Probe data (`~/.t3`) and never use a remote server.
- NFR-4: scenarios run in Playwright's headless Chromium (the browser `apps/web` uses for its browser tests), installed with `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium`; CI caches it under `~/.cache/ms-playwright`.
- NFR-5: the harness drives the UI with pointer actions (mouse or touchpad); no scenario may depend on a keyboard shortcut. Typing text into a terminal or a text field is allowed.
- Constraint (SA-2): scenarios use Playwright as a library from a Node runner that owns the server process; they do not use Vitest browser mode.
- Repo test rules apply (`AGENTS.md` Verifying, `docs/internals/testing.md`): no sleeps, polling loops, per-test timeouts, retries or wall-clock deltas; wait on events. Flakiness is fixed, not retried (epic risk R-3).
- Never set `VITE_HTTP_URL` or `VITE_WS_URL`; dev is single-origin (`AGENTS.md`).
- Never start a server against `~/.t3/userdata`; never kill a process found by name or path pattern, only one the harness started and tracked (`AGENTS.md`).
- Epic R-3: a flaky harness blocks every later epic, so stability is a requirement of this story, not a follow-up.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a clean shell with no manual pairing or setup step, when the author runs `vp run test:scenarios`, then it runs the booting scenario (first page loads, no error shown), prints its result, and exits with status 0 | auto | NFR-4, SA-3 |
| AC-2 | Given the scenario command is running, when the booting scenario loads the app, then the server runs on a fresh `mkdtemp` home passed with an explicit `--base-dir`, with `T3CODE_*` and `VITE_*` scrubbed from the server's environment, `<home>/userdata/server-runtime.json` holds the pid of the spawned server, and the home is not under `~/.t3`. (A before/after snapshot of `~/.t3` was dropped: it is flaky because the author's live install changes it constantly.) | auto | NFR-3 |
| AC-3 | Given the scenario command is running, when the booting scenario runs, then it drives the UI with pointer actions and no keyboard shortcuts (typing into a terminal is allowed) and the browser is headless Chromium. Pointer-only is enforced by the type `PointerPage = Omit<Page, "keyboard">` plus review: a compile-time guarantee, not a runtime one | auto | NFR-4, NFR-5 |
| AC-4 | Given the scenario command finished (pass or fail), when the author checks the machine, then no server or browser process started by the run is left and the throwaway data is removed | auto | ER-4 |
| AC-5 | Given a run just finished, when the command is run again immediately, then it passes again | auto | EC-1 |
| AC-6 | Given a dev server is running on the machine, when the command is run, then it passes and the dev server is untouched | auto | EC-1 |
| AC-7 | Given a harness self-test scenario (not one of S1 to S8 and not part of the normal run) that starts the server on a throwaway data directory and has added a project with `bin.ts project add <path> --title …` against the running server (state the server stores), when the server is restarted, then the project is found in the UI. Run with `vp run test:scenarios -- --selftest` (scenario T1) | auto | EC-2, SA-4 |
| AC-8 | Given a deliberately failing harness self-test scenario (not one of S1 to S8 and not part of the normal run), when the command runs, then it names that scenario and the reason, still runs and reports the other scenarios, and exits non-zero. Run with `vp run test:scenarios -- --selftest` (scenario T2); it exits non-zero by design | auto | ER-1 |
| AC-9 | Given the browser cannot be started (the failure is induced by the test), when the command runs, then it ends with a message that names the missing browser and the install command and does not hang | auto | ER-2 |
| AC-10 | Given the server cannot start (the failure is induced by the test), when the command runs, then it ends with a message that says so and does not hang | auto | ER-2 |
| AC-11 | Given the harness is pointed at the user's real data directory (by an option or by an ambient environment setting) or at a remote server address, when the command runs, then it refuses before starting anything and says why | auto | ER-3, NFR-3 |
| AC-12 | Given a run is interrupted midway, when the author checks the machine, then only the server and browser processes the run started are stopped and its throwaway data is removed (the interruption is produced by the test, for example by signalling the runner) | auto | ER-4 |
| AC-13 | Given the mock agent CLI is started in a plain terminal, when it starts, then it prints a banner and a session id | auto | SA-1, SA-5 |
| AC-14 | Given a running mock agent CLI, when a line is typed, then the same line is echoed | auto | SA-1 |
| AC-15 | Given a running mock agent CLI with earlier input, when `exit` is typed, then it ends with status 0 and prints no second banner | auto | EC-3 |
| AC-16 | Given a mock agent CLI session that echoed some lines and printed session id X, when it is started again with the resume command and X, then the earlier conversation is shown again and new input continues it with the same id | auto | SA-5 |
| AC-17 | Given the docs after this story, when a reader follows them, then they can run the scenario command and the mock agent CLI | manual (author, in the PR docs review) | NFR-7 |
| AC-18 | Given only the boot scenario exists, when the command runs, then it lists S2 to S8 as pending, reports the number of passing scenarios out of 8, and exits 0 when no existing scenario fails | auto | KPI |

## Dependencies

None. This is the first story of PRB.E-001; the running toolchain (A-5) is re-proved by AC-1.

| Depends on | Why | Status |
| --- | --- | --- |
| None | First story in order | n/a |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | Epic A-3: a fake agent CLI that a shell can run stands in for a Claude-Code-like tool | assumption | verified | AC-13 to AC-16 pass (verify run); the author reviews it at the end of this story | author |
| SA-2 | Epic A-4: Playwright (already a dependency of `apps/web`), used as a library from a Node scenario runner that owns the server process, drives Playwright's headless Chromium (not `channel: "chrome"`) and can stop and restart the server. Vitest browser mode is not used for scenarios because its tests run inside the page. Constraint on the plan, decided 2026-11-02 | assumption | verified | AC-1, AC-7 and the passing harness tests prove it (verify run) | author |
| SA-3 | Epic A-5: the toolchain installs and the app runs in the browser on this machine | assumption | verified | Confirmed by the author 2026-11-02; re-proved by AC-1 | author |
| SA-4 | Epic A-7: the harness can stop and restart the server within one scenario on the same data directory (this story provides it as `server.restart()`, same home and port; story 7 and story 8 use it) | assumption | verified | AC-7 (verify run) | author |
| SA-5 | Epic A-15: the mock CLI can print a session id, accept a resume command with that id, and continue the same conversation | assumption | verified | AC-13 to AC-16 (verify run) | author |
| SU-1 | The exact name of the scenario command | unknown | verified | Decided by the user: `vp run test:scenarios` | author |
| SU-2 | What the mock CLI does for an unknown session id (needed by story 8 so a resume can fail and succeed after the cause is fixed; not built or tested here) | unknown | unverified | Decide with the author before story 8 at the latest; TBD (author, 2026-11-16). Current behavior is only a placeholder: `mock-agent: no session <id>` on stderr and exit 1. Story 8 owns the final behavior | author |
| SU-3 | How the harness starts the server on a throwaway home and gets its browser authorised without a human (no manual pairing). Decided: mint a credential with `bin.ts auth pairing create --base-dir <home> --json`, then open `<origin>/pair#token=<credential>` | unknown | verified | AC-1 passes from a clean shell with no pairing step | author |
| SU-4 | The boot scenario's pass condition | unknown | verified | Decided by the user: the first page loads and no error state shows. Concrete check: the page is past `/pair`, "Add project" is visible and "Something went wrong." is not shown. Story 3 must update it when the start screen replaces the first screen | author |
| SU-5 | How scenarios not yet built show in the output | unknown | verified | Decided by the user: listed as pending, do not fail the run; the KPI counts passing scenarios out of 8 | author |
| SU-6 | Whether scenarios must also run in CI; the epic measures the KPI only locally | unknown | verified | Decided by the user 2026-11-02: local only for now | author |
| SU-7 | The mock CLI's resume command, invocation and wording. Decided: run `node scripts/mock-agent/mock-agent.ts [--resume <id>]`; the banner is `Mock Agent v1`, then `session: mock-xxxxxxxx`; each line is echoed as `echo: <line>`; `exit` ends with status 0; `--resume <id>` prints the banner and session id again, replays `> <line>` and `echo: <line>` for each earlier line, then continues; sessions are stored in `$MOCK_AGENT_HOME` (default: a `probe-mock-agent` folder in the system temp directory). **Not built:** the way to make a resume fail every time that story 8 needs (its SA-5); today only an unknown id fails (see SU-2) | unknown | verified | AC-13 to AC-16 (verify run) | author |

## Verification Result

Verify run (2026-11-03): 16 of 18 ACs are met. AC-2 and AC-3 are partial by design: AC-2 checks the home and server pid instead of a `~/.t3` snapshot, and AC-3's pointer-only rule is a compile-time type plus review, not a runtime check. The author decides whether to accept them.
