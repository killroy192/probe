---
paths:
  - "scripts/scenarios/**"
  - "scripts/mock-agent/**"
---

# Scenario rules

The scenario-specific rules for writing and running scenarios live only here. The general test rules (what to test, waiting for work, no sleeps, polling or clock deltas, flaky tests are fixed, the lint rules that enforce them) are in [AGENTS.md "Verifying"](../../AGENTS.md#verifying) and apply to scenarios too. These rules bind every scenario. A story that changes the harness updates this file in the same change.

A scenario (`scripts/scenarios/scenarios/`) drives the built web app in headless Chromium against a real Probe server on a throwaway home. Scenarios run on Playwright Test, but the harness, not the test runner, starts and stops every server, because a scenario must be able to stop and restart a real one; Vitest browser mode runs test code inside the page and cannot.

## Shape

- **Check or perf.** Every scenario is one kind, never both ([Kinds](#kinds)).
- **Atomic.** A check scenario checks one behavior and fails naming it. It holds several criteria only when they follow from one action (one reload, one restart, one refused start), and says why in a one-line comment above its `covers`. It sets up its own state instead of relying on what another scenario left. Bigger flows are composed from atomic scenarios ([Sets and composed scenarios](#sets-and-composed-scenarios)).
- **Ids.** A check that came from a long scenario is `<old id>.<part>`, the part in kebab case (`S7.survive-restart`); a composed scenario is `composed.<name>`, a perf scenario `perf-<name>`, a self-test `T<n>` and a self-test set `T-<name>`. A new check outside those families takes its story's id the same way.
- **What it leaves behind.** A scenario does not clean up at its end: what it made stays on the server. It never counts, kills or removes what it did not make or was not handed: counts are scoped to its own workspace, projects or shell ids, and a process is found by its exact command line, never a pattern another run's processes could match. It asserts an absence only after the event that settles it (a row detached, a list change after a mark, a present row after a reload), never on one early sample. A change beyond its own names and folders is undone at step end ([below](#sets-and-composed-scenarios)).
- **Saved, never throwaway.** Every scripted check that drives a harness or sandbox server is a saved scenario, registered under an id in `registry.ts`; harness self-tests go in `selftest/`. Do not write a one-off driver script or offer evidence from one; register the scenario first and iterate on it. The manual checks AGENTS.md asks for (a `test-t3-app` pass, before/after captures, a runtime transcript) are not scripted scenarios and are unaffected.
- **Shared library.** Every reusable setup, UI step, wait and logging helper lives in the library ([below](#the-library)); add to it rather than writing a helper in a scenario file. A scenario file holds only its own steps and assertions.
- **Direct setup.** A scenario builds its world over the server API unless the UI path is its subject ([coverage map](#direct-setup-and-the-coverage-map)).

## Kinds

- **Check.** A check scenario asserts behavior and never records a duration: its file reads no clock and declares no measure.
- **Perf.** A perf scenario, id `perf-<name>`, lives in a file named `<name>.perf.ts`, measures one value and asserts nothing itself: it declares one measure with its limit and the criterion that sets it (`PRB.T-004 AC-3`), and the harness judges the value it returns, failing on a miss with the measure, the value and the limit. A product limit is used as written and never changed to make a run pass; a miss goes to the ticket that owns it. A budget a story sets itself is one a single isolated perf run meets every time: set it with headroom over the value seen, never as a median or best of several runs.
- **Where perf runs.** Only in the serial perf run. The default suite, every set, the cap gate and the sandbox never run a perf scenario, and naming one there is refused, saying so.
- **Mixes are refused** when the registry loads, before anything runs, naming the scenario and the mix: a check file that reads the clock or declares a measure, a perf file that asserts, or declares other than one measure with its limit and owner, and a file name that does not match its kind.

## Writing

- **Pointer only.** Scenarios get a page with no keyboard; using it fails the typecheck. Typing into a terminal or a text field is fine; keyboard shortcuts are not.
- **Throwaway state.** Each scenario gets its own browser context. Its server and throwaway home are shared with the other scenarios on its worker, or on a sandbox with every run there, unless its needs ask for a fresh one ([The runner](#the-runner)), so it puts its run id (new every run) into each workspace name and folder it makes. The runner refuses real data and any server address ([AGENTS.md rule 2](../../AGENTS.md#the-three-ways-to-hurt-yourself)). Never add a path to real data or a remote server.
- **Isolated shell.** Scenario shells run zsh or bash with the harness's plain startup files and git config. How a developer's own shell config affects behavior or timing is not the suite's concern.
- **Mock agent.** Shells run `scripts/mock-agent/mock-agent.ts`, never a real agent CLI; each throwaway home is seeded with it as the "mock agent" starting script.
- **Ending a shell from outside** the app means killing the `pid` the shell list reports.
- **A lost shell host.** To leave shells `lost`, stop the server, then the shell host, then start the server. A host stopped under a running server ends its shells as `signal`, not `lost`. The library's restart does it in that order when asked for a lost host.
- **Raw output.** A check on what a shell printed (prompt marks, the order of the prompt, the command and the agent) reads the server's raw output of that shell, never page frames: a page that attached late misses the start, and attach snapshots carry no marks.
- **Root.** A check that relies on file permissions runs through the library's root skip, so it prints a `SKIP` line with the reason as root instead of passing vacuously.

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

| Action family                                                                                 | Owner                                                          |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Create a workspace by the Workspaces menu and by the start screen's button                    | S1 (from an empty server)                                      |
| Add a project (import, create a new folder, refusals)                                         | S2 (from a workspace with no project)                          |
| Import a linked worktree through the Add project dialog, and its notice                       | S3.import-linked                                               |
| Start from the "+" modal, with worktree choices, the double click and the grid size (S2 AC-6) | S2 and S3 (every S3 start)                                     |
| The starting-script dropdown and starts through it                                            | E2-S1, E2-S3, E2-S4, S2.agent-echo                             |
| The modal's remembered choice                                                                 | S3; S7.survive-restart's last start before the restart (AC-31) |
| Kill from the tree with a confirmation, and cancel                                            | S6                                                             |
| Restore an ended shell                                                                        | S8                                                             |
| Open and remove a workspace by the Workspaces menu                                            | S7 (and S6's own workspace removal)                            |
| Remove a project by its row's hover action and a confirmation                                 | S6                                                             |
| Close a tab                                                                                   | S5, and S4 and S7 where closing is their subject               |

- **Plain shells.** A scenario that needs a plain shell starts one over the API with no starting script; the server types nothing into it, and setup returns once the shell list reports it at its first prompt. It does not leave a mock agent to get one.
- **Remembered choice.** The page updates its copy of a project's last start only for starts it made, so a stage that asserts the remembered choice starts the shell it compares against through the modal.
- **Mock agent stages** (S2's, E2-S1, E2-S3) start the agent through the modal and wait for its banner.

## Waiting

- Wait by subscribing to the event that marks the milestone (a locator, a terminal frame after a mark taken before the action, a shell-list change, a log line, a process `exit`), raced against a deadline from `lib/deadlines.ts`. A missed wait fails naming what was awaited, the offset it waited from where it has one, and the deadline; a page wait goes through the library's locator wait so its failure names the milestone, not the locator. The library's waits do this.
- **No deadline of your own.** A scenario or self-test file never passes a number as a deadline; it uses the library's (self-tests have a short one for a wait that must fail).
- **Before typing into a shell**, wait until the page shows its tab attached and the shell at its first prompt: the tab panel's `data-shell-ready="ready"` and, inside it, `data-terminal-attached="yes"`, hidden tabs included. The library's typing wait does this and fails at once when the shell ends. "Back at a prompt" after a command has no page state: wait for the next prompt mark in the shell's output after a mark taken before the command.
- **Before a reload or a server stop** that follows a tab change, wait until the page shows the layout saved (`data-layout-save="saved"` on the workspace screen); the library's reload and restart waits do it. To make a save slow on purpose, hold its request back from the test's side, never with a hook in product code.
- **After ending a shell the server owns** (a kill, or a signal from outside), wait for its end event, its removal or its ended entry, then check the pid once. The server sends the removal after the process ended, or after a 1 s wait the process outlived, which that one check then reports.
- A bounded check loop is allowed only where no event exists to subscribe to: processes the server does not own, such as a shell's background jobs or shells whose shell host was stopped.
- The test wait lint rules also run on every file here; a `.perf.ts` file may read the clock but not sleep or poll. A suppression states its reason in one of these forms; a fixed sleep that waits and hopes is fixed, never suppressed:
  - `permanent (a): …` runner bookkeeping that waits for nothing (printed timing, timestamps);
  - `permanent (b): …` a deadline raced against the event it names;
  - `permanent (c): …` a bounded check loop, naming the missing event;
  - `temporary: PRB.T-0NN …` code a named PRB.E-005 story removes.

## Sets and composed scenarios

- **Old ids are sets.** Each long scenario PRB.T-039 split (`S1` to `S8`, `T-002`, `R1`, `E2-S1`, `E2-S3`, `E2-S4`, `T-041a`) keeps its id as a set name, so `--only S7` runs every check that covers an S7 criterion. The members come from each check's `covers`, never from a hand-kept list; a check is a member because it covers one of the old id's criteria. `T-041b` and `T-041c` were atomic already and keep their ids as checks. The set `shared` holds every check a sandbox accepts.
- **Sets.** A set is a named list, in `registry.ts`, of check or composed scenarios. Running it runs exactly its members, each as it would run alone. A set names no perf scenario and no other set, ids and set names share one namespace, and a `T-` name is a self-test set. The registry is refused at load when a set names an unknown id, a perf scenario or a set, or has the name of an id.
- **Composed scenarios.** A composed scenario is a saved check made of atomic check scenarios as steps, in order, on one server, under the union of its steps' needs. A step states the kind of value it takes and the kind it returns (a workspace, a shell, a world, a shell with its tab closed). The composed scenario hands a step the value an earlier step returned; the step uses it and builds the rest itself, and run alone it builds everything itself. Each step gets its own run id, so a scenario used twice makes distinct names. Refused at load: a step that is not an atomic check, an input from a step that is not earlier, an input of the wrong kind (naming the step, what it takes and what the other returns), and two steps under different conditions.
- **Composed output.** A pass prints `(composed, <n> steps, <t>)` and one time line per step. A failure names the composed scenario, the failing step, its stage, expected and found, and lists each later step as `not run: step <n> <id>`; the later steps do not run. Artifacts go under `<id>/step-<n>-<stepId>`. A composed scenario is not timed against the cap; its steps are.
- **Undone in the step.** A change a step makes beyond its own workspaces and folders (a file or folder made unwritable, a shell or follower it must end) is registered as an undo where it is made. The undos run in reverse order when the step ends, pass or fail, and the run prints `undone: <what>` for each. Take write access away only through the library's file step, which registers its undo.

## Failures and reruns

- A failure must be readable from its first run: it names the scenario, the stage, what was expected and what was found. Mark each step of a scenario as a named stage on its trail (`lib/trail.ts`); code outside every stage is in the stage `setup`, and the failure reads `at stage "<stage>": <cause>`.
- **Artifacts**, in the folder the `FAIL` line prints, each piece saved on its own (a piece that cannot be saved is named, and the original error is still the one reported):
  - `error.txt`;
  - per page, labelled `page-<n>-<label>`: a screenshot and its browser console (console messages and page errors);
  - per browser context, `trace-<n>.zip`, its Playwright trace (open it with `scripts/node_modules/.bin/playwright show-trace <file>`); a passing scenario keeps no trace;
  - per server, labelled by server (the scenario's, `second-server`): its debug log from the failing stage's start (`<label>.stage.log`) and from when the scenario started using it (`<label>.log`);
  - `setup.json`, what each setup call asked for and got;
  - `recorders.json`, the last values each recorder saw.
- **Debug logs.** Every server the harness starts (a shared one, a fresh one, a second server, the sandbox's) runs at `--log-level debug` and also writes its whole log to `<home>/harness/server.log`; a shared server's whole log is also kept in the run's `servers/w<worker>-<n>.log`. Artifacts mask tokens, websocket tickets, pairing fragments and cookie values; the logs in the throwaway home and in `servers/` are not masked. At teardown each scenario prints one `scenarios: <id> <label> log=<KiB>KiB` line per server it used.
- Never rerun an unchanged scenario on unchanged code to get a pass, a reading or a diagnosis, perf scenarios included. Running again after changing the scenario or the code is normal. The one deliberate repeat is a determinism loop of N runs, only when an acceptance criterion asks for it.
- A cause that needed a rerun to find is a defect of the scenario: fix it there with more logging or a sharper assertion.
- Log enough to show the problem. Product code may gain log lines for that at debug level, which production does not print by default. No log line prints a token, pairing URL or cookie.

## The 20 s cap gate

Every atomic check scenario must finish under 20 s. That is a separate gate, never judged on a normal run, which prints times and never compares them to the cap: run it once after a scenario is implemented, and again only when the user asks.

- **Command.** `vp run scenarios:gate -- [--only <name>]... --quiet-confirmed` times each chosen atomic check once, serially, on one worker. `--only` repeats; with none, the gate times every atomic check in the suite.
- **Confirmation first.** Add `--quiet-confirmed` only after the user confirms nothing in the background slows the machine. Without it the gate times nothing and says to ask the user.
- **Server start.** The time includes the scenario's own server start only when it needs a fresh server (a restart, an empty home, server-wide state, a condition); otherwise the shared server's start is left out. Each `GATE PASS|FAIL <id> <t> s (server start excluded|included), cap 20 s` line says which.
- **What it times.** Given a set, it times the set's atomic members and lists each composed member as `NOT TIMED <id>`. A perf or composed scenario named directly is refused, naming why. It does not run on a sandbox.

## Registering a scenario

- Register it under an id in `registry.ts`; there is no other way to run one.
- State its `needs` in its own file. `{}` means it needs nothing from its server and is safe on a shared one: every workspace name and folder it makes carries its run id, and it asserts only on what it made. Otherwise name what it needs:
  - `restart`, `secondServer`, `pristineHome`;
  - `serverWide: "<why>"` when it changes or depends on state every scenario on its server sees (the starting-script list, the server's own state folders, the server process itself);
  - `condition` when its server must start under a condition (an environment variable, a faulty git config): a reason and the variables for the server's home. A condition is met by starting a server under it, never by restarting into it.
- A scenario that needs a restart, an empty home, server-wide state or a condition gets a server of its own; `secondServer` alone does not ([The runner](#the-runner)). The sandbox refuses the same scenarios, plus `secondServer`.
- A self-test that must run on a shared server but would break one others share (`T32` SIGKILLs it) states `needs: {}` and says why in `offSandbox`; the sandbox refuses it with that reason.
- A check that is not a self-test lists the criteria it proves in `covers`, as `"S7 AC-6"`. The sets of the old ids are derived from it, and a registry test fails when a criterion of an old id is covered by no check.

## The sandbox

A sandbox keeps one harness server up on a throwaway home so saved scenarios run against it without a cold start. It runs saved scenarios only.

- Start it in the background: `vp run scenarios:sandbox -- [--fixture workspace|shells] [--keep-home]`, and run on it once it prints `ready`.
- Run on it: `vp run test:scenarios -- --sandbox <pid> --only <name>`, where the name is an id, a set or a composed scenario; `--only` repeats. The run goes through the same launcher, on one worker, with no bundle build and no server start: its scenarios use the sandbox's server, and a sandbox that stops mid-run fails the scenario running, saying so. It accepts a scenario whose file states `needs: {}`, and a set or composed scenario only when every member or step does.
- Stop it: `kill <pid>`, the pid it printed, never a pid found by pattern ([AGENTS.md rule 1](../../AGENTS.md#the-three-ways-to-hurt-yourself)).
- It prints one `sandbox: <key>=<value>` line per fact: `pid` first, then `home`, `origin` (loopback only), `server-pid`, `fixture` when seeded, `bundle`, `pairing-url` and `ready`, plus `shell-host-pid` when a shell host starts (before `ready` with the `shells` fixture, otherwise with a run's first shell). The pairing URL is a secret: open it in a browser to look, never write it to a file in the checkout.
- Fixtures, made by the library's setup over the server API: `workspace` (a workspace with one git project) and `shells` (the same with two running plain shells). Their names carry a run id too.
- A sandbox is not reset between runs: a scenario runs against whatever the fixture and earlier runs left, and must not depend on its absence.
- Refused before the sandbox is touched, with the reason: a script path or an unknown name given to `--only`; `--gate`, `--perf`, `--workers`, `--rebuild`, `--server-bin`, `--own-shell-config` or `--selftest`; a scenario that needs a restart, a second server, an empty home, server-wide state or a condition, or states no needs; a set or composed scenario with any such member or step (the whole run is refused, naming each refused member or step and its reason, so a set never runs in part); a perf scenario; a second run while one runs; a run after a web, server, package or sandbox harness source changed, or the bundle was rebuilt, since the sandbox started (start a new one). Scenario files and their steps are loaded by each run, so changing them needs no new sandbox. A scenario that tries what it did not state fails naming it.
- Stopping it ends its server, shell host and shells and removes the home, unless it was started with `--keep-home`. A sandbox killed with SIGKILL is cleaned up by the next run or sandbox start. A failure on it leaves artifacts as in the suite, outside the home.

## The runner

- **Launcher.** Every command runs `scripts/scenarios/cli.ts`, which does everything once per run before a worker starts: the guard and the arguments, the names, a sweep of leftovers, the web bundle (rebuilt when an input is newer than `apps/web/dist`; `--rebuild` forces it) and one Chromium launch, so a missing browser fails before any server starts. It then runs Playwright Test in its own process group. `suite.spec.ts` declares one test per chosen scenario; scenario and self-test files never import the test runner (lint refuses it).
- **Workers.** Scenarios run in parallel on half the cores, at least 1 and at most 4. `--workers <n>` sets the number, up to the core count. The cap gate, the perf run and a sandbox run use one worker.
- **Shared server.** Each worker starts one server on a throwaway home with the first scenario that needs one, and every scenario on that worker whose needs ask for no fresh server runs on it. A worker that gets only fresh-server scenarios starts none. A scenario may not stop, kill or restart the shared server or stop its shell host: the attempt fails, naming the need it did not state. What a scenario leaves stays until the worker ends, and each shared server prints `scenarios: server <pid>: <k> scenarios, <m> shells running` at teardown.
- **Fresh server.** A scenario that needs a restart, an empty home, server-wide state or a condition gets its own server, home and port, started inside its own timing and stopped when it ends; nothing else runs there.
- **After a failure** Playwright replaces the worker, so the next scenario there starts a new shared server: one cold start per failure. A shared server that ends during a scenario fails that scenario, naming the exit and its log; one that ended between scenarios is replaced.
- **Timeouts.** A page action or navigation fails after 10 s and a library wait after its deadline. The one test timeout is the configuration's 180 s hang ceiling; a scenario never sets a timeout of its own.
- **No retries, no repeats.** Retries are 0 and each chosen scenario runs once. `--retries`, `--repeat-each`, `--repeat` and every other Playwright flag are refused before anything starts. The N-run loop is the only command that repeats runs.
- **Ports.** Each harness server listens on a port leased in 20000–31999 through a lock file in `<tmp>/probe-scenario-ports/`, held for the server's life, restarts included; a lease whose owner died is taken over. If another process still takes the port, the start moves to a new lease, at most 3 times, printing `scenarios: port <p> was taken by another process; using <q>`. A scenario never picks a port.
- **Cleanup.** The launcher, each worker and each sandbox record the servers and homes they start in a manifest under `<tmp>/probe-scenario-runs/`, from before the spawn. The launcher sweeps by recorded pid and start time before the run and again after it, so a killed worker's servers go in the same run; the next run sweeps what a dead run left, and never touches a live run or a server it did not start. SIGINT, SIGTERM or SIGHUP to the launcher stops every worker through its teardown, and the run exits 130. Stop a run only through its launcher, never by killing a Playwright pid.
- **Two runs in one checkout** share the web bundle: a run that would rebuild it while another live run serves it is refused, naming that run.
- **Artifacts** go to `<tmp>/probe-scenario-artifacts/<start>-<launcher pid>/`, or `--artifacts <dir>`: a folder per failed scenario ([Failures and reruns](#failures-and-reruns)), `servers/` with each shared server's whole log, `results.json` with each scenario's outcome and time, and the run plan. A `--selftest` run puts its perf self-tests under `perf/`.

## Running

- `vp run test:scenarios` runs every check and composed scenario, never a perf scenario or a self-test, and exits non-zero when one fails. `-- --only <name>` runs an id, a set or a composed scenario, and repeats; a name that matches nothing is refused. `-- --workers <n>` sets the workers.
- Each scenario prints, in the order they finish, `PASS    <id> <title> (<s> s, teardown <ms> ms)` or `FAIL    <id> <title> (…): <reason>` with its artifacts folder; `SKIP` lines pass through. The summary is `scenarios: <n> ran, <p> passed, <f> failed, <k> checks skipped`, one `scenarios: set <name> <p>/<n> passed` line per set with a member that ran, and `scenarios: total <s> s`. Times are printed, never compared to the cap.
- `vp run test:scenarios:perf -- [--only <perf id>]... --quiet-confirmed` is the serial perf run: every perf scenario, or the named ones, one at a time on one worker, after the user confirms the machine is quiet. Without the confirmation it measures nothing and says to ask the user.
- `vp run test:scenarios:loop -- <N> [--only <name>]... [--quiet-confirmed]` is the N-run determinism loop, only when an acceptance criterion asks for one: the check suite N times, then the perf run N times, with no retries. With no `--only`, or with a perf id, it needs the confirmation. It stops when a source changes between runs, and prints `loop: <id> failed <f>/<N>` per failing scenario.
- `-- --list` prints what a run would run and starts nothing. `--browser <path>`, `--server-bin <path>` and `--own-shell-config` (the developer's own shell startup files) change what the run starts.
- `-- --selftest` runs the harness self-tests `T1`, `T2`, `T4`, `T10` (two setups on one server) and `T11` (a page reaches an API-made workspace from the start screen and from another workspace), then the perf self-tests `T33` (within its budget) and `T34` (over it) on one worker. `-- --selftest --only <name>` runs one of the others or a self-test set:
  - `T3` (a second server that cannot start); `T5` (tries needs it did not state); `T6` (names what it makes by its run); `T7` to `T9` (each signal wait fails naming what it awaited); `T12` (a setup call fails in setup); `T13` (a workspace is not shown); `T14` (a wait fails naming what it awaited, its offset and the deadline); `T15` (labelled artifacts from two pages and a second server);
  - `T16` (returns a workspace) and `T17` (takes one, or makes its own alone); `T18` (a wrong UI state), `T19` (terminal output that never comes) and `T20` (its server crashes mid-stage), each naming stage, expected and found; `T21` (composed, fails at step 2, step 3 not run); `T22` (composed, two handovers); `T23` (`serverWide`) and `T24` (`condition`); `T25` (fails while a folder is unwritable, and the folder is restored); `T26` (composed with a restart step); `T27` (held output let go before the reload fails the raw-output check) and `T28` (held output never let go fails the wait for it after the reload);
  - `T29` and `T30` (each sees only its own workspace and shells on a shared server) and `T31` (the same count made server-wide, the negative control); `T32` (kills its shared server mid-stage); `T35` (holds a shell running until the run is stopped); `T36` (stops its shell host on a fresh server);
  - sets `T-lib` (T10 to T15), `T-diagnosis`, `T-compose`, `T-needs`, `T-sandbox`, `T-restart-set`, `T-gate` and `T-shared` (T29 to T31; run it with `--workers 1` so all three share one server).
- `T2`, `T3`, `T5`, `T12`, `T13`, `T15`, `T18` to `T21`, `T25`, `T27`, `T28`, `T32`, `T34` and `T35` fail on purpose, and `T31` fails after another scenario on its server, so they exit non-zero. Every self-test whose needs are `{}`, and every composed one or set made only of such members, also runs on a sandbox, except `T32`, which would kill the sandbox's server; the others are refused there.
- Chromium is the web browser tests' Playwright Chromium: `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium` once, or `--browser <path>`.
- `scripts/scenarios/harness.test.ts` (Vitest) covers the runner's failure paths and the throwaway-home guard; `sandbox.test.ts` covers the sandbox.
- Scenarios are not a CI gate, and a run does not disturb a running dev server.
