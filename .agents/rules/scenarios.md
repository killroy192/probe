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
- **Throwaway state.** In the suite each scenario gets its own throwaway home, server and browser context; on a sandbox it shares the sandbox's, so it puts `runId` (new every run) into each workspace name and folder it makes. The runner refuses real data and any server address ([AGENTS.md rule 2](../../AGENTS.md#the-three-ways-to-hurt-yourself)). Never add a path to real data or a remote server.
- **Isolated shell.** Scenario shells run zsh or bash with the harness's plain startup files and git config. How a developer's own shell config affects behavior or timing is not the suite's concern.
- **Mock agent.** Shells run `scripts/mock-agent/mock-agent.ts`, never a real agent CLI; each throwaway home is seeded with it as the "mock agent" starting script.
- **Ending a shell from outside** the app means killing the `pid` the shell list reports.
- **Raw output.** A check on what a shell printed (prompt marks, the order of the prompt, the command and the agent) reads `server.rawOutput(shellId)`, never page frames: a page that attached late misses the start, and attach snapshots carry no marks.
- **Root.** A check that relies on file permissions runs through `unlessRoot`, so it is skipped with a reason as root instead of passing vacuously.
- **`check()` messages** are evaluated even when the check passes, so never `await` a locator inside one.

## Waiting

- Wait by subscribing to the event that marks the milestone (a locator, a terminal frame after a `mark()` taken before the action, a log line, a process `exit`), raced against a deadline whose failure names what was awaited. The library's waits do this.
- **Before typing into a shell**, wait until the page shows its tab attached and the shell at its first prompt: the tab panel's `data-shell-ready="ready"` and, inside it, `data-terminal-attached="yes"`, hidden tabs included. `typeLine` does this through `shellReady`, which fails at once when the shell ends. "Back at a prompt" after a command has no page state: wait for the next prompt mark in the shell's output after a `mark()`, as `leaveAgent` does.
- **Before a reload or a server stop** that follows a tab change, wait until the page shows the layout saved (`data-layout-save="saved"` on the workspace screen) with `layoutSaved`; `reloadShowing` and `restartAndReload` do it. `frameHolder` holds a request back from the test's side, to make a save slow on purpose.
- **After ending a shell the server owns** (a kill, or a signal from outside), wait for its end event, its removal or its ended entry, then check the pid once: `shellEnded`. The server sends the removal only after the process ended.
- A bounded check loop is allowed only where no event exists to subscribe to: processes the server does not own, such as a shell's background jobs or shells whose shell host was stopped (`gone`, `survivors`).
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

## Registering a scenario

- Register it under an id in `registry.ts`; there is no other way to run one.
- State its `needs` in its own file. `{}` means it needs nothing from its server and is safe on a shared one: every workspace name and folder it makes carries `runId`, and it asserts only on what it made. Otherwise name what it needs: `restart`, `secondServer`, `pristineHome`, or `unshared: "<why>"` for anything else a shared server breaks (fixed names, server-wide state, matching every process). A scenario without `needs` is refused on a sandbox.

## The sandbox

A sandbox keeps one harness server up on a throwaway home so saved scenarios run against it without a cold start. It runs saved scenarios only.

- Start it in the background: `vp run scenarios:sandbox -- [--fixture workspace|shells] [--keep-home]`, and run on it once it prints `ready`.
- Run one scenario on it: `vp run test:scenarios -- --sandbox <pid> --only <id>`. The scenarios it accepts are the ones whose file states `needs: {}`.
- Stop it: `kill <pid>`, the pid it printed, never a pid found by pattern ([AGENTS.md rule 1](../../AGENTS.md#the-three-ways-to-hurt-yourself)).
- It prints one `sandbox: <key>=<value>` line per fact: `pid` first, then `home`, `origin` (loopback only), `server-pid`, `fixture` when seeded, `bundle`, `pairing-url` and `ready`, plus `shell-host-pid` when a shell host starts (before `ready` with the `shells` fixture, otherwise with a run's first shell). The pairing URL is a secret: open it in a browser to look, never write it to a file in the checkout.
- Fixtures, made over the server API: `workspace` (a workspace with one git project) and `shells` (the same with two running plain shells). Their names carry a run id too.
- A sandbox is not reset between runs: a scenario runs against whatever the fixture and earlier runs left, and must not depend on its absence.
- Refused before the sandbox is touched, with the reason: a script path or an unknown id given to `--only`; a scenario that needs a restart, a second server or an empty home, is `unshared`, or states no needs; a second run while one runs; a run after a web, server, package or sandbox harness source changed, or the bundle was rebuilt, since the sandbox started (start a new one). Scenario files and their steps are loaded by each run, so changing them needs no new sandbox. A scenario that tries what it did not state fails naming it.
- Stopping it ends its server, shell host and shells and removes the home, unless it was started with `--keep-home`. A sandbox killed with SIGKILL is cleaned up by the next suite or sandbox start. A failure on it leaves artifacts as in the suite, outside the home.

## Running

- `vp run test:scenarios` runs the suite and exits non-zero when a scenario fails; `-- --only <id>` runs one scenario.
- `-- --selftest` runs the harness self-tests `T1`, `T2`, `T4` and `T7` to `T9`; `-- --selftest --only T3` runs `T3`; `T5` (tries needs it did not state) and `T6` (names what it makes by its run) run the same way or on a sandbox. `T2`, `T3` and `T5` fail on purpose, so they exit non-zero.
- Chromium is the web browser tests' Playwright Chromium: `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium` once, or `--browser <path>`.
- The web bundle is rebuilt when an input is newer than `apps/web/dist`; `--rebuild` forces it.
- `scripts/scenarios/harness.test.ts` (Vitest) covers the runner's failure paths and the throwaway-home guard; `sandbox.test.ts` covers the sandbox.
- Scenarios are not a CI gate, and a run does not disturb a running dev server.

## Until later stories land

Each line goes when its story lands.

- No single library or direct setup yet (PRB.T-038): the helpers are spread over `support.ts`, `fixtures.ts`, `browser.ts`, `rpc.ts`, `seam.ts` and `scenarios/workspaceUi.ts`; setting up by clicking through dialogs is allowed. Scenario servers log at info level, and artifacts have no browser console.
- No sets, composed scenarios, `.perf.ts` support or cap gate command yet (PRB.T-043): each scenario runs alone under its id; add no new timing to a check scenario (the existing `metric()` calls stay until then); the cap gate is one `--only <id>` run after the user's confirmation, reading the time on its `PASS` line.
- No serial perf run or N-run loop command yet (PRB.T-040).
