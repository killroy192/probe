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
- **Not yet tried:** the unexecuted-text case (type, leave the tab or workspace, come back), which the
  scripted run did not cover. It points at a reattach: a snapshot or redraw landing on a surface that
  already has the text.

## Next

Reproduce the unexecuted-text case in the browser with the typed line left in place across a tab
switch and a workspace switch, and capture what the surface shows (text of the rendered terminal)
next to the server history. Instrument `TerminalViewport` (snapshot writes, `onResize`, `setVisible`).

## Done when

- Text typed and left at the prompt shows once after a tab switch, workspace switch and reload.
- The prompt is not repeated after workspace switches or resizes.
- A test reproduces the root cause and fails before the fix.
