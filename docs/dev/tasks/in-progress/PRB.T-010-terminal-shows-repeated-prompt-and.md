---
id: PRB.T-010
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first, debug]
created: 2026-11-07
updated: 2026-11-07
---

# Terminal text duplicates, triples or multiplies

Reported by the author (2026-11-07), first seen during the PRB.T-007 manual pass (2026-11-06). The
text in a shell's terminal sometimes shows two, three or more times:

- The prompt line (cwd, git info), repeated many times with no line breaks:

  ```
  vscode ➜ ~/probe-demo/repo (main) $vscode ➜ ~/probe-demo/repo (main) $vscode ➜ ~/probe-demo/repo (main) $ …
  ```

- Text typed at the prompt but not run: after doing other things and coming back to the shell, that
  text is duplicated, tripled or multiplied.

It happens often in some shells (seen across workspace switches, PRB.T-007 E1 check). The doubled
agent command on a new shell is tracked apart in PRB.T-011.

## Debug findings (2026-11-07)

Method: a raw `node-pty` zsh, and a throwaway Playwright script on the scenario harness (real server,
mock agent) that read each shell's raw history through `shell.attach`. No product code was changed.

- **The server's history stays clean** after a window resize, a page reload, a second shell, tab
  switches, a workspace switch and back, and a server restart (one prompt each, byte counts
  unchanged). An idle PTY resize gives one in-place redraw (`\r\r\e[J` then the prompt).
- So the duplication is not in the bytes the server keeps. Remaining suspects are on the client: the
  renderer drawing at a width that differs from the PTY's (`TerminalViewport` in
  `ThreadTerminalDrawer.tsx`; `onResize` and `setVisible` for hidden tabs that stay mounted), or a
  replayed snapshot written on top of text the surface already shows.
- That first pass resized at one width and never left typed text at the prompt, so every replay
  matched the width its redraws were written at. The root cause below needs both.

## Root cause (confirmed 2026-11-07)

Replaying raw history at fewer columns than it was written at. On each PTY resize zsh redraws its
line in place (`\r\r\e[J`, prompt, typed text), and the server keeps those bytes faithfully. A
viewport that mounts or reattaches calls `resetAndWrite(history)` at the current grid. Where the
line now wraps, `\r` returns only to the start of the wrapped row and `\e[J` clears only below
it, so each redraw recorded at a wider grid leaves its copy behind.

Evidence, from temporary probes (`#region debug:t010`) and a throwaway scenario on the harness
(real server, built web bundle, Chromium): typed text left at the prompt, three resizes at
146-165 cols, then a reload.

| Run                     | Replay grid | History                    | Copies shown after reload |
| ----------------------- | ----------- | -------------------------- | ------------------------- |
| Reload while wide       | 152 cols    | 5 redraws, typed text 4x   | 1                         |
| Narrow to 520px, reload | 62 cols     | 6 redraws, typed text 5x   | 5                         |

A second, smaller source: narrowing a live shell already leaves one stray copy (2 shown before the
reload). Ghostty reflows the wide line onto two rows and zsh's redraw clears only from the row the
cursor is on. A server-side emulator would keep that copy too.

Ruled out by the same logs: live writes at a grid other than the PTY's (every write matched), a
double write (the reset offset equals the server history length and only moves forward), two
viewports of one shell, and duplicated bytes in the server history.

The same replay reproduces outside the app: real zsh output replayed through `GhosttyTerminalCore`
shows one copy at 120 cols and four at 30.

## Fix direction (not decided)

1. **Recommended: a headless emulator in the shell host.** Feed each shell's output to a
   `libghostty-vt` terminal resized with the PTY, and send a formatted VT snapshot (screen,
   scrollback, modes, cursor) on attach instead of raw history. This is Paradev's design with
   xterm headless (see `docs/dev/research/paradev.md`). The bundled wasm exports
   `ghostty_formatter_terminal_new` and `ghostty_formatter_format_alloc`; which options this pin
   supports (VT output, scrollback, modes) is unverified. Saved history would become saved
   snapshots. Parsing moves to the server once per byte; attach payloads become bounded by screen
   plus scrollback.
2. **Resize markers in history.** Clients replay each segment at its recorded grid, then reflow.
   This changes the history format in `contracts`, and old history files have no markers.

The live-narrowing copy needs prompt marks (`OSC 133` shell integration) so the terminal can clear
the prompt on resize; whether this `libghostty-vt` pin does that is unverified.

## Progress (2026-11-08)

Option 1 was chosen.

**Live narrowing: fixed.** libghostty-vt's C ABI clears the prompt on resize only when the shell
sends `OSC 133;A;redraw=1` (`src/terminal/c/terminal.zig:284` at the pin). The PRB.T-011 wrapper
sent a plain `A` *after* the prompt, which Ghostty treats as a fresh line: typed text moved to its
own row, and redraws left an orphan prompt row. Now zsh and bash lead the prompt with
`A;redraw=1` and signal readiness with `B` after it. bash 5.2's readline redraws on SIGWINCH, so
bash gets `redraw=1` too. In `DBG-T010`, live narrowing shows 1 copy (it was 2).

**Reload: still 5 copies.** Raw replay has no resizes in it, so marks cannot help. Next: a shared
`packages/ghostty-vt` runtime that Node can load, a headless terminal with a VT formatter, then a
server emulator per session whose snapshot replaces raw history on attach. After that, persisted
history, shell-host resize records for `adopt`, and a client reattach when the grid changed
since the snapshot.

**Shared runtime: done.** `packages/ghostty-vt` holds the libghostty-vt runtime and wasm (web
and Node), and `GhosttyVtTerminal` formats a terminal's state as VT. Its tests cover the T-010
case: raw history replayed at 25 cols shows the prompt 5 times, the formatted snapshot shows it
once. Tab stops are left out of the snapshot because the formatter restores them after the
cursor, which leaves the cursor in the wrong column.

**Cost, measured 2026-11-08** (Node, arm64 container, mixed coloured and Unicode output, 160×48;
the wasm is built `ReleaseSmall`):

| Server scrollback | Parse      | Format | Snapshot | Rows kept | Memory per terminal |
| ----------------- | ---------- | ------ | -------- | --------- | ------------------- |
| 1 MiB             | ~43 MiB/s  | 5 ms   | 63 KiB   | ~570      | ~5 MiB              |
| 4 MiB             | ~41 MiB/s  | 11 ms  | 212 KiB  | ~2,050    | ~5 MiB              |
| 10 MiB            | ~43 MiB/s  | 21 ms  | 505 KiB  | ~5,000    | ~13 MiB             |

All terminals share one wasm instance. Its memory never shrinks, so the server keeps its peak.
Matching today's 5,000-line history needs ~10 MiB of scrollback, and that snapshot is close to
the client's 512 KiB buffer cap (`DEFAULT_MAX_TERMINAL_BUFFER_BYTES`).

## Next

Choose the server's scrollback budget (the table above), then Phase C: an emulator per server
session, first running in the shadow, then sending its snapshot on attach. A regression test belongs in
`apps/web/src/terminal/ghostty/core.test.ts` (or the server's equivalent for option 1): replay a
short zsh history with redraws recorded wide and assert one prompt.

The probes and the `DBG-T010` scenario are not committed; they sit uncommitted in the
`prb-t-010-terminal-duplicate-text` worktree. There, `node scripts/scenarios/run.ts --rebuild --only
DBG-T010` reruns the repro into `.logs/debug/t010.ndjson`, and `DBG_NARROW=0` runs the control.

## Done when

- Text typed and left at the prompt shows once after a tab switch, workspace switch and reload.
- The prompt is not repeated after workspace switches or resizes.
- A test reproduces the root cause and fails before the fix.
