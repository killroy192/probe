---
id: PRB.T-038
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-11
---

# Shared e2e library: direct setup over the API, one real UI path per action, waits and debug logging

## Goal

Scenarios built their world by clicking through dialogs they were not testing, copied helpers between files, and left too little in their artifacts to explain a failure without a rerun. Now one library (`scripts/scenarios/lib/`) sets up workspaces, projects and shells over the server API, one scenario per action family keeps the real UI path, every wait names what it awaited against one deadline source, and a failure's artifacts carry each server's debug log and each page's console.

## Delivered

Merged with PRB.E-005 in `d9a240c6b`; this story's end is tag `e005-t038`, with fixes on the branch afterwards (`5f19082a3`, `d6e21ea9b`, `b8534ee1b`, `c6abdac1d`, `797a1479f`, `545bcc7e1`). Satisfies FR-10, FR-20, FR-21, NFR-7 (library half) and the NFR-3 part about logs.

| AC | Proven by |
| --- | --- |
| AC-1, AC-10, AC-11, AC-13, AC-23, AC-24 | Read-only review, 2026-11-11 at `be06655c0` (AC-11 partial at the time: helpers left in scenario files went to `lib/` in PRB.T-039's `d8fea7c01`) |
| AC-2, AC-6, AC-8 | Owner scenarios at the tag: S1, S2, S3, S6, S7, S8, E2-S1, E2-S3, E2-S4 (now their atomic successors; S7's remembered-choice check is `S7.survive-restart`) |
| AC-3, AC-4, AC-5 | The suite at the tag (plain shells started over the API; S2, E2-S1, E2-S3 mock agent stages; S8's tree rows for API shells) |
| AC-7 | `T11` |
| AC-9 | `T10` |
| AC-14 | `T14` |
| AC-15 | `T12`; harness test "fails a setup call in setup, naming the call and the server's reason" |
| AC-16 | `T13`; harness test "names the workspace a page did not show, and saves the page" |
| AC-17, AC-21 | `T15`; harness test "labels every server's debug log and every page's console, with no secret in them" |
| AC-18 | Harness test "keep the failing stage's server lines past what the log buffer holds" |
| AC-19 | Harness test "prints debug entries only when asked, and never the bearer token" |
| AC-20 | Harness tests "reports the original error when the failure artifacts cannot be saved", "save every other piece and name the screenshot of a closed page as missing" |
| AC-12 | Sandbox fixtures built on `lib/setup.ts` (review); no sandbox run is recorded in this ticket |
| AC-22, AC-25 | V7 runs below |

- **FR-10 count (desk count from the code, 2026-11-11, `be06655c0`).** Setup round trips fell from 1123 to 464 (41 %), under the 561 threshold; every scenario with its own threshold met it except E2-S3 (24 against ≤ 19).
- **V7 runs (2026-11-11, one serial `vp run test:scenarios` each, devcontainer, quiet machine).** Before at `ebb9d3287`, info level: 350.8 s, 13/16 passed. After at tag `e005-t038`, debug level: 284.4 s, 14/16 passed. The after run's two failures (S4's fork name, S3 AC-29) were in code that exists only at the tag; the fork name was fixed at the tip in `1dad979eb`, and the tip's S3 set passed 16/16.

## Decisions

- **Round-trip unit and FR-10 threshold** (user, 2026-11-11). One round trip is one awaited harness operation that crosses a process boundary (pointer action, page wait or read, RPC/HTTP call, CLI process, terminal typing or wait); restarts are counted apart. Pass: suite setup after at most 50 % of before, and every scenario with 19 or more convertible round trips except S2 cuts its own setup by at least 40 %. The "before" count was a desk count at `f24dbcdf8` (2026-11-10): 2581 round trips, 1123 of them setup.
- **"Before" times** come from one serial run at `ebb9d3287` in the final verification, not PRB.T-036's baseline, which predates PRB.T-037's per-run names (user, 2026-11-11).
- **Coverage map** of one UI path per action family confirmed complete by the user, 2026-11-10.
- **No web diagnostic lines** (plan D4): the web app has no log level, so the browser console is captured in failure artifacts instead.
- **Signals in this story.** PRB.T-041 landed first (`4eaf87ecb`), so by the epic's switch rule this story moved the typing, reload, restart and process-end waits to its signals; nothing was left for PRB.T-039.
- **PRB.T-037's fixtures** (`workspace`, `shells`) are rebuilt on the library's setup, and a per-trail counter extends the per-run names (plan D7).
- **Plan changes while building** (master plan): one step-end hook `onStepEnd(what, undo)` instead of `defer` (M2); a stage failure reads `at stage "<s>": <cause>` and the runner prints the id (M4); a server's `<label>.log` starts at the scenario's registration, so it is the scenario's own time on that server (M7).
- **Verification at the tag** (epic master plan §4). AC-22 and AC-25 were measured at `e005-t038`, because PRB.T-039 replaced these scenarios and PRB.T-040 retired `run.ts`; a defect found there was fixed at the tip only where its code survived.

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md): the library, direct setup and the coverage map, waiting, failure artifacts and debug logs.

## Follow-ups

- **E2-S3 missed its own FR-10 threshold** (24 against ≤ 19, its restart path). PRB.T-039 split it into three checks without the restart (15 to 16 setup round trips each), so the old threshold has no successor. Accepted at that count by the user (2026-11-11, PRB.E-005 Decisions).
- **S6's typed line lost a chunk** in the "before" run (`PROBE_SHttp://…`): a likely product defect in the typing path: PRB.T-044.
