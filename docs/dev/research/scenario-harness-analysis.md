# Scenario harness: speed and determinism analysis

Desk analysis of 2026-11-09 by six read-only passes (harness core, S1+S2, S3+S5, S4+S6, S7+S8, story scenarios). Nothing was changed. Claims marked (unverified) were not run.


## Goal

Playwright checks that are fast and deterministic: no waiting random time, no rerun to get green,
and no throwaway scripts written by agents just to poke the UI.

## Where the pain comes from (cross-cutting)

1. **One fresh server per scenario, run one after another.** 12 cold starts, each with a shell host,
   a pairing subprocess, and teardown that can wait up to 5 s (server) + 5 s (shell host).
2. **UI-driven setup.** Creating workspaces, adding projects and starting shells through dialogs and
   the "+" modal (about 8 round trips per shell). S7 starts 11 shells and adds 5 projects by clicking;
   none of it is what S7 tests. R1 already seeds by RPC.
3. **Polling and wall-clock gates that the repo rules forbid.** `gone()` polls kill(0) every 100 ms for
   up to 5 s; `Date.now()` deltas gate S2 (1 s), S3 (4 s) and E2-S3 (700 ms, about 14% headroom).
4. **The harness runs the developer's real shell config.** In this container that is oh-my-zsh with the
   `devcontainers` theme, whose prompt forks `git` on every prompt. Prompt width and delay vary, the
   agent command is typed as soon as the first-prompt mark appears, and a resize or wide line makes zle
   redraw it. This is the likely cause of the S2 failure (PRB.T-011 "exactly once"), which also fails
   on plain `main` (unverified at runtime).
5. **Typing before the terminal is ready.** `typeLine` does not wait for attach or a prompt.
6. **Raw websocket-frame matching without start offsets.** Some waits can be satisfied by an earlier
   frame (S2 `Mock Agent v1` at plus-modal.ts:235, S4 markers), so a pass may not prove its claim.
7. **Stale web bundle.** `dist` is built only when missing. After any web change the harness tests the
   old UI and fails at a 10 s timeout. It bit this project twice in one day.
8. **Monolithic scenarios.** S2 (25 ACs), S3 (~20 stages), S7 (~15 ACs) are single linear scripts. An
   early failure hides the rest and nothing can be rerun from stage N.
9. **No way to keep a server up and drive one step.** This is why agents write throwaway TypeScript.
   Helpers are private to scenario files, and failures give one line, with no trace or screenshot.
10. Smaller: `reservePort` binds then releases (port race); `chmod` failure checks do nothing as root
    (S1 AC-15..17, S7 AC-18/19/21); `/tmp` hard-coded in S3; kill-by-regex `sleep 1601` in S6 blocks
    parallel runs; S1 walks 13 chat URLs twice; cleanup leaks on SIGKILL of the runner.

## Phases (each leaves the suite runnable)

### Phase 0: stop the lying and the flakes (size S each, no behaviour change)

| # | Change | Fixes |
| --- | --- | --- |
| 0.1 | Scenario servers get a throwaway `HOME`/`ZDOTDIR` with an empty rc and plain `PS1` | S2 failure, prompt variance (4) |
| 0.2 | S2: replace "command appears exactly once" with an order check on raw history (typed after the first 133;B mark, banner after it) | keeps PRB.T-011 covered, removes redraw dependence |
| 0.3 | Rebuild the web bundle automatically when `apps/web/src` or contracts are newer than `dist`; print what was used | stale bundle (7) |
| 0.4 | Replace the three `Date.now()` gates with a recorded metric. Move the 700 ms budget to a server-side timestamp, kept as a non-gating perf check | (3) |
| 0.5 | Give every `frames.until` an offset; add a "nothing since" helper | masked passes (6) |
| 0.6 | Server readiness by HTTP descriptor, not by the log line; auth cookie minted once per server and reused (`storageState`) | startup and per-page cost |
| 0.7 | Throwaway servers stop with SIGKILL (no data worth flushing); manifest-based cleanup after a runner kill | up to 10 s teardown per scenario |
| 0.8 | Guard root-only gaps: skip with a stated reason, or run chmod checks another way | (10) |
| 0.9 | On failure: screenshot, server log tail, the recorder's last values | one-line failures (9) |
| 0.10 | One fixtures module (`projects`, `setUp`, `check`, `withClient`, `seedWorkspace`, restart-and-come-back) | duplicate helpers |

### Phase 1: sandbox mode (size M) - ends most throwaway scripts

`vp run scenarios:sandbox [--fixture <name>]` starts a harness server on a throwaway home, optionally
seeds a named fixture over RPC, prints origin, pairing URL, home and PIDs, and stays up until stopped
by the printed PID. Helpers (`openPage`, `connectRpc`, fixtures) are importable and documented in
`docs/operations/development.md` (Scenario tests) so an agent drives one step against a live server.
Also `PROBE_SCENARIO_ORIGIN=...` to run a single scenario against it without a cold start.

### Phase 2: RPC-first setup (size M)

Create workspaces, projects and shells over RPC wherever the UI is not the subject. Keep one real UI path
per action family (add project, "+" modal, kill with confirmation, Restore, Workspaces menu): S1, S2,
S3 and S6 keep them. Expected: removes most of the ~8 round trips per shell in S4, S6, S7, S8, E2-S1/S3.
Also drop `leaveAgent` for plain-shell setups (start without a script).

### Phase 3: split the long scenarios (size M-L)

- S2 -> modal/validation, start and double click, resize and kill, restart-dependent, workspace isolation.
- S3 -> modal lists, remembered choice, fork naming, failures, concurrency, restart/unstartable.
- S7 -> restart survival, missing folders and removal, save-failure alerts, lost shell host, workspaces.
- E2-S1 -> run the file-edit stages on a running server; keep only the restarts that prove startup rules
  (AC-5, AC-9, AC-8, AC-23). Consider a server-level test for the seeding rules.
- S4/S6: replace `sleep 2` with a file or FIFO the test releases; replace the global `sleep 1601`
  regex with a per-run unique value; replace instant `count() === 0` checks with detached waits.
Each split test builds its own repo through a shared fixture. Restarts drop from 3+1+8 to the ones that
test restart behaviour.

### Phase 4: Playwright Test runner, shared server, parallel workers (size L)

Add `@playwright/test` (same 1.60.0 already in `apps/web`; no new browser). Worker-scoped `server`
fixture (one server and shell host per worker), test-scoped workspace and page, opt-in `freshServer` for
the scenarios that restart or need a pristine home. Gains: trace on failure, `--grep`, `--ui`,
`--workers`. Prerequisites: port reservation without the bind-close race (retry on EADDRINUSE or
report the bound port), no global process-table regexes, scoping assertions to the test's workspace
(S3 counts `[data-worktree]` globally). Keep ids S1..S8 as test titles and a tiny reporter that prints
the same PASS/FAIL lines. Rewrite `docs/internals/testing.md:28-33` (it justifies `playwright-core`).
Retire `run.ts`, `registry.ts` and `TOTAL = 8` last.

### Phase 5: app signals (size M, touches production code - needs your OK)

- A "prompt ready / attached" state the page exposes (the server already knows the first prompt), so
  `typeLine` waits on it instead of guessing.
- A "layout saved" signal, so S4 does not reload with a save in flight (S4's tab-list flake: the tab
  strip is read once with no wait and the layout save is fire-and-forget; unverified at runtime).
- Optionally the terminal's rendered text, so waits stop parsing raw frames.
Replace `gone()` with the shell list's `ended` event plus one pid check, where the server owns the pid.

## Per-scenario summary

| Scenario | Main time costs | Main non-determinism | First moves |
| --- | --- | --- | --- |
| S1 boot | 13 chat URLs x2, UI workspace creation | root chmod, fixed click point (900,600) | trim URLs to one per route class; root guard |
| S2 plus modal | 2 restarts, UI setup, 25 ACs in one flow | real zshrc, `Date.now` gate, offset-less frames | 0.1, 0.2, 0.4, 0.5; split in phase 3 |
| S3 worktrees | 1 restart, ~20 UI-driven stages, `gone()` x4 | 4 s wall-clock gate, stage coupling, `/tmp` | 0.4; split; RPC setup |
| S4 many shells | 6 modal starts, `sleep 2`, `leaveAgent` x2 | tab list read once; save in flight at reload | phase 5 layout signal; FIFO instead of sleep |
| S5 close tab | UI workspace + 2 modal starts | frames cannot tell live from history | RPC setup; bounded recorder |
| S6 kill | ~10 modal starts, `gone()` x6, `ps -A` | global `sleep 1601` regex, log timing | RPC setup; per-run unique jobs |
| S7 restart | 3 restarts, 11 UI shell starts, 5 add-project dialogs | typing before ready, root chmod, shared state | RPC setup; split; layout signal |
| S8 restore | 1 restart, UI setup, `leaveAgent` x2 | same typing risk | RPC setup |
| T-002 | 1 restart, `gone()` | none significant | keep as the model |
| R1 | tokens minted twice (4 CLI starts instead of 2) | EC-1 check can pass vacuously | dedupe tokens; wait on the Connections state |
| E2-S3 | 1 restart, UI setup | 700 ms gate | 0.4 |
| E2-S1 | 5 restarts, UI setup | log-text parsing | phase 3 |

## Must not change

Real PTYs, real git worktrees, real websockets; real server restarts (a restart is not a page reload);
real SIGKILL and lost-host cases; pointer-only input (mouse-first rule); the throwaway-home guard and
cleanup by captured PID; the mock agent as the agent stand-in; the second-server path (R1, seam);
the PRB.T-011 contract end to end; the 700 ms click-to-prompt budget, as a load-independent measure.

## Decisions (2026-11-09, user)

1. `@playwright/test` may be added; the playwright library choice may be replaced as needed.
2. Phase 5 may add small production signals (prompt ready, layout saved).
3. The 700 ms click-to-prompt budget is measured on the server and gated only in a dedicated serial
   performance run, never in the parallel suite (decided by the assistant on the user's "choose what
   is better").
4. Phase 0 is one ticket.

## Baseline (2026-11-09, devcontainer, rebuilt bundle, serial, one run)

| Scenario | Wall time (alone, including about 13 s runner/browser/server start) | Result |
| --- | --- | --- |
| S1 | 23.8 s | pass |
| S2 | 22.3 s | fail (PRB.T-011 check, also fails on `main`) |
| S3 | 37.3 s | pass |
| S4 | 19.9 s | pass (failed once in an earlier full run) |
| S5 | 13.4 s | pass |
| S6 | 21.8 s | pass |
| S7 | 39.5 s | fail (passed in an earlier full run) |
| S8 | 25.0 s | pass |
| T-002 | 17.6 s | pass |
| R1 | 31.3 s | pass |
| E2-S3 | 21.7 s | pass |
| E2-S1 | 50.5 s | pass |
| Full run | 345.9 s | |

A rebuild of the web bundle plus T-002 took 30.8 s. Single run per scenario, not the median of 3.
