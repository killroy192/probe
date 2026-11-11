---
id: PRB.T-043
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-10
updated: 2026-11-11
---

# Check and perf kinds, sets, composed scenarios and the cap gate

## Goal

Scenarios had no kind, no grouping and no composition, timings sat inside check scenarios, and nothing measured the 20 s cap. This story gave the harness its building blocks: check and perf kinds, named sets, composed scenarios, two more stated needs, and the cap gate command, so PRB.T-039 could convert every scenario into atomic ones.

## Delivered

Built on branch `e005` (tag `e005-t043`), merged to `main` in `d9a240c6b` (PRB.E-005). Main commits: `fbdfdfff8` (kinds, registry rules, composition, gate, sandbox rules), `62da8f047` (start env and unexpected-exit signal on the server handle), `cc1ecd7b3` (registration through `defineCheck`), `7ff929c38` (five `.perf.ts` scenarios; timings and the nine temporary suppressions out of S2, S3 and E2-S3), `6e5e1dbbd` (self-tests T16 to T26 and their sets), `80250fd20` (rules file). The runtime parts (selection, composition, step undos, condition env, the gate, sandbox sets) run on PRB.T-040's runner, and their spawned harness cases were written there (`e65f35986`, `f90f145ba`).

- Epic requirements: FR-16, FR-17 (mechanism, including the sandbox), FR-19 (deliberate-failure self-tests), FR-22 (gate command), FR-9 (needs `serverWide` and `condition`), NFR-5, NFR-6.
- Perf scenarios: `perf-tree-node` (1 s), `perf-start-to-banner` (2 s), `perf-branch-label` (3 s), `perf-prompt-server` and `perf-prompt-harness` (700 ms each).

| AC | Proved by |
| --- | --- |
| AC-1, AC-16 | `vp run test:scenarios` (104/104 in V7), plus `--selftest`, `harness.test.ts` and `vp run check:changed` in the epic's final verification |
| AC-2 | lint, plus a source search at `5f6a76288` (no clock reads, `METRIC` or `temporary: PRB.T-039` in check files) |
| AC-3, AC-5, AC-8, AC-9 | `registryRules.test.ts`, `registry.test.ts`, `harness.test.ts` refusal cases |
| AC-4 | review of the five `*.perf.ts` files |
| AC-6, AC-7, AC-14 | set `T-compose` (T21, T22, T17, T25) in `harness.test.ts`; `compose.test.ts` |
| AC-10 | `sandbox.test.ts`: `T-sandbox` and T22 pass; `T-restart-set` and T26 refused |
| AC-11 | set `T-needs` (T23, T24) in `harness.test.ts`; their sandbox refusals in `sandbox.test.ts` |
| AC-12 | set `T-diagnosis` (T18, T19, T20) in `harness.test.ts` |
| AC-13 | `gate.test.ts` and the `T-gate` cases in `harness.test.ts` |
| AC-15 | review of `.agents/rules/scenarios.md` |

- 2026-11-11, V7 on tip `abbe5f6db`: the cap gate timed 103 scenarios with none over 20 s (slowest S7.lost-host, 16.6 s). The perf run passed 5 of 5, but in the N=3 loop `perf-branch-label` missed its then 2 s limit in 2 of 3 runs, so the limit was raised (Decisions).

## Decisions

- 2026-11-10, user: split from PRB.T-039 (candidate # 5) because one story with 35 acceptance criteria was too big to plan and review. This story is the harness part; PRB.T-039 does the conversion.
- 2026-11-10, user: perf scenarios run only in PRB.T-040's serial perf run, never by id before that run existed.
- 2026-11-10, user (SU-1, SU-2): E2-S3's harness-side click to prompt asserts PRB.E-002's 700 ms (PRB.T-028 reads it). S3's fork-start time is dropped because no limit or reader exists. The branch label used PRB.T-005 AC-26's 2 s, not the old 4000 ms harness gate.
- 2026-11-11, user: the branch-label limit was raised from 2 s to 3 s (`e8d448013`). The server re-reads HEAD on a 2 s poll, so a label can lag a switch by a full interval plus the read.
- 2026-11-11, user (SU-3, master plan U2): one repeatable `--only <name>` for an id, a set or a composed scenario, with no `--set` flag; the gate is `vp run scenarios:gate -- [--only <name>]... --quiet-confirmed`; self-test sets are named `T-<name>`.
- 2026-11-11, user (SU-4, plan D5): the two new needs are separate `serverWide` and `condition` fields, not folded into PRB.T-037's existing needs. A condition is a function of the home.
- The gate's server-start time is not a separate measure (plan step B1's `serverStartMs` was dropped). PRB.T-040 times each scenario after the shared server is ready, and a fresh server's start counts (master plan M13).

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md): kinds, needs, sets and composed scenarios, step undos, the cap gate, the self-tests.
- [Worktrees](../../../scenarios/worktrees.md) and [Starting scripts](../../../scenarios/starting-scripts.md): the NFRs the perf scenarios verify.
