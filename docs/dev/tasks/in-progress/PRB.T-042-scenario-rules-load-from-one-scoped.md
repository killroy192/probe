---
id: PRB.T-042
type: story
parent: PRB.E-005
phase: 1
labels: [testing, verify]
created: 2026-11-10
updated: 2026-11-10
---

# Scenario rules load from one scoped file, and lint enforces them in scenario files

## Business Goal

**Problem:** The rules for writing and running scenarios are spread over AGENTS.md "Verifying", `docs/internals/testing.md` and `docs/operations/development.md`, and they have drifted (development.md still says the bundle is built only when missing). Nothing loads them when an agent opens a scenario file, so agents write scenarios from whatever they happened to read. The rules the user set on 2026-11-10 (atomic, composable, saved, deterministic, readable on the first run, no reruns) are written nowhere an agent would see them. The lint rules that forbid sleeps, polling and wall-clock reads in tests do not run on scenario files at all.

**Proposed solution:** One agent rules file, scoped to the e2e files, holds every rule for writing and running scenarios and loads when an agent reads or edits them. AGENTS.md and the docs keep a one-line pointer. The three test lint rules also run on scenario files, so the waiting rules are enforced, not only written.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 2 PRB.T-042 Scenario rules load from one scoped file, and lint enforces them in scenario files
- **Delivers:**
  - FR-15: creates the rules file, scoped to `scripts/scenarios` and `scripts/mock-agent`, and cuts the scenario text from AGENTS.md, `docs/internals/testing.md`, `docs/operations/development.md` and `README.md` down to a one-line pointer.
  - FR-18: the no-throwaway rule, written in the rules file.
  - FR-4 (enforcement part): the epic's FR-4 check is a lint rule that flags a wall-clock delta in a scenario file; this story makes the lint rules match scenario files (epic A-15 is false, see Current Behavior).
  - NFR-7: one rules file that no other doc restates; AGENTS.md "Verifying" keeps the unit and browser rules.
  - It also takes over PRB.T-036's AC-22 (no doc says the bundle is built only when missing, that E2-S3 fails above its budget, or describes helpers that moved), as the epic records.
  - It writes down every rule in the epic's "Notes for stories" list (the user's e2e rules of 2026-11-10), including those whose mechanisms later stories build (FR-9, FR-16, FR-17, FR-19, FR-20, FR-21, FR-22), as rules with an interim instruction until the mechanism exists. Building those mechanisms is not this story.
- **One deployable outcome:** An agent that opens any scenario or mock-agent file gets the full e2e rules in its context from one place, and lint fails a scenario file that sleeps, polls or reads the wall clock; every later story in the epic writes its rules into that file.

## Current Behavior

Verified by reading files on 2026-11-10 (the `cocoindex-code` MCP was not available; searched with grep).

- **Agent rules:** neither `.agents/rules/` nor `.claude/rules/` exists. `.claude/skills` and `.claude/agents` are symlinks to `.agents/skills` and `.agents/agents`. The only always-loaded instructions are `CLAUDE.md` (imports `AGENTS.md`) and `AGENTS.md`.
- **Where scenario rules live today:**
  - `AGENTS.md:186` (Verifying): one bullet on `vp run test:scenarios`, `--only`, the mock agent and "a new user-facing behavior adds or extends a scenario", linking to development.md.
  - `docs/internals/testing.md:26-37` ("Scenario tests"): why a Node runner with Playwright as a library, throwaway home and guard, `PointerPage`, waiting on events, `harness.test.ts`, `registry.ts` and `selftest/`, the mock agent seeding, fault helpers (`server.restart`, `server.logs`, `connectionCutter`, `recorder`, `pageFrames`, `gone` in `support.ts`), and the `check()` message trap. Its opening line says AGENTS.md carries the same writing rules.
  - `docs/operations/development.md:284-306` ("Scenario tests"): how to run, the Chromium install, "builds the web bundle if `apps/web/dist` is missing; pass `--rebuild` after web changes" (stale since the PRB.T-036 merge, which rebuilds when an input is newer, `scripts/scenarios/bundle.ts`), `--only` and `--selftest`, the mock agent CLI usage, `PROBE_SEED_MOCK_AGENT` for `vp run dev`, and the S2 and E2-S3 timing lines (E2-S3 "fails above 700", stale since PRB.T-036 made it a printed metric).
  - `README.md:33`: "scenario tests are in the development runbook"; `docs/README.md:48` links to the development.md `#scenario-tests` anchor.
  - `AGENTS.md:137` and `:211` mention the harness only as a place (test data note, "Where code lives"); not rules.
  - No skill or agent file under `.agents/` restates scenario rules (grep for `test:scenarios`, `scripts/scenarios`, `scenario harness`).
- **Lint:** `t3code/no-wall-clock-in-tests`, `no-real-time-wait-in-tests` and `no-polling-loop-in-tests` are on for the whole repo (`vite.config.ts:288-296`), but each checks the file name and returns early unless it matches `.test.`/`.spec.` (`oxlint-plugin-t3code/rules/no-wall-clock-in-tests.ts:6`, `no-polling-loop-in-tests.ts:6`). Scenario files (`scripts/scenarios/scenarios/*.ts`, `support.ts`, `server.ts`, `run.ts`) are never checked; only `scripts/scenarios/harness.test.ts` is. Epic A-15 is therefore false.
- **What the widened rules would likely hit today** (grep candidates, 2026-11-10; the wall-clock rule flags any `Date.now()`, `performance.now()` or `new Date()`, not only deltas; AC-13 settles the real list from lint output):
  - Runner bookkeeping: `scripts/scenarios/run.ts:66,174,259-273` (per-scenario and total times, NFR-6); `run.ts:180` (the home's creation time, which guards cleanup against PID reuse, `cleanup.ts:149`) and `run.ts:274` (the run's start time, which names the artifacts folder, `environment.ts:83-87`).
  - Timing metrics inside check scenarios: `scenarios/plus-modal.ts:145-154` (S2), `scenarios/starting-scripts.ts:95-98` (E2-S3), `scenarios/worktrees.ts:193-198,285-294` (S3). PRB.T-039 moves these into perf scenarios.
  - Guards on processes the harness owns: `server.ts:156` (a timeout on server start), `server.ts:308-314` (`stopShellHost`, polling `alive(pid)`; scenario steps also call it, `restart.ts:100`, `restore-shell.ts:121`). `server.ts:106` (a kill grace timer) is a candidate the rule may not flag.
  - Deadlines on event waits: `support.ts:55` (`recorder().until`, the frame wait every scenario uses, failing with "Timed out waiting for …") and `server.ts:286` (`server.logged`, failing with "Timed out waiting for the server to log …"; used by `fixtures.ts:124,137`). The deadline turns a missed event into a named failure instead of a hang.
  - Polling for a process to end: `support.ts:110-113` (`gone()`, a 5 s deadline), used by scenarios; PRB.T-041 replaces it for pids the shell list reports, but S6's `allGone` (`scenarios/workspaceUi.ts`) also uses it for background jobs the server does not list.
  - `scripts/mock-agent`: no hit.

## Expected Behavior

### User Flow

1. An agent (Claude Code) is asked to add or change a scenario. It reads or edits a file under `scripts/scenarios/` or `scripts/mock-agent/`; the e2e rules file is loaded into its context without the agent looking for it.
2. An agent in any harness reads AGENTS.md "Verifying" and finds one line: a new user-facing behavior adds or extends a scenario (the always-loaded rule stays), and scenarios have their own rules, in the named file, to read before writing or running one.
3. The agent finds in the rules file, in one place: what a scenario is and the two kinds (check and perf, `<scenario>.perf.ts`); one purpose per scenario; composition and sets; the shared library; no throwaway driver scripts; no reruns of an unchanged scenario (the N-run determinism loop excepted); a failure readable from the first run; debug-level logging, including in product code, never printing secrets; the isolated shell; the 15 s cap as a separate gate run once after a scenario is implemented and again only on the user's request, after the user confirms the machine is quiet; pointer-only input; the waiting rules (no sleeps, polling or wall-clock reads in check scenarios; wait by subscribing to an event, raced against a deadline with a named message; a bounded check loop only where no event exists, with the reason in the code); the throwaway-home guard; how to run one scenario, the suite and the self-tests; and a link to the general test rules in AGENTS.md.
4. Where a rule needs something not built yet (the sandbox, the shared library and the debug log level of scenario servers, sets, composition, `.perf.ts` and the perf run, the cap gate command, the prompt-ready and layout-saved signals), the file says what to do until it exists and which story brings it.
5. The rules file says the rules apply to every new or changed scenario now, and that the existing scenarios are converted in PRB.T-039.
6. The agent writes a scenario that sleeps (a timer in a promise, `timers/promises`, or Playwright's `waitForTimeout`), polls in a loop, or reads the clock; lint fails it, naming the rule. In a `.perf.ts` file, reading the clock is allowed, sleeping and polling are not.
7. A maintainer reads `docs/operations/development.md` or `docs/internals/testing.md` and finds a one-line pointer to the rules file where the scenario section was; development.md still describes the mock agent CLI and `PROBE_SEED_MOCK_AGENT` for `vp run dev`.

### Edge Cases

- **EC-1** An agent in a harness that does not read `.claude/rules` (Codex and others): the AGENTS.md pointer names the file and says to read it first.
- **EC-2** An agent runs `vp run test:scenarios` or verifies a feature without opening a scenario file, so path-scoped loading never triggers: the AGENTS.md pointer covers it.
- **EC-3** A session that touches no e2e file: the rules file is not loaded (it is scoped, not global).
- **EC-4** A rule whose mechanism a later story builds: the file gives the interim instruction and names the story; every command in the file behaves as the file describes when run today (the self-tests exit non-zero by design).
- **EC-5** An existing scenario that breaks a new rule (S2 both checks and measures): the rules file says existing scenarios are converted in PRB.T-039; the rule binds new and changed scenarios now.
- **EC-6** An existing lint hit falls in exactly one of these outcomes, the same everywhere in this story: (1) fixed in this story; (2) a temporary suppression whose reason names the later PRB.E-005 story that removes it, by that story's ownership in the epic even where its ticket is not reworked yet (PRB.T-039 for the metrics in check scenarios, as it owns FR-11 and FR-16; PRB.T-041 for `gone()` where the shell list reports the pid; any other story whose epic-owned FRs remove the hit); (3) a permanent suppression, only in one of these classes, wherever the code sits (runner, library or server-handle helper), and only where the code cannot be written without a clock or timer: (a) runner bookkeeping, which waits for nothing: its timing output (NFR-6, not a scenario recording a duration) and its timestamps (artifact folder names, the PID-reuse guard); (b) an event wait: the code subscribes to the event it needs (a terminal frame, a log line, a process exit) and races it against a deadline that fails with a message naming what was awaited, so a missed event is a readable first-run failure (epic FR-19) instead of a hang; (c) a bounded check loop, only where no event exists to subscribe to (for example the end of a process the harness did not start as its own child, or a server that is up only once it answers), with the reason naming the missing event. A fixed sleep that waits and hopes is never suppressed: it is fixed or temporary (user decision, 2026-11-10: waiting by time is allowed only when no event-based way exists).
- **EC-7** A `.perf.ts` file reads the clock: not flagged; the same file sleeping or polling: flagged.
- **EC-8** A file under `scripts/mock-agent/` sleeps or polls: flagged like a scenario file.
- **EC-9** Unit and browser test files: lint behaves exactly as before.
- **EC-10** A stale statement survives the move (the bundle built only when missing, E2-S3 failing above its budget, a helper in the wrong module): it is not carried into the rules file.

### Error Handling

- **ER-1** The rules file does not load through the `.claude/rules` symlink (SA-1 false): the story does not close; the plan picks a layout that keeps `.agents/rules/` as the source and does load, and records why.
- **ER-2** A widened lint rule flags a hit that is in neither permanent class and that no later story removes: it is fixed in this story, not suppressed.
- **ER-3** A suppression without a reason: `t3code/require-suppression-reason` fails it, as elsewhere in the repo.
- **ER-4** A doc still restates a scenario rule after the cut: the docs review fails (AC-6), and the text is removed, not reworded.

## Out Of Scope

- Unit (`*.test.ts`) and browser (`*.browser.test.tsx`) test rules: they stay in AGENTS.md and `docs/internals/testing.md` (epic Out, user decision 2026-11-10).
- Building any mechanism the rules describe: the sandbox (PRB.T-037), the shared library and debug log level (PRB.T-038), atomic and composed scenarios, sets, `.perf.ts` files and the cap gate command (PRB.T-039), the perf run and the new runner (PRB.T-040), the signals (PRB.T-041). This story writes the rules and interim instructions only.
- Converting existing scenarios to the new rules, including moving the S2, S3 and E2-S3 metrics into perf scenarios: PRB.T-039.
- Removing `gone()` polling: PRB.T-041.
- Rule loading in harnesses other than Claude Code beyond the AGENTS.md pointer (epic Out, R-9).
- Reworking PRB.T-037 to PRB.T-041 to match the epic: separate story-skill sessions.
- Any change to scenario behavior or results: the suite passes as before.

## Technical Scope

- **Layers:** agent instructions (a new rules folder and file, with the Claude Code link to it); repo docs; the repo's lint plugin and lint config (file matching of three existing rules, and `no-real-time-wait-in-tests` also recognizing Playwright's fixed-time wait, which it does not today); harness and scenario code only where a lint hit is fixed or given a stated reason. No server, web, contracts or product code.
- **Docs impact:** new rules file (in `.agents/rules/`); `AGENTS.md` ("Verifying" scenario bullet becomes one pointer line; the documentation table gets a row for the rules folder); `docs/internals/testing.md` ("Scenario tests" becomes one pointer line; the opening line stays accurate for unit and browser rules); `docs/operations/development.md` ("Scenario tests" becomes one pointer line; the mock agent CLI and `PROBE_SEED_MOCK_AGENT` text for `vp run dev` stay); `README.md:33` and the `docs/README.md:48` link point at the rules file (or at the pointer line, if the anchor stays).
- **Mobile impact:** none; nothing mobile-facing changes.

## Non-functional Requirements and Constraints

- The rules folder is `.agents/rules/`, and `.claude/rules` links to it, the same pattern as `.agents/skills` (epic Dependencies, user decision 2026-11-10).
- The rules file is the single source for writing and running scenarios: no other doc or skill restates any of it; it links to the general test rules in AGENTS.md instead of copying them (epic FR-15, NFR-7).
- Rewrite, do not append: the removed doc sections are replaced by a pointer, not kept beside it (AGENTS.md documentation rules).
- Unit and browser test lint behavior must not change; the existing rule tests in `oxlint-plugin-t3code/rules/*.test.ts` keep passing.
- Every lint suppression carries a reason (`t3code/require-suppression-reason`), and a temporary one names the story that removes it.
- One run, no reruns: the suite check in AC-14 is a single run (epic FR-19).
- Agent-facing text follows the repo's writing style (short, plain, no history narration); the repo's evals cover model-facing product text, not this file (no eval run needed).

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given a fresh Claude Code session in this repo, when the agent reads a file under `scripts/scenarios/` and, in another fresh session, a file under `scripts/mock-agent/`, then the rules file is in its context both times. | manual (developer, two fresh sessions) | FR-15, SA-1, ER-1 |
| AC-2  | Given a fresh Claude Code session, when the agent reads only files outside `scripts/scenarios/` and `scripts/mock-agent/`, then the rules file is not in its context. | manual (developer) | FR-15, EC-3 |
| AC-3  | Given AGENTS.md after the change, when read, then "Verifying" holds exactly one line about scenarios, which keeps the rule that a new user-facing behavior adds or extends a scenario, names the rules file and says to read it before writing or running a scenario; the documentation table lists the rules folder; no other scenario rule is in AGENTS.md. | manual (docs review) | FR-15, NFR-7, EC-1, EC-2 |
| AC-4  | Given `docs/internals/testing.md`, `docs/operations/development.md`, `README.md` and `docs/README.md` after the change, when read, then each holds at most one line about writing or running scenarios, pointing to the rules file; development.md still describes the mock agent CLI and `PROBE_SEED_MOCK_AGENT` for `vp run dev`; testing.md's opening line says AGENTS.md carries the same rules for unit and browser tests only. | manual (docs review) | FR-15, NFR-7 |
| AC-5  | Given the rules file, when read against the epic's "Notes for stories" rules list and the current `docs/internals/testing.md` scenario section, then it states every rule on that list (library, one purpose, composition, check vs perf and `<scenario>.perf.ts`, no throwaway driver scripts with the manual checks AGENTS.md requires unaffected, no rerun of an unchanged scenario with the N-run determinism loop as the one exception, first-run diagnosis, debug-level logging that never prints secrets, isolated shell, waiting by event with a time-based wait only where no event exists, the 15 s cap gate with the user's confirmation and never on a normal run) and every still-true statement of the old `docs/internals/testing.md` and `docs/operations/development.md` scenario sections (for example the throwaway-home guard, pointer-only input, waiting on events, the `check()` message trap, `registry.ts` and `selftest/`, the fault helpers, the mock agent seeding, the Chromium install) ends up either in the rules file or, as a non-rule fact, in a doc (SU-3), with nothing dropped; and it links to the general test rules instead of copying them. | manual (developer, checklist) | FR-15, FR-18, NFR-7 |
| AC-6  | Given `AGENTS.md`, `README.md`, `docs/user`, `docs/operations`, `docs/internals`, `.agents/skills`, `.agents/agents` and the rules file (`docs/dev` excluded: tickets and the roadmap restate rules on purpose), when searched, then no text says the bundle is built only when missing or needs `--rebuild` after web changes, that E2-S3 fails above a budget in the suite, or names a helper in a module it is not in; no scenario rule appears in any doc other than as the pointer line. | manual (docs diff review) | PRB.T-036 AC-22, EC-10, ER-4 |
| AC-7  | Given the rules file, when each rule whose mechanism is not built yet is read, then it has an interim instruction and names the story that brings the mechanism; and when every command in the file is run once (the suite command's run is AC-14's run, not a second one; the single-scenario command is checked on the picked self-test `second-server-failure` (`--selftest --only T3`), which neither the suite nor a plain `--selftest` run executes, so no scenario runs twice; the interim cap-gate procedure is not run here, since it runs only after a scenario is implemented or on the user's request), then each behaves as the file describes. | manual (developer runs each command once) | FR-15, EC-4 |
| AC-8  | Given the rules file, when read, then it says the rules bind every new or changed scenario now and that existing scenarios are converted in PRB.T-039. | manual (review) | EC-5 |
| AC-9  | Given a file under `scripts/scenarios/` and one under `scripts/mock-agent/`, when either holds a delta of two clock reads, a real-time sleep, or a polling loop, then lint reports `no-wall-clock-in-tests`, `no-real-time-wait-in-tests` and `no-polling-loop-in-tests` respectively. | auto (lint rule tests) | FR-4, EC-8 |
| AC-10 | Given a `<scenario>.perf.ts` file, when it reads the clock, then lint reports nothing; when it sleeps or polls, then lint reports it as in AC-9. | auto (lint rule tests) | FR-4, EC-7 |
| AC-15 | Given a file under `scripts/scenarios/` that calls Playwright's fixed-time wait (`waitForTimeout`), when lint runs, then `no-real-time-wait-in-tests` reports it, in `.perf.ts` files too. | auto (lint rule tests) | FR-4 |
| AC-11 | Given the existing `*.test.*` and `*.spec.*` cases of the three rules, when the rule tests run, then they pass unchanged. | auto (lint rule tests) | EC-9 |
| AC-12 | Given the change, when lint runs on `scripts/`, then it passes; every remaining hit carries a suppression with a reason; each temporary one names the PRB.E-005 story that removes it; each permanent one names its EC-6 class, and a class (c) one names the event that does not exist; no permanent suppression covers a fixed sleep, a check loop where an event exists, or a clock delta in a check scenario. | auto (lint) and manual (review of each suppression) | FR-4, EC-6, ER-2, ER-3 |
| AC-13 | Given the change, when the plan's grep of the harness and the lint output are compared, then every lint hit appears in exactly one EC-6 outcome (fixed, temporary with its story, permanent with its class), in a table in this ticket's handoff. | manual (developer, a table in the handoff) | EC-6, ER-2 |
| AC-14 | Given the change, when `vp run test:scenarios` runs once, then every scenario passes as it did before the change, and `vp run check:changed` passes. | auto | Out Of Scope (no change to scenario behavior), FR-4 |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-036 | The rules file describes the harness as PRB.T-036 left it (rebuild on change, isolated shell, offsets, failure artifacts); AC-22 moves here | code merged 2026-11-10; ticket in progress |
| PRB.E-005 | The rules list and the interim stories come from the epic | approved 2026-11-10, in backlog |

PRB.T-037 to PRB.T-041 depend on this story (they write their rules into the file); none of them is a prerequisite. As written today they still put scenario docs into `docs/operations/development.md` and `docs/internals/testing.md` and do not mention PRB.T-042; their rework (epic, Stories) must land before any of them starts.

## Assumptions

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | Claude Code loads a rules file from `.claude/rules/` with path globs when the agent reads or edits a matching file, also when `.claude/rules` is a symlink to `.agents/rules` (epic A-14). | assumption | verified | First step of implementation: one rule file, a fresh session reading a scenario file (AC-1). Pre-check 2026-11-10, `claude -p --model haiku --allowedTools Read`, stub rule with a marker: loaded after reading `scripts/scenarios/support.ts` and `scripts/mock-agent/mock-agent.ts` (only that file read, through the symlink), not after `apps/web/package.json`. The developer checked AC-1 and AC-2 in fresh interactive sessions, 2026-11-10: as expected. | author |
| SA-2 | The three test lint rules apply to scenario files (epic A-15). | assumption | false | Read 2026-11-10: each matches only `.test.`/`.spec.` file names (`oxlint-plugin-t3code/rules/no-wall-clock-in-tests.ts:6`). This story widens them (AC-9). | author |
| SA-3 | The three rules can match more files without changing what they report in `*.test.*` and `*.spec.*` files. | assumption | verified | 2026-11-10: the existing cases of the three rule tests pass unchanged; test-file messages are byte-equal (AC-11). | author |
| SA-4 | No skill or agent file restates scenario rules, so the docs listed in Current Behavior are the whole cut. | assumption | verified | grep of `.agents/`, `AGENTS.md`, `docs/` (outside `docs/dev`) and `README.md` for `test:scenarios`, `scripts/scenarios`, `scenario harness`, `scenario tests`, 2026-11-10 (the last term found `docs/README.md:48`). | author |
| SA-5 | The list of existing lint hits in Current Behavior is complete. | assumption | verified | 2026-11-10: the widened lint reported exactly the Current Behavior candidates, 26 errors; `server.ts:106` was not flagged; `scripts/mock-agent` had none (AC-13 table in the Handoff). | author |
| SU-1 | Which EC-6 outcome each real lint hit gets (the `server.ts` guards, the event-wait deadlines in `support.ts` and `server.ts`, the runner timestamps, `gone()` and the metrics). | unknown | verified | Settled 2026-11-10; the table in the Handoff. | author |
| SA-6 | PRB.T-041 removes `gone()` polling wherever the shell list reports the pid; what remains (S6's `allGone` for background jobs the server does not list) has no exit event to subscribe to and fits EC-6 class (c). | assumption | verified | 2026-11-10: PRB.T-041 AC-13 drops `gone()` only for pids the shell list reports; S6's jobs (`kill-shell.ts:119-125`) are found by a process-table pattern and have no exit event. `gone()`'s loop stays temporary for PRB.T-041, because some of its callers do have an event today; PRB.T-041 reclassifies the remainder as class (c). | author |
| SU-2 | Whether path-scoped rules also load when an agent only runs a command and reads no file. | unknown | verified | Pre-check 2026-11-10: a headless session that read no file did not have the rule, so the AGENTS.md pointer is the only path for EC-2. | author |
| SU-3 | Which of today's development.md and testing.md details a maintainer (not an agent) still needs outside the rules file, such as the Chromium install line. | unknown | verified | 2026-11-10: only the mock agent CLI usage and `vp run dev`'s `PROBE_SEED_MOCK_AGENT` seeding stay in development.md (now its own "Mock agent" section); everything else, including the Chromium install line and the Node-runner rationale, is in the rules file. | author |

## Handoff

- **Rules loading (SA-1, SU-2).** Verified: headless Haiku pre-check, then the developer's AC-1 and AC-2 sessions (2026-11-10).
- **Lint design.** `testFileKind` in `oxlint-plugin-t3code/utils.ts` decides what the three rules check: `*.test.*`/`*.spec.*` as before, plus any file under `scripts/scenarios/` or `scripts/mock-agent/`; `.perf.ts` there is exempt from the clock rule only. In e2e files the messages point to the rules file. `waitForTimeout` is reported in every checked file (no code used it, so unit and browser lint output is unchanged).
- **Lint hits (AC-13).** The suppression reason forms are written in the rules file ("Waiting").

| Hit | Rule | What it is | Outcome |
| --- | --- | --- | --- |
| `support.ts` `recorder().until` timer | real-time-wait | deadline on a value, named in the failure | permanent (b) |
| `server.ts` `server.logged` timer | real-time-wait | deadline on a log line, named | permanent (b) |
| `server.ts` start timer | real-time-wait | deadline raced against output, exit and the HTTP answer, named | permanent (b) |
| `server.ts` `stopShellHost` loop and timer | polling, real-time-wait | the detached shell host is not the harness's child, and `host.ts:161` drops its pid file before it exits, so no event marks its end | permanent (c) |
| `support.ts` `gone()` two `Date.now()` reads | wall-clock | the 5 s deadline | fixed: an attempt counter, same bound |
| `support.ts` `gone()` loop and timer | polling, real-time-wait | process-end wait | temporary, PRB.T-041 (SA-6) |
| `run.ts` six `performance.now()` reads | wall-clock | printed timing (NFR-6) | permanent (a), behind one `clock()` helper with one suppression |
| `run.ts` `homeCreatedMs` | wall-clock | PID-reuse guard (`cleanup.ts:149`) | permanent (a) |
| `run.ts` `startedAt` | wall-clock | names the artifacts folder | permanent (a) |
| `plus-modal.ts` (3), `starting-scripts.ts` (2), `worktrees.ts` (4) | wall-clock | S2, E2-S3 and S3 metrics in check scenarios | temporary, PRB.T-039 |

- **Docs.** AGENTS.md "Verifying" keeps one scenario line; the documentation table has a `.agents/rules/` row. `testing.md` and `development.md` keep their "Scenario tests" headings (for the anchors) with one pointer line; the mock agent text in development.md moved under "Mock agent". `README.md` and `docs/README.md` link the rules file.
- **Commands run once (AC-7).** Chromium install: exit 0. Both mock agent commands behave as documented. `--selftest`: T1 and T4 pass, T2 fails by design. `--selftest --only T3`: fails by design (a second server that cannot start, `MODULE_NOT_FOUND` for the missing bin); the rules file now says T3 is a deliberate failure too.
- **AC-14, accepted with existing failures (user decision, 2026-11-10).** One suite run, 2026-11-10 (bundle current): 7/8 epic scenarios and 4/5 story checks pass. S2 (AC-7/AC-12/AC-24) and E2-S1 (AC-3) fail the PRB.T-011 order check: the shell frames the page received start at the mock agent banner, so the first prompt and the typed command never reached the page (`shellOutput(frames.seen.slice(framesBefore), …)`). This looks like a race between the shell starting and the page subscribing. Neither scenario's code path changed in this story (only comment lines in `plus-modal.ts`; S2 fails before its one `gone()` call), and this run had no rerun. The order check is PRB.T-036's (FR-3), and the prompt-ready signal is PRB.T-041's. `vp run check:changed` fails on two things from local `main`, not from this branch: the format of `apps/server/src/terminal/Shells.ts` and `Manager.test.ts`, and `harness.test.ts` "cleans up after a runner killed with SIGKILL", which reads the shells `registry.json` before it exists after S2's first shell. Local `main` is 90 commits ahead of `origin/main`, which `check:changed` diffs against. Lint, knip, typecheck and the other 449 tests pass. These failures are left to PRB.T-036, whose handoff is open.
- **Rules file review (user feedback, 2026-11-10).** The file holds only scenario-specific rules and links to AGENTS.md for the general test rules, the lint rule names and the `~/.t3` guard. It names no library exports, and keeps fault-helper and root-check notes only as rules (the code documents the APIs). The interim lines are gathered in a closing section, so a landing story deletes its line. "Running" and the cap gate stay in the file, as FR-15, NFR-5 and FR-9 require (user decision, same day). AC-5's "nothing dropped" therefore holds for rules, not for API descriptions the code carries.
- **For PRB.T-037 to PRB.T-041.** Write rules into `.agents/rules/scenarios.md` in the change that alters the harness, replace its interim lines, and remove the temporary suppressions you own.

