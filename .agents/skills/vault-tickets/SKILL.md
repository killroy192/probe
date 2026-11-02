---
name: vault-tickets
description: Read and update Probe tickets in the sibling ../probe-vault with the pv CLI. Use when a task references a PRB.T-NNN task (story or bug) or PRB.E-NNN epic, to list or show tickets, view the board, change a ticket's status or labels, or append a vault session log entry.
---

# Probe vault tickets

Tickets live in `../probe-vault/epics/` and `../probe-vault/tasks/`, one markdown file each. The
status is the folder the file is in (`backlog`, `in-progress`, `done`); there is no status field.
Manage tickets with `pv`, never by moving files or editing frontmatter by hand. `pv` is a
zero-dependency Node script and is not on `PATH`; run it as `../probe-vault/bin/pv` from the repo
root (or set `PV_VAULT=../probe-vault`).

## Commands

```
../probe-vault/bin/pv ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story|bug]
../probe-vault/bin/pv show PRB.T-004
../probe-vault/bin/pv board [--phase N] [--epic PRB.E-002]
../probe-vault/bin/pv mv PRB.T-004 in-progress   # backlog | in-progress | done
../probe-vault/bin/pv label PRB.T-004 +plan      # add or remove a label: +x / -x
../probe-vault/bin/pv log "<one line>"           # appends to memory/log/YYYY-MM-DD.md
```

`mv` and `label` set `updated`. Moving to `done` prints a reminder: list what should be promoted
into `docs/` in this repo, and do that promotion here.

## Workflow

The usual path is plan > implement > verify > review, but it is optional. Mark the current step
with a label (`plan`, `implement`, `verify`, `review`) and keep the spec, plan and verification
notes in the task body in the vault.

1. Before starting, `pv show` the task and its epic, then `pv mv` it to `in-progress`.
2. Reference the ID in commits and PRs (`feat(server): ... (PRB.T-004)`).
3. Move to `done` when told the work merged.
4. To find tickets or notes by topic, use the `probe-vault` MCP (`ccc` search over the vault), then
   `pv show` for the exact ticket. Old `PRB-0NN` and `PRB.S-NNN` IDs in history are mapped by each
   ticket's `was`.

## Not from this repo

`pv new` creates tickets and belongs to a vault session. If new work needs a ticket, say so instead
of creating one. Do not restructure the vault, and do not commit there; `pv` never commits.
