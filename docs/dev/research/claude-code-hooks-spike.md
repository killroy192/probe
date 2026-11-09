# Spike: Claude Code hooks for agent status

2026-11-08, before the phase 3 epic. Claude Code 2.1.318, model Haiku, in the dev container. Hooks
were loaded only through a throwaway `--settings` file (the user's `~/.claude/settings.json` was not
touched), and the interactive runs were driven through a real PTY with scripted keys. Paradev was
re-read at commit `b77bc046` (2026-11-07); behavioral reference only (ELv2, see `paradev.md`).

## What Claude Code does

| # | Question | Result | How shown |
| --- | --- | --- | --- |
| 1 | Can `--settings <file>` add hooks for one session? | **Yes.** They fire for that session only; a nested `claude` started without the flag fires none of them. | `claude -p` whose Bash tool ran two nested `claude -p`, one with and one without the flag |
| 2 | Does a nested `claude -p` get its own `session_id` and fire hooks? | **Own `session_id`, yes.** It fires whatever hooks its own settings give it (global hooks: yes; `--settings`: only if passed). It inherits the PTY's env, so a per-shell env var (`PROBE_SHELL_ID`) arrives on both sessions' events. No payload field names the parent session. | Same run; the hook logged env and payload |
| 3 | Can Probe choose the session id? | **Yes:** `claude --session-id <uuid>` is honored, and every event carries that id. | Same run |
| 4 | Does `Stop` fire on Esc or Ctrl+C? | **No. No hook fires at all**: Esc during a running tool, Ctrl+C during a running tool, and Esc while the model is writing (screen showed "Interrupted") all left the log unchanged for 8 s; the next event came only from the next prompt or `SessionEnd`. | Interactive TUI over a PTY |
| 5 | Does `Stop` mean "done"? | **Not always.** `Stop` carries `background_tasks`; it fired while a background shell was still running. | Interactive run where the model backgrounded `sleep` |
| 6 | Other events that could mislead status | After every `Stop` a `SubagentStop` fires with an `agent_id`, an empty `agent_type` and no matching `SubagentStart` (an internal helper; its message was the prompt suggestion). `Notification` with `notification_type: "idle_prompt"` was seen. `SessionEnd.reason` is `other` for both a `-p` exit and Ctrl+C twice. | Interactive runs |
| 7 | First run in a new folder | Claude shows a folder **trust dialog whose default is "No, exit"**, and **no hook fires** (not even `SessionStart`) until it is answered. | Interactive run in a fresh folder |
| 8 | HTTP hooks | The `url` cannot use env vars (`http://127.0.0.1:$PORT/...` is rejected as "Invalid URL" and the entry skipped); `headers` can, through `allowedEnvVars`, so `Authorization: Bearer $PROBE_HOOK_TOKEN` arrived. `SessionStart` was not delivered over HTTP (`UserPromptSubmit`, `Stop` and `SessionEnd` were). | Local listener |
| 9 | Endpoint down (server restarting) | The turn is not slowed (1.8 s with or without the listener); a `SessionEnd hook [...] failed: connect ECONNREFUSED` line is printed to stderr, so it would show in the terminal. | Same, listener stopped |

## What Claude Code writes to the terminal (no flags, no hooks)

Raw PTY output of an interactive session, recorded next to the hook events (same day, same version):

| Moment | Terminal output | Hook |
| --- | --- | --- |
| Trust dialog shown | no title; only an `OSC 7501;?` query | none |
| Ready, idle, finished, interrupted | title `OSC 0;✳ <task summary>` (`✳ Claude Code` at start) | `Stop` on finish; none on Esc |
| Working | title alternates `◐`/`◑` before the task summary, about once a second | `UserPromptSubmit`, `PreToolUse` |
| Waiting for permission | title stops spinning (`✳`) at once; with `TERM_PROGRAM=iTerm.app`, `OSC 9;Claude needs your permission` about 6 s later | `PermissionRequest` |
| Idle about 60 s | with `TERM_PROGRAM=iTerm.app`, `OSC 9;Claude is waiting for your input` | `Notification` (`idle_prompt`) |

- Esc during a turn turns the title back to `✳` within 0.1 s, so the title catches the interrupt the
  hooks miss.
- Without `TERM_PROGRAM=iTerm.app` no `OSC 9` was sent (the default notification channel depends on
  the detected terminal); the title was sent either way.
- The title format is undocumented and can change between versions; it cannot tell permission from
  done, or a failed turn from a finished one.

## What Paradev does (commit `b77bc046`)

- **Identity:** events are keyed by the terminal id set on the PTY, not by session. Subagent events
  (`agent_id`) go to a roster; a different CLI is dropped by comparing the hook's harness with the
  launched agent. A nested `claude -p` passes both checks, replaces the terminal's session, and its
  `SessionEnd` detaches the parent: open issue #8131.
- **Interrupts:** they document that `Stop` does not fire on interrupt (matches row 4) and clear
  working/permission when the renderer sees Ctrl+C or Esc typed in that terminal, quietly; the next real
  event overrides it. No timeout on "working"; terminal exit and a daemon-loss sweep also clear it.
  #8120: status drops to "review" while a background subagent runs (`background_tasks` ignored).
- **Auth:** the hook endpoint is unauthenticated on purpose and can only set an indicator and play a
  chime; the terminal id must exist; the hook cannot set notification text. The host's credential is
  kept out of the PTY env.
- **Several instances and stale installs:** one global entry runs `$APP_HOME/hooks/notify.sh` only if
  the env var is set and the file exists, else `|| true`, so stale entries and agents outside the app
  are no-ops. The script tries the URL from the PTY env, then every host manifest on disk; only the
  owner of the terminal accepts.
- **Per-session `--settings`:** used until PR #2479 (2026-03-14), then replaced by merging into the
  global `~/.claude/settings.json`, because their `claude` wrapper was not found first on `PATH` for
  some users (ZDOTDIR, mise/asdf). They also merge into `$CLAUDE_CONFIG_DIR/settings.json`.
- **Latency:** #8245: a synchronous `UserPromptSubmit` hook with shell parsing added seconds and hit
  the 30 s timeout. Keep the hook trivial.

## What this means for Probe

- **Two layers, decided by the user 2026-11-08 (see `roadmap.md`):** a base layer for the UI that needs no setup
  (the shell's foreground process is `claude`, and the title says working or not), and a hook layer
  for the probe CLI that agents read (permission, failed, background tasks, session id). The hook layer reaches a `claude`
  typed by hand through a `claude` shell function that Probe's zsh and bash wrapper defines after the
  user's startup files: a function wins over `PATH`, so nvm, mise or asdf reordering `PATH` cannot
  hide it (the problem that moved Paradev off `--settings`). A non-interactive shell, such as an
  agent's Bash tool, does not get the function, so nested sessions stay silent. Unwrapped shells
  (fish) and `command claude` get the base layer only.

- **Per-session hooks are now an option, unlike for Paradev.** Probe types the agent command itself
  (PRB.E-002), so it can add `--settings <file> --session-id <uuid>` without a `PATH` wrapper. That
  avoids editing the user's global config, makes nested sessions silent (they get no Probe hooks, so
  #8131 cannot happen), and binds each shell to the session id Probe chose. The cost: `claude` typed by
  hand in a plain shell reports nothing, and a starting script must be known to be Claude Code to get
  the flags. This conflicts with the roadmap's recorded choice (global config, as Paradev does) and
  needs a decision.
- **If hooks stay global:** key by shell plus the bound session (the first main-loop `session_id`, or
  the one Probe passed with `--session-id`), and ignore events and `SessionEnd` from any other session
  in the same shell.
- **Interrupts must be cleared by Probe, not by hooks.** The server owns PTY input, so it can clear
  "working" and "permission" when an Esc or Ctrl+C reaches the shell, for every client including
  remote ones; the next hook event overrides it.
- **Done is `Stop` with no running `background_tasks`.** Ignore `SubagentStop` with no matching start
  or with an empty `agent_type`.
- **Auth:** a per-shell token in a header (as `probe kill` already uses a per-shell token) is cheap and
  stronger than Paradev's open endpoint. An HTTP hook needs a literal URL, so it fits a per-session
  settings file written at launch, not a global entry; a server restart on another port would orphan
  it. `SessionStart` needs a command hook.
- **New worktrees:** the first agent in every forked worktree stops at the trust dialog with no event,
  so Probe cannot show "needs input" for it from hooks. Whether Probe may pre-trust worktrees it
  creates is unverified.

## Not verified

- Whether a nested `claude` fires hooks from the global settings file (expected from row 2, which
  showed it loads its own settings, but only `--settings` was tried).
- Why `SessionStart` was not delivered over HTTP (unsupported for that event, or a timing issue).
- Whether the trust answer is remembered per path, and whether it can be given in advance.
- How a failing hook's stderr line looks in the interactive TUI.
- Codex and other CLIs: not tried.
