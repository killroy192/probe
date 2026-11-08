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
  (input, resize, exit back to the prompt). Checked by hand in PRB.E-002 story 1 or 2; phase 2 depends on it.
- Claude Code's terminal title (spinner while working, `✳` otherwise) is undocumented: whether it is
  stable across versions, and whether the user can turn it off. The UI status depends on it
  (`research/claude-code-hooks-spike.md`).
- Paradev CLA terms (not read; irrelevant unless we contribute).

## Decisions pending


- Batch reference format: reuse T3 context records or probe-specific.
- Comment storage: server DB vs. per-worktree file.
- Whether to keep source-control packages (GitHub only vs. all hosts).
- Repo visibility (public/private) and what that implies for docs and the analysis of Paradev.
- Product name and bundle id (currently `probe`).

- PRB.E-006 removes "hosted/browser runtime mode" while we now build browser first (2026-11-02). Unverified how the two differ: the locally served `apps/web` stays as the dev and test surface, only the hosted `app.t3.codes` mode is meant to go. Decide before starting PRB.E-006.
