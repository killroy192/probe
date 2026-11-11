---
id: PRB.E-005
type: epic
parent:
phase: 1
labels: [testing]
created: 2026-11-09
updated: 2026-11-11
---

# Fast, deterministic scenario tests

## Goal

The scenario suite (`vp run test:scenarios`) was slow, flaky and hard to trust: each long scenario cold-started its own server, set up its world through dialogs it was not testing, used guessed waits, ran the developer's shell config and tested a stale bundle, and agents wrote throwaway driver scripts ([analysis](../../research/scenario-harness-analysis.md), 2026-11-09). As delivered, the suite is saved atomic check scenarios and `.perf.ts` perf scenarios, composable and runnable as sets, on Playwright Test with shared servers and parallel workers, under a 20 s cap per check, with a sandbox for agents and one scoped rules file.

## Result

- **Primary, longest atomic check scenario in a cap gate run.** Baseline 41.0 s (S7, 2026-11-10, PRB.T-036). Target 20 s (raised from 15 s, user, 2026-11-11). Reached 2026-11-11 (V7, machine confirmed quiet, tip `abbe5f6db`): 103 checks timed, none over 20 s, slowest `S7.lost-host` 16.6 s. Met.
- **Guardrail, flake rate over N = 3 runs of the check suite and the perf run, no retries.** Baseline 3 of 7 full runs with a failure (2026-11-10, PRB.T-036). Target 0 failures. Reached 2026-11-11: check suite 104/104 in each of 3 runs; perf run 5/5 alone, but in the loop `perf-branch-label` missed its 2 s limit in 2 of 3 runs (2042 and 2055 ms); after the user raised it to 3 s (`e8d448013`), 0 misses in 3. Met after that change.
- **Setup over the API (FR-10).** Setup round trips 1123 to 464 (desk count, threshold 561). One serial suite run before at `ebb9d3287` (info level): 13/16 passed in 350.8 s; after at tag `e005-t038` (debug level): 14/16 in 284.4 s, both failures in code that exists only at the tag and fixed at the tip.
- **macOS (NFR-4):** not measured; the run was skipped by the user (2026-11-11).

## Delivered by

- PRB.T-036 Scenario quick fixes: clean shell, auto-built bundle, no wall-clock gates, readable failures
- PRB.T-042 Scenario rules load from one scoped file, and lint enforces them in scenario files
- PRB.T-037 Scenario sandbox: keep a server up and run saved scenarios against it
- PRB.T-041 Prompt-ready and layout-saved signals so scenarios stop guessing
- PRB.T-038 Shared e2e library: direct setup over the API, one real UI path per action, waits and debug logging
- PRB.T-043 Check and perf kinds, sets, composed scenarios and the cap gate
- PRB.T-039 Convert every scenario into atomic, composable check scenarios
- PRB.T-040 Run scenarios on Playwright Test with a shared server and parallel workers

Merged to `main` in `d9a240c6b` (PRB.T-038, T-043, T-039, T-040) and `a58600d79` (scenario docs); the earlier stories merged on their own.

## Decisions

- 2026-11-09 to 2026-11-10, user: the KPI caps one atomic check scenario, not the suite total, because the suite grows with every feature; no median or best-of, because a scenario that passes only on some runs is the problem. Perf and composed scenarios are outside the cap. The product decisions (atomic, check or perf, no throwaway scripts, no reruns, debug-level product logs, isolated shell, one rules file) are in [roadmap.md](../../roadmap.md) "Scenario tests".
- Out of scope, with reasons: unit and browser tests (their rules stay in AGENTS.md and `testing.md`); a CI gate (not asked for); weakening what scenarios prove (real PTYs, git, restarts, pointer-only input stay); product performance budgets (owned by product epics); ad-hoc sandbox probes; behavior under a developer's own shell config; mobile and desktop.
- Rejected: only parallelizing the old runner (flaky waits and shared state get worse under load); deleting or loosening checks; a mock server (restarts, PTYs and websockets are the product); "rerun from stage N" on long scenarios (cannot run or compose one behavior); rules kept in AGENTS.md and docs (load for every task, already drifted).
- The Playwright Test path, no fallback: `@playwright/test` ran on the cached Chromium with no download (A-5), and scenarios that name what they make by run share a server one after another (A-4, PRB.T-037, 2026-11-10), as a set on one sandbox (set `shared`, PRB.T-039) and in parallel (V7 loop, 2026-11-11).
- 2026-11-10, user: PRB.T-039 split, its building blocks to PRB.T-043; N = 7, then N = 3 (2026-11-11). 2026-11-11, user: the cap raised from 15 s to 20 s for every scenario (R-8: no per-scenario exceptions).
- 2026-11-11, user: FR-10's round-trip unit and threshold (PRB.T-038 Decisions); E2-S3 accepted at its count over its own threshold (24 against at most 19; its successors have no restart); the two narrowed S5 checks accepted (PRB.T-039 Decisions); PRB.T-038's AC-25 accepted with its tag-only failures; the branch-label limit (PRB.T-005 AC-26) raised from 2 s to 3 s; the macOS run (A-16, PRB.T-040 AC-26) skipped.
- 2026-11-11, user (`a58600d79`): scenarios cite the requirements in `docs/scenarios` (`verifies`), never tickets or ACs.
- Assumptions settled: A-1 false (the S2 failure came from reading page frames, PRB.T-036); A-2 true (PRB.T-041); A-3 built (PRB.T-041 covers restore and takeover); A-7 true (setup round trips 1123 to 464, suite 350.8 s to 284.4 s); A-10 fixed (PRB.T-036); A-12 true (debug below the `Info` default); A-13 true (cap gate above); A-14 true (PRB.T-042: the rule loads through the `.claude/rules` link when a scenario file is read); A-15 false then made true (PRB.T-042 widened the lint rules). A-6 (SIGKILL teardown loses nothing a scenario checks) was not checked on its own; the suite has torn down by SIGKILL since PRB.T-036. Not measured and moot once every scenario shared a server: A-8 (the harness is the slowest pre-push check) and A-9 (cold starts and UI setup are most of the run time). A-11 (parallel load exposes guessed waits) could not be checked: PRB.T-041's signals landed before the parallel runner, and the run after them had 0 check failures.

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md): writing, running, the library, the sandbox, kinds, sets, the runner, the cap gate and the loop.
- [Scenario requirements](../../../scenarios/README.md): the FR/NFR rows scenarios verify.
- [Terminal runtime](../../../internals/terminal-runtime.md): the prompt-ready signal and a kill that follows the process end.
- [roadmap.md](../../roadmap.md) "Scenario tests".

## Follow-ups

- The harness on macOS (A-16): [questions.md](../../questions.md).
- Whether web diagnostic lines can be hidden in production (U-3): [questions.md](../../questions.md).
- Two suites at once beside a dev server, and an agent following only the rules file on a sandbox under the new runner: no recorded run (PRB.T-040 Follow-ups).
- Product defects found in verification: typed lines lose a chunk (PRB.T-044), "Create workspace" shows late (PRB.T-045), an agent's label missing for over 10 s (PRB.T-046).
- Smaller untracked items are in each story's Follow-ups.
