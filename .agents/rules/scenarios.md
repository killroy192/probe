---
paths:
  - "scripts/scenarios/**"
  - "scripts/mock-agent/**"
---

# Scenario rules

The scenario-specific rules for writing and running scenarios live only here. The general test rules (what to test, waiting for work, no sleeps, polling or clock deltas, flaky tests are fixed, the lint rules that enforce them) are in [AGENTS.md "Verifying"](../../AGENTS.md#verifying) and apply to scenarios too. These rules bind every new or changed scenario now; the existing ones are converted in PRB.T-039, so an old scenario that breaks one (S2 both checks and measures) is not a pattern to copy. A story that changes the harness updates this file in the same change.

A scenario (`scripts/scenarios/scenarios/`) starts a real Probe server on a throwaway home and drives the built web app in headless Chromium. A Node runner owns the server process and uses Playwright as a library, because Vitest browser mode runs test code inside the page and cannot stop or restart a real server.

## Shape

- **Check or perf.** A check scenario asserts behavior and never records a duration. A perf scenario measures and asserts only its own budget, in a file named `<scenario>.perf.ts`. No scenario is both. A perf budget is one a single isolated perf run meets every time: set it with headroom over the value seen, never as a median or best of several runs.
- **One purpose.** A scenario checks one behavior and fails naming it; it sets up its own state instead of relying on what another scenario left. Bigger flows are composed from atomic scenarios.
- **Saved, never throwaway.** Every scripted check that drives a harness or sandbox server is a saved scenario, registered under an id in `registry.ts`; harness self-tests go in `selftest/`. Do not write a one-off driver script or offer evidence from one; register the scenario first and iterate on it. The manual checks AGENTS.md asks for (a `test-t3-app` pass, before/after captures, a runtime transcript) are not scripted scenarios and are unaffected.
- **Shared library.** Use the helpers in the library modules; add to one rather than writing a helper in a scenario file. A scenario file holds only its own steps and assertions.

## Writing

- **Pointer only.** Scenarios get a `PointerPage`, with no `keyboard`. Typing into a terminal or a text field is fine; keyboard shortcuts are not.
- **Throwaway state.** Each scenario gets its own throwaway home, server and browser context, and the runner refuses real data and any server address ([AGENTS.md rule 2](../../AGENTS.md#the-three-ways-to-hurt-yourself)). Never add a path to real data or a remote server.
- **Isolated shell.** Scenario shells run zsh or bash with the harness's plain startup files and git config. How a developer's own shell config affects behavior or timing is not the suite's concern.
- **Mock agent.** Shells run `scripts/mock-agent/mock-agent.ts`, never a real agent CLI; each throwaway home is seeded with it as the "mock agent" starting script.
- **Ending a shell from outside** the app means killing the `pid` the shell list reports.
- **Root.** A check that relies on file permissions runs through `unlessRoot`, so it is skipped with a reason as root instead of passing vacuously.
- **`check()` messages** are evaluated even when the check passes, so never `await` a locator inside one.

## Waiting

- Wait by subscribing to the event that marks the milestone (a locator, a terminal frame after a `mark()` taken before the action, a log line, a process `exit`), raced against a deadline whose failure names what was awaited. The library's waits do this.
- A bounded check loop is allowed only where no event exists to subscribe to, such as the end of a process the harness did not start as its own child.
- The test wait lint rules also run on every file here; a `.perf.ts` file may read the clock but not sleep or poll. A suppression states its reason in one of these forms; a fixed sleep that waits and hopes is fixed, never suppressed:
  - `permanent (a): …` runner bookkeeping that waits for nothing (printed timing, timestamps);
  - `permanent (b): …` a deadline raced against the event it names;
  - `permanent (c): …` a bounded check loop, naming the missing event;
  - `temporary: PRB.T-0NN …` code a named PRB.E-005 story removes.

## Failures and reruns

- A failure must be readable from its first run: it names the scenario, the stage, what was expected and what was found, and leaves artifacts (screenshot, server log tail, last recorded values) in the folder the `FAIL` line prints.
- Never rerun an unchanged scenario on unchanged code to get a pass, a reading or a diagnosis, perf scenarios included. Running again after changing the scenario or the code is normal. The one deliberate repeat is a determinism loop of N runs, only when an acceptance criterion asks for it.
- A cause that needed a rerun to find is a defect of the scenario: fix it there with more logging or a sharper assertion.
- Log enough to show the problem. Product code may gain log lines for that at debug level, which production does not print by default. No log line prints a token, pairing URL or cookie.

## The 15 s cap gate

Every atomic check scenario must finish under 15 s. That is a separate gate, never judged on a normal run: run it once after a scenario is implemented, and again only when the user asks, each time after the user confirms nothing in the background slows the machine.

## Running

- `vp run test:scenarios` runs the suite and exits non-zero when a scenario fails; `-- --only <id>` runs one scenario.
- `-- --selftest` runs the harness self-tests `T1`, `T2`, `T4`; `-- --selftest --only T3` runs `T3`. `T2` and `T3` fail on purpose, so both exit non-zero.
- Chromium is the web browser tests' Playwright Chromium: `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium` once, or `--browser <path>`.
- The web bundle is rebuilt when an input is newer than `apps/web/dist`; `--rebuild` forces it.
- `scripts/scenarios/harness.test.ts` (Vitest) covers the runner's failure paths and the throwaway-home guard.
- Scenarios are not a CI gate, and a run does not disturb a running dev server.

## Until later stories land

Each line goes when its story lands.

- No sandbox yet (PRB.T-037): iterate on a registered scenario with `--only <id>`.
- No single library or direct setup yet (PRB.T-038): the helpers are spread over `support.ts`, `fixtures.ts`, `browser.ts`, `rpc.ts`, `seam.ts` and `scenarios/workspaceUi.ts`; setting up by clicking through dialogs is allowed. Scenario servers log at info level, and artifacts have no browser console.
- No sets, composed scenarios, `.perf.ts` support or cap gate command yet (PRB.T-043): each scenario runs alone under its id; add no new timing to a check scenario (the existing `metric()` calls stay until then); the cap gate is one `--only <id>` run after the user's confirmation, reading the time on its `PASS` line.
- No serial perf run or N-run loop command yet (PRB.T-040).
- No prompt-ready, layout-saved or shell-ended signals yet (PRB.T-041): wait for the prompt mark in terminal frames, for the server's state, or with `gone()`; never type into a terminal or reload on a guess.
