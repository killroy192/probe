# Paradev: how agent status works (reference only)

Source: Paradev repo at commit `db70f347` (2026-11-01), read from a shallow clone, plus
docs.paradev.com/agent-status. Behavioral reference only; Paradev is Elastic License 2.0, so do not
copy code (see `paradev.md`). Verified by reading the files named below.

## Mechanism

1. **Hooks, not PTY scraping.** Paradev writes lifecycle hooks into each agent's own config. For Claude Code that is
   `~/.claude/settings.json`; for Codex `~/.codex/hooks.json`. Its entries are merged in and
   identified by script path, so user hooks are preserved and removable
   (`packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts`).
2. **Claude Code events used:** `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`,
   `SubagentStart`, `SubagentStop`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`.
3. **One notify script** (`packages/agent-setup/templates/notify-hook.template.sh`) reads the hook JSON
   (stdin for Claude, argv for Codex), normalizes the event name, and POSTs it with curl to the local
   host service (`notifications.hook`). Hook failure never blocks the agent; unknown events are ignored.
4. **Identity by env vars set on the PTY.** The script exits immediately unless the terminal exported
   its own ids (`SUPERSET_TERMINAL_ID` or `SUPERSET_TAB_ID`). Hook configs are global, so this stops
   agents started outside the app from reporting. Other vars carry agent id, workspace and pane.
5. **Endpoint discovery:** an env var with the hook URL, with a fallback that reads host manifest files.
   The host's credentials are deliberately not placed in the PTY env; the hook endpoint is low-capability.
6. **Host broadcasts, client decides.** The host normalizes and broadcasts `agent:lifecycle` over a
   WebSocket. The client (not Electron main) updates sidebar state, suppresses the notification if the pane is visible and the
   window focused, plays the sound, shows the OS notification, and focuses the pane on click.
   The hook cannot set notification text (prevents spoofing).

## State model (`packages/shared/src/agent-status.ts`)

| Hook event | Status |
| --- | --- |
| `UserPromptSubmit` (renamed `Start`) | `working` |
| `PermissionRequest` | `permission` (highest urgency) |
| `StopFailure` / failure | `failed` |
| `Stop` | `review` (done, unseen) |

Urgency order: review < working < failed < permission. A group takes the highest status of its members.
Terminal exit clears stuck `working`/`permission` so no permanent dots remain.

## Subagents

Claude Code and Codex add `agent_id` to hook payloads only inside a subagent. Paradev routes those
events to a per-terminal subagent roster, never to the terminal's own status. `SubagentStart/Stop`
maintain the roster and carry transcript paths so a subagent pane can follow its transcript.

## Pitfalls Paradev hit (worth designing around)

- Agents replaying another agent's config (cursor-agent replays `~/.claude/settings.json`; Claude's
  Bash tool running `codex exec` fires Codex hooks under a Claude terminal). Fix: compare the hook's harness with the
  terminal's launched agent and drop mismatches.
- Hook configs are global and can go stale across installs.
- Some agents emit no waiting-for-input signal, so they only get completion notifications.
- Renderer-owned notification state was hard to share with remote hosts; v2 moved it to the client behind a shared contract.

## Not verified

- Claude hook payload: common fields `session_id`, `cwd`, `transcript_path`, `hook_event_name` and
  subagent `agent_id`/`agent_type` are confirmed in Claude Code's hooks docs (2026-11-01). Still open: `Stop` on
  interrupt, nested `claude -p` session ids, per-session hooks via `--settings`. See `../questions.md`.
- Behavior for CLIs with no hooks (the docs say nothing beyond "completion only" for some).
