---
id: PRB.T-042
type: story
parent: PRB.E-005
phase: 1
labels: [testing]
created: 2026-11-10
updated: 2026-11-10
---

# Scenario rules load from one scoped file, and lint enforces them in scenario files

## Goal

Scenario rules were spread over AGENTS.md, `docs/internals/testing.md` and `docs/operations/development.md`, had drifted, and loaded for no one; the test lint rules skipped scenario files. They now live in one file that loads when an agent touches a scenario file, and lint covers those files.

## Delivered

- `.agents/rules/scenarios.md`, scoped to `scripts/scenarios` and `scripts/mock-agent`, with `.claude/rules` linking to `.agents/rules`. It holds the rules of epic PRB.E-005's "Notes for stories", with an interim instruction and the owning story for each rule whose mechanism is not built yet.
- AGENTS.md "Verifying", `docs/internals/testing.md`, `docs/operations/development.md`, `README.md` and `docs/README.md` keep one pointer line each. development.md keeps the mock agent CLI and `PROBE_SEED_MOCK_AGENT` under "Mock agent".
- `no-wall-clock-in-tests`, `no-real-time-wait-in-tests` and `no-polling-loop-in-tests` also check files under `scripts/scenarios` and `scripts/mock-agent` (`testFileKind` in `oxlint-plugin-t3code/utils.ts`). `.perf.ts` files may read the clock but not sleep or poll; `waitForTimeout` is reported everywhere. Unit and browser lint output is unchanged.
- Requirements met: FR-15, FR-18, NFR-7, the enforcement part of FR-4, and PRB.T-036's AC-22 (stale doc statements removed).

## Decisions

- **Pointer in AGENTS.md is required (2026-11-10).** A headless session that read no scenario file did not load the scoped rule, so the AGENTS.md line is the only path for an agent that only runs `vp run test:scenarios` or uses a harness that ignores `.claude/rules`.
- **Rules file holds only scenario rules (user feedback, 2026-11-10).** It links to AGENTS.md for the general test rules, lint rule names and the `~/.t3` guard, and names no library exports. Interim lines are gathered in one closing section so a landing story deletes its line. "Running" and the cap gate stay in it (FR-15, NFR-5, FR-9).
- **Every existing lint hit has one outcome.** Fixed: `gone()`'s two `Date.now()` reads became an attempt counter with the same bound. Temporary, naming the removing story: `gone()`'s loop and timer (PRB.T-041, for pids the shell list reports); the S2, E2-S3 and S3 metrics in check scenarios (PRB.T-039). Permanent, by class: (a) runner bookkeeping, six `performance.now()` reads behind one `clock()` helper, the home's creation time (PID-reuse guard) and the run start time (artifacts folder name); (b) event waits that race a deadline and fail naming what was awaited, namely `recorder().until`, `server.logged` and the server start timer; (c) a bounded check loop where no event exists, namely `stopShellHost`, because the detached shell host is not the harness's child and drops its pid file before it exits. Reason forms are in the rules file "Waiting". Later stories remove only what they own.
- **PRB.T-041 reclassifies what remains of `gone()`.** After it drops `gone()` for pids the shell list reports, S6's background jobs (found by process-table pattern) and S7's shells after the shell host stops have no end event, so they become permanent class (c).
- **AC-14 accepted with existing failures (user, 2026-11-10).** One suite run: 7/8 epic scenarios and 4/5 story checks passed; S2 and E2-S1 failed the PRB.T-011 order check because the page's frames began at the mock agent banner (the page attached after the first prompt). Neither scenario's code path changed here; PRB.T-036 owns the order check and PRB.T-041 the prompt-ready signal. `check:changed` failed on local `main` formatting of `Shells.ts` and `Manager.test.ts` and on the `harness.test.ts` SIGKILL cleanup case, not on this change.
- Existing scenarios are converted to the rules in PRB.T-039; the rules bind new and changed scenarios now.

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md)
- [Testing](../../../internals/testing.md)
- [Development runbook](../../../operations/development.md)

## Follow-ups

- Sandbox, shared library and debug log level, atomic and composed scenarios, sets, `.perf.ts` and the cap gate, runner, and signals: PRB.T-037 to PRB.T-041, each writing into the rules file and removing the temporary suppressions it owns.
- Epic PRB.E-005's assumption A-15 (test lint rules apply to scenario files) was false when written and is true now.
