# Planning

Work that is planned or in flight: tickets and notes. The rest of `docs/` describes what exists;
when a ticket merges, move what still matters into those docs.

| Folder | Purpose |
| --- | --- |
| `epics/`, `tasks/` | One file per ticket, in a `backlog/`, `in-progress/` or `done/` folder |
| `memory/roadmap.md` | Scope decisions and phase order |
| `memory/questions.md` | Open questions and unverified assumptions |
| `memory/design/` | Design drafts for features not built yet |
| `memory/research/` | Studies of other products |
| `memory/log/` | Short dated session notes |

## Tickets

The folder a ticket sits in is its status (`backlog` > `in-progress` > `done`); the file has no
status field. Epics are `PRB.E-NNN`, tasks are `PRB.T-NNN`, with separate counters in `ids.json`.
A task is `type: story` or `type: bug`; a story names its epic in `parent`, a bug may omit it.
Refer to tickets by ID, not file name.

```yaml
---
id: PRB.T-003
type: epic | story | bug
parent: PRB.E-002        # tasks only; required for stories
phase: 1
labels: [plan, mobile-impact]
was: [PRB-012, PRB-014]  # optional: old IDs this ticket replaced
created: 2026-11-01
updated: 2026-11-01
---
```

The usual path is plan > implement > verify > review, marked with a label of that name. The spec,
plan and verification notes go in the task body.

## tm

`tm` (`scripts/ticket-manager-lib`) is the only way to create, move or relabel tickets. It issues
IDs from `ids.json` under a lock, so IDs only go up and are never reused. Never edit `ids.json` or
create ticket files by hand.

```
vp run tm new epic "<title>" [--phase N] [--labels a,b]
vp run tm new story|bug "<title>" [--parent EPIC_ID] [--phase N] [--labels a,b]
vp run tm ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story|bug]
vp run tm show <ID>
vp run tm mv <ID> <backlog|in-progress|done>
vp run tm label <ID> +plan -spec
vp run tm rm <ID>          # an epic must have no tasks; the ID stays reserved
vp run tm board [--phase N] [--epic ID]
vp run tm check            # IDs unique, ids.json ahead of every ticket, parents exist
vp run tm log "<text>"     # appends to memory/log/YYYY-MM-DD.md
```

`TM_ROOT` points it at another folder; the tests use that with `scripts/fixtures/tm`.
