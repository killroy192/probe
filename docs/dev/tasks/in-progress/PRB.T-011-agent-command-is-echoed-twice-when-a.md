---
id: PRB.T-011
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first, debug]
created: 2026-11-07
updated: 2026-11-07
---

# Agent command is echoed twice when a shell starts

On every new shell the agent command shows twice, once before the prompt and once after it:

```
node /workspaces/probe/scripts/mock-agent/mock-agent.ts
vscode ➜ /workspaces/…/worktrees/repo/probe-worktree-de435b (linked) $ node /workspaces/probe/scripts/mock-agent/mock-agent.ts
```

Split from PRB.T-010 (2026-11-07): it may be a separate problem from the duplicated terminal text.

## Cause (confirmed in PRB.T-010 debugging, 2026-11-07)

`Shells.open` writes `<agent command>\r` into the PTY right after spawning (`Shells.ts`, "The pty
buffers this until the shell has read its startup files"). The tty echoes the line at once, before
the OSC title, OSC 7 and the first prompt; zsh then reads the typed-ahead line and redraws it after
the prompt (`n\bnode …`). The shell's history begins with the echo. It reproduces with plain zsh in
a bare `node-pty`, and through the real server with the mock agent.

## Fix direction

Wait for the shell to be ready before typing (first prompt via OSC 133 marks, or the OSC 7 report from
[event-driven tracking](../../ideas/event-driven-shell-tracking.md)), or run the agent as the shell's
command instead of typing it. Mind restore (PRB.T-008), which relaunches the agent with a resume
command the same way.

## Done when

- A new shell and a restored shell show the agent command once.
- A test on the shell's history fails before the fix: the first bytes are not the command's echo.
