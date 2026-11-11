---
id: PRB.T-050
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-11
---

# Tab and tree labels lag the program running in the shell

Found in manual testing (2026-11-11). A shell's tab ("Shell <n> · <folder> · <program>") and tree node
("Shell <n> · <program>") are meant to name the program running in it (`shells/FR-17`), but they
follow it badly: after typing a command and pressing Enter, or stopping one with Ctrl+C, the label
keeps the old name (or none) for seconds. Users read these labels to find the shell an agent runs in,
so a stale one is a lying label.

The server learns the program only from a process-table poll in `apps/server/src/terminal/Manager.ts`
(`pollSubprocessActivity`): one snapshot per second for all shells, every 30th tick when every
session counts as quiet (`QUIET_SUBPROCESS_SNAPSHOT_EVERY_TICKS`), and a doubling back-off up to 60 s
after failed snapshots (`subprocessSnapshotPollDelayMs`). Nothing the user types makes it look
sooner.

A session is "quiet" when two snapshots in a row found no child process, its program name did not
change, and it printed and received nothing since (`isQuiet`). The 30-tick skip applies only while
every running shell is quiet; any output or keystroke in any shell ends it. So by the code, a shell
the user is typing in should be rechecked within about 1 s. The user sees the lag everywhere
(2026-11-11), so the 1 s poll is not the whole story: the back-off after failed native snapshots
(see PRB.T-046) or the path from the manager's `hasRunningSubprocess` and `label` to the client's
shell list may add more. Measure first: debug lines with timestamps on the key, the snapshot, the
manager's activity event and the shell-list update the client receives. PRB.T-046 is one case of this (the label missing for over 10 s after a start); fix them
together or land this after it.

## Direction

- Recheck on the keys that change the foreground program, as the user proposed. `Manager.write`
  already sees every byte a client or the `probe` command sends, so the trigger lives on the server
  and works for every client, remote ones included: Enter (`\r`), Ctrl+C (`\x03`), Ctrl+D (`\x04`)
  and Ctrl+Z (`\x1a`) wake the poll for that session instead of waiting for the next tick.
  A program is not in the process table the instant Enter arrives, so wake it shortly after and
  once more a little later (bounded, a few hundred ms), not once.
- Use the shell's own marks too, where the wrappers send them: a new prompt mark means the
  foreground program ended, so recheck on it (see `docs/internals/terminal-runtime.md` for the
  OSC 133 marks zsh and bash send). fish and other unwrapped shells get the key triggers only.
- Keep the cost bounded with ten or more shells (AGENTS.md, performance): coalesce wakes into one
  snapshot for all sessions that asked, never one snapshot per key, and keep the steady poll as the
  fallback. Typing a long line must not take a snapshot per character.
- Settle before publishing (user, 2026-11-11): bursts of short-lived processes (a prompt that runs
  `git`, completions, a script running many commands) must not flicker the label. Publish the
  program name with a trailing-edge throttle or debounce per shell: rechecks may run at once, but
  the label changes only once the snapshots stop changing for a short window (a few hundred ms).
  Keep the window short so the label is still prompt after Enter.
- Tests first, on the `TestClock` in `Manager.test.ts`: writing `\r` (and `\x03`) to a quiet
  session takes a snapshot within the wake delay, not after the quiet skip; a burst of writes takes
  one snapshot. Extend a scenario that starts a program by typing and checks the tab label follows,
  and again after Ctrl+C.
- Related idea: `docs/dev/ideas/event-driven-shell-tracking.md` (the same move away from polling
  for folders and branches).

## Done when

- After Enter starts a program, or Ctrl+C or Ctrl+D ends one, the tab and tree node name the new
  foreground program within a bound the author sets and states (well under a second on a quiet
  machine), on zsh and bash; fish follows on the key triggers.
- A burst of short-lived programs changes the label once, to the program left running.
- Keystrokes that are not those keys take no extra snapshots, and many shells cost no more per tick
  than today.
