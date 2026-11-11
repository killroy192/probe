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
every running shell is quiet; any output or keystroke in any shell ends it.

Measured 2026-11-11 (manual run, debug lines on the poll): the seconds-long lag was the back-off
after failed native snapshots, the same cause as PRB.T-046. With the native monitor missing, every
tick fell back to `ps` and still counted as failed, so the delay grew to 60 s; the label reached the
client in the same second the poll saw the program. Fixed by counting a `ps` fallback as a good
snapshot on Linux and macOS (see PRB.T-046). After the fix the label followed Enter and Ctrl+C
within 0 to 1 s.

What remains is the schedule. Any output or keystroke in any shell keeps every shell on the 1 s
check, so ten busy agents pin the poll at 1 s for good, while a server where everything is idle
waits up to 30 s even when the user acts. The checks should follow what the user does, not what the
shells print.

## Direction

User design, 2026-11-11.

- **A schedule per shell that grows when nothing happens.** The wait before a shell's next check
  follows the Fibonacci numbers in seconds: 1, 1, 2, 3, 5, 8, 13, then stays at 13. It replaces the
  quiet skip (`isQuiet`, `QUIET_SUBPROCESS_SNAPSHOT_EVERY_TICKS`). Output and ordinary typing do not
  move the schedule, so a chatty agent no longer pins the poll at 1 s.
- **A reset event puts the shell back at the start (1 s).** Reset events:
  1. The shell's tab is shown or hidden: the user switches tabs, or the browser tab becomes
     visible or hidden.
  2. The shell's terminal gets focus: the user clicks into it, or the window regains focus with it
     focused.
  3. Enter (`\r`) or Ctrl+C (`\x03`) written to the shell. `Manager.write` sees every byte from
     every client and the `probe` command, so this one needs nothing from the client.
  4. The shell's own marks: a prompt mark (OSC 133, sent by the zsh and bash wrappers, see
     `docs/internals/terminal-runtime.md`) means the foreground program ended or was suspended,
     which also covers Ctrl+D and Ctrl+Z. fish and other unwrapped shells get the other events only.
  5. A check found a different program than the last one, so a quick second change is caught too.
- **Reset events are debounced per shell**, so typing or switching tabs fast does not reset over and
  over. The recommended form is leading-edge: the first event resets at once, and more events
  inside the window (about 500 ms) do nothing more. A trailing debounce would delay the check after
  Enter by the window.
- **Events 1 and 2 come from the client**, so they need a new `shell.*` request in
  `packages/contracts` (for example "the user is looking at shell X"). The web client sends it on tab
  switch, terminal focus and `visibilitychange`; it goes over the websocket, so it works for remote
  clients. Mobile must still compile. Hidden tabs stay attached today (they are mounted `hidden`),
  so the server cannot tell visibility from attach or detach.
- **One process-table read per tick.** A tick takes one snapshot when any shell is due and checks
  only the shells that are due. Many shells cost no more per tick than today.
- **The failure back-off stays as it is**: a failed read (or the Windows PowerShell fallback) backs
  off on its own schedule, separate from this one.
- The earlier idea to settle the label for a few hundred ms before publishing is dropped. With checks
  at least 1 s apart there is never more than one snapshot inside such a window, so it would do
  nothing, and a longer window would only delay the label.
- Tests first, on the `TestClock` in `Manager.test.ts`: the waits follow 1, 1, 2, 3, 5, 8, 13, 13;
  each server-side reset (Enter, Ctrl+C, a prompt mark, a changed program) brings the next check
  back to 1 s; a burst of resets inside the window resets once; output and other keys do not reset;
  one snapshot per tick with several shells due. Extend a scenario: start a program by typing, the
  tab label follows within the bound, and again after Ctrl+C; switch to an idle shell's tab and its
  label is checked within about 1 s.
- Related idea: `docs/dev/ideas/event-driven-shell-tracking.md` (the same move away from fixed
  polling for folders and branches).

## Done when

- After Enter starts a program, or Ctrl+C ends one, the tab and tree node name the new foreground
  program within about 1 s plus one snapshot, on zsh and bash.
- A shell with no reset events is checked at 1, 1, 2, 3, 5, 8, 13 s, then every 13 s, whatever it
  prints.
- Showing a shell's tab, or focusing its terminal, gets its label rechecked within about 1 s, from
  a local or a remote client.
- Resets inside the debounce window count once, and one tick reads the process table once however
  many shells are due.
