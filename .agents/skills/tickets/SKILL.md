---
name: tickets
description: Read and update Probe tickets with the tm CLI. Use when a task references a PRB.T-NNN task (story or bug) or PRB.E-NNN epic, to list or show tickets, view the board, or change a ticket's status or labels.
---

# Probe tickets

Tickets live in `docs/dev/epics/` and `docs/dev/tasks/`, one markdown file each. The status is the
folder the file is in (`backlog` > `in-progress` > `done`); there is no status field. Manage tickets
with `tm`, never by moving files or editing frontmatter by hand. Refer to tickets by ID, not file
name.

## Format

Epics are `PRB.E-NNN`, tasks are `PRB.T-NNN`, with separate counters in `docs/dev/ids.json`. A task
is `type: story` or `type: bug`; a story names its epic in `parent`, a bug may omit it.

```yaml
---
id: PRB.T-003
type: epic | story | bug
parent: PRB.E-002 # tasks only; required for stories
phase: 1
labels: [plan, mobile-impact]
was: [PRB-012, PRB-014] # optional: old IDs this ticket replaced
created: 2026-11-01
updated: 2026-11-01
---
```

## Commands

`tm` (`scripts/ticket-manager-lib`) issues IDs from `ids.json` under a lock, so IDs only go up and
are never reused. Never edit `ids.json` or create ticket files by hand.

```
vp run tm ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story|bug]
vp run tm show PRB.T-004
vp run tm board [--phase N] [--epic PRB.E-001]
vp run tm mv PRB.T-004 in-progress   # backlog | in-progress | done
vp run tm label PRB.T-004 +plan -spec
vp run tm check                      # IDs unique, ids.json ahead of every ticket, parents exist
vp run tm new epic "<title>" [--phase N] [--labels a,b]
vp run tm new story|bug "<title>" [--parent EPIC_ID] [--phase N] [--labels a,b]
vp run tm rm <ID>                    # an epic must have no tasks; the ID stays reserved
```

`mv` and `label` set `updated`. Moving to `done` prints a reminder to list what should move into
`docs/` outside `docs/dev`. `TM_ROOT` points `tm` at another folder; the tests use that with
`scripts/fixtures/tm`.

## Workflow

The usual path is plan > implement > verify > review, but it is optional. Mark the current step
with a label (`plan`, `implement`, `verify`, `review`). The task body keeps the spec, decisions
made while planning, verification notes and a handoff for the next session; the step-by-step
working plan stays in the gitignored `.plans/`.

1. Before starting, `tm show` the task and its epic, then `tm mv` it to `in-progress`.
2. Reference the ID in commits and PRs (`feat(server): ... (PRB.T-004)`).
3. Move to `done` when told the work merged.
4. To find tickets or notes by topic, use the `cocoindex-code` MCP, then `tm show` for the exact
   ticket. Old `PRB-0NN` and `PRB.S-NNN` IDs in history are mapped by each ticket's `was`.

New tickets come from the [epic-creation](../epic-creation/SKILL.md) and
[story-creation](../story-creation/SKILL.md) skills. If other work needs a ticket, say so instead of
creating one. `tm` never commits.
