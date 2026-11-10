---
id: PRB.T-011
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
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

## Investigation (2026-11-07)

Only the first start is affected: `Shells.restore` opens a plain shell and types nothing, so a
restored shell has no doubled command today. The agent relaunch with a resume command (FR-18, story
8) will go through the same typing, so the fix should be one shared path.

Options tried in a raw `node-pty` (zsh and bash), no product code changed:

| Option | Result | Cost |
| --- | --- | --- |
| Type after the shell's first prompt, detected by the bracketed-paste-on report `ESC [ ? 2004 h` | zsh and bash both emit it right before they read input; nothing is echoed before it, so the command shows once. (The window-title escape also contains the command; that is not visible text.) | Needs a fallback for shells that never emit it (`sh`, `dash`, PowerShell, `cmd`): type after a short quiet period or a timeout |
| Run the agent as the shell's command: `zsh -i -c '<cmd>; exec zsh -i'` | No echo at all | Startup files run twice, the command is not in shell history, and each shell needs its own wrapper form; Windows shells differ |
| Type immediately (today) | Echo before the prompt, redraw after it | none |

## Fix direction

Recommended: wait for `ESC [ ? 2004 h` in the shell's output (watch it in `Shells.open` through the
manager's output events, handling a sequence split across chunks), then type the command; fall back
to typing after a timeout when it never comes. Prefer a test on the manager's output stream with a
fake PTY (no sleeps; the timeout under `TestClock`), plus the existing scenario S2 asserting the
history's first bytes are not the command's echo.

**Decision (author, 2026-11-07): follow Paradev.** Probe starts zsh and bash with its own startup
wrapper that sources the user's files and then prints an OSC 133;A "prompt start" marker; `Shells.open`
types the agent command when the marker arrives, or after a timeout (Paradev uses 15 s, so slow
setups such as direnv still work). Other shells (`sh`, `dash`, Windows shells) are not wrapped and
type at once as today. fish is left out of the first cut: it is not installed in the dev container,
so its wrapper could not be checked. Paradev (MIT) is a behavioral reference only; no code is copied.

## Implementation status and handoff (2026-11-07)

Built in slices, tests first (plan: `.plans/bright-imagining-snail.md`, not committed):

- `apps/server/src/terminal/shellReady.ts`: the mark scanner, `shellReadyLaunch` (zsh through a
  wrapper `ZDOTDIR`, bash through `--rcfile`, every other shell and Windows untouched),
  `writeShellReadyFiles`, and `waitForPromptMark` (mark, shell exit or timeout).
- `Manager.ts`: `shellReadyDir` option, set from `<state dir>/shell-ready`; `trySpawn` wraps shell
  owners only; `printsPromptMark` says whether a session's process was wrapped.
- `Shells.ts`: `open` types the agent command in a background fiber after the first mark, or after
  `promptTimeout` (15 s). Opening does not wait. Input written to the shell with `Shells.write`
  waits for the agent command, because scenarios (and a fast user) type `exit` or `git switch`
  right after the start, and without the wait that input reached the bare shell first.
- Scenario S2 asserts the first shell's history starts at the prompt and shows the command once.

Things a later session should know:

- zsh prints the mark from a `line-init` hook and bash at the end of `PS1`; a `precmd` hook or
  `PROMPT_COMMAND` runs before the terminal is in raw mode and echoes the typed line twice.
- Restore (`Shells.restore`) types nothing today. The resume command of story 8 must go through the
  same wait.
- fish is not wrapped (not installed in the dev container, so it could not be checked); it types at
  once as before.
- A shell whose startup never prints the mark holds user input for up to 15 s.
- The real-shell tests in `shellReady.test.ts` show as skipped when zsh or bash is not installed.
- The start-to-banner time is tracked in [the idea](../../ideas/start-to-banner-time.md).

## Done when

- A new shell and a restored shell show the agent command once.
- A test on the shell's history fails before the fix: the first bytes are not the command's echo.
