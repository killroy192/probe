---
id: PRB.T-039
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-09
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
- **Gate runs.** After implementing atomic scenarios, the agent asks the user to confirm the machine is quiet and runs PRB.T-043's cap gate once over them; a scenario over 15 s is split further or taken to the epic owner, never rerun unchanged.
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
- **EC-10** A scenario's gate time exceeds 15 s: it is split further, or the epic owner raises the cap for every scenario (epic R-8); it is never rerun unchanged to get under.
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

- **Layers:** `scripts/scenarios` only: the scenario files, their registration and stated needs, the old ids' sets, the composed scenario from converted ones, self-tests of S4's release and S6's marker. No server, web, contracts or product code.
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
| AC-25 | Given every atomic check scenario this story implements and the user's confirmation that the machine is quiet, when the cap gate runs once over them on the devcontainer, then every one is at or under 15 s and the per-scenario times are in the handoff; a scenario over the cap is split further or taken to the epic owner, never rerun unchanged | manual (agent asks the user; one gate run) | FR-22, NFR-1, EC-10, A-13 (epic) |
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
| PRB.T-043 | The check and perf kinds, sets, composed scenarios, the two new needs, the cap gate command and the deliberate-failure self-tests this story uses. | backlog |
| PRB.T-038 | The library every atomic scenario builds its preconditions with, and its composition interface: needs from explicit inputs, results returned as values, unique names per call, the same on every server, nothing cleaned up on its own with remove steps offered. Also the debug log and console in artifacts that FR-19 relies on. | backlog |
| PRB.T-037 | The statement of needs, the sandbox and its refusals, and the "not yet safe" refusals this story converts. | backlog |
| PRB.T-042 | The rules file this story updates, and the lint rules on scenario files (including the `temporary: PRB.T-039` suppressions this story removes). | done |
| PRB.T-036 | The failure artifacts, the PRB.T-011 order check and offsets on frame waits. | code merged 2026-11-10; in progress |
| PRB.T-041 | Not needed to start; the switch rule decides who moves the scenarios to the signals. | backlog |

**Blocks:** PRB.T-040, which runs these scenarios in parallel on shared servers, decides fresh servers from the needs stated here (its EC-17), and runs the whole-suite gate. Tickets that cite old scenario ids or ACs (PRB.T-016 to PRB.T-020, PRB.T-022 and PRB.T-028 among them) resolve them, and the timings they read, through AC-1's mapping.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The desk analysis's split plans, extended to every scenario, keep every criterion, and no criterion holds only because an earlier stage ran. | assumption | unverified (stages read; dependencies between stages not traced fully) | Trace each stage's preconditions while writing AC-1's mapping. | author |
| SA-2 | The old scenarios restart the server 14 times: S2 2, S3 1, S7 3, S8 1, T-002 1, E2-S3 1, E2-S1 5 (the analysis's "3+1+8" counted fewer scenarios). | assumption | verified (read `restart(` and `restartAndReload(` calls, 2026-11-10; not run) | Recount at the start. | author |
| SA-3 | The server reads the starting-script list on every call and writes the default only at start, so adding a script needs no restart. | assumption | verified (read `StartingScripts.ts:42-64`; E2-S1 AC-22 and AC-7 rely on it with no restart) | AC-5, AC-8. | author |
| SA-4 | The mock agent is safe to run from many scenarios on one server: its home is per server home and each session has its own file. | assumption | verified (read `server.ts:210`, `mock-agent.ts:11-14,47`; not run) | AC-3. | author |
| SA-5 | With the library's direct setup, every atomic check scenario fits under 15 s, including those whose gate time counts their own server start (epic A-13). | assumption | unverified | AC-25. | author |
| SA-6 | Leftovers on a long-lived shared server (shells still running from earlier scenarios) do not change later scenarios' results or push them over the cap. | assumption | unverified | AC-3 (sequential, on a sandbox); PRB.T-040's parallel runs and whole-suite gate. | author |
| SA-7 | S4's release and S6's per-run marker behave the same under zsh and bash, on Linux and macOS (macOS `ps` output, `/tmp` being a link there). | assumption | unverified | Plan stage; the macOS run in PRB.T-040 (epic A-16). | author |
| SA-8 | PRB.T-043 ships sets, composition and the needs its ticket describes. | assumption | unverified | Read PRB.T-043's code and handoff before planning. | author |
| SU-1 | Moved to PRB.T-043 (split, 2026-11-10). | – | – | – | – |
| SU-2 | Moved to PRB.T-043 (split, 2026-11-10). | – | – | – | – |
| SU-3 | The exact form of the new ids (old id plus a part name). | unknown | unverified | Plan stage; set names follow PRB.T-043. | TBD (author, plan stage, 2026-11-24) |
| SU-4 | Moved to PRB.T-043 (split, 2026-11-10). | – | – | – | – |
| SU-6 | Moved to PRB.T-043 (split, 2026-11-10); decided there: no perf run before PRB.T-040. | – | – | – | – |
| SU-5 | Whether E2-S2 or E2-S5 has landed as a long scenario when this story starts (EC-11). | unknown | unverified | Read the registry at the start. | TBD (author, at the start, 2026-11-24) |
