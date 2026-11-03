---
name: tickets
description: Read and update Probe tickets with the tm CLI. Use when a task references a PRB.T-NNN task (story or bug) or PRB.E-NNN epic, to list or show tickets, view the board, change a ticket's status or labels, or append a session log entry.
---

# Probe tickets

Tickets live in `docs/dev/epics/` and `docs/dev/tasks/`, one markdown file each. The status is the
folder the file is in (`backlog`, `in-progress`, `done`); there is no status field. Manage tickets
with `tm`, never by moving files or editing frontmatter by hand. Format and the full command list:
[docs/dev/README.md](../../../docs/dev/README.md).

## Commands

```
vp run tm ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story|bug]
vp run tm show PRB.T-004
vp run tm board [--phase N] [--epic PRB.E-001]
vp run tm mv PRB.T-004 in-progress   # backlog | in-progress | done
vp run tm label PRB.T-004 +plan      # add or remove a label: +x / -x
vp run tm log "<one line>"           # appends to docs/dev/memory/log/YYYY-MM-DD.md
```

`mv` and `label` set `updated`. Moving to `done` prints a reminder to list what should move into
`docs/` outside `docs/dev`.

## Workflow

The usual path is plan > implement > verify > review, but it is optional. Mark the current step
with a label (`plan`, `implement`, `verify`, `review`) and keep the spec, plan and verification
notes in the task body.

1. Before starting, `tm show` the task and its epic, then `tm mv` it to `in-progress`.
2. Reference the ID in commits and PRs (`feat(server): ... (PRB.T-004)`).
3. Move to `done` when told the work merged.
4. To find tickets or notes by topic, use the `cocoindex-code` MCP, then `tm show` for the exact
   ticket. Old `PRB-0NN` and `PRB.S-NNN` IDs in history are mapped by each ticket's `was`.

New tickets come from the [epic-creation](../epic-creation/SKILL.md) and
[story-creation](../story-creation/SKILL.md) skills. If other work needs a ticket, say so instead of
creating one. `tm` never commits.
