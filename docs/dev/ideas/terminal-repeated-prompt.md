# Terminal shows the prompt repeated on one line

Seen once in a shell tab during the PRB.T-007 manual pass (2026-11-06), not reproduced since. A tab
showed the prompt many times in a row with no line breaks:

```
vscode ➜ ~/probe-demo/repo (main) $vscode ➜ ~/probe-demo/repo (main) $vscode ➜ ~/probe-demo/repo (main) $ …
```

where one `vscode ➜ ~/probe-demo/repo (main) $` was expected.

## What to look at first

- **Size mismatch.** zsh redraws its prompt on every `SIGWINCH`. If the shell's idea of the width
  differs from what the renderer draws (a resize that reached the PTY but not the surface, or the
  shared grid of several viewers changing), each redraw's carriage return and clear-to-end land in
  the wrong place and leave the old prompt behind. Check whether it follows a reload, a tab switch,
  a window resize, or a second viewer of the same shell.
- **History replay.** A reopened or reloaded tab replays the server's history, then live output. A
  replay that also gets a resize (the reattached viewer resizes the PTY) makes the shell redraw on
  top of replayed text.
- **Shell host takeover.** After a server restart the history comes from the shell host's raw buffer
  rather than the server's; compare a tab before and after a restart.

## To capture next time

The shell id, the tab's size and the window's size, what happened just before (reload, tab switch,
resize, restart), and the shell's history from `shell.attach` (raw, with escape sequences), so the
bytes can be replayed into the renderer in a test.
