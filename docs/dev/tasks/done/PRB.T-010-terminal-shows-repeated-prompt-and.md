---
id: PRB.T-010
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-07
updated: 2026-11-08
---

# Terminal text duplicates, triples or multiplies

## Goal

A shell's terminal sometimes showed its prompt or text typed at the prompt two, three or more times
(reported 2026-11-07, first seen in the PRB.T-007 manual pass). Delivered: left-over text shows once
after a resize, reload or navigating away and back.

## Delivered

- Server snapshots: each session feeds a headless libghostty-vt terminal resized with the PTY, and
  attach, saved history and adopt use its formatted screen (and recorded grids) instead of raw history.
- Shells lead the prompt with `OSC 133;A;redraw=1`, so live narrowing clears the prompt rows.
- Web viewports that remount after a grid change reattach for a fresh snapshot.
- Measured on the scenario harness (`DBG-T010`, since removed), copies shown: live narrowing 2 to 1,
  reload 5 to 1, navigate away and back 5 to 1, control 1 to 1.
- Tests: `packages/ghostty-vt/src/terminal.test.ts`, `Manager.test.ts`, `shellHost.test.ts`,
  `terminalSession.test.ts`, `apps/web/src/terminal/ghostty/core.test.ts`.

## Decisions

- Root cause (2026-11-07): raw history replayed at fewer columns than it was written at, because
  zsh redraws its line in place on each resize. Server history bytes were clean.
- A server-side headless emulator (2026-11-08) over resize markers in history, which would have
  changed the history format in `contracts` and left old files without markers.
- bash gets `redraw=1` too, since bash 5.2 readline redraws on SIGWINCH.

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md): shell integration marks, snapshots, saved history, adopt, client remount.

## Follow-ups

- Mobile replays the same client buffer and is not fixed: PRB.T-014.
