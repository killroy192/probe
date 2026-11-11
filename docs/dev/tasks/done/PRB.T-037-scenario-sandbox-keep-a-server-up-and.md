---
id: PRB.T-037
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-11
---

# Scenario sandbox: keep a server up and run saved scenarios against it

## Goal

Every scenario run cold-started its own Probe server, so agents who wanted a live server wrote throwaway driver scripts that were lost after one use. This story added a sandbox: one command keeps a harness server up on a throwaway home, and saved scenarios run against it by id with no cold start. Nothing else runs there, and scenarios that would break a shared server are refused with the reason.

## Delivered

- Merged in `8e2573b00` (2026-11-11). The first slice and the A-5 and A-4 checks are `ed9b2954e`; the refusals, `needs`, fixtures, run lock and stale check are `0a7d6a463`.
- Epic requirements: FR-8, FR-9 for single scenarios and the refusals, FR-15 (sandbox part, in the rules file), FR-18 (enforcement part: no entry point for an unsaved script), NFR-3, NFR-5, NFR-6 (sandbox part).
- **Epic A-5 is true** (2026-11-10): `@playwright/test` 1.60.0 ran one test against the cached `chromium_headless_shell-1223` with no browser download. `PLAYWRIGHT_DOWNLOAD_HOST` pointed at a closed loopback port, the test ran with `trace: "on"` and wrote a `trace.zip`, and `~/.cache/ms-playwright` was unchanged afterwards. Result: 1 passed in 526 ms, Node 26.12.1, in a scratch folder outside the repo. No Fallback. Notes for PRB.T-040: `browserType().executablePath()` names the full `chromium-1223` build, which is not installed, but a headless launch uses the headless shell and works, so do not check that path. Node 26 also prints a `DEP0205` (`module.register()`) warning on every worker start.
- **Epic A-4 is true for scenarios run one after another**, checked on the sandbox's first slice (2026-11-10). S4 and S5 were first changed to name their workspace and folders by `runId`. Then S5 (8.0 s) and S4 (16.9 s) ran one after the other on one sandbox, and the server pid was the same before, between and after. S4 found S5's workspace and its two still-running shells beside its own, and every assertion held. No Fallback.
- Proved by `scripts/scenarios/sandbox.test.ts` (13 tests, AC-3 to AC-20 and AC-24) and the picked self-tests T5 (tries needs it did not state) and T6 (rerun of a changed scenario). T2 now fails in a named stage with expected and found values.
- AC-22 walkthrough (2026-11-11): a fresh agent session worked from the rules file alone. It ran S5 (7.4 s) then S4 (17.4 s) on one sandbox with no second server start. A script path and S7 were both refused with a reason. It wrote no file in the checkout. The gaps it hit were closed in the rules file. These times are from a shared machine and are not cap results.
- AC-23 (2026-11-11, rebased on `7be34739b`): the full `vp run test:scenarios` run passed every scenario (321.3 s), and `vp run check:changed` passed.

## Decisions

- The sandbox runs saved scenarios only. Ad-hoc use was dropped from this story (user, 2026-11-10): no attaching to a sandbox page from another process, no driving one step, no driver script.
- The A-5 spike and the A-4 check came before the rest of the sandbox, so the sandbox would not be built on a runner or a sharing model that was about to change (epic Approach). The rest was built after the go-ahead (2026-11-10).
- If A-4 had been false, each scenario would have got a fresh workspace on the same server instead of being refused (user, 2026-11-10). It was true, so this did not apply.
- `--keep-home` is an opt-in at start that keeps the home for post-mortem reading; the default removes it (user, 2026-11-10).
- Commands (author, 2026-11-10): `vp run scenarios:sandbox`, then `vp run test:scenarios -- --sandbox <pid> --only <id>`. The sandbox prints one `sandbox: <key>=<value>` line per fact, its own pid first.
- Only two fixtures, `workspace` and `shells` (author, 2026-11-10). Later stories add theirs to `sandboxFixtures` in `fixtures.ts`.
- The A-5 spike was kept as a transcript only, and no `@playwright/test` dependency was added (author, 2026-11-10).
- Each scenario states its `needs` in its own file. A scenario with no stated needs is refused, and the refusal for scenarios not yet safe on a shared server (S6, E2-S4) names PRB.T-039.
- A sandbox runs one scenario at a time. Parallel runs on one sandbox are not part of PRB.E-005.

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md), sections "Registering a scenario" and "The sandbox": the commands, the printed fields, the fixtures, the refusals, no reset between runs, and the cases that need a new sandbox.

## Follow-ups

- Sets and composed scenarios on the sandbox: PRB.T-043 (FR-17).
- Converting the refused scenarios for a shared server: PRB.T-039.
- The run lock's takeover after a killed run is not atomic: two runs taking over the same dead lock at the same instant could both run. Left as is because a sandbox normally has one user. Untracked.
- Whether a running server correctly serves a bundle rebuilt after it started is unverified. The sandbox refuses a run after a rebuild either way, so allowing web-only changes on a live sandbox would need that check first. Untracked.
