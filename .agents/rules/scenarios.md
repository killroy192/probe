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
- **Shared library.** Every reusable setup, UI step, wait and logging helper lives in the library ([below](#the-library)); add to it rather than writing a helper in a scenario file. A scenario file holds only its own steps and assertions.
- **Direct setup.** A scenario builds its world over the server API unless the UI path is its subject ([coverage map](#direct-setup-and-the-coverage-map)).

## Writing

- **Pointer only.** Scenarios get a `PointerPage`, with no `keyboard`. Typing into a terminal or a text field is fine; keyboard shortcuts are not.
- **Throwaway state.** In the suite each scenario gets its own throwaway home, server and browser context; on a sandbox it shares the sandbox's, so it puts `runId` (new every run) into each workspace name and folder it makes. The runner refuses real data and any server address ([AGENTS.md rule 2](../../AGENTS.md#the-three-ways-to-hurt-yourself)). Never add a path to real data or a remote server.
- **Isolated shell.** Scenario shells run zsh or bash with the harness's plain startup files and git config. How a developer's own shell config affects behavior or timing is not the suite's concern.
- **Mock agent.** Shells run `scripts/mock-agent/mock-agent.ts`, never a real agent CLI; each throwaway home is seeded with it as the "mock agent" starting script.
- **Ending a shell from outside** the app means killing the `pid` the shell list reports.
- **Raw output.** A check on what a shell printed (prompt marks, the order of the prompt, the command and the agent) reads `server.rawOutput(shellId)`, never page frames: a page that attached late misses the start, and attach snapshots carry no marks.
- **Root.** A check that relies on file permissions runs through `unlessRoot`, so it is skipped with a reason as root instead of passing vacuously.
- **`check()` messages** are evaluated even when the check passes, so never `await` a locator inside one.

## The library

The library is `scripts/scenarios/lib/`, one module per concern and no index module: a scenario imports the module it needs. It knows no particular scenario and imports nothing from `scenarios/`, `selftest/`, the runner or the registry. Runner infrastructure (the server handle, the sandbox, cleanup, the bundle, the browser launch) stays at the top of `scripts/scenarios/`.

- `lib/setup.ts` builds a world over the server API: folders and git repos (optionally with a linked worktree) in the throwaway home, workspaces, projects, and shells (plain or with a starting script; in the project's checkout, a fork with a name the caller gives, or an existing worktree; at a given size), the remove steps (kill a shell, remove a project, remove a workspace), and the sandbox's named fixtures. A one-call form builds a workspace with its projects and shells and, when asked, opens a signed-in page and shows the workspace on it last.
- `lib/navigate.ts` brings a page to a workspace the way a user does (the "Workspaces" menu, from the start screen or another workspace), opens a shell's tab from its tree row, and reloads or restarts after the layout is saved.
- `lib/ui/` holds one file per UI action family, with its pointer steps and locators: the Workspaces menu and create dialog, the Add project dialog, the "+" modal (worktree choices, script dropdown, start), the tree (rows, kill with confirmation, Restore, project remove), tabs, the terminal panel, and alerts and dialogs.
- `lib/shells.ts` follows the shell list and a shell's output, reads history, writes a line over the API, waits for the mock agent's banner or leaves it, and checks that a shell's processes ended. `lib/serverLog.ts` waits for server log entries.
- `lib/waits.ts` and `lib/deadlines.ts` are the waits and their one deadline source ([Waiting](#waiting)). `lib/trail.ts` keeps a run's stages, setup record and artifacts. `lib/api.ts` is the API connection, `lib/network.ts` records what a page received over its websockets, `lib/seam.ts` saves a second server in the browser, `lib/files.ts` holds git and starting-scripts file steps, and `lib/report.ts` holds the root skip and redaction.

**Composing.** Each setup step builds one precondition from what it is given (the server, a page, or an earlier step's result) and returns what it made as a value tagged with its kind: folder, repo, workspace, project, shell, world or page, with the names, paths, shell ids and pids, the page and the shell-list follower. A step that takes an earlier result uses the one it is handed or builds its own, and fails naming both kinds when it is handed the wrong one. Nothing carries between scenarios through the library.

- **No collisions.** Workspace names and folders carry the run id and a counter, so the same setup twice on one server makes distinct names; the library never assumes an empty server. A scenario that needs a pristine server states it in its `needs`.
- **What stays.** What a setup made stays on the server until the server goes; the library does not clean up. The setup connection closes when the scenario ends.
- **Signing in.** Setup signs in as the page when it has one, and otherwise with a bearer token minted once per server.
- **Setup record.** Every setup call is recorded with what it asked for and what it got (never auth data). A failed call fails the current stage with a message naming the call and the server's reason.

## Direct setup and the coverage map

A scenario creates its workspaces, adds its projects and starts its shells over the API, then brings the page to the workspace and opens each tab it needs from the tree by a click: a shell started over the API gets no tab of its own. The UI path stays only where it is the subject, and each action family has one owner. A new scenario does not repeat a path another scenario owns.

| Action family                                                                                 | Owner                                                                 |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Create a workspace by the Workspaces menu and by the start screen's button                    | S1 (from an empty server)                                             |
| Add a project (import, create a new folder, refusals)                                         | S2 (from a workspace with no project)                                 |
| Import a linked worktree through the Add project dialog, and its notice                       | S3, stage AC-29                                                       |
| Start from the "+" modal, with worktree choices, the double click and the grid size (S2 AC-6) | S2 and S3 (every S3 start)                                            |
| The starting-script dropdown and starts through it                                            | E2-S1, E2-S3, E2-S4, S2's agent stages                                |
| The modal's remembered choice                                                                 | S3; S7's last start in its workspace before the restart (stage AC-31) |
| Kill from the tree with a confirmation, and cancel                                            | S6                                                                    |
| Restore an ended shell                                                                        | S8                                                                    |
| Open and remove a workspace by the Workspaces menu                                            | S7 (and S6's own workspace removal)                                   |
| Remove a project by its row's hover action and a confirmation                                 | S6                                                                    |
| Close a tab                                                                                   | S5, and S4 and S7 where closing is their subject                      |

- **Plain shells.** A scenario that needs a plain shell starts one over the API with no starting script; the server types nothing into it, and setup returns once the shell list reports it at its first prompt. It does not leave a mock agent to get one.
- **Remembered choice.** The page updates its copy of a project's last start only for starts it made, so a stage that asserts the remembered choice starts the shell it compares against through the modal.
- **Mock agent stages** (S2's, E2-S1, E2-S3) start the agent through the modal and wait for its banner.

## Waiting

- Wait by subscribing to the event that marks the milestone (a locator, a terminal frame after a `mark()` taken before the action, a shell-list change, a log line, a process `exit`), raced against a deadline from `lib/deadlines.ts`. A missed wait fails naming what was awaited, the offset it waited from where it has one, and the deadline; a page wait goes through the library's locator wait so its failure names the milestone, not the locator. The library's waits do this.
- **No deadline of your own.** A scenario or self-test file never passes a number as a deadline; it uses the library's (self-tests have a short one for a wait that must fail).
- **Before typing into a shell**, wait until the page shows its tab attached and the shell at its first prompt: the tab panel's `data-shell-ready="ready"` and, inside it, `data-terminal-attached="yes"`, hidden tabs included. The library's typing wait does this and fails at once when the shell ends. "Back at a prompt" after a command has no page state: wait for the next prompt mark in the shell's output after a `mark()`.
- **Before a reload or a server stop** that follows a tab change, wait until the page shows the layout saved (`data-layout-save="saved"` on the workspace screen); the library's reload and restart waits do it. To make a save slow on purpose, hold its request back from the test's side, never with a hook in product code.
- **After ending a shell the server owns** (a kill, or a signal from outside), wait for its end event, its removal or its ended entry, then check the pid once. The server sends the removal after the process ended, or after a 1 s wait the process outlived, which that one check then reports.
- A bounded check loop is allowed only where no event exists to subscribe to: processes the server does not own, such as a shell's background jobs or shells whose shell host was stopped.
- The test wait lint rules also run on every file here; a `.perf.ts` file may read the clock but not sleep or poll. A suppression states its reason in one of these forms; a fixed sleep that waits and hopes is fixed, never suppressed:
  - `permanent (a): …` runner bookkeeping that waits for nothing (printed timing, timestamps);
  - `permanent (b): …` a deadline raced against the event it names;
  - `permanent (c): …` a bounded check loop, naming the missing event;
  - `temporary: PRB.T-0NN …` code a named PRB.E-005 story removes.

## Failures and reruns

- A failure must be readable from its first run: it names the scenario, the stage, what was expected and what was found. Mark each step of a scenario as a named stage on its trail (`lib/trail.ts`); code outside every stage is in the stage `setup`, and the failure reads `at stage "<stage>": <cause>`.
- **Artifacts**, in the folder the `FAIL` line prints, each piece saved on its own (a piece that cannot be saved is named, and the original error is still the one reported):
  - `error.txt`;
  - per page, labelled `page-<n>-<label>`: a screenshot and its browser console (console messages and page errors);
  - per server, labelled by server (the scenario's, `second-server`): its debug log from the failing stage's start (`<label>.stage.log`) and from when the scenario started using it (`<label>.log`);
  - `setup.json`, what each setup call asked for and got;
  - `recorders.json`, the last values each recorder saw.
- **Debug logs.** Every server the harness starts (a scenario's, a second server, the sandbox's) runs at `--log-level debug` and also writes its whole log to `<home>/harness/server.log`. Artifacts mask tokens, websocket tickets, pairing fragments and cookie values; the log in the throwaway home is not masked. At teardown the runner prints one `scenarios: <id> <label> log=<KiB>KiB` line per server.
- Never rerun an unchanged scenario on unchanged code to get a pass, a reading or a diagnosis, perf scenarios included. Running again after changing the scenario or the code is normal. The one deliberate repeat is a determinism loop of N runs, only when an acceptance criterion asks for it.
- A cause that needed a rerun to find is a defect of the scenario: fix it there with more logging or a sharper assertion.
- Log enough to show the problem. Product code may gain log lines for that at debug level, which production does not print by default. No log line prints a token, pairing URL or cookie.

## The 20 s cap gate

Every atomic check scenario must finish under 20 s. That is a separate gate, never judged on a normal run: run it once after a scenario is implemented, and again only when the user asks, each time after the user confirms nothing in the background slows the machine.

## Registering a scenario

- Register it under an id in `registry.ts`; there is no other way to run one.
- State its `needs` in its own file. `{}` means it needs nothing from its server and is safe on a shared one: every workspace name and folder it makes carries `runId`, and it asserts only on what it made. Otherwise name what it needs: `restart`, `secondServer`, `pristineHome`, or `unshared: "<why>"` for anything else a shared server breaks (fixed names, server-wide state, matching every process). A scenario without `needs` is refused on a sandbox.

## The sandbox

A sandbox keeps one harness server up on a throwaway home so saved scenarios run against it without a cold start. It runs saved scenarios only.

- Start it in the background: `vp run scenarios:sandbox -- [--fixture workspace|shells] [--keep-home]`, and run on it once it prints `ready`.
- Run one scenario on it: `vp run test:scenarios -- --sandbox <pid> --only <id>`. The scenarios it accepts are the ones whose file states `needs: {}`.
- Stop it: `kill <pid>`, the pid it printed, never a pid found by pattern ([AGENTS.md rule 1](../../AGENTS.md#the-three-ways-to-hurt-yourself)).
- It prints one `sandbox: <key>=<value>` line per fact: `pid` first, then `home`, `origin` (loopback only), `server-pid`, `fixture` when seeded, `bundle`, `pairing-url` and `ready`, plus `shell-host-pid` when a shell host starts (before `ready` with the `shells` fixture, otherwise with a run's first shell). The pairing URL is a secret: open it in a browser to look, never write it to a file in the checkout.
- Fixtures, made by the library's setup over the server API: `workspace` (a workspace with one git project) and `shells` (the same with two running plain shells). Their names carry a run id too.
- A sandbox is not reset between runs: a scenario runs against whatever the fixture and earlier runs left, and must not depend on its absence.
- Refused before the sandbox is touched, with the reason: a script path or an unknown id given to `--only`; a scenario that needs a restart, a second server or an empty home, is `unshared`, or states no needs; a second run while one runs; a run after a web, server, package or sandbox harness source changed, or the bundle was rebuilt, since the sandbox started (start a new one). Scenario files and their steps are loaded by each run, so changing them needs no new sandbox. A scenario that tries what it did not state fails naming it.
- Stopping it ends its server, shell host and shells and removes the home, unless it was started with `--keep-home`. A sandbox killed with SIGKILL is cleaned up by the next suite or sandbox start. A failure on it leaves artifacts as in the suite, outside the home.

## Running

- `vp run test:scenarios` runs the suite and exits non-zero when a scenario fails; `-- --only <id>` runs one scenario.
- `-- --selftest` runs the harness self-tests `T1`, `T2`, `T4`, `T10` (two setups on one server) and `T11` (a page reaches an API-made workspace from the start screen and from another workspace). `-- --selftest --only <id>` runs one of `T3`, `T5` (tries needs it did not state), `T6` (names what it makes by its run), `T7` to `T9` (each signal wait fails naming what it awaited), `T12` (a setup call fails in setup), `T13` (a workspace is not shown), `T14` (a wait fails naming what it awaited, its offset and the deadline) or `T15` (labelled artifacts from two pages and a second server). `T2`, `T5`, `T6`, `T8` to `T14` also run on a sandbox. `T2`, `T3`, `T5`, `T12`, `T13` and `T15` fail on purpose, so they exit non-zero.
- Chromium is the web browser tests' Playwright Chromium: `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium` once, or `--browser <path>`.
- The web bundle is rebuilt when an input is newer than `apps/web/dist`; `--rebuild` forces it.
- `scripts/scenarios/harness.test.ts` (Vitest) covers the runner's failure paths and the throwaway-home guard; `sandbox.test.ts` covers the sandbox.
- Scenarios are not a CI gate, and a run does not disturb a running dev server.

## Until later stories land

Each line goes when its story lands.

- No sets, composed scenarios, `.perf.ts` support or cap gate command yet (PRB.T-043): each scenario runs alone under its id; add no new timing to a check scenario (the existing `metric()` calls stay until then); the cap gate is one `--only <id>` run after the user's confirmation, reading the time on its `PASS` line.
- No serial perf run or N-run loop command yet (PRB.T-040).
