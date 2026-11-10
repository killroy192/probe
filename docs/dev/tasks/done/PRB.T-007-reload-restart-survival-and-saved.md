---
id: PRB.T-007
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-07
---

# Reload, restart survival and saved workspace layout

## Goal

A user running several agent shells can reload the browser or restart the server without losing their
shells, tabs or output, and a shell they deliberately ended does not come back. Delivered as a shell
host that owns every shell's PTY, plus saved tabs and a remembered shown workspace.

## Delivered

Merged on `feat/restart-survival-prb-t-007` (stacked on the PRB.T-006 branch), done 2026-11-07.

- A reload keeps the tree, the shells, the open tabs and the selected tab, and each reopened tab shows
  the shell's output history. The shown workspace is remembered per browser.
- A server restart leaves running shells as the same processes with their output; the next server
  reattaches. A workspace file saves its tabs and selected tab.
- A Probe kill or an exit without a signal removes a shell for good; a signal exit, or a shell lost
  with its host, stays listed as ended until removed with the "x".
- A project, worktree or shell whose folder is gone is marked "moved"; a running shell there keeps
  working, and no new shell can start in it. An alert shows when the layout cannot be saved.
- Proof: scenario S4 (reload part) and S7 (`scripts/scenarios`, restart; stages named after their
  acceptance criteria), shell host, `Manager` and `SavedWorkspaces` tests. The author and the user
  (2026-11-06 to 2026-11-07, `vp run dev`) ran a manual pass and accepted it.
- Requirements met: FR-14, FR-15, FR-19, FR-23, FR-24 (part), FR-22 (persisted part), NFR-5, NFR-7.

## Decisions

- **Shell host (user, 2026-11-06):** one detached helper per state folder owns every PTY, instead of
  keeping PTYs in the server. The PRB.T-002 spike had shown shells die with the server (A-14 false).
- **Tabs (user):** open and selected tabs are saved in the workspace file; shells stay server-level and
  are recorded in `<state dir>/shells/registry.json`, not in workspace files (as PRB.T-006 decided).
- **End classification (user, 2026-11-02, U-7/SU-2):** a normal exit of any status is intentional;
  only a signal or a lost owner is unexpected.
- **Moved folders (user, 2026-11-07, manual pass):** missing folders read "moved"; a project whose
  folder is gone leaves the workspace once no shell is in it.
- **Removed workspace (user, 2026-11-02):** removal deletes its file and layout; nothing is reopenable.
- Taking over a shell with 8 MiB of kept output took 128 ms over the host socket (2026-11-06).

## Docs

- [Roadmap: PRB.E-001 restart survival](../../roadmap.md)
- [Reloads and restarts](../../../user/workspaces.md)
- [Shell host](../../../internals/terminal-runtime.md)
- [Stopping a dev server's shells](../../../operations/development.md)

## Follow-ups

- [PRB.T-008](PRB.T-008-restore-and-resume-after-an-unexpected.md): restoring ended shells.
- [PRB.T-010](PRB.T-010-terminal-shows-repeated-prompt-and.md) and
  [PRB.T-011](PRB.T-011-agent-command-is-echoed-twice-when-a.md): terminal text duplicated, agent
  command echoed twice.
- [Event-driven shell tracking](../../ideas/event-driven-shell-tracking.md): replace the 2 s poll.
- Android's `t3_terminal_jni.cpp` passes the same 10,000 `max_scrollback` that the web fix replaced
  (the value is bytes, not rows); not changed, no native build here, and not tracked anywhere yet.
