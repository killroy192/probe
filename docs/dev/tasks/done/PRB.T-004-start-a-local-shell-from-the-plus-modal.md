---
id: PRB.T-004
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-05
---

# Start a local shell from the plus modal

## Goal

Probe had no way to start a shell: terminals only opened inside a chat thread, so the workspace and
tree built before this story stayed empty. The "+" modal now starts a shell running the mock agent
CLI in a chosen folder, as a tab and a tree node, with no chat thread.

## Delivered

Implemented on `feat/plus-modal-prb-t-004`, stacked on the PRB.T-003 branch (commits 1251962ba,
f38435961 and earlier, 2026-11-05). Proved by scenario S2 (`scripts/scenarios/scenarios/plus-modal.ts`),
including a mutation check (removing the double-click guard fails AC-24). The story also added the
harness helpers S2 needed: restart with env, server logs and a connection cutter.
Start to banner measured at 350-380 ms in the dev container (AC-21).
Requirements: FR-3, FR-6, FR-8, FR-21, FR-7 (part), FR-22 (part), NFR-1 (part), NFR-5, NFR-6 (part).
No formal verify-story-implementation report was produced; the user accepted closing on the
focused tests, typechecks and S2 after manual passes (2026-11-05).

## Decisions

- Folder step is not the existing add-project flow (planning, 2026-11-05): its
  UI is in the unmounted command palette and always opens a chat draft, so only the server services
  and client browse helpers were reused. Epic assumption A-13 recorded as false.
- Two dialogs (user, 2026-11-05, after the manual pass): "+" opens Start shell, which only picks a
  folder and starts a shell; the sidebar's "Add project" icon opens a dialog that imports or creates
  a folder and starts no shell. A folder is registered as a project.
- Clone from a remote and publish are not offered; deferred to a later story (user, 2026-11-05).
- The 2 s start-to-banner limit is kept after the 350-380 ms measurement (user, 2026-11-05).
- The preselected folder was remembered per workspace (user, 2026-11-02); PRB.T-005 later turned it
  into the remembered last start per project.
- The agent command was server-side: the server typed `PROBE_AGENT_COMMAND` into the new shell
  (user, 2026-11-05). Superseded by starting scripts (PRB.T-016); the variable is gone.

## Docs

- [Workspaces](../../../user/workspaces.md#projects-and-shells): starting shells and adding projects
- [Terminal runtime](../../../internals/terminal-runtime.md#shells-and-thread-terminals): start and end logging
- [Mock agent](../../../operations/development.md#mock-agent)
- [Roadmap](../../roadmap.md) (PRB.E-001 "+" and projects decision)

## Follow-ups

- Clone and publish in Add project: deferred, not yet tracked by a ticket.
