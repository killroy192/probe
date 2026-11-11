---
id: PRB.T-049
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-11
---

# Cursor lands one column left in open background tabs after a resize and reload

Found in manual testing (2026-11-11). After a resize followed by a reload (or another remount), most
shells draw the terminal cursor one column left of where it belongs: on the last typed or prompt
character instead of after it. It happens only to shells whose tab is open but not selected at that
moment; the selected tab is right. Typed input still reaches the shell; only the drawn cursor (and
what is drawn after it) is off.

Requirements it falls short of: `shells/FR-14` (the pane shows the shell at its rows and columns) and
`close-and-reopen/FR-8` (earlier output shows once after a reload or reopen). `reload-and-restart/FR-27`
covers the hidden tab becoming ready, not how it draws.

## Direction

Suspected, unverified (read from the code, not reproduced):

- Every open tab stays mounted, and a tab that is not selected is `hidden` (0x0). A terminal surface
  created while hidden builds its core from `mount.clientWidth` 0, which gives a 1x1 grid
  (`apps/web/src/terminal/ghostty/surface.ts`, the create path and `terminalGridSize`), and `fit()`
  does nothing while not visible.
- On remount the client reattaches, and the server's snapshot (`packages/ghostty-vt/src/terminal.ts`:
  content, then an absolute cursor move, plus a reprint of the last cell when a wrap is pending) is
  written into that 1x1 core even though the tab is hidden. The cursor move is clamped, and when the
  tab is shown `fit()` resizes the core and the text reflows, leaving the cursor on the last printed
  cell: one column left. With no size change on show, no SIGWINCH prompt redraw corrects it.
- Other candidates if that does not reproduce: a hidden tab's grid is stale after a window resize
  (it sends no `shell.resize` while hidden, and the server sizes the PTY to the smallest viewer), or
  the pending-wrap state is lost when the snapshot is replayed at another width.

Approach:

- Reproduce first with a failing test at the lowest layer: a `surface.test.ts` (or core) case that
  creates a surface while hidden, writes a snapshot ending mid-line, shows it, and asserts the cursor
  column. Then the same with a resize while hidden.
- Likely fix: do not apply a reattach snapshot to a surface that has never been sized; hold it (or
  request a fresh snapshot) until the first real `fit()`, so the snapshot is replayed at the grid the
  server sent it for. Whatever the fix, the cursor must be right without relying on a SIGWINCH redraw.
- Extend a scenario: open two shells, leave one in the background, resize the window, reload, select
  the background tab, and check its cursor column against the shell's (the `S2.grid-size` checks and
  `scripts/scenarios/lib/grid.ts` cover the visible tab only today). Ask whether this needs a new
  `shells/FR` row for the cursor position.
- Check desktop too (same web surface); mobile is frozen and has its own resize ticket, PRB.T-014.

## Done when

- After a resize and a reload, every open tab, selected or not, draws its cursor where the shell put
  it, the first time it is shown.
- A test fails before the fix and passes after, and a scenario covers a background tab after reload.
