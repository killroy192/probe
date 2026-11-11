---
id: PRB.T-039
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-11
---

# Convert every scenario into atomic, composable check scenarios

## Business Goal

**Problem:** Every scenario today is one linear script. S2, S3 and S7 hold about 20 stages each and E2-S1 ten; even the short ones (S4 to S6, S8) chain several behaviors. An early failure hides every later criterion, a stage often depends on a shell or folder an earlier stage made, and no agent can run "just the restart behavior" or build a bigger flow out of existing checks. The scripts restart the server 14 times, often only to change a startup condition. Most scenarios use fixed names and folders, some change state the whole server shares (the starting-script list, the server's state folders), and S6 finds its background jobs with a process-table pattern that any other run would match, so PRB.T-037's sandbox has to refuse them. A failure message often names what was expected but not what was found.

**Proposed solution:** With PRB.T-043's building blocks (check and perf kinds, sets, composed scenarios, the new needs, the cap gate), replace every scenario with atomic check scenarios: each proves one behavior, builds its own preconditions through PRB.T-038's library and states what it needs from its server. The old ids become named sets, and at least one composed scenario is built from converted ones. Every assertion names what was expected and what was found. This story runs the cap gate once for every scenario it implements. Every acceptance criterion the old scenarios prove is mapped to a new scenario, and nothing on the epic's must-not-change list is given up.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 5b PRB.T-039, the conversion part. Split on 2026-11-10 by user decision: the building blocks (kinds, `.perf.ts`, sets, composition, the new needs, the cap gate command) moved to PRB.T-043, which comes first. Acceptance criteria keep their numbers; moved ones point to PRB.T-043.
- **Delivers:**
  - FR-11: every scenario that exists when this story starts (S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4, and E2-S2 or E2-S5 if either has landed as a long scenario) is replaced by atomic scenarios that each build their own state and can run alone; restarts remain only where restart behavior is the subject; every old acceptance criterion maps to a new scenario.
  - FR-17, the conversion part: every old id becomes a set of its successors, and at least one composed scenario is built from converted scenarios of two old ids. The mechanism is PRB.T-043's.
  - FR-19, the conversion part: every assertion of a converted scenario names expected and found. The deliberate-failure self-tests are PRB.T-043's; the runner part is PRB.T-040's; the debug log and browser console in the artifacts are PRB.T-038's.
  - FR-22, the runs: one gate run for every atomic check scenario this story implements, after the user confirms the machine is quiet. The command is PRB.T-043's.
  - FR-14, S6's part: S6's background jobs carry a value unique to the run, and no global process-table pattern another run could match is left. S3's successor also stops using the machine's shared `/tmp`.
  - FR-9, the conversion part: every scenario PRB.T-037 refuses as "not yet safe on a shared server (converted in PRB.T-039)" is converted, so the sandbox refuses a scenario only for a need it states.
  - NFR-1: per scenario, through the gate runs above (the whole-suite gate is PRB.T-040's).
  - NFR-6: every converted assertion carries the expected and found values.
  - Epic risks R-3 (lost criteria), R-8 (scenarios that do not fit the cap) and R-11 (hidden coupling through composition) are mitigated here.
- **Provides, owned elsewhere:** FR-13 (PRB.T-040) gets its sets from here: every old id becomes a set name. FR-12 (PRB.T-041) is touched only through the epic's switch rule. FR-4 is touched only where this story removes a wait by time from a scenario it splits (S4's `sleep 2`); moving timings into perf scenarios is PRB.T-043's. FR-15: this story keeps the e2e rules file current.
- **One deployable outcome:** After this ships, a failing scenario names one behavior and what it expected and found; every atomic scenario runs alone by id, and every old id runs as a set, in the suite or on a sandbox; and every atomic check scenario has passed its cap gate. This is the shape PRB.T-040 needs to share servers and run in parallel.

## Current Behavior

Read on `main` at `2eac97f07` on 2026-11-10, with grep and file reads (the `cocoindex-code` MCP was not available); nothing was run. PRB.T-036's code is merged. PRB.T-042 was merged on 2026-11-10 (`2eac97f07`; its rules file is `.agents/rules/scenarios.md`); PRB.T-037, PRB.T-038 and PRB.T-041 are not built. What those stories will change is described by their tickets, not here.

- **Scenario contract and selection.** A scenario is `id`, `title` and `run(context)` (`scripts/scenarios/scenario.ts`); it states nothing about kind, needs, inputs or results. The registry lists S1 to S8 as epic scenarios and T-002, R1, E2-S3, E2-S1 and E2-S4 as story checks (`registry.ts:18-37`). `--only <id>` matches one id exactly and exits 2 with `no scenario has the id …` otherwise (`run.ts:301-305`). There are no sets and no composition. The summary prints `<passed>/8 passing` from the constant `TOTAL = 8` (`run.ts:39,335`).
- **Per-scenario time.** The printed time covers the scenario from before its server starts to its end, so it includes its server start and first login (`run.ts:176,214-222,265,319`). No command compares a time to a cap; the rules file's interim instruction is one `--only <id>` run after the user's confirmation, reading the time on its `PASS` line (`.agents/rules/scenarios.md`, "Until later stories land").
- **Timings, sets, composition, needs and the gate.** Today none exists; PRB.T-043 builds them and moves the S2, S3 and E2-S3 timings into perf scenarios before this story starts. Its ticket describes what this story uses.
- **What each old scenario holds and needs** (stage labels are the `stage =` lines or, in S1, T-002 and R1, the AC comments; restarts are `restart(` and `restartAndReload(` calls):

| Old id | File | Checks | Restarts | Not safe on a shared server today because |
| ------ | ---- | ------ | -------- | ----------------------------------------- |
| S1 | `boot.ts` (295 lines) | 16 AC groups, no stage variable | 0 | needs a pristine home: the start screen shows no tree (`boot.ts:22-25`) and the Workspaces menu lists exactly its names (`boot.ts:144,229,262,275`); fixed names; seeds files into, and makes unwritable, the server's workspaces folder (`boot.ts:69-71,222,239-250,252-268`) |
| S2 | `plus-modal.ts` (520) | 19 stages | 2: one with a faulty git config so `git init` fails (`:411`), one to clear it (`:451`) | fixed name; adds a script to the starting-script list (`:406-410`); kills every shell on the server and counts the server's whole shell list (`:132,320-340,402-404,427,470`) |
| S3 | `worktrees.ts` (522) | 20 stages | 1, after adding a script to the list (`:477`) | fixed name and folders; adds a script to the list (`:472-476`); counts the server's whole shell list (`:391,399`); changes into `/tmp` (`:205-206`) |
| S4 | `many-shells.ts` (261) | 12 stages | 0 | fixed name (`:52`); output during a reload comes from `sleep 2` typed into a shell (`:163`); absence is read once with `count() === 0` (`:208,243,250`) |
| S5 | `close-tab.ts` (125) | 5 stages | 0 | fixed name (`:45`) |
| S6 | `kill-shell.ts` (247) | 9 stages | 0 | fixed name (`:100`), removed by the Workspaces menu by name (`:226-235`); finds its jobs by listing every process on the machine and matching `^sleep 160[12]$` (`:34-44,119-120`); absence read once (`:126,202`) |
| S7 | `restart.ts` (470) | 22 stages after 4 setup stages | 3: `:225`; `:420` with the shell host stopped; `:430` | fixed names; makes the server's shells and workspaces folders unwritable while a stage runs (`:350-358,377-385`) |
| S8 | `restore-shell.ts` (192) | 5 stages | 1, with the shell host stopped (`:121-122`) | fixed name (`:63`) |
| T-002 | `standalone-shell.ts` (168) | 6 AC groups | 1 (`:147`) | fixed folder in the home (`:22`) |
| R1 | `second-server.ts` (130) | 4 AC groups | 0 | needs a second server (`:49`); fixed names (`:73-75`) |
| E2-S3 | `starting-scripts.ts:68-153` | 3 stages | 1, with `PROBE_AGENT_COMMAND` set (`:114`) | asserts the exact list a fresh state folder offers (`:85-89`); fixed name through `setUp` (`fixtures.ts:29-35`) |
| E2-S1 | `starting-scripts.ts:156-322` | 10 stages | 5 (`:253,292,301,313` without the mock agent seed, `:320`) | rewrites the starting-script list throughout (`:176-181,269,278,291,300,312`) |
| E2-S4 | `starting-scripts.ts:346-454` | 6 stages | 0 | rewrites the list (`:360-364`); counts the server's whole shell list (`:386-393`) |

- **Coupled stages.** Later stages reuse what earlier ones made, for example S2's AC-7 uses the shell AC-2 started, S7's "AC-17 after restart" checks shells earlier stages killed, E2-S1's AC-5 reads the last starts of AC-3 and AC-4, and S2's AC-23 ("no chat route was opened at any point") judges the whole flow.
- **The starting-script list is server-wide.** It is one file per state folder (`apps/server/src/startingScripts/StartingScripts.ts:26,40`), read again on every call (`:63-64`); the mock agent default is written only at server start, and only when no file exists (`:42-60`). E2-S1's AC-22 and AC-7 already rely on the per-call read with no restart (`starting-scripts.ts:268-288`). A scenario that writes the list changes what every other scenario on that server is offered.
- **The mock agent.** Its sessions live under `MOCK_AGENT_HOME`, which the harness sets per server home (`server.ts:210`); each session has its own file (`scripts/mock-agent/mock-agent.ts:11-14,47`).
- **Chat addresses in S1.** S1 walks 13 old chat addresses by in-app navigation with a workspace shown and again with none, plus two page loads (`boot.ts:79-93,191-194,285-293`). Every one of those routes redirects through the same `redirectHiddenChatRoute` (for example `apps/web/src/routes/_chat.usage.tsx:7`, `guest.tsx:8`).
- **Rules file.** `.agents/rules/scenarios.md` (PRB.T-042) already states check vs perf, `<scenario>.perf.ts`, one purpose, composition, no reruns and the cap gate as rules; it says existing scenarios are converted in PRB.T-039 and holds an interim line for this story ("No sets, composed scenarios, `.perf.ts` support or cap gate command yet").
- **Mobile and desktop.** Nothing under `apps/mobile` or `apps/desktop` refers to `scripts/scenarios` (PRB.T-040 SA-9).

## Expected Behavior

Every old scenario is replaced by atomic check scenarios built on PRB.T-038's library, PRB.T-037's statement of needs and PRB.T-043's kinds, sets, composition and gate. Nothing is proved less than before.

- **Atomic check scenarios.** Each proves one behavior, which its title names. Several old criteria stay in one atomic scenario only when they are consequences of the same action; the mapping says why. Each builds every precondition it needs through the library, from what it is given and nothing else, so it never reads what another scenario left and runs alone by its id. Each has its own id, made of the old id it came from and a part name, so the old id stays recognisable in the output. The desk analysis's split plans (S2, S3, S7, E2-S1) are a starting point; this story applies the same rule to every scenario.
- **Account of criteria.** Before an old scenario is deleted, every one of its acceptance criteria and stages is listed in this ticket's handoff against the new scenario that proves it, with the new id. That table is also the mapping note the epic promises to tickets that cite old scenario ACs, so their citations stay resolvable.
- **Stated needs.** Every scenario states what it needs from its server, using PRB.T-037's statement as PRB.T-043 extends it: a restart (stopping the shell host counts as one), a pristine home, a second server, a change to server-wide state, or a server started under a condition (an environment variable, a faulty git config). The sandbox refuses every one of these needs, naming it; on the runner each gets a server of its own (PRB.T-040's EC-17 rule). After this story no registered scenario is refused on the sandbox as "not yet safe on a shared server" or for stating no needs. The handoff lists each scenario's needs with the assertion or step that causes each.
- **Server-wide state.** The starting-script list stays server-wide: it is one file per state folder in the product, so E2-S1's and E2-S4's successors that write it, the S2 and S3 successors that add a script to it, and E2-S3's successor that asserts what a fresh state folder offers all state a change to, or a dependence on, server-wide state. So do the successors that make the server's own state folders unwritable (S1 AC-16 and AC-17, S7 AC-18 and AC-21). This answers PRB.T-040's EC-17: these get a fresh server on the runner and are refused on the sandbox. Scenarios that rely on the default list (the "mock agent" entry) run on a shared server because no scenario that shares one writes the list.
- **Restarts.** A scenario restarts the server only when restart behavior is its subject: restart survival, a lost shell host, shells that stay gone across a restart, a restored shell after a lost host, a running standalone shell after a restart, and E2-S1's startup rules (preselection after a restart, an emptied list not seeded again, a damaged list not overwritten, no default when the seed is off, then seeding). A restart that only set a startup condition (S2's faulty git config and the restart that clears it, E2-S3's `PROBE_AGENT_COMMAND`) becomes a server started under that condition. A restart that only made the server see a new starting script (S2 AC-16, S3 AC-22) goes, since the server reads the list on every call. Every remaining restart is listed in the handoff with what it proves.
- **Shared-server safety.** Names and folders come from the library, unique per call. A scenario acts only on what it created or was handed by an earlier step (it never kills every shell on the server, as S2's AC-16 does today). A scenario that does not state a change to server-wide state asserts nothing that leftovers of earlier scenarios on the same server could change: a count of shells or nodes is taken within its own workspace or project, never over the server's whole shell list. A count over the page counts only the scenario's own workspace, because a page shows one workspace at a time, so S3's page-wide `[data-worktree]` count is safe on a sandbox where scenarios run one at a time; PRB.T-040 scopes it for its parallel case. S1's successors keep the pristine-home need where an assertion depends on an empty home (the start screen with no workspace, the exact Workspaces list) and drop it where it does not.
- **What a scenario leaves.** A scenario does not remove what it created when it ends, so the next step of a composed scenario can use it; a shared server or sandbox drops it when it is stopped (PRB.T-040 EC-2, PRB.T-037 EC-6). A change that affects anything beyond the scenario's own workspace and folders while it lasts (a file or folder made unreadable or unwritable) is undone in the step that made it, pass or fail. S7 AC-19's unreadable file is the scenario's own workspace file, so that successor stays workspace-local and restores it in the step; S1's seeded workspace files are written straight into the server's workspaces folder, not created through the library with names unique per call, and its unwritable-folder stages change the server's own state folder, so those successors state a pristine home or a change to server-wide state.
- **Old ids as sets.** Every old id (S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4, and E2-S2 or E2-S5 if converted under EC-11) becomes a set of its check successors, so the old id stays usable and tickets that cite it resolve. On the sandbox, a set holding a member with a refused need is refused as a whole (PRB.T-043).
- **A composed scenario from converted ones.** At least one composed scenario exists whose steps come from at least two old ids and are all accepted on the sandbox.
- **Expected and found.** Every assertion in a converted scenario fails naming what it expected and what it found.
- **Gate runs.** After implementing atomic scenarios, the agent asks the user to confirm the machine is quiet and runs PRB.T-043's cap gate once over them; a scenario over 20 s is split further or taken to the epic owner, never rerun unchanged.
- **S4.** The output that arrives during a reload is released by the scenario after the reload has begun, instead of a `sleep 2` typed before it, and is shown exactly once.
- **S6.** The background jobs carry a value unique to the run, and the scenario finds only processes carrying it; a process of the old `sleep 1601` shape, or one carrying another run's value, is not matched.
- **S3.** The shell that leaves its worktree goes to a folder the scenario owns, not `/tmp`.
- **S1's chat addresses.** Each of the 13 addresses is still checked at least once, and both states (a workspace shown, none shown) are still checked by in-app navigation and by a page load, with fewer navigations than today; which addresses are repeated is left to the plan, since they share one redirect.
- **Absence.** An assertion that something is absent is made only after the event that settles it (a row or tab detached, a shell-list change, the tree showing after a reload), never on a single early sample.
- **Signals.** If PRB.T-041 has landed, the atomic scenarios use its signals; if not, they use the library's waits, and whichever of the two lands last switches them (epic switch rule).

### User Flow

1. An agent changes the kill path and runs only the atomic scenarios that prove it, or the set `S6`, with the rules file's one-line commands, in the suite or against a sandbox.
2. One fails. Its `FAIL` line names the scenario, the stage, the expected and the found value; the artifacts hold the debug log of that stage and the browser console. The agent finds the cause from that run, fixes the code, and runs the scenario again (a change, not a rerun).
3. A developer runs `vp run test:scenarios`: every check scenario runs, atomic and composed, and no perf scenario. Asking about restart behavior, they run the set `S7`.
4. After implementing atomic scenarios, the agent asks the user to confirm the machine is quiet, then runs the cap gate over them and records the times.

### Edge Cases

- **EC-1** A stage that used an earlier stage's leftover (S2 AC-7, S7 "AC-17 after restart", E2-S1 AC-5): its atomic successor builds that precondition itself when run alone, and takes it from the earlier step only inside a composed scenario.
- **EC-2** A criterion that only holds over a whole flow (S2 AC-23, no chat route opened at any point): every S2 successor that drives the UI checks it over its own flow.
- **EC-3** A restart scenario that proved survival of many kinds of state at once (S7 AC-6: an agent shell, a plain shell, a shell with a closed tab, a shell whose folder was removed, a second workspace): its successor keeps that variety in one restart, so it proves at least as much. If it cannot fit under the cap, a step run alone would still build all that state, so a composed scenario does not help: the epic owner either raises the cap for every scenario (epic R-8) or agrees to a split that rewrites AC-6 for this case, recorded in the handoff; there are no per-scenario exceptions.
- **EC-4** A behavior proved by a restart with a changed environment (S2's `git init` failure, E2-S3's `PROBE_AGENT_COMMAND`): proved on a server started under that condition, and the handoff lists how.
- **EC-5** The same atomic scenario runs alone and as a step, or twice in one composed scenario: each run creates its own names and folders, and neither reads the other's.
- **EC-6** Moved to PRB.T-043 EC-2.
- **EC-7** A set on the sandbox includes a member that needs a restart (the set `S7`): the whole set is refused before anything runs, naming that member and the need.
- **EC-8** Moved to PRB.T-043 EC-4.
- **EC-9** Moved to PRB.T-043 EC-5.
- **EC-10** A scenario's gate time exceeds 20 s: it is split further, or the epic owner raises the cap for every scenario (epic R-8); it is never rerun unchanged to get under.
- **EC-11** E2-S2 or E2-S5 has landed as a long scenario before this story starts: it is converted like the others (FR-11).
- **EC-12** A decoy process of the old shape (`sleep 1601`), or one carrying another run's unique value, runs while S6's successor runs: it is not matched and the scenario passes on its own jobs.
- **EC-13** The release in S4's successor happens before the reload starts: the scenario fails, since the output would have arrived before the reload (the point of the old `sleep`).
- **EC-14** After the split there are many more scenarios than eight: the run's summary still reports correct counts of what ran, passed and failed.
- **EC-15** A sandbox holds leftovers of earlier runs (shells still running, workspaces): an accepted scenario's result does not change; its assertions are on its own state.

### Error Handling

- **ER-1** An atomic scenario fails: the output names the scenario id, the stage, the expected and the found value; the artifacts of PRB.T-036 and PRB.T-038 are saved.
- **ER-2** A precondition cannot be built (a library setup call fails): the scenario fails in its setup stage naming the call and the server's reason, not later with a missing element.
- **ER-3** S4's release never happens: the scenario fails with a named wait for the output, not a silent pass.
- **ER-4** Moved to PRB.T-043 ER-1.
- **ER-5** Moved to PRB.T-043 ER-2.
- **ER-6** Moved to PRB.T-043 ER-3.

## Out Of Scope

- The building blocks: check and perf kinds, `.perf.ts` files and moving today's timings into them, sets and composed scenarios as a mechanism (in the suite and on the sandbox), the two new needs, the cap gate command and the deliberate-failure self-tests: PRB.T-043 (used here).
- The runner: Playwright Test, parallel workers, a shared server per worker, traces, ports without a bind-then-release race, retries fixed at 0, the serial perf command, the N-run flake loop, and old ids findable as set names in the new runner's output: PRB.T-040. Until then every scenario still cold-starts its own server in the suite, so a full run gets slower; that is accepted here.
- Scoping S3's page-wide `[data-worktree]` count, and the check that two suites at once leave each other alone: PRB.T-040 (FR-14).
- The library, direct setup over the API, debug-level scenario servers and the browser console in artifacts: PRB.T-038 (used here).
- The sandbox itself, its single-scenario runs, its refusals and the statement of needs: PRB.T-037 (extended by PRB.T-043).
- The prompt-ready, layout-saved and process-end signals: PRB.T-041 (this story follows the switch rule).
- Creating the rules file and its pointers: PRB.T-042. This story only updates the file.
- Product performance limits and changing them (PRB.E-002's 700 ms, PRB.T-004's 1 s, PRB.T-005's branch label): product tickets own them (epic Out).
- Making the starting-script list per workspace: product scope (PRB.E-002), not a test change.
- A server-level unit test for the starting-script seeding rules (the analysis says "consider"): not requested.
- Changing what any criterion proves, or loosening one to save time (epic must-not-change list: real PTYs, git worktrees, websockets, real restarts, abrupt-kill and lost-host cases, pointer-only input, the throwaway-home guard and cleanup by captured PID, the mock agent, the second-server path, the PRB.T-011 contract end to end).
- Writing E2-S2 and E2-S5: PRB.T-019 and PRB.T-020 (epic FR-13).
- Parallel runs on one sandbox (no FR), making scenarios a CI gate, mobile and desktop.

## Technical Scope

- **Layers:** `scripts/scenarios` only: the scenario files, their registration and stated needs, the old ids' sets, the composed scenario from converted ones, self-tests of S4's release (S6's marker is checked against its decoys inside every `S6.kill-from-tree` run, AC-28). No server, web, contracts or product code.
- **Agent CLIs:** the mock agent only; Claude Code and other CLIs are not run.
- **Shells:** zsh and bash through the harness's isolated startup files; S4's release and S6's marker must behave the same under both, on Linux and macOS (SA-7).
- **Docs impact:** the e2e rules file `.agents/rules/scenarios.md` only, in the same change: what an atomic scenario is and how its id is formed; what a scenario leaves; that old ids are set names.  The sentence that existing scenarios are converted in PRB.T-039 and the S2 example of an old scenario breaking a rule are removed. `docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md are only checked: each keeps its pointer and contradicts nothing.
- **Mobile impact:** none; no contract change.

## Non-functional Requirements and Constraints

- The repo test rules and the rules file hold: no sleeps, polling loops or wall-clock reads in check scenarios; waits subscribe to an event raced against a named deadline, a bounded check loop only where no event exists; no per-test timeout argument or retry. Check scenario files gain no new clock exemption, and the rules file's permanent classes (runner bookkeeping, deadlines raced against an event, bounded loops where no event exists) stay as they are.
- Pointer-only input; real PTYs, git worktrees, websockets and restarts; the throwaway-home guard and cleanup by captured PID are unchanged (epic NFR-3, must-not-change list).
- No reruns (epic FR-19): each acceptance criterion is checked by one run on unchanged code; where one run can check several criteria, it does (AC-2 and AC-3 are the suite run and the sandbox set run). A failure found on the way is diagnosed from its first run and fixed in the scenario or the code.
- The cap gate runs only after the user confirms the machine is quiet, on the devcontainer, one run per scenario, no median (epic KPI).
- Pointer-only, mock-agent-only and local-only: no scenario reaches a remote server.
- One library: no scenario file defines a helper another scenario could use (FR-21, PRB.T-038).

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given the acceptance criteria and stages of S1 to S8, T-002, R1, E2-S1, E2-S3 and E2-S4 (and E2-S2 or E2-S5 if either landed as a long scenario), when the split lands, then the handoff maps every one of them to at least one new scenario by id, every atomic scenario lists the old criteria it covers with a reason where it covers more than one, no old criterion is unmapped, and no old scenario file is deleted before its rows are reviewed by the developer | manual (author; developer review) | FR-11, R-3, EC-11 |
| AC-2  | Given the change, when `vp run test:scenarios` runs once, then every atomic and composed check scenario runs and passes, no old id (S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4) is registered as a scenario, each being only a set name, and the summary counts what ran, passed and failed | auto | FR-11, EC-14 |
| AC-3  | Given a running sandbox, when every atomic check scenario that states no need the sandbox refuses runs once, one after another, as one set against it, then every one passes, the sandbox's server PID is the same throughout, and no run starts a server | auto | FR-9, FR-17, EC-5, EC-15 |
| AC-4  | Given the registry after the change, when a harness test reads every registered scenario's stated needs, then every scenario carries a statement of needs (an empty one is allowed), none is missing one, and none states "not yet safe on a shared server"; and the handoff lists each scenario's needs with the assertion or step that causes each | auto (harness test) and manual (handoff) | FR-9 (conversion), FR-11 |
| AC-5  | Given the 14 old restarts, when the split lands, then the handoff lists every remaining restart or shell-host stop with the restart behavior it proves, and every old restart that only set a startup condition or made the server see a new starting script is gone, with what replaced it | manual (author; developer review) | FR-11, EC-4 |
| AC-6  | Given the successors whose subject is restart behavior (S7 survival, lost shell host, gone after a restart; S8 restore after a lost host; T-002 running after a restart; E2-S1 preselection after a restart, emptied list, damaged list, no default then seeding), when they run, then each performs a real server restart (the lost-host ones stop the shell host first) and asserts what it proves after it; S7's survival successor restarts once with every kind of state the old AC-6 stage held (an agent shell, a plain shell, a shell with a closed tab, a shell whose folder was removed, a second workspace) | auto | FR-11, EC-3 |
| AC-7  | Given the successors of S2's `git init` failure and E2-S3's `PROBE_AGENT_COMMAND` check, when they run, then each proves its old criterion on a server running under that condition, and the git fault does not reach any other scenario's server | auto | FR-11, EC-4 |
| AC-8  | Given the successors that write the starting-script list, assert a fresh state folder's list, or make the server's state folders unwritable, and the successors that need a server started under a condition (S2's `git init` failure, E2-S3's `PROBE_AGENT_COMMAND`), when each is run against a sandbox, then it is refused before anything runs, naming the need it states (a change to server-wide state, a dependence on it, or the condition); and in the suite each passes on a server of its own; and the set `S7` run against a sandbox is refused as a whole before anything runs, naming its restart member | auto | FR-9, FR-11, EC-4, EC-7 |
| AC-9  | Given the successors of stages that used an earlier stage's leftover (S2 AC-7, S7 "AC-17 after restart", E2-S1 AC-5), when each runs alone by its id, then it builds its own preconditions and passes | auto | FR-11, EC-1 |
| AC-10 | Given the PRB.T-011 contract (the agent command typed once, after the first prompt, banner after it), when the split lands, then one atomic scenario checks it end to end through a modal start of the mock agent, as PRB.T-036 left the check | auto | FR-11 (must-not-change) |
| AC-11 | Given S2's successors that drive the UI, when each runs, then each checks that no chat route opened during its own flow | auto | EC-2 |
| AC-12 | Moved to PRB.T-043 AC-2 (split, 2026-11-10). | – | – |
| AC-13 | Moved to PRB.T-043 AC-3 (split, 2026-11-10). | – | – |
| AC-14 | Moved to PRB.T-043 AC-4 (split, 2026-11-10). | – | – |
| AC-15 | Moved to PRB.T-043 AC-5 (split, 2026-11-10). | – | – |
| AC-16 | Moved to PRB.T-043 AC-6 (split, 2026-11-10). | – | – |
| AC-17 | Moved to PRB.T-043 AC-7 (split, 2026-11-10). | – | – |
| AC-18 | Moved to PRB.T-043 AC-8 (split, 2026-11-10). | – | – |
| AC-19 | Given the saved composed scenarios, when the suite runs, then at least one composed scenario whose steps come from at least two old ids, all accepted on the sandbox, passes | auto | FR-17 |
| AC-20 | Given the registry after the change, when a harness test reads it, then each old id is a set whose members are exactly its check successors (as the handoff maps them), and no old id is registered as a scenario; no extra suite run is needed | auto (harness test) | FR-17, FR-13 (provided) |
| AC-21 | Moved to PRB.T-043 AC-10 (split, 2026-11-10). | – | – |
| AC-22 | Moved to PRB.T-043 AC-12 (split, 2026-11-10). | – | – |
| AC-23 | Given the atomic scenarios, when their assertions are reviewed, then every one fails naming what it expected and what it found | manual (developer review) | FR-19, NFR-6, ER-1 |
| AC-24 | Moved to PRB.T-043 AC-13 (split, 2026-11-10). | – | – |
| AC-25 | Given every atomic check scenario this story implements and the user's confirmation that the machine is quiet, when the cap gate runs once over them on the devcontainer, then every one is at or under 20 s and the per-scenario times are in the handoff; a scenario over the cap is split further or taken to the epic owner, never rerun unchanged | manual (agent asks the user; one gate run) | FR-22, NFR-1, EC-10, A-13 (epic) |
| AC-26 | Given S4's successor that reloads with output arriving, when it runs, then the scenario releases the output only after the reload has begun, it is shown exactly once, and no fixed sleep is typed | auto | FR-4, EC-13 |
| AC-27 | Given self-tests of S4's release, one releasing before the reload and one never releasing, when each runs, then the first fails because the output arrived before the reload and the second fails with a named wait | auto (self-test) | EC-13, ER-3 |
| AC-28 | Given S6's successor with a decoy of the old `sleep 1601` shape and a decoy carrying another run's unique value both running, when it runs, then it matches only its own jobs and passes; and a source search of the scenarios finds no process-table pattern another run's processes could match | auto and manual (source search in the handoff) | FR-14, EC-12 |
| AC-29 | Given the atomic scenarios, when reviewed (source search recorded in the handoff), then each absence assertion is made after the event that settles it, never on a single early sample; and no scenario without a server-wide need kills, removes or counts shells, projects or workspaces outside what it created or was handed; and every successor that makes a file or folder unreadable or unwritable undoes it in that step, pass or fail | manual (developer review) | FR-19, FR-14, EC-15 |
| AC-30 | Given S3's successor that leaves its worktree, when it runs, then the shell goes to a folder the scenario owns, not `/tmp` | auto | FR-14 |
| AC-31 | Given S1's successors, when they run, then each of the 13 chat addresses is checked at least once, both states (a workspace shown, none shown) are checked by in-app navigation and by a page load, fewer navigations are made than today's, and the pristine-home need is stated only by successors whose assertions depend on an empty home | auto and manual (review of the needs in the handoff) | FR-11 |
| AC-32 | Given the rules file after the change, when read against the harness, then it covers Technical Scope's docs list, the removed sentences are gone, and `docs/internals/testing.md`, `docs/operations/development.md` and AGENTS.md contradict nothing in it | manual (docs review) | FR-15 (kept) |
| AC-33 | Moved to PRB.T-043 AC-14 (split, 2026-11-10). | – | – |
| AC-34 | Given whether PRB.T-041 has landed when this story lands, when the atomic scenarios are reviewed, then they use its signals if it had, and otherwise the handoff names PRB.T-041 as the story that switches them | manual (review) | FR-12 (touched) |
| AC-35 | Given the change, when `--selftest` runs once and `vp run check:changed` runs, then the self-tests pass or fail as designed (T2 and the deliberate failures fail on purpose), the `harness.test.ts` guard cases pass, PRB.T-038's self-test of a failing setup call still fails in its setup stage naming the call and the server's reason (every converted scenario builds its preconditions only through the library), and typecheck and knip pass for `scripts` | auto | NFR-3 (epic), FR-21 (kept), ER-1, ER-2 |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-043 | The check and perf kinds, sets, composed scenarios, the two new needs, the cap gate command and the deliberate-failure self-tests this story uses. | in progress (code on branch `e005`, tag `e005-t043`) |
| PRB.T-038 | The library every atomic scenario builds its preconditions with, and its composition interface: needs from explicit inputs, results returned as values, unique names per call, the same on every server, nothing cleaned up on its own with remove steps offered. Also the debug log and console in artifacts that FR-19 relies on. | in progress (code on branch `e005`, tag `e005-t038`) |
| PRB.T-037 | The statement of needs, the sandbox and its refusals, and the "not yet safe" refusals this story converts. | done |
| PRB.T-042 | The rules file this story updates, and the lint rules on scenario files (including the `temporary: PRB.T-039` suppressions this story removes). | done |
| PRB.T-036 | The failure artifacts, the PRB.T-011 order check and offsets on frame waits. | done |
| PRB.T-041 | Not needed to start; the switch rule decides who moves the scenarios to the signals. | done (landed first; the successors use its signals) |

**Blocks:** PRB.T-040, which runs these scenarios in parallel on shared servers, decides fresh servers from the needs stated here (its EC-17), and runs the whole-suite gate. Tickets that cite old scenario ids or ACs (PRB.T-016 to PRB.T-020, PRB.T-022 and PRB.T-028 among them) resolve them, and the timings they read, through AC-1's mapping.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The desk analysis's split plans, extended to every scenario, keep every criterion, and no criterion holds only because an earlier stage ran. | assumption | unverified (stages read; dependencies between stages not traced fully) | Trace each stage's preconditions while writing AC-1's mapping. | author |
| SA-2 | The old scenarios restart the server 14 times: S2 2, S3 1, S7 3, S8 1, T-002 1, E2-S3 1, E2-S1 5 (the analysis's "3+1+8" counted fewer scenarios). | assumption | verified (read `restart(` and `restartAndReload(` calls, 2026-11-10; not run) | Recount at the start. | author |
| SA-3 | The server reads the starting-script list on every call and writes the default only at start, so adding a script needs no restart. | assumption | verified (read `StartingScripts.ts:42-64`; E2-S1 AC-22 and AC-7 rely on it with no restart) | AC-5, AC-8. | author |
| SA-4 | The mock agent is safe to run from many scenarios on one server: its home is per server home and each session has its own file. | assumption | verified (read `server.ts:210`, `mock-agent.ts:11-14,47`; not run) | AC-3. | author |
| SA-5 | With the library's direct setup, every atomic check scenario fits under 20 s, including those whose gate time counts their own server start (epic A-13). | assumption | unverified | AC-25. | author |
| SA-6 | Leftovers on a long-lived shared server (shells still running from earlier scenarios) do not change later scenarios' results or push them over the cap. | assumption | unverified | AC-3 (sequential, on a sandbox); PRB.T-040's parallel runs and whole-suite gate. | author |
| SA-7 | S4's release and S6's per-run marker behave the same under zsh and bash, on Linux and macOS (macOS `ps` output, `/tmp` being a link there). | assumption | unverified | Plan stage; the macOS run in PRB.T-040 (epic A-16). | author |
| SA-8 | PRB.T-043 ships sets, composition and the needs its ticket describes. | assumption | unverified | Read PRB.T-043's code and handoff before planning. | author |
| SU-1 | Moved to PRB.T-043 (split, 2026-11-10). | – | – | – | – |
| SU-2 | Moved to PRB.T-043 (split, 2026-11-10). | – | – | – | – |
| SU-3 | The exact form of the new ids (old id plus a part name). | unknown | settled: `<old id>.<part>`, `composed.<name>` (master plan U3) | Plan stage; set names follow PRB.T-043. | author |
| SU-4 | Moved to PRB.T-043 (split, 2026-11-10). | – | – | – | – |
| SU-6 | Moved to PRB.T-043 (split, 2026-11-10); decided there: no perf run before PRB.T-040. | – | – | – | – |
| SU-5 | Whether E2-S2 or E2-S5 has landed as a long scenario when this story starts (EC-11). | unknown | settled: neither had landed (registry read at the start) | Read the registry at the start. | author |

## Handoff

**Built as one wave of the PRB.E-005 master plan** (`.plans/e005-master.md`, not committed), on branch `e005` with PRB.T-038, PRB.T-043 and PRB.T-040. No step ran a scenario, the runner or the spawned harness tests; verification is the epic's final phase (master plan §4: V1 self-tests, V2 `check:changed`, V3 suite, V4 sandbox, V6 reviews, V7c gate).

**What is registered.** 103 atomic checks (101 successors plus `T-041b` and `T-041c`, unchanged), one composed scenario `composed.close-then-kill` = [`S5.close-tab`, `S6.kill-closed-tab` ← step 1], 15 sets (the 14 old ids and `shared`, 73 members), and the self-tests `T27` and `T28` (picked, fail on purpose). No old id is a scenario id. Each old id's set is derived from `covers` in `registry.ts`; `shared` is every check `sandboxRefusal` accepts. `playwright test --list` lists 137 tests. `registry.test.ts` asserts AC-1 (auto part), AC-4, AC-20, AC-3's set, the sandbox refusals of `S7`, `S2.git-init-fails`, `E2-S1.list-offered`, `S1.start-screen` and `R1`, the acceptance of `composed.close-then-kill`, `S5`, `S5.close-tab` and `S6.kill-closed-tab`, and that `validateRegistry` rejects nothing. `unshared` is gone from the contract, the rules and the sandbox reasons (master plan M12).

### Mapping (AC-1)

One row per old criterion. The third column is the successor's one-line reason, where it covers more than one. For the developer's review before the merge (master plan U6); the old files stay readable on `main`.

| Old criterion | Successor | Why grouped |
| --- | --- | --- |
| S1 AC-1 | `S1.start-screen` |  |
| S1 AC-2 | `S1.create-workspace` |  |
| S1 AC-3 | `S1.second-workspace` | One switch flow: create a second, list both, switch back, then choose the shown one again. |
| S1 AC-4 | `S1.second-workspace` | One switch flow: create a second, list both, switch back, then choose the shown one again. |
| S1 AC-5 | `S1.remove-other` |  |
| S1 AC-6 | `S1.remove-shown` |  |
| S1 AC-7 | `S1.reload-keeps-saved` | One reload: it shows the same workspace (AC-20) and its list keeps every saved one (AC-7). |
| S1 AC-8 | `S1.second-workspace` | One switch flow: create a second, list both, switch back, then choose the shown one again. |
| S1 AC-9 | `S1.second-workspace` | One switch flow: create a second, list both, switch back, then choose the shown one again. |
| S1 AC-10 | `S1.settings-no-chat` |  |
| S1 AC-11 with a workspace shown | `S1.chat-routes-shown` | One page showing a workspace: chat addresses and chat shortcuts both leave it shown. |
| S1 AC-11 with none shown | `S1.chat-routes-start-screen` |  |
| S1 AC-12 | `S1.chat-routes-shown` | One page showing a workspace: chat addresses and chat shortcuts both leave it shown. |
| S1 AC-13 | `S1.name-refusals` | Both are the create dialog's refusals of a name; only the taken one needs a workspace. |
| S1 AC-14 | `S1.name-refusals` | Both are the create dialog's refusals of a name; only the taken one needs a workspace. |
| S1 AC-15 | `S1.invalid-workspace` |  |
| S1 AC-16 | `S1.folder-unwritable` | One read-only folder refuses both changes: the create (AC-16) and the remove (AC-17). |
| S1 AC-17 | `S1.folder-unwritable` | One read-only folder refuses both changes: the create (AC-16) and the remove (AC-17). |
| S1 AC-20 | `S1.reload-keeps-saved` | One reload: it shows the same workspace (AC-20) and its list keeps every saved one (AC-7). |
| S2 AC-1 | `S2.import-git` | One import: the folder picked in the server's folder browser, then what its "+" offers. |
| S2 AC-2 | `S2.one-click-start` | One click on Create shell: its node, its single tab and its names all follow from that start. |
| S2 AC-3 | `S2.one-click-start` | One click on Create shell: its node, its single tab and its names all follow from that start. |
| S2 AC-4 | `S2.no-chat-chrome` |  |
| S2 AC-5 | `S2.agent-echo` |  |
| S2 AC-6 | `S2.grid-size` |  |
| S2 AC-7 | `S2.repeat-start` | One second start: its preselection, its single shell and its own output follow from it. |
| S2 AC-8 | `S2.import-git` | One import: the folder picked in the server's folder browser, then what its "+" offers. |
| S2 AC-9 | `S2.new-folder-git` |  |
| S2 AC-10 | `S2.plain-folder` |  |
| S2 AC-11 | `S2.no-project` |  |
| S2 AC-12 | `S2.repeat-start` | One second start: its preselection, its single shell and its own output follow from it. |
| S2 AC-13 | `S2.cancel-modal` |  |
| S2 AC-14 | `S2.deleted-folder` | One deletion: the refused start in the open modal, then the mark the next read shows. |
| S2 AC-14b | `S2.removed-folder-last-start` |  |
| S2 AC-15 | `S2.deleted-folder` | One deletion: the refused start in the open modal, then the mark the next read shows. |
| S2 AC-16 | `S2.unstartable-script` |  |
| S2 AC-17 | `S2.add-refusals` |  |
| S2 AC-17 git init | `S2.git-init-fails` |  |
| S2 AC-18 | `S2.connection-drop` |  |
| S2 AC-19 | `S2.start-end-lines` |  |
| S2 AC-20 | every S2 check that drives the page (17; all but `S2.start-end-lines`) | held by every page flow: pointer only (AC-20), no chat route checked last (AC-23) |
| S2 AC-21 | `S2.one-click-start` | One click on Create shell: its node, its single tab and its names all follow from that start. |
| S2 AC-23 | every S2 check that drives the page (17; all but `S2.start-end-lines`) | held by every page flow: pointer only (AC-20), no chat route checked last (AC-23) |
| S2 AC-24 | `S2.repeat-start` | One second start: its preselection, its single shell and its own output follow from it. |
| S2 AC-25 | `S2.other-workspace` |  |
| S3 AC-1 | `S3.existing-primary` | One start in the primary checks its default, the list and its label; the repeat, that it stays. |
| S3 AC-2 | `S3.existing-linked` | A start in the linked worktree, then the repeat its remembered choice preselects. |
| S3 AC-3 | `S3.existing-primary`, `S3.existing-linked` | `S3.existing-primary`: One start in the primary checks its default, the list and its label; the repeat, that it stays; `S3.existing-linked`: A start in the linked worktree, then the repeat its remembered choice preselects. |
| S3 AC-4 | `S3.fork-branch` | The origins list, then the one fork it starts and that fork's log line. |
| S3 AC-5 | `S3.fork-branch` | The origins list, then the one fork it starts and that fork's log line. |
| S3 AC-6 | `S3.fork-detached` |  |
| S3 AC-7 | `S3.fork-remembered` | The repeat the remembered fork preselects is the one-click fork. |
| S3 AC-8 | `S3.fork-branch` | The origins list, then the one fork it starts and that fork's log line. |
| S3 AC-9 | `S3.fork-remembered` | The repeat the remembered fork preselects is the one-click fork. |
| S3 AC-10 | `S3.existing-primary`, `S3.existing-linked` | `S3.existing-primary`: One start in the primary checks its default, the list and its label; the repeat, that it stays; `S3.existing-linked`: A start in the linked worktree, then the repeat its remembered choice preselects. |
| S3 AC-11 | `S3.existing-primary` | One start in the primary checks its default, the list and its label; the repeat, that it stays. |
| S3 AC-12 | `S3.ended-worktree` | The linked worktree's shells end, then the worktree itself goes. |
| S3 AC-13 | `S3.origin-gone-fallback` |  |
| S3 AC-14 | `S3.choice-per-project` |  |
| S3 AC-15 | `S3.no-worktree-choice` | Two projects without a forkable checkout, each opened and started once. |
| S3 AC-16 | `S3.no-worktree-choice` | Two projects without a forkable checkout, each opened and started once. |
| S3 AC-17 | `S3.origin-deleted` | One refused fork: what it leaves, what it starts and what it remembers. |
| S3 AC-18 | `S3.origin-deleted` | One refused fork: what it leaves, what it starts and what it remembers. |
| S3 AC-19 | `S3.origin-deleted` | One refused fork: what it leaves, what it starts and what it remembers. |
| S3 AC-22 | `S3.unstartable-in-worktree` |  |
| S3 AC-23 | `S3.fork-double-click` |  |
| S3 AC-24 | `S3.cancel-keeps-choice` |  |
| S3 AC-25 | `S3.existing-primary` | One start in the primary checks its default, the list and its label; the repeat, that it stays. |
| S3 AC-26 | `S3.branch-relabel` |  |
| S3 AC-27 | `S3.leave-worktree` | One cd out of the worktree, into a folder the scenario owns. |
| S3 AC-28 | `S3.ended-worktree` | The linked worktree's shells end, then the worktree itself goes. |
| S3 AC-29 | `S3.import-linked` |  |
| S3 AC-30 | `S3.leave-worktree` | One cd out of the worktree, into a folder the scenario owns. |
| S4 AC-1 | `S4.many-shells`, `S4.reload-layout` | `S4.reload-layout`: One reload proves them: the workspace, its rows, the open tabs, the selection, the closed tab. |
| S4 AC-2 | `S4.switch-tabs`, `S4.reopen-after-reload` | `S4.reopen-after-reload`: One reload proves them: the reopened tab (AC-2) and the open one (AC-3) show earlier output once. |
| S4 AC-3 | `S4.reopen-after-reload` | One reload proves them: the reopened tab (AC-2) and the open one (AC-3) show earlier output once. |
| S4 AC-4 | `S4.output-during-reload` | One held output proves them: shown once (AC-4), held with no sleep (AC-26), a plain shell (EC-3). |
| S4 AC-5 | `S4.reload-layout` | One reload proves them: the workspace, its rows, the open tabs, the selection, the closed tab. |
| S4 AC-11 | `S4.ended-after-reload` | One reload proves them: killed and exited shells stay gone, the signalled one shows ended. |
| S4 AC-15 | `S4.ended-after-reload` | One reload proves them: killed and exited shells stay gone, the signalled one shows ended. |
| S4 AC-26 | `S4.output-during-reload` | One held output proves them: shown once (AC-4), held with no sleep (AC-26), a plain shell (EC-3). |
| S4 AC-28 | `S4.ended-after-reload` | One reload proves them: killed and exited shells stay gone, the signalled one shows ended. |
| S4 AC-31 | `S4.reload-layout` | One reload proves them: the workspace, its rows, the open tabs, the selection, the closed tab. |
| S4 AC-32 | `S4.reload-layout` | One reload proves them: the workspace, its rows, the open tabs, the selection, the closed tab. |
| S4 EC-3 | `S4.output-during-reload` | One held output proves them: shown once (AC-4), held with no sleep (AC-26), a plain shell (EC-3). |
| S5 AC-3 | `S5.close-tab` |  |
| S5 AC-4 | `S5.reopen-from-tree` |  |
| S5 AC-5 | `S5.close-all` |  |
| S5 AC-6 | `S5.output-while-closed` |  |
| S6 AC-7 | `S6.kill-from-tree` | One kill: the shell, its jobs, its tab and its log line all end with it; the decoys must not. |
| S6 AC-8 | `S6.kill-from-tree`, `S6.kill-closed-tab` | `S6.kill-from-tree`: One kill: the shell, its jobs, its tab and its log line all end with it; the decoys must not. |
| S6 AC-9 | `S6.kill-from-tree` | One kill: the shell, its jobs, its tab and its log line all end with it; the decoys must not. |
| S6 AC-10 | `S6.probe-kill` | One `probe kill` in a shared worktree: its shell ends, the neighbour and the worktree stay. |
| S6 AC-11 | `S6.probe-kill` | One `probe kill` in a shared worktree: its shell ends, the neighbour and the worktree stay. |
| S6 AC-12 | `S6.probe-kill` | One `probe kill` in a shared worktree: its shell ends, the neighbour and the worktree stay. |
| S6 AC-13 | `S6.probe-kill` | One `probe kill` in a shared worktree: its shell ends, the neighbour and the worktree stay. |
| S6 AC-14 | `S6.kill-unreachable` |  |
| S6 AC-15 | `S6.remove-workspace` | One removal: its shells end (AC-15) and its folders, the worktree's included, stay (AC-16). |
| S6 AC-16 | `S6.remove-workspace` | One removal: its shells end (AC-15) and its folders, the worktree's included, stay (AC-16). |
| S6 AC-17 | `S6.ended-during-confirm` |  |
| S6 AC-18 | `S6.cancel-kill` |  |
| S6 AC-20 | `S6.kill-from-tree` | One kill: the shell, its jobs, its tab and its log line all end with it; the decoys must not. |
| S6 AC-28 | `S6.kill-from-tree` | One kill: the shell, its jobs, its tab and its log line all end with it; the decoys must not. |
| S6 remove project | `S6.remove-project` |  |
| S7 AC-6 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 AC-7 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 AC-8 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 AC-9 | `S7.switch-workspace` |  |
| S7 AC-10 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 AC-12 | `S7.ended-after-restart` | One restart: each is how the restarted server shows a shell that ended before it. |
| S7 AC-13 | `S7.ended-after-restart` | One restart: each is how the restarted server shows a shell that ended before it. |
| S7 AC-14 | `S7.ended-after-restart` | One restart: each is how the restarted server shows a shell that ended before it. |
| S7 AC-16 | `S7.ended-after-restart` | One restart: each is how the restarted server shows a shell that ended before it. |
| S7 AC-17 | `S7.removed-stay-gone` | The removal, then the same entries after a restart. |
| S7 AC-17 after restart | `S7.removed-stay-gone`, `S7.lost-host` | `S7.removed-stay-gone`: The removal, then the same entries after a restart; `S7.lost-host`: The lost host, then a second restart: the lost entries it removed stay gone (plan D10). |
| S7 AC-18 | `S7.remove-unsaveable` |  |
| S7 AC-19 | `S7.unreadable-workspace` |  |
| S7 AC-20 | `S7.lost-host` | The lost host, then a second restart: the lost entries it removed stay gone (plan D10). |
| S7 AC-21 | `S7.layout-unsaveable` |  |
| S7 AC-22 | `S7.ended-after-restart` | One restart: each is how the restarted server shows a shell that ended before it. |
| S7 AC-23 | `S7.ended-after-restart` | One restart: each is how the restarted server shows a shell that ended before it. |
| S7 AC-29 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 AC-31 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 AC-33 | `S7.remove-workspace` |  |
| S7 AC-34 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S7 EC-1 | `S7.survive-restart` | One restart: every kind of running state is judged after the same restart (EC-3). |
| S8 PRB.E-001 FR-17 | `S8.restore-after-signal`, `S8.restore-after-lost-host` | `S8.restore-after-signal`: The S8 behavior is the E-001 requirement: the restore is the user's, never automatic; `S8.restore-after-lost-host`: One lost host proves the restore (FR-17) and that the lost shell keeps its number (PRB.T-015). |
| S8 PRB.E-001 FR-19 | `S8.no-restore-exit-kill`, `S8.no-restore-moved-folder` | `S8.no-restore-exit-kill`: An exit and a kill are the two ways a shell leaves for good, which FR-19 names; `S8.no-restore-moved-folder`: A missing folder is the other case FR-19 rules out of a restore. |
| S8 PRB.T-015 numbering | `S8.restore-after-lost-host` | One lost host proves the restore (FR-17) and that the lost shell keeps its number (PRB.T-015). |
| S8 no restore for a moved folder | `S8.no-restore-moved-folder` | A missing folder is the other case FR-19 rules out of a restore. |
| S8 no restore for exit or kill | `S8.no-restore-exit-kill` | An exit and a kill are the two ways a shell leaves for good, which FR-19 names. |
| S8 remove after restore | `S8.remove-restored` |  |
| S8 restore after a restart | `S8.restore-after-lost-host` | One lost host proves the restore (FR-17) and that the lost shell keeps its number (PRB.T-015). |
| S8 restore after a signal | `S8.restore-after-signal` | The S8 behavior is the E-001 requirement: the restore is the user's, never automatic. |
| T-002 A-14 | `T-002.restart` |  |
| T-002 AC-1 | `T-002.listed` | One open proves both: the shell starts outside any thread (AC-1) and is listed (AC-3). |
| T-002 AC-3 | `T-002.listed` | One open proves both: the shell starts outside any thread (AC-1) and is listed (AC-3). |
| T-002 AC-5 | `T-002.reload` |  |
| T-002 AC-7 | `T-002.end` |  |
| T-002 AC-15 | `T-002.view` | The view that shows the shell (AC-15) is the one whose pane sets its size (AC-16). |
| T-002 AC-16 | `T-002.view` | The view that shows the shell (AC-15) is the one whose pane sets its size (AC-16). |
| R1 AC-1 | `R1.two-servers` | One second server answers all four: its process and home, its workspaces, and its shells. |
| R1 AC-2 | `R1.two-servers` | One second server answers all four: its process and home, its workspaces, and its shells. |
| R1 AC-3 | `R1.seam` | The seam save is one action: the UI connecting (AC-3) and where the credential went (EC-1). |
| R1 EC-1 | `R1.seam` | The seam save is one action: the UI connecting (AC-3) and where the credential went (EC-1). |
| R1 EC-4 | `R1.two-servers` | One second server answers all four: its process and home, its workspaces, and its shells. |
| R1 a shell on the second server | `R1.two-servers` | One second server answers all four: its process and home, its workspaces, and its shells. |
| E2-S3 AC-1 | `E2-S3.fresh-list` |  |
| E2-S3 AC-2a | `E2-S3.agent-command-ignored` | One plain start in a worktree: what it types (AC-2a, AC-13a) and how it is logged (AC-12). |
| E2-S3 AC-2b | `E2-S3.plain-preselected` |  |
| E2-S3 AC-12 | `E2-S3.agent-command-ignored` | One plain start in a worktree: what it types (AC-2a, AC-13a) and how it is logged (AC-12). |
| E2-S3 AC-13a | `E2-S3.agent-command-ignored` | One plain start in a worktree: what it types (AC-2a, AC-13a) and how it is logged (AC-12). |
| E2-S1 AC-3 | `E2-S1.agent-once-after-prompt` | One modal start of the mock agent: it starts (AC-3) and is typed once after the prompt (AC-10). |
| E2-S1 AC-4 | `E2-S1.second-script` | One start of the echo script: it runs once (AC-4) and its start line names it (AC-12). |
| E2-S1 AC-5 | `E2-S1.preselect-after-restart` |  |
| E2-S1 AC-7 | `E2-S1.removed-falls-back` |  |
| E2-S1 AC-8 | `E2-S1.seed-off-then-on` |  |
| E2-S1 AC-9 | `E2-S1.damaged-kept` |  |
| E2-S1 AC-10 | `E2-S1.agent-once-after-prompt` | One modal start of the mock agent: it starts (AC-3) and is typed once after the prompt (AC-10). |
| E2-S1 AC-12 | `E2-S1.second-script` | One start of the echo script: it runs once (AC-4) and its start line names it (AC-12). |
| E2-S1 AC-21 | `E2-S1.list-offered` |  |
| E2-S1 AC-22 | `E2-S1.renamed-preselected` |  |
| E2-S1 AC-23 | `E2-S1.emptied-not-seeded` |  |
| E2-S4 AC-1 | `E2-S4.missing-program` | One refused start: its alert (AC-1, AC-12 by clicks only), the shell it removes (AC-2), its log line (AC-5) and the modal left open for another try (AC-4). |
| E2-S4 AC-2 | `E2-S4.missing-program` | One refused start: its alert (AC-1, AC-12 by clicks only), the shell it removes (AC-2), its log line (AC-5) and the modal left open for another try (AC-4). |
| E2-S4 AC-4 | `E2-S4.missing-program` | One refused start: its alert (AC-1, AC-12 by clicks only), the shell it removes (AC-2), its log line (AC-5) and the modal left open for another try (AC-4). |
| E2-S4 AC-5 | `E2-S4.missing-program` | One refused start: its alert (AC-1, AC-12 by clicks only), the shell it removes (AC-2), its log line (AC-5) and the modal left open for another try (AC-4). |
| E2-S4 AC-9 | `E2-S4.exiting-command` | One start of an exiting command: the shell stays (AC-9), takes a typed line (AC-10) and stays listed as running (AC-11). |
| E2-S4 AC-10 | `E2-S4.exiting-command` | One start of an exiting command: the shell stays (AC-9), takes a typed line (AC-10) and stays listed as running (AC-11). |
| E2-S4 AC-11 | `E2-S4.exiting-command` | One start of an exiting command: the shell stays (AC-9), takes a typed line (AC-10) and stays listed as running (AC-11). |
| E2-S4 AC-12 | `E2-S4.missing-program` | One refused start: its alert (AC-1, AC-12 by clicks only), the shell it removes (AC-2), its log line (AC-5) and the modal left open for another try (AC-4). |
| T-041a AC-4 reload | `T-041a.hidden-and-reload` | One page with a hidden and a shown tab: each later stage reads the same two tabs again. |
| T-041a AC-4 restart | `T-041a.after-restart` |  |
| T-041a AC-4 second client | `T-041a.hidden-and-reload` | One page with a hidden and a shown tab: each later stage reads the same two tabs again. |
| T-041a AC-6 | `T-041a.hidden-and-reload` | One page with a hidden and a shown tab: each later stage reads the same two tabs again. |
| T-041b AC-11 | `T-041b` |  |
| T-041c AC-12 | `T-041c` |  |

### Needs (AC-4)

All 73 `{}` checks: every workspace, folder, fork name and job marker carries `runId`, and counts, kills and removes are scoped to what the check made (lane searches below). 28 checks get a server of their own; two share the main server and are refused on a sandbox.

| Check | Needs | Cause |
| --- | --- | --- |
| `S1.start-screen` | pristineHome | its home and server-pid guard, and AC-1 on the first page of an empty home (D9 confirmed: the shown workspace is per browser, so only this one needs it) |
| `S1.reload-keeps-saved`, `S1.invalid-workspace` | serverWide: writes into the server's workspaces folder | seeds `delphi-<runId>.json`, `broken-<runId>.json`, `locked-<runId>.json` straight into the folder |
| `S1.folder-unwritable` | serverWide: makes the workspaces folder read-only | `revokeWrite` on `userdata/workspaces` |
| `S2.unstartable-script`, `S3.unstartable-in-worktree` | serverWide: adds a starting script | writes the server's starting-script list |
| `S2.git-init-fails` | condition: git reads a broken global config | `GIT_CONFIG_GLOBAL` points at `<home>/broken-gitconfig`, so the server's `git init` fails |
| `S7.survive-restart`, `S7.ended-after-restart`, `S7.removed-stay-gone` | restart | the restart is the subject |
| `S7.lost-host`, `S8.restore-after-lost-host` | restart | server stop, host stop, start (`S7.lost-host` restarts once more) |
| `S7.remove-unsaveable` | serverWide: makes the state folder read-only | `revokeWrite` on `userdata/shells` |
| `S7.layout-unsaveable` | serverWide: makes the state folder read-only | `revokeWrite` on `userdata/workspaces` |
| `T-002.restart`, `T-041a.after-restart` | restart | the restart is the subject |
| `R1.two-servers`, `R1.seam` | secondServer | `ctx.startSecondServer()`; the seam saves the second server in the browser |
| `E2-S3.fresh-list` | serverWide: depends on the list a fresh state folder offers | asserts the exact list [Plain shell, mock agent] |
| `E2-S3.agent-command-ignored` | condition: the server starts with `PROBE_AGENT_COMMAND` set | the variable must be in the server's start env |
| `E2-S1.list-offered`, `.second-script`, `.renamed-preselected`, `.removed-falls-back`, `E2-S4.missing-program`, `E2-S4.exiting-command` | serverWide: writes the list | `writeStartingScripts` |
| `E2-S1.preselect-after-restart`, `.emptied-not-seeded`, `.damaged-kept` | restart, serverWide: writes the list | the list is written, then the restart is the subject |
| `E2-S1.seed-off-then-on` | restart, serverWide, condition: no mock agent to seed | starts with `PROBE_SEED_MOCK_AGENT` unset, then restarts once with `{}` env (seeding on) |

### Restarts (AC-5)

Old: 14 (SA-2). New: **11 in the 13 old ids**, the plan's number, plus T-041a's own one, so **12 restarts in 10 checks**. Old S7 had 3 and now has 5 (lane 6), which the plan's 11 already counted.

| Check | Restart | Proves |
| --- | --- | --- |
| `S7.survive-restart` | restart | running shells keep pid, output, place, tabs, selection and last start; reattach log line; a live shell in a missing folder (one restart over every kind of state, EC-3) |
| `S7.ended-after-restart` | restart | shells that ended before it stay gone or show ended; the fork worktree is still offered; missing folders are marked |
| `S7.removed-stay-gone` | restart | removed entries and their projects stay gone |
| `S7.lost-host` | host stop + restart, then restart | shells show `lost` and no process survives; after the second restart the removed lost entry stays gone |
| `S8.restore-after-lost-host` | host stop + restart | listed `lost`, keeps "Shell 1", Restore runs it again |
| `T-002.restart` | restart | a standalone shell keeps its pid and stays running |
| `E2-S1.preselect-after-restart` | restart | last starts per project survive; the list file is unchanged |
| `E2-S1.emptied-not-seeded` | restart | an emptied list is not seeded on start |
| `E2-S1.damaged-kept` | restart | a damaged list is kept, logged, and offers Plain only |
| `E2-S1.seed-off-then-on` | restart | a state folder with no list gets the mock agent once seeding is on |
| `T-041a.after-restart` | restart | both tabs show attached and ready again after the shells reattach |

Gone: S2's two (the git fault is now `S2.git-init-fails`'s condition server; the restart to see a new script is dropped because the list is read on every call), S3 AC-22's (read per call), E2-S3's (condition server of `E2-S3.agent-command-ignored`) and E2-S1 AC-8's first (condition server of `E2-S1.seed-off-then-on`).

### Source searches (AC-28, AC-29), at integration

Over `scripts/scenarios/scenarios/*.ts` except the perf files:
- **Process table:** no `pidsRunning` and no `ps`. `S6.kill-from-tree` finds its jobs by the exact argv `sleep <run marker>`; its decoys (`sleep 1601` and another run's marker) start before its jobs, must not match, must outlive the kill, and end by captured pid at step end (D7).
- **Kills:** `NodeProcess.kill(<pid>, "SIGKILL")` five times, each on a pid of a shell the check started (many-shells, restart, restore-shell, kill-shell, plus-modal); every tree kill and `setup.killShell` is on the check's own shells.
- **Counts and removes:** scoped to the check's own projects, shell ids, workspace or fresh page; the Workspaces menu is checked as "includes mine, excludes my removed one"; S3's `[data-worktree]` counts are scoped to its own project (no page-wide count is left, M16).
- **Write access:** six `revokeWrite` calls (boot 2, plus-modal 1, restart 3), each undone at step end, pass or fail. One raw `chmod`: `S7.layout-unsaveable` restores the folder's own mode to see saving resume, before the same undo.
- **Absence:** each after its settling event, per the lane rows (a detached row, a list after a `mark()`, a present row after a reload, the refusal alert).
- **No** `/tmp`, clock reads, typed `sleep`, or `temporary: PRB.T-039` left. One `sleep 0.05` loop remains, in the git hook that holds `S3.fork-double-click`'s fork from the test's side (`holdingHook` in `lib/files.ts`); it is a fixture script, not a scenario wait. It gives up after one library wait (`WAIT_MS`, 200 looks), and the check writes its release file at step end, pass or fail, so a failed wait never leaves the shared server's git hanging (V6, `lib/files.test.ts`).
- **AC-34:** PRB.T-041 landed first; every successor waits on its signals (prompt ready, layout saved, shell ended) through the library.

### Risks for the final phase

- S8 started its API shells after the page showed the workspace (W4's SA-3 note). Its successors now start them before, and a shell started later (the `PRB.T-015 numbering` stage's) waits for its tree row; if the tree misses that list event, the wait fails naming the row.
- `E2-S4.missing-program` AC-2: the scoped count of 0 can be met by a list from before the refused shell's add event, so it may pass early (as the old scenario could).
- `S1.chat-routes-shown` assumes a page load of `/<env>/thread-1` with a workspace shown restores the remembered workspace after the redirect (PRB.T-007); the old S1 page-loaded only with none shown.
- Lines typed on the page (S2, S3, S4, S6, S7, S8 and E2 stages; lane 4's `S4.many-shells` and `S4.reopen-after-reload` among them) are exposed to the PRB.T-041 typed-chunk defect: recorded, not rerun (master plan U7, D5).
- The cap: 28 checks count their own server start, the two-restart `S7.lost-host` and the four E2-S1 restart checks most of all (D10: split further if over, no exception).
- SA-7 (macOS `ps`, `/tmp` link) for the marker and the release stays open until PRB.T-040's macOS run.

### Product defects found in verification

- **"Create workspace" appears late and moves the Workspaces menu under the pointer** (original story PRB.T-003). Symptom: right after a page load, the sidebar's Workspaces menu and the start screen show no "Create workspace" until the page learns its write permission, then insert it above "Open workspace"; a submenu opened in that window shuts and the highlight jumps to "Create workspace". Scenarios: `S3.fork-remembered` (V3 rerun 1) and `E2-S4.exiting-command` (V3 full run 2), both the first scenario on a fresh shared server. Artifacts: `/tmp/probe-scenario-artifacts/2026-11-11T05-37-41-502Z-82729/S3.fork-remembered/`, `/tmp/probe-scenario-artifacts/2026-11-11T05-40-41-857Z-93488/E2-S4.exiting-command/` (traces show the item missing at the click and present at the failure). Suspected cause: `canChange` (`workspaceEnvironment.create.permissionAtom`) resolves after the workspace list, and `WorkspaceSidebar`/`WorkspaceScreen` render the gated items only once it does. The harness now waits for the item before using the menu (`lib/ui/workspacesMenu.ts`).
- **A started agent's program label can stay missing for over 10 s** (original story PRB.T-004). Symptom: a mock agent started by one click on "Create shell" printed its banner and session, but its tab stayed "Shell 1 · repo-2" and its tree row "Shell 1" (no "· node") for the whole 10 s wait; the shell list kept `process: null`. Scenario: `S2.one-click-start`, V4's second `--only shared` run on a sandbox holding about 155 running shells (it passed in the first). Artifacts: `/tmp/probe-scenario-artifacts/2026-11-11T05-57-08-980Z-35838/S2.one-click-start/` (`recorders.json` has an `activity` frame with `hasRunningSubprocess: false` right after the banner). Suspected cause: in `apps/server/src/terminal/Manager.ts`, a process-table snapshot taken before the agent was the shell's child (the native telemetry table, or its silent `ps` fallback, which also backs the poll off) finds no subprocess; the session then counts as quiet, and with every session quiet the poll snapshots only every 30th tick, so the label comes about 30 s late.

### Checks weakened in verification

- **S5 AC-4 and AC-6 cannot be seen on the reopened tab** (V3 `8b277856e`, V4 `a2b914515`, V6). The terminal draws on a canvas, with no DOM text, and a tab closed and reopened quickly may keep the page's attach, so the page gets no new snapshot on reopen and a frame cannot say what the reopened tab draws. `S5.reopen-from-tree` (AC-4: the tab opens again with the running shell) now checks only that: the reopened tab shows attached and ready, and the shell runs; its frame wait counted output printed while the tab was still open, so it proved nothing and is gone. `S5.output-while-closed` (AC-6) proves that the output made while the tab was closed is in the shell's history and reached the page (live while closed, or in a snapshot on reopen), and that the reopened tab shows attached and ready; not that the tab draws it. The old S5 judged AC-6 the same way.

### Deviations from the plan

- `restartAndReload` now always returns after the new connection's first shell list and takes `{ env?, lostHost? }`, where its fifth argument was `env`. Lanes 6 and 7 had each built the same lost-host restart (server stop, host stop, start) and first-list wait; both now call it.
- The lanes' helper modules are folded: workspace following, a signed-in page with recorded frames, the framed world, plain tabs and an uncommitted repo into `lib/setup.ts`; the path wait into `lib/navigate.ts`; the text expectation into `lib/expect.ts`; frame counts into `lib/network.ts`; a written line and its output into `lib/shells.ts`; the starting-script reads and the modal start into `lib/ui/plusModal.ts`, replacing its unused only-Plain check. Seven scenario files had their own copy of the framed page; all use the library's now.
- `S2.grid-size` starts a plain shell, `S2.start-end-lines` is API-only and so does not cover S2 AC-20/AC-23, and `S2.agent-echo` prints no `S2 server pid=` line on a shared server (PRB.T-040 10B keys its SIGKILL case on the shared server's line).
- `T27` and `T28` are registered in `pickedSelftests` (the step brief; the master plan had left self-test arrays to 10B). `harness.test.ts`'s old-id uses are 10B's and `sandbox.test.ts`'s are 10C's; integration removed only the `unshared` row there so the typecheck stays green.
- `S7.lost-host`'s missing grouping comment was added at integration.
- Per lane: lane 1 checks the start-screen refusal on a second fresh page; lane 4 writes S5's earlier lines over the API; lane 5 uses plain shells where the agent was not the subject; lane 6 splits old S7 AC-16 into AC-16 and AC-22 stages and uses two shells in `lost-host`; lane 7 keeps `T-002.restart` as a plain server restart; lane 8 waits for E2-S4 AC-5's log line; lane 9 makes R1's names carry `runId`.

### Commits

Lane 0 `217ebf102` (shared pieces, inventory). Lanes: 1 S1 `ebf67f8bf`, 2 S2 `50203fc58`, 3 S3 `edc8a7c91`, 4 S4/S5/T27/T28 `d605f74e1`, 5 S6 `6341d096c`, 6 S7 `9a8540d4a`, 7 S8/T-002 `7151616c2`, 8 E2 `9338005bb`, 9 R1/T-041a `efd62a9f4`, merged at `6fd865077`. Integration: `feat(scenarios): register atomic scenarios, old ids as sets (PRB.T-039)`, tag `e005-t039`.
