---
id: PRB.T-012
type: bug
parent:
phase: 1
labels: [terminal-first]
created: 2026-11-07
updated: 2026-11-07
---

# Agent command is still echoed twice in fish shells

Follow-up to PRB.T-011 (2026-11-07). That fix starts zsh and bash through wrapper startup files that
print an OSC 133;A prompt mark, and `Shells.open` types the agent command after the first mark. fish
is not wrapped (`shellReadyLaunch` in `apps/server/src/terminal/shellReady.ts` returns null for it),
so a fish user still gets the command typed at once: the terminal echoes it before the prompt and
fish draws it again after, so it shows twice.

fish was left out because it is not installed in the dev container, so a wrapper could not be
checked. Install it there (or on the author's machine) before writing the code.

## Direction

- `shellReadyLaunch` returns `{ args: ["--init-command", <script>], env: {} }` for `fish`. The script
  defines a function on the `fish_prompt` event that prints `ESC ] 133 ; A BEL`. `--init-command`
  runs after fish reads the user's `config.fish`, so no wrapper folder is needed. Check that
  against the installed version.
- Check where the mark lands against fish's raw-mode setup, as was done for zsh and bash: typing on
  seeing the mark must not be echoed before the prompt. fish may already keep the terminal in raw
  mode from its start, in which case the event is early enough.
- Tests first, as in PRB.T-011: a row in the launch-plan table, and a real-shell test in
  `shellReady.test.ts` (skipped when fish is missing, with `it.live.skipIf`) that asserts the user's
  `config.fish` ran and the mark is printed. The user's `config.fish` and `$XDG_CONFIG_HOME` must
  still be read.
- Extend scenario S2's check (history starts at the prompt, command shown once) to run with fish
  when it is installed, or add a note why it cannot.
- Update the sentence in `docs/internals/terminal-runtime.md` that says other shells are not wrapped.

## Done when

- A new fish shell shows the agent command once, after the prompt.
- Tests fail before the change and pass after; they are skipped, not passed, without fish.
