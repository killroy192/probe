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

## Goal

On every new shell the agent command showed twice, once before the prompt and once after it. The command now shows once.

## Delivered

Split from PRB.T-010 (2026-11-07), where the cause was confirmed: the command was typed into the PTY right after spawn, so the tty echoed it before the prompt and zsh redrew it after. `Shells.open` now types the agent command after the shell's first prompt mark, or after a 15 s timeout. zsh and bash start through wrapper startup files; other shells are unwrapped and type at once. Input written to a shell waits for the agent command, so a fast `exit` or `git switch` does not reach the bare shell first. Scenario S2 asserts the first shell's history starts at the prompt and shows the command once.

## Decisions

- Follow Paradev's approach: a wrapper that prints a prompt mark, typing on the mark or a 15 s timeout (author, 2026-11-07). Paradev is MIT and a behavioral reference only; no code was copied. Rejected: running the agent as the shell's command (`zsh -i -c '<cmd>; exec zsh -i'`), which runs startup files twice and keeps the command out of shell history.
- fish is not wrapped, because it is not installed in the dev container and could not be checked (author, 2026-11-07).

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md): the wrapper, the mark, the timeout and the zsh and bash traps.
- [Start-to-banner time idea](../../ideas/start-to-banner-time.md): the measurements taken while fixing this.

## Follow-ups

- fish still echoes the command twice: PRB.T-012.
- Restore types nothing today; the agent resume command (FR-18, story 8) must go through the same wait.
- A shell whose startup never prints the mark holds user input for up to 15 s.
