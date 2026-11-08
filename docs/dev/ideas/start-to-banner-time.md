# Shorten the time from "start shell" to the agent banner

Seen 2026-11-07 while fixing PRB.T-011: scenario S2 prints `start-to-banner` of about 700 to 780 ms
(click on the up-arrow to a rendered banner frame in the browser). On 2026-11-05 it was 350 to 380 ms
(epic U-3); that was not re-measured on unmodified code, so part of the gap may be machine state. The
limit is 2 s (NFR-1), so this is room to improve, not a failure.

## What is known (dev container, zsh with the user's `.zshrc`)

| Stage | Time |
| --- | --- |
| zsh startup with the rc files (the PRB.T-011 wrapper adds nothing visible: 225 to 245 ms against 223 to 240 ms) | about 200 ms |
| Mock agent start (`node …/mock-agent.ts`; bare node is about 18 ms) | about 60 ms |
| Everything else: click, RPC, shell host spawn, tab open, terminal mount, first render | about 400 ms, not measured |

The agent command is not typed later than before PRB.T-011: the old typed-ahead line was only read
after zsh finished its startup too.

## Ideas, best first (none verified)

1. **Measure the missing 400 ms.** Timestamps at click, `shell.open` received, shell spawned, prompt
   mark seen, command written, first output, first rendered frame. This shows whether the time is on
   the server or in the browser. Do this before any change.
2. **Start the terminal mount in parallel with the spawn.** If the browser mounts the renderer and
   attaches only once the tab exists, doing that while the server spawns could save a good part of it.
3. **Let the user keep their rc files out of the way** (an optional minimal-rc start). The 200 ms is
   the user's own config, so it should not be skipped by default.
4. **Run the agent without the interactive shell in front of it** (for example through `zsh -c`). It
   avoids shell startup but loses the shell that stays open when the agent exits, so it is a trade-off.
5. **Warm node** for the agent. For the mock agent this is about 40 ms; a real agent CLI's startup is
   outside Probe's control.

## To capture

Per-stage timestamps from step 1 on the author's machine, with and without the user's rc files, and
the same S2 number from unmodified `main` on the same day.
