---
name: vault-tickets
description: Read and update Probe tickets in the sibling ../probe-vault with the pv CLI. Use when a task references a PRB-NNN ticket, to list or show tickets, view the board, move a ticket's status, or append a vault session log entry.
---

# Probe vault tickets

Tickets live in `../probe-vault/tickets/PRB-NNN.md`. Manage them with `pv`, never by editing
frontmatter by hand. `pv` is a zero-dependency Node script and is not on `PATH`; run it as
`../probe-vault/bin/pv` from the repo root (or set `PV_VAULT=../probe-vault` and call it elsewhere).

## Commands allowed from this repo

```
../probe-vault/bin/pv ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story]
../probe-vault/bin/pv show PRB-012      # full ticket; an epic also lists its stories
../probe-vault/bin/pv board [--phase N]
../probe-vault/bin/pv mv PRB-012 doing  # backlog | ready | doing | review | done
../probe-vault/bin/pv log "<one line>"  # appends to memory/log/YYYY-MM-DD.md
```

`mv` sets `updated` for you. Moving to `done` prints a reminder: list what should be promoted
into `docs/` in this repo, and do that promotion here.

## Not from this repo

`pv new` creates tickets and belongs to a vault session. If new work needs a ticket, say so
instead of creating one. Do not restructure the vault, and do not commit there; `pv` never commits.

## Workflow

1. Before starting, `pv show` the ticket and its parent epic. Move it to `doing`.
2. Reference the ID in commits and PRs (`feat(server): ... (PRB-012)`).
3. Move to `review` when the PR opens and `done` when told it merged.
4. To find tickets or notes by topic, use the `probe-vault` MCP (`ccc` search over the vault), then
   `pv show` for the exact ticket.
