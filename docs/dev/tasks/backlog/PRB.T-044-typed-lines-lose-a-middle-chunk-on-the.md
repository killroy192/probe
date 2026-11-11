---
id: PRB.T-044
type: bug
parent: PRB.E-001
phase: 1
labels: []
created: 2026-11-11
updated: 2026-11-11
---

# Typed lines lose a middle chunk on the way to the shell

## Symptom

A line typed into a shell's tab sometimes reaches the shell with a contiguous piece from its middle
missing. The rest arrives in order; nothing is reordered or doubled. It happened while the page
showed the tab attached and ready (`data-terminal-attached`, `data-shell-ready`), so the shell was
at its prompt. Found during PRB.E-005 verification (PRB.T-041 and PRB.T-038 Follow-ups).

## Evidence

Quoted from the PRB.T-041 and PRB.T-038 Follow-ups and the run artifacts:

- S6: `sleep 1601 & (sleep 1602 &); echo jobs-started` arrived as `sleeep 1602 &); echo jobs-started`.
- S5, inside PRB.T-037's `sandbox.test.ts` on a quiet machine: `read word; echo after-$word-s5`
  arrived as `readfter--s5`.
- S6 in V7's "before" run (PRB.T-038): the line
  `PROBE_SHELL_ENDPOINT=http://127.0.0.1:9/ "$PROBE_BIN" kill; echo exit-$?-s6`
  (`scripts/scenarios/scenarios/kill-shell.ts`) was echoed as
  `PROBE_SHttp://127.0.0.1:9/ "$PROBE_BIN" kill; echo exit-$?-s6`, and zsh answered
  `zsh: no such file or directory: PROBE_SHttp://127.0.0.1:9/` then `exit-127-s6`, so S6 failed at
  AC-14 waiting for `exit-1-s6`. The shell summary in the error had `promptReady: true`. Artifacts:
  `/tmp/probe-scenario-artifacts/2026-11-11T08-46-16-686Z/S6/` (`error.txt`, `recorders.json`,
  `server-log-tail.txt`).
- Rate (2026-11-10, busy machine): S6 failed 2 of 3 runs and S7 1 of 2. S7's message does not name
  the line.

In all three quoted cases the missing piece is 13 or 14 characters (`ep 1601 & (sl`,
`ELL_ENDPOINT=h`, ` word; echo a`). Whether that length means anything is not known.

The page-typed lines go through `typeLine` in `scripts/scenarios/lib/ui/terminal.ts`
(`pressSequentially` into the terminal's textarea), so each key becomes page input and a
`shell.write`. How the S5 line was sent in that run is not recorded; today's
`S5.output-while-closed` writes it with one `shell.write` over the API.

- Manual try (2026-11-11, dev server, by the user): pasting and fast-typing a long line into a new
  shell right after its prompt, after a reload and after showing a hidden tab, never lost a piece.
  Parked by the user until a scenario run shows it again.

## Expected

Every character typed into a ready tab reaches the shell, in order (`shells/FR-2`, `shells/FR-4`,
`starting-scripts/FR-24`). The affected checks are `kill-shell/FR-4` (S6's background jobs),
`kill-shell/FR-14` (the unreachable `probe kill`) and `close-and-reopen/FR-5` (S5's output while
closed).

## Suspected cause

Unknown. The loss could be in page input (the terminal's input handling), in the per-keystroke
`shell.write` calls (client batching, ordering or a dropped request), or on the server (the write
into the PTY, or the line editor while it redraws). Nothing so far narrows it.

## Direction

- First step: debug-level lines along the path (page input handler, each `shell.write` sent and
  received with its length and a sequence number, the PTY write), then rerun S6 until a line loses
  a chunk, and see on which side of which hop the piece is gone.
- Then write the fewest tests that fail on `main` at that layer, and fix.

## Acceptance criteria

- A scenario or test that fails today for this reason passes with the fix: a line typed into a
  ready tab arrives whole.
- S6 passes its background-jobs and unreachable-`probe kill` stages in the serial N-run check
  (PRB.E-005) without a lost chunk.
- The debug lines that stay are at debug level and log no typed text in full.

## How to verify

- The new test fails on `main` and passes with the fix.
- Run S6 (and S5, S7) the epic's N times; no typed line is missing a piece. Read the artifacts of
  any failure for the typed line before calling it unrelated.
