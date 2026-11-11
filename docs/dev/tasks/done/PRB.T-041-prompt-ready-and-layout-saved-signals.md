---
id: PRB.T-041
type: story
parent: PRB.E-005
phase: 1
labels: [testing, implement]
created: 2026-11-09
updated: 2026-11-11
---

# Prompt-ready and layout-saved signals so scenarios stop guessing

## Goal

Scenarios guessed three facts the app could state. They typed into a terminal as soon as a tab was clicked. They reloaded or stopped the server while a layout save might still be in flight (the suspected S4 flake). They polled a killed shell's pid for up to 5 s, because the shell left the list before its process had ended. This story made the app state the three facts: the server reports each shell's first prompt, the page shows each tab as attached and ready and the layout as saved, and a killed shell leaves the list only once its process has ended. Every harness wait that guessed one of these facts now waits on the signal.

## Delivered

- Merged in `4eaf87ecb` (2026-11-11). The code is `4bea411e2` (2026-11-10). The fixes after verification (the failed layout state kept per workspace, named survivors) are `5f1e0b488`. The fit to the PRB.T-037 sandbox is `ec0e32cc5`.
- Epic requirements: FR-12 (serially; the N-run check was skipped, see Decisions), FR-15 and NFR-7 (rules file kept current), FR-19 (every new wait fails naming what it awaited and the last state it saw), FR-20 and NFR-3 (the new log lines are at debug level and print no secret; the developer confirmed AC-20 on 2026-11-11), FR-22 (each new scenario passed the cap gate once), and NFR-4 (mobile, desktop and client-runtime type-check with the contract change).
- **Epic A-2 is true** (2026-11-10). T-041c holds the layout save back from the test's side of the connection and reloads without waiting, and the old tab strip comes back. With the wait for "saved", the change is kept.
- Proved by five new `Shells` cases in `apps/server/src/terminal/Manager.test.ts`, all of which fail on `main`'s code: ready once at the first mark, never ready without a mark or with a late one, a restored shell, a reattach after a restart, and the kill's removal after the process end. Also by a `terminalSession.test.ts` row (an older summary reads as unknown), the scenarios T-041a, T-041b and T-041c, R1 and S7 extended, and the self-tests T7 to T9 (each signal wait fails naming what it awaited).
- PRB.T-038 and PRB.T-039 had not landed, so this story switched every typing, reload-after-layout-change and process-end wait in the harness. No suppression names PRB.T-041 any more. Bounded check loops remain only for S6's background jobs and for S7's shells after their shell host is stopped.
- Suite run, 2026-11-10: everything passed except three scenarios. S2 and E2-S1 failed the known PRB.T-011 order check, which PRB.T-036 owns. S6 failed at its AC-14, where its "unreachable" `probe kill` killed its shell.
- AC-23 cap gate, 2026-11-11, one run each with a load average of 1 to 3 on 10 cores. On their own server: T-041a 17.9 s and T7 13.3 s. On one sandbox: T-041b 9.8 s, T-041c 7.2 s, T8 8.3 s and T9 5.9 s. All six are under the 20 s cap.
- AC-22 docs review, 2026-11-11: the review found that the rules file's Waiting rules named library exports, against PRB.T-042's decision. They now name only page states and events (`226bdfa83`).

## Decisions

- The three signals ship as one story, because PRB.T-040's flake-free claim needs all three (epic, Stories).
- Only `promptReady` crosses the wire, as an optional field on the shell summary. A missing field reads as unknown and never as ready. There is no new stream, no new RPC method and no change to the terminal protocol. Attached and saved come from state the page already has: the attach session and the `saveTabs` results (SA-3).
- The page shows the states as DOM attributes, `data-shell-ready`, `data-terminal-attached` and `data-layout-save`. They are normal page state, not a test-only path, and add no control a user can see (SU-2, author, 2026-11-10).
- A killed shell leaves the list only once its process has ended (SU-3, user, 2026-11-10). The kill waits at most the manager's 1 s kill grace, and only for the exit its SIGKILL already caused, so S6 still passes (SA-11). The fallback, a separate "process ended" fact, was not built.
- The first-prompt scan keeps its 15 s bound. A mark that arrives later leaves the shell not ready for good, never ready on a guess (user, 2026-11-10).
- The server must know whether a reattached shell already printed its first prompt. If it cannot, that is a defect to fix, never a reason for a fallback wait (user, 2026-11-10).
- `leaveAgent` followed by typing needs "back at a prompt", so `leaveAgent` waits for the next prompt mark after the goodbye, an event that already exists. No product signal was added for later prompts (SU-1).
- Product performance budgets for the signals belong to the product epics. The scenario rules go only into the rules file, and AGENTS.md, `testing.md` and `development.md` were not changed (user, 2026-11-10).
- The cap is raised from 15 s to 20 s for every scenario, so T-041a (over 15 s) passes (user, 2026-11-11, epic R-8).
- AC-24, the serial N-run check, was skipped (developer, 2026-11-11). N was not set when the story ran (it is now 3).

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md): the one first-prompt scan sets `promptReady` (restore and takeover included), and a kill's removal follows the process end.
- [Scenario rules](../../../../.agents/rules/scenarios.md), "Waiting": what to wait on before typing, before a reload or stop after a tab change, and after ending a shell; and where a bounded loop is still allowed.

## Follow-ups

- **Typed lines lose a chunk.** This is likely a product defect in the typing path: PRB.T-044. A contiguous middle piece of a typed line is missing, not reordered, even though the page showed the tab attached and ready:
  - S6: `sleep 1601 & (sleep 1602 &); echo jobs-started` arrived as `sleeep 1602 &); echo jobs-started`.
  - S5, inside PRB.T-037's `sandbox.test.ts` on a quiet machine: `read word; echo after-$word-s5` arrived as `readfter--s5`.
  - S6 failed 2 of 3 runs and S7 1 of 2 runs (2026-11-10, busy machine). S7's message does not name the line.
  - It is not known whether the loss happens in page input, in the per-keystroke `shell.write` calls, or on the server. Finding it starts with debug lines on that path.
- The parallel-load half of FR-12, and epic A-11: PRB.T-040 (its AC-15 and AC-16). The "before the signals" run of A-11 can no longer happen (its EC-12).
- fish and other unwrapped shells are never reported ready: PRB.T-012.
- At merge, `check:changed` failed PRB.T-037's `sandbox.test.ts` case "outlives a killed run". That was a harness race of PRB.T-037, reproduced on `main` and fixed there (2026-11-11), with a forced-order case in that test.
