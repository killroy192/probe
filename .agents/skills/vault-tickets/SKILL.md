---
name: vault-tickets
description: Read and update Probe tickets in the sibling ../probe-vault with the pv CLI. Use when a task references a PRB.S-NNN story or PRB.E-NNN epic, to list or show tickets, view the board, move a story through its stages, or append a vault session log entry.
---

# Probe vault tickets

Tickets live in `../probe-vault/tickets/`: one folder per epic (`PRB.E-NNN-slug/`), one folder per
story inside it. A story folder holds `PRB.S-NNN.md` plus `.spec.md`, `.plan.md` and
`.verification.md` as it moves through those stages. Manage them with `pv`, never by editing
frontmatter by hand. `pv` is a zero-dependency Node script and is not on `PATH`; run it as
`../probe-vault/bin/pv` from the repo root (or set `PV_VAULT=../probe-vault`).

## Commands

```
../probe-vault/bin/pv ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story]
../probe-vault/bin/pv show PRB.S-004      # ticket plus spec, plan, verification
../probe-vault/bin/pv board [--phase N] [--epic PRB.E-002]
../probe-vault/bin/pv mv PRB.S-004 spec   # backlog > ready > spec > plan > build > verify > review > done
../probe-vault/bin/pv log "<one line>"    # appends to memory/log/YYYY-MM-DD.md
```

`mv` sets `updated` and creates the stage file when you enter `spec`, `plan` or `verify`. Epics use
`backlog | doing | done`. Moving to `done` prints a reminder: list what should be promoted into
`docs/` in this repo, and do that promotion here.

## Not from this repo

`pv new` creates tickets and belongs to a vault session. If new work needs a ticket, say so instead
of creating one. Do not restructure the vault, and do not commit there; `pv` never commits.

## Workflow

1. Before starting, `pv show` the story and its epic.
2. Work the stages in order and write each stage's file in the vault: spec, then plan, then build
   in this repo, then verification (scenario tests plus any manual checks).
3. Reference the ID in commits and PRs (`feat(server): ... (PRB.S-004)`).
4. `review` when the PR opens, `done` when told it merged.
5. To find tickets or notes by topic, use the `probe-vault` MCP (`ccc` search over the vault), then
   `pv show` for the exact ticket. Old `PRB-0NN` IDs in history are mapped by each ticket's `was`.
