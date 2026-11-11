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

## Goal

Every scenario was one long linear script (S2, S3 and S7 about 20 stages each), so an early failure hid every later criterion, stages depended on what earlier ones left, and fixed names and server-wide changes kept them off a shared server. As delivered, every old scenario is replaced by atomic check scenarios that each prove one behavior, build their own state, state their needs and fail naming expected and found; each old id is now the set of its successors.

## Delivered

- 101 atomic successors of S1 to S8, T-002, R1, E2-S1, E2-S3, E2-S4 and T-041a (plus `T-041b` and `T-041c`, unchanged: 103 checks), the composed scenario `composed.close-then-kill` (`S5.close-tab`, then `S6.kill-closed-tab` on its result), 15 sets (the 14 old ids and `shared`), and the self-tests `T27` and `T28` for S4's release. No old id is a scenario id. Built in commit `27d848203` (tag `e005-t039`), with verification fixes on the same branch, merged to `main` in `d9a240c6b` (PRB.E-005).
- Epic requirements: FR-11; the conversion parts of FR-9, FR-14 (S6, S3), FR-17, FR-19 and FR-22; NFR-1 per scenario; NFR-6.
- Cap gate, 2026-11-11 (V7, machine confirmed quiet): 103 checks timed, none over 20 s, slowest `S7.lost-host` at 16.6 s.

| AC | Proved by |
| -- | --------- |
| AC-1, AC-4, AC-20 | `scripts/scenarios/registry.test.ts`: every check states needs, each old id is exactly the set of its `<old id>.` checks. The per-criterion table of old scenario ACs to successors was reviewed before the merge and is in this ticket's history at `4497f387b`. |
| AC-2 | `vp run test:scenarios` |
| AC-3 | the set `shared` on a sandbox |
| AC-5, AC-6 | `S7.survive-restart`, `S7.ended-after-restart`, `S7.removed-stay-gone`, `S7.lost-host`, `S8.restore-after-lost-host`, `T-002.restart`, `E2-S1.preselect-after-restart`, `E2-S1.emptied-not-seeded`, `E2-S1.damaged-kept`, `E2-S1.seed-off-then-on` |
| AC-7 | `S2.git-init-fails`, `E2-S3.agent-command-ignored` |
| AC-8 | `registry.test.ts` sandbox refusals (`S7`, `S2.git-init-fails`, `E2-S1.list-offered`, `S1.start-screen`, `R1`) |
| AC-9 | `S2.repeat-start`, `S7.removed-stay-gone`, `S7.lost-host`, `E2-S1.preselect-after-restart` |
| AC-10 | `S2.repeat-start` (agent typed once, after the first prompt) |
| AC-11 | every `S2.*` check that drives the page (all but `S2.start-end-lines`) |
| AC-19 | `composed.close-then-kill` |
| AC-25 | `vp run scenarios:gate -- --quiet-confirmed` (result above) |
| AC-26, AC-27 | `S4.output-during-reload`; `T27`, `T28` |
| AC-28 | `S6.kill-from-tree` (decoys `sleep 1601` and another run's marker) |
| AC-30 | `S3.leave-worktree` |
| AC-31 | `S1.chat-routes-shown`, `S1.chat-routes-start-screen` |
| AC-23, AC-29, AC-32, AC-34 | reviews and source searches at integration |
| AC-35 | `--selftest` and `vp run check:changed` |

## Decisions

- 2026-11-10, user: the story was split; the building blocks (kinds, `.perf.ts`, sets, composition, the new needs, the cap gate command) went to PRB.T-043, which came first. Moved ACs kept their numbers there.
- Ids are `<old id>.<part>` and `composed.<name>`; each old id stays as a set so tickets that cite it still resolve.
- The starting-script list stays server-wide, since it is one file per state folder; making it per workspace is product scope (PRB.E-002). So every successor that writes it, or depends on what a fresh state folder offers, and every one that makes the server's state folders unwritable, states `serverWide` and gets a server of its own.
- A restart stays only where restart behavior is the subject: the 14 old restarts became 11 in 10 checks (T-041a, converted too, keeps its own one). A restart that set a startup condition (S2's faulty git config, E2-S3's `PROBE_AGENT_COMMAND`, E2-S1's seed-off start) became a server started under that condition; one that only made the server see a new starting script was dropped, because the server reads the list on every call.
- `S7.survive-restart` keeps every kind of state the old survival stage held in one restart, so it proves at least as much as before; it fits the cap.
- Only `S1.start-screen` needs a pristine home: the shown workspace is remembered per browser, so the other S1 successors run on a shared server.
- S6's jobs are found by their exact argv carrying the run's marker, never a process-table pattern; S4's output during a reload is released by the scenario after the reload begins instead of a typed `sleep 2`; S3's leaving shell goes to a folder the scenario owns, not `/tmp`.
- PRB.T-041 landed first, so every successor waits on its signals through the library.
- 2026-11-11, verification: S5 AC-4 and AC-6 were narrowed. The terminal draws on a canvas with no DOM text and a quick reopen may keep the page's attach, so no frame shows what a reopened tab draws. `S5.reopen-from-tree` checks the reopened tab is attached and ready and the shell runs; `S5.output-while-closed` checks the output reached the shell's history and the page, as the old S5 judged it (`8b277856e`, `52129df5c`, `a2b914515`).

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md): atomic checks, ids, what a scenario leaves, needs, old ids as sets.
- [Scenario requirements](../../../scenarios/README.md), which the successors cite in `verifies`.

## Follow-ups

- "Create workspace" appears late after a page load and moves the Workspaces menu under the pointer (PRB.T-003 area; harness waits for it in `lib/ui/workspacesMenu.ts`): PRB.T-045.
- A started agent's program label can stay missing for over 10 s on a server with many shells (PRB.T-004 area, `apps/server/src/terminal/Manager.ts` poll): PRB.T-046.
- The branch label missed the 2 s limit in 2 of 3 loop runs; the user raised it to 3 s (2026-11-11), with no misses in 3 runs since. Tracked in PRB.T-005.
- S4's release and S6's marker are unverified on macOS (`ps` output, `/tmp` as a link): the macOS question in [questions.md](../../questions.md); the macOS run was skipped by the developer on 2026-11-11.
