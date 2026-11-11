---
id: PRB.T-040
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-11
---

# Run scenarios on Playwright Test with a shared server and parallel workers

## Goal

The scenario suite ran one scenario at a time with a cold server each, no trace on failure, no perf command and nothing stopping a retry. It now runs on Playwright Test in parallel workers, one shared server per worker and a fresh one only for scenarios that need it, with traces, a serial perf run, retries refused and one documented N-run loop.

## Delivered

Merged in `d9a240c6b` (PRB.E-005; this story ends at tag `e005-t040`). Main commits: launcher and config `a6773ad16`, fixtures `e68107782`, perf run, gate, sandbox runs and loop `13c8c0913`, harness and sandbox tests with `run.ts` retired `f90f145ba` and `e65f35986`, rules `98c9e3295`, then the verification fixes up to `abbe5f6db`.

Epic requirements: FR-13, FR-14 (ports, workspace scoping), FR-4 (serial perf run), FR-6 (trace), FR-19 (runner part); FR-9, FR-16, FR-17, FR-22 kept on the new runner; NFR-1, NFR-2 and the flake KPI met at close.

| ACs | Proof |
| --- | --- |
| AC-1, AC-4, AC-9, AC-10, AC-11, AC-18, AC-19, AC-27 to AC-30 | `harness.test.ts` launcher cases (refusals, browser and server start failures, `reports each failure by name…`, bundle once per run), `cli.test.ts`, `reporter.test.ts` |
| AC-2, AC-3, AC-5 | `T29`, `T30`, `T31` (set `T-shared`, `--workers 1`; T31 is the negative control), `T36` (stops its shell host on a fresh server) |
| AC-7 | `ports.test.ts`, `harness.test.ts` "server ports" |
| AC-17, AC-20 | `T35` (interrupt and SIGKILL), `T32` (kills its shared server); `harness.test.ts` cleanup cases |
| AC-12, AC-21, AC-22, AC-29 | `gate.test.ts` and `T-gate`, the reporter's `SKIP` count, `T21`, `T14` |
| AC-6, AC-24 | source searches at `c5862bf19`: no page-wide count, no pattern match on processes, `run.ts`, `TOTAL` and `PENDING` gone |
| AC-13, AC-15, AC-16 | final runs below |

**Final runs (V7, 2026-11-11, machine confirmed quiet, tip `abbe5f6db`).** Cap gate: 103 atomic checks timed, 0 over 20 s, slowest `S7.lost-host` 16.6 s. Perf run 5/5. N = 3 loop: check suite 104/104 in each run; `perf-branch-label` failed 2 of 3 (2042 and 2055 ms against 2000 ms), passed 3/3 after the user raised the limit to 3 s. A-11's "before" run was impossible because PRB.T-041 landed first (EC-12).

## Decisions

- Playwright Test path, no fallback: PRB.T-037 found A-5 and A-4 (one after another) true (2026-11-10). `@playwright/test` pinned to `apps/web`'s 1.60.0.
- Workers default to `min(4, max(1, floor(cores / 2)))`, `--workers` refused above the core count, and one config-wide 180 s hang ceiling (master plan U4, user-approved 2026-11-11).
- N = 3 for the flake loop (user, 2026-11-11).
- `registry.ts` stays as the catalog the launcher and sandbox read before Playwright starts; `run.ts`, `TOTAL`, `PENDING` and run-order lists removed (master plan U5, user-approved 2026-11-11).
- A shared server refuses `stop`, `kill`, `restart` and `stopShellHost`, so an undeclared need fails one scenario instead of taking down the others.
- A failing scenario's log on a shared server starts at the offset recorded when the server was registered for it (master plan M7).
- Sandbox runs go through the same launcher on one worker (SU-5). A run that would rebuild the bundle while another live run serves it is refused; sandbox starts are not covered (SU-6).
- The reporter keys its silence under `--list` on `_mode: "list"`, an undocumented option Playwright passes; a Playwright upgrade may change it.
- Parallel runs of several scenarios on one sandbox were left out: the epic has no FR for it.

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md), "The runner" and "Running"

## Follow-ups

- AC-8 (two suites at once beside a dev server) and AC-14 (an agent following only the rules file on a sandbox) have no recorded run; not tracked.
- AC-26 / epic A-16: the macOS run was skipped by the developer (2026-11-11); tracked in [questions.md](../../questions.md).
- Epic A-11 cannot be verified any more (PRB.T-041 landed first); closed as such in PRB.E-005 Decisions.
- `sandbox.test.ts`'s busy-run case relies on `T19` still running about 1 s after `ready`, a timing margin rather than a forced order. Not tracked.
