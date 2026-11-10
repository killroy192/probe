---
paths:
  - "scripts/scenarios/**"
  - "scripts/mock-agent/**"
---

# Scenario rules

Every rule for writing and running scenarios is in this file. The general test rules (what to test, one layer, waiting for work) are in [AGENTS.md "Verifying"](../../AGENTS.md#verifying) and apply here too. These rules bind every new or changed scenario now. The existing scenarios are converted to them in PRB.T-039, so an old scenario that breaks one (S2 both checks and measures) is not a pattern to copy.

When a story changes the harness, it updates this file in the same change. No other doc restates these rules; link here instead.

## What a scenario is

A scenario (`scripts/scenarios/scenarios/`) proves terminal-first behavior end to end: the runner starts a real Probe server on a throwaway home and drives the built web app in headless Chromium. A Node runner owns the server process and uses Playwright as a library, because Vitest browser mode runs test code inside the page and cannot stop or restart a real server.

- **Two kinds.** A check scenario asserts behavior and never records a duration. A perf scenario measures, and asserts only its own budget, in a file named `<scenario>.perf.ts`. No scenario is both. Until PRB.T-039 brings `.perf.ts` support and PRB.T-040 the serial perf run, add no new timing to a check scenario. The `metric()` calls already there stay until PRB.T-039 moves them.
- **One purpose.** A scenario checks one behavior and fails naming it. Bigger flows are composed from atomic scenarios. Until PRB.T-039 brings sets and composed scenarios, each scenario runs alone under its id, and sets up its own state instead of relying on what another scenario left.
- **Saved, never throwaway.** Every scripted check that drives a harness or sandbox server is a saved scenario, registered under an id. Do not write a one-off driver script, and do not offer evidence from one. Register the scenario first and iterate on it there. The manual checks AGENTS.md asks for (a `test-t3-app` pass, before/after captures, a runtime transcript) are not scripted scenarios and are unaffected.
- **Registering.** A new scenario goes in `scenarios/` and is listed in `registry.ts`, replacing its entry without `run` if its story left one. Harness self-tests go in `selftest/` and run only with `--selftest`.

## Writing one

- **One shared library.** Reusable setup, steps, waits, fixtures and logging live in the library modules, not in scenario files: `support.ts` (`check`, `recorder`, `pageFrames`, `alive`, `gone`), `fixtures.ts` (`setUp`, `seedWorkspace`, `withClient`, `restartAndReload`, `unlessRoot`, `expectLogged`, `metric`), `browser.ts` (`PointerPage`, `connectionCutter`), `rpc.ts`, `seam.ts` and `scenarios/workspaceUi.ts` (UI steps and the starting-script helpers). A scenario file holds its own steps and assertions and defines nothing another scenario could reuse. Extend a library module instead. PRB.T-038 turns these into one library with direct setup over the server API; until then, setting up by clicking through dialogs is allowed.
- **Pointer only.** Scenarios get a `PointerPage`, which has no `keyboard`. Drive the UI with clicks. Typing into a terminal or a text field is fine, keyboard shortcuts are not.
- **Throwaway home.** Each scenario gets its own throwaway home, server and browser context. The server never inherits `T3CODE_*` or `VITE_*`, and the runner refuses `~/.t3`, `--base-dir`, `--home-dir` and any server address. Never add a path to real data or a remote server.
- **Isolated shell.** Scenario shells run zsh, else bash, with the harness's plain startup files (fixed `PS1`, own history file), and git reads only `scripts/scenarios/gitconfig`. How a developer's own shell config changes behavior or timing is not the suite's concern; `--own-shell-config` exists only to look into that.
- **The mock agent.** `scripts/mock-agent/mock-agent.ts` stands in for a Claude-Code-like CLI in shells. The runner sets `PROBE_SEED_MOCK_AGENT`, so each throwaway home starts with a "mock agent" starting script; `openModal` picks it unless told otherwise. The starting-script helpers in `scenarios/workspaceUi.ts` rewrite the list file in the home, which the server reads on every use.
- **Fault helpers.** `server.restart({ env })` restarts with changed variables (a broken `GIT_CONFIG_GLOBAL`, or `PROBE_SEED_MOCK_AGENT: undefined` for a server without the default). `server.logs()` returns the server's output, at info level today. `connectionCutter(page)` drops a page's websockets when it sends a given request. To end a shell from outside the app, kill the `pid` the shell list reports.
- **Root.** A check that relies on file permissions runs through `unlessRoot`, which prints a `SKIP` line with the reason as root instead of passing vacuously.
- **`check()` messages.** The message passed to `check()` is evaluated even when the check passes, so never `await` a locator inside it.

## Waiting

- No sleeps, no polling loops and no clock reads in a check scenario. Wait by subscribing to the event that marks the milestone (a locator, a terminal frame through `recorder().until` with a `mark()` taken before the action, a log line through `server.logged`, a process `exit`), raced against a deadline whose failure names what was awaited. The library's waits already do this; use them.
- A bounded check loop is allowed only where no event exists to subscribe to (the end of a process the harness did not start as its own child, a server that is up only once it answers). Its suppression names the missing event.
- Until PRB.T-041 brings the prompt-ready and layout-saved signals and the shell's ended event, wait for the prompt mark in terminal frames, for the server's state, or with `gone()`. Never type into a terminal or reload on a guess.
- Lint enforces this in every file under `scripts/scenarios/` and `scripts/mock-agent/`: `t3code/no-wall-clock-in-tests`, `t3code/no-real-time-wait-in-tests` (timers, `timers/promises`, Playwright's `waitForTimeout`) and `t3code/no-polling-loop-in-tests`. A `.perf.ts` file may read the clock; it may not sleep or poll.
- A suppression states its reason in one of these forms, and nothing else gets one; a fixed sleep that waits and hopes is fixed, never suppressed:
  - `permanent (a): …` runner bookkeeping that waits for nothing (its printed timing, timestamps);
  - `permanent (b): …` a deadline raced against the event it names;
  - `permanent (c): …` a bounded check loop, naming the missing event;
  - `temporary: PRB.T-0NN …` code a named PRB.E-005 story removes.

## Failures and reruns

- A failure must be readable from its first run: the output names the scenario, the stage, what was expected and what was found. A failed scenario leaves a screenshot, the server log tail and the last recorded values in the artifacts folder the `FAIL` line prints (`--artifacts <dir>` to choose it).
- Never rerun an unchanged scenario on unchanged code to get a pass, a reading or a diagnosis, perf scenarios included. Running again after changing the scenario or the code is normal work. The one deliberate repeat is a determinism loop of N runs (the epic's flake loop, or a story's own N-run check of a fix), and only when an acceptance criterion asks for it; PRB.T-040 documents its command.
- A failure whose cause needed a rerun to find is a defect of the scenario. Fix it there with more logging or a sharper assertion, never with a retry. Flaky scenarios are fixed, not retried.
- Log enough to show the problem. Product code may gain log lines for that at debug level, which production does not print by default. No log line prints a token, pairing URL or cookie. Scenario servers log at info level until PRB.T-038 starts them at debug level and adds the browser console to the artifacts.

## The 15 s cap gate

Every atomic check scenario must finish under 15 s. That is a separate gate, never measured on a normal run: run it once after a scenario is implemented, and again only when the user asks. Each time, first ask the user to confirm nothing in the background slows the machine. Until PRB.T-039 brings the gate command, the gate is one `--only <id>` run after that confirmation, reading the time on its `PASS` line against 15 s.

## Running

- Chromium: the same Playwright Chromium as the web browser tests. Install it once with `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium`, or pass `--browser <path>`.
- `vp run test:scenarios` runs every scenario and prints `PASS`, `FAIL`, `PENDING` or `SKIP` lines with each scenario's time, then how many of the 8 epic scenarios and of the story checks pass. It exits non-zero when a scenario fails.
- `vp run test:scenarios -- --only <id>` runs one scenario by id (`S1` to `S8`, `T-002`, `R1`, `E2-S1`, `E2-S3`, `E2-S4`).
- `vp run test:scenarios -- --selftest` runs the harness self-tests `T1`, `T2` and `T4`; `T2` is a deliberate failure, so it exits non-zero by design. `vp run test:scenarios -- --selftest --only T3` runs `T3`, which runs only when picked.
- The runner rebuilds the web bundle when `apps/web/dist` is missing or any of its inputs is newer, and prints which bundle it used; `--rebuild` forces a build.
- Runs never touch `~/.t3` and do not disturb a running dev server. Each scenario stops its server's shell host, by the pid in its throwaway home, before deleting that home, and the next run cleans up after a killed one by captured PID.
- `scripts/scenarios/harness.test.ts` covers the runner's failure paths and the throwaway-home guard; it is a Vitest file (`vp test run scripts/scenarios/harness.test.ts`) and needs the Playwright Chromium.
- Scenarios are not a CI gate. Until PRB.T-037 brings the sandbox (a server that stays up and runs saved scenarios by id), iterate with `--only <id>`.
