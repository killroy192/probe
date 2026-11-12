---
id: PRB.T-050
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-12
---

# Tab and tree labels lag the program running in the shell

## Goal

A shell's tab and tree label name its foreground program (`shells/FR-17`), but followed it late:
any output in any shell held every shell on the 1 s check, and an idle server waited up to 30 s
even when the user acted. Checks now follow what the user does, not what shells print.

## Delivered

- Each shell is checked after waits of 1, 1, 2, 3, 5, 8, 13 s, then every 13 s, whatever it prints.
  A reset puts it back at the start: Enter or Ctrl+C written to it (any client or the `probe`
  command), a prompt mark from the zsh or bash wrapper, a check that found a different program, and
  the new `shell.viewChanged` request, which the web client sends when a shell's tab is shown or
  hidden, the browser tab's visibility changes, or focus enters its terminal. Resets within 500 ms
  of the last count once. One process-table read per tick, only when a shell is due.
- Commits `c6d0af334` (server, contracts, client runtime, web, unit tests), `b485f4491`
  (scenarios), merge `37783380c`.
- Tests: `Manager.test.ts` › "label check schedule" (9 cases, all failing on the old poll).
  Scenarios `S4.labels-follow` (`shells/FR-24`) and `S4.shown-tab-rechecked` (`shells/FR-25`).
- Earlier, on 2026-11-11, most of the lag was the failure back-off after native snapshots failed;
  fixed in PRB.T-046.

## Decisions

- Schedule, reset events and leading-edge debounce: user design, 2026-11-11. A trailing debounce
  was rejected because it would delay the check after Enter; settling the label for a few hundred
  ms before publishing was dropped, as checks at least 1 s apart leave nothing to settle.
- `shell.viewChanged` needs only terminal read scope: it only moves a check earlier.
- fish and other unwrapped shells get every reset but the prompt mark.
- A reset makes the shell due at the next 1 s tick, so its check comes 0 to 1 s later.

## Follow-ups

- Event-driven tracking of folders and branches: `docs/dev/ideas/event-driven-shell-tracking.md`.
