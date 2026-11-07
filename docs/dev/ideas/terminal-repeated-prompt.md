# Terminal shows the prompt repeated on one line

Seen once in a shell tab during the PRB.T-007 manual pass (2026-11-06), not reproduced since. A tab
showed the prompt many times in a row with no line breaks:

```
vscode ➜ ~/probe-demo/repo (main) $vscode ➜ ~/probe-demo/repo (main) $vscode ➜ ~/probe-demo/repo (main) $ …
```

where one `vscode ➜ ~/probe-demo/repo (main) $` was expected.

It happens often in some shells (seen across workspace switches, PRB.T-007 E1 check). A related
symptom shows on every new shell: the agent command appears twice, once before the prompt and once
after it:

```
node /workspaces/probe/scripts/mock-agent/mock-agent.ts
vscode ➜ /workspaces/…/worktrees/repo/probe-worktree-de435b (linked) $ node /workspaces/probe/scripts/mock-agent/mock-agent.ts
```

`Shells.open` writes `<agent command>\r` into the PTY right after spawning, before the shell has read
its startup files (`Shells.ts`, "The pty buffers this until the shell has read its startup files").
The terminal driver echoes the typed-ahead line at once, then zsh prints its prompt, reads the
buffered input and its line editor draws the line again. So the command is typed before the shell
is ready, and the first echo is left on screen. The same early input, or a prompt redraw racing it,
may be what leaves repeated prompts. A fix would wait for the shell to be ready before typing: the
first prompt (OSC 133 prompt marks, or the OSC 7 report from
[event-driven tracking](event-driven-shell-tracking.md)), or run the agent as the shell's command
instead of typing it.

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
