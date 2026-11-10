# Open questions

Assumptions that have **not** been verified and decisions still open, where they span tickets.
An assumption that only one ticket depends on stays in that ticket's table. Remove an entry when
it is verified or decided; settled decisions go to `roadmap.md`.

## Unverified

- How agents started in a T3 terminal receive MCP configuration, and whether the existing
  `apps/server/src/mcp` server can serve review-batch tools to them.
- Whether the Ghostty terminal surface and the server's PTY layer accept programmatic input without
  submitting (the "stage text, no Enter" primitive).
- Agent CLIs' handling of staged input: bracketed paste, multi-line, kitty keyboard protocol.
- Claude Code's current support for MCP prompts as slash commands and for server-pushed messages.
- Whether CI type-checks desktop and mobile after contract changes (PRB.T-008 SA-4). Locally,
  `vp run check:changed` type-checks both as dependents of `packages/contracts`.
- Which story brings back the right panel (folders and file preview) next to shells. It lived in the
  chat view, which is now hidden; the user wants it back once shells and folders exist (2026-11-05).
- PRB.E-002 A-2: Claude Code typed into a ready Probe shell starts and works like in a plain terminal
  (input, resize, exit back to the prompt). Checked by hand in PRB.E-002 story 1; phase 3 depends on it.
- Claude Code's terminal title (spinner while working, `✳` otherwise) is undocumented: whether it is
  stable across versions, and whether the user can turn it off. The UI status depends on it
  (`research/claude-code-hooks-spike.md`).
- Phase 2, shared by PRB.E-003 and PRB.E-004 (2026-11-09), all unverified until PRB.E-004 story 1 (the spike) runs (PRB.E-003 story 1 has run):
  - PRB.E-004 A-1/A-2/A-3: the server builds and runs in a stock Linux container; `node-pty`, the shell host and the `probe` wrapper work there; the `packages/ssh` install and launch logic runs under plain `sh` inside the target. PRB.E-003's verification depends on a server installed this way.
  - PRB.E-004 A-7/A-9: a server bound to a non-loopback address is reachable through a published port, and the shell host socket and database work on a mounted state folder (topology 1), also shared with a host server. Decides what PRB.E-003 story 8 can verify against a real remote.
  - PRB.E-003 U-7 (also PRB.E-002 U-4): how a start request for a workspace on another server gets its command, and where the removed-or-disabled check runs. Settled in PRB.E-003 story 2; PRB.E-002 closes without it.
- Scenario suite (PRB.E-005, 2026-11-09 and 2026-11-10, all unverified until the named story runs):
  - PRB.E-005 A-1: S2's PRB.T-011 check fails because the harness runs the developer's real shell config (oh-my-zsh prompt forks `git`; a resize redraws the typed command). Desk reading, not run; it fails the same on plain `main`. Checked in PRB.T-036.
  - PRB.E-005 A-5: `@playwright/test` 1.60.0 runs with the cached headless Chromium shell. The first spike of PRB.T-037 (moved from PRB.T-040); the fallback is the current Node runner.
  - PRB.E-005 A-4: scenarios scoped to their own workspace can share one server, one after another (checked first in PRB.T-037, for the sandbox; then every sandbox-accepted atomic scenario as one set in PRB.T-039 AC-3) and in parallel (PRB.T-040). Desk reading (PRB.T-037, 2026-11-10): S1, S4, S5, S6 and the `setUp` scenarios collide on the fixed workspace name "sparta" and fixed folders; E2-S4 rewrites the server-wide starting-script list; S6 matches the whole process table. PRB.T-037 gives each accepted scenario per-run names before the check.
  - PRB.E-005 A-9: the cold starts and UI-driven setup are most of the run time. Timing split in the PRB.T-036 baseline; acted on in PRB.T-038.
  - PRB.E-005 A-11: parallel load exposes waits that are only guesses today. Run in parallel before and after PRB.T-041, in PRB.T-040.
  - PRB.E-005 A-13: with direct setup and a shared server, atomic scenarios fit under the 15 s cap. The cap gate per scenario in PRB.T-039, and a whole-suite gate when PRB.T-040 closes.
  - PRB.E-005 U-1: per-scenario times and the flake rate today. One gate-style serial run in PRB.T-036 (its AC-21), after the user confirms the machine is quiet.
  - PRB.E-005 A-2 (PRB.T-041 SA-2): S4's tab-list flake comes from reloading with a layout save still in flight and reading the tab strip once with no wait. Desk reading; PRB.T-041 AC-12 tests it.
  - PRB.T-038 SA-2: a plain shell in the isolated shell config shows a first-prompt mark the library can wait for before typing (depends on PRB.T-036 SU-3). Checked when PRB.T-038 is planned.
  - PRB.T-038 SU-1 / PRB.E-005 U-3: whether web diagnostic lines can be hidden in production; the web app has no log level today (grep 2026-11-10). Plan stage of PRB.T-038.
- From the PRB.T-029 container spike (`research/t-029-container-spike.md`), for PRB.T-030 and PRB.T-031:
  - Whether the server should default the agent command when `PROBE_AGENT_COMMAND` is unset. Today no shell opens at all without it, in any install.
  - What the startup banner and `pair` should print when the server is bound to `0.0.0.0` in a container: today they print the bridge IP, which the host cannot reach. The startup token also lands in the server log.
  - The PID-based "already running" preflight (`apps/server/src/cli/config.ts`) cannot see a server in another PID namespace; the `server-owner.sqlite` lock caught it between containers. Unverified for a host server sharing the folder with a container server.
  - The shell-host socket on a mounted state folder accepts connections from any container that mounts it. Whether the guide only warns, or the socket needs its own check.
- Paradev CLA terms (not read; irrelevant unless we contribute).

## Decisions pending


- Batch reference format: reuse T3 context records or probe-specific.
- Comment storage: server DB vs. per-worktree file.
- Whether to keep source-control packages (GitHub only vs. all hosts).
- Repo visibility (public/private) and what that implies for docs and the analysis of Paradev. PRB.E-004 U-6 also depends on it: a one-line `curl` install needs a repository reachable without credentials; until then, file-copy delivery.
- Product name and bundle id (currently `probe`).

- The trim epic (phase 7) removes "hosted/browser runtime mode" while we now build browser first (2026-11-02). Unverified how the two differ: the locally served `apps/web` stays as the dev and test surface, only the hosted `app.t3.codes` mode is meant to go. Decide before starting that epic.
