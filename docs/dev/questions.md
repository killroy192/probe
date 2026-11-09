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
  chat view, which PRB.T-003 hides; the user wants it back once shells and folders exist (2026-11-05).
  PRB.T-002 builds it inside the ws layer (`apps/server/src/ws.ts`); deferred by the user.
- PRB.E-002 A-2: Claude Code typed into a ready Probe shell starts and works like in a plain terminal
  (input, resize, exit back to the prompt). Checked by hand in PRB.E-002 story 1; phase 3 depends on it.
- Claude Code's terminal title (spinner while working, `✳` otherwise) is undocumented: whether it is
  stable across versions, and whether the user can turn it off. The UI status depends on it
  (`research/claude-code-hooks-spike.md`).
- Phase 2, shared by PRB.E-003 and PRB.E-004 (2026-11-09), all unverified until PRB.E-004 story 1 (the spike) and PRB.E-003 story 1 run:
  - PRB.E-004 A-1/A-2/A-3: the server builds and runs in a stock Linux container; `node-pty`, the shell host and the `probe` wrapper work there; the `packages/ssh` install and launch logic runs under plain `sh` inside the target. PRB.E-003's verification depends on a server installed this way.
  - PRB.E-004 A-7/A-9: a server bound to a non-loopback address is reachable through a published port, and the shell host socket and database work on a mounted state folder (topology 1), also shared with a host server. Decides what PRB.E-003 story 8 can verify against a real remote.
  - PRB.E-003 U-7 (also PRB.E-002 U-4): how a start request for a workspace on another server gets its command, and where the removed-or-disabled check runs. Settled in PRB.E-003 story 2; PRB.E-002 closes without it.
  - PRB.E-003 A-1/A-8: the connection registry can hold the default and several remote servers at once, and a server can list all its workspaces and signal changes. PRB.E-003 story 1.
- Paradev CLA terms (not read; irrelevant unless we contribute).

## Decisions pending


- Batch reference format: reuse T3 context records or probe-specific.
- Comment storage: server DB vs. per-worktree file.
- Whether to keep source-control packages (GitHub only vs. all hosts).
- Repo visibility (public/private) and what that implies for docs and the analysis of Paradev. PRB.E-004 U-6 also depends on it: a one-line `curl` install needs a repository reachable without credentials; until then, file-copy delivery.
- Product name and bundle id (currently `probe`).

- PRB.E-006 removes "hosted/browser runtime mode" while we now build browser first (2026-11-02). Unverified how the two differ: the locally served `apps/web` stays as the dev and test surface, only the hosted `app.t3.codes` mode is meant to go. Decide before starting PRB.E-006.
