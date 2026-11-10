---
id: PRB.T-028
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Everything built so far works on a remote server

## Business Goal

**Problem:** PRB.E-001 (shells, tree, restore, worktrees) and PRB.E-002 (starting scripts) are verified against a single server. Nothing proves they behave the same when the workspace is on another machine, and the second-server checks written into PRB.E-002's stories do not run until a second server exists.

**Proposed solution:** Once PRB.E-002 has closed on its single-server behaviour, add and run its second-server checks and the two-server steps of its scenarios against the harness second server, replay PRB.E-001 and PRB.E-002 scenarios on a remote workspace, switch the plain-shell guardrail to the E2-S3 click-to-first-prompt time, fix what breaks, and write the docs.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 8 Everything built so far on a remote
- **Delivers:**
  - FR-14: starting scripts, restore, kill, worktree creation and every earlier feature behave on a remote workspace as locally; the start menu of a remote workspace offers the default server's user list plus that workspace's own scripts; the program-not-found check and the typed command run on the workspace's server.
  - NFR-1 (E2-S3 time): plain-shell click-to-first-prompt through the second server stays within 700 ms plus the allowance the author sets (Q-2).
  - NFR-7 (the docs half): user docs and `docs/internals/` complete (PRB.T-023, PRB.T-025 and this story share it).
  - KPI guardrail: PRB.E-001 S1 to S8 and PRB.E-002 E2-S1 to E2-S5 two-server steps, 13 of 13: 8 (E-001 S1 to S8) plus 5 (E2-S1 to E2-S5). PRB.E-002's second-server AC checks (AC-2 to AC-6) are counted on top and must also pass.
- **One deployable outcome:** Everything built before PRB.E-003 is proven to work for a workspace of a remote server, so phase 3 (agent status) can build on remote servers; this closes the epic's guardrail.

## Current Behavior

Mostly unverified: PRB.E-002's stories and the other E-003 stories are in the backlog, so nothing below is code that exists yet.

- **Single-server proof.** PRB.E-001 scenarios S1 to S8 exist in `scripts/scenarios/scenarios/` and run against one server. Verified by PRB.T-016's reading (2026-11-08): S2 prints a start-to-banner time and does not enforce it.
- **Starting scripts.** PRB.T-016 to PRB.T-020 specify the per-start choice, user list on the default server, Settings page, disabling and workspace scripts, and changes after start. PRB.T-016 and PRB.T-017 are done and PRB.T-018 to PRB.T-020 are in the backlog; the checks this story adds are written in them: PRB.T-016 AC-24 and AC-25, PRB.T-017 AC-15 and AC-16, PRB.T-018 AC-26, PRB.T-019 AC-21, PRB.T-020 AC-21 to AC-23. Their exact wording is read from those tickets at the plan stage.
- **Second server.** The harness second server comes from PRB.T-021; whether it is complete enough for these checks is unverified.
- **Remote start.** How a start request for a remote workspace gets its command, and how the removed-or-disabled check is judged, is epic U-7, settled by PRB.T-022. Not yet known.
- **Shells and restore.** The server owns shells and the shell host keeps them over a server restart (`docs/internals/terminal-runtime.md`). Whether restore, kill and worktrees run on the workspace's server without touching the UI's machine is unverified (PRB.T-021's audit).
- **Mobile.** Mobile has its own server list; not touched.

## Expected Behavior

- On a workspace of the harness second server: shells start, restore after a reload and a server restart, kill, and worktree choices run on that server; the folder browser and files are that machine's; starting scripts work as PRB.E-002 specifies.
- The start menu of a remote workspace offers Plain shell, the default server's user starting-scripts list, and the workspace's own scripts (kept in the workspace file on the workspace's server). The program-not-found check and the typed command run on the workspace's server; a script whose program exists only on the default server is a missing program there.
- Changes after start (editing or removing a script, a script disabled by another client) behave as PRB.E-002 specifies with the workspace on the second server.
- PRB.E-002's second-server checks are added to the scenarios and run; the E2-S1 to E2-S5 two-server steps are replayed.
- The guardrail switches from PRB.E-001 S2 (2 s start-to-banner, from PRB.T-022) to E2-S3 (click-to-first-prompt, 700 ms plus the allowance Q-2).
- Defects the replay reveals are fixed in this story; anything larger than a focused fix, or owned by another story, is filed as a new ticket and named.
- Docs are written and checked.

### User Flow

1. The author runs the scenarios with the UI connected to the harness second server.
2. The PRB.E-001 scenarios run with a workspace of the second server shown.
3. The PRB.E-002 scenarios run their two-server steps, and the second-server checks of PRB.T-016 to PRB.T-020 run.
4. The plain-shell time of E2-S3 is printed and read against 700 ms plus the allowance.
5. Failures are fixed or filed, and the docs are reviewed.

### Edge Cases

- EC-1: A script defined on the default server whose program exists only there: refused on the remote with the missing-program message naming the program and the workspace's server.
- EC-2: A workspace of the second server and one of the default server with the same name: each scenario step acts on the one shown.
- EC-3: The second server is restarted during a scenario: restore and the shell host behave as in PRB.E-001; the reconnect is PRB.T-026.
- EC-4: PRB.E-002 is not closed: this story does not start (see Dependencies); it can be planned.
- EC-5: PRB.T-022 left a PRB.E-001 scenario step failing on the second server and filed: it is fixed here or its owner story is named; it never silently skips.

### Error Handling

- ER-1: A second-server check fails: the story reports which AC of which ticket, and the defect is fixed or filed with a ticket ID; no check is removed to pass.
- ER-2: The measured time exceeds 700 ms plus the allowance: the author decides (reset Q-2 or fix); not silently accepted.
- ER-3: A check needs a data shape U-7 left open: stop and ask the author (a process rule, not a testable criterion).

## Out Of Scope

- The single-server behaviour of PRB.E-002: it closes first and does not wait for this story.
- A real devcontainer or second machine: PRB.E-004's verification story (PRB.T-033) and the author's manual check close the epic.
- New starting-script features; new connection kinds; relay and SSH.
- Setting Q-2 limits (the author sets them after PRB.T-026).
- Mobile and desktop UI.

## Technical Scope

- **Layers:** scenario harness (second server added to the E-001 and E-002 scenarios and the second-server checks), any layer a failure points to (web, client-runtime, server), docs.
- **Docs impact:** user docs "Connect to a Probe server" completed; `docs/internals/` (workspace belongs to its server, no shared filesystem, the settings split) checked and completed together with PRB.T-023 and PRB.T-025; PRB.E-002 docs touched only if a second-server fact is missing. Replaces any text that still names "Settings > Environments".
- **Mobile impact:** contracts may change from fixes; mobile must compile.

## Non-functional Requirements and Constraints

- NFR-1: plain-shell time through the second server within the E2-S3 guardrail; terminal output and the tree send no more than the local path (recorded in PRB.T-022).
- NFR-4: headless Chromium against a second Linux or macOS server process; `vp run check:changed` type-checks mobile.
- NFR-5: pointer-only.
- Real agent runs cost money: use the mock agent; a real CLI only if the change depends on it, and the cheapest model.
- Scenarios are run locally by the author, not in CI.
- Never read the UI machine's files from the second server.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given PRB.E-002 closed on its single-server behaviour, when this story's scenarios run, then PRB.E-001 S1 to S8 pass with a workspace of the second server shown | auto | FR-14 |
| AC-2 | Given the second server, when PRB.T-016 AC-24 and AC-25 are added and run, then both pass (as those ACs specify; this story adds no further criterion for them) | auto | FR-14, EC-1 |
| AC-3 | Given the second server, when PRB.T-017 AC-15 and AC-16 are added and run, then both pass | auto | FR-14 |
| AC-4 | Given the second server, when PRB.T-018 AC-26 is added and run, then it passes | auto | FR-14 |
| AC-5 | Given the second server, when PRB.T-019 AC-21 is added and run, then it passes | auto | FR-14 |
| AC-6 | Given the second server, when PRB.T-020 AC-21 to AC-23 are added and run, then they pass | auto | FR-14 |
| AC-7 | Given PRB.E-002 scenarios E2-S1 to E2-S5, when their two-server steps run, then all pass | auto | FR-14 |
| AC-8 | Given a remote workspace with its own scripts, when the start menu is read, then it also lists that workspace's own scripts (kept in the workspace file on its server) | auto | FR-14 |
| AC-9 | Given a script whose program exists only on the default server, when started on the remote workspace, then the start is refused naming the program and the workspace's server and no shell is left | auto | FR-14, EC-1 |
| AC-10 | Given a remote workspace, when a shell is killed, restored and a worktree chosen, then each acts on the second server and nothing reads the UI machine | auto | FR-14 |
| AC-11 | Given E2-S3, when run against a workspace of the second server, then the click-to-first-prompt time is printed | auto | NFR-1 |
| AC-12 | Given the KPI, when the scenario command runs, then 13 of 13 (8 from E-001 S1 to S8 and 5 from E2-S1 to E2-S5 two-server scenarios) pass, and the second-server AC checks of AC-2 to AC-6 pass on top; each failure is fixed or filed with a ticket ID | auto | FR-14, ER-1 |
| AC-13 | Given two workspaces of the same name on two servers, when a scenario step runs, then it acts on the one shown | auto | EC-2 |
| AC-14 | Given the change, when `vp run check:changed` runs, then mobile and dependents type-check | auto | NFR-4 |
| AC-15 | Given the docs diff, when read, then the user docs describe connecting to a Probe server, no "Settings > Environments" remains for web and desktop, and `docs/internals/` states that a workspace belongs to its server and records the settings split | manual (reviewer) | NFR-7 |
| AC-16 | Given the printed time of AC-11, when read once Q-2 sets the allowance (TBD (author, 2026-11-15)), then it is at most 700 ms plus that allowance | manual (author) | NFR-1, ER-2 |
| AC-17 | Given a shell on a remote workspace, when the page is reloaded and then the second server is restarted, then the shell is restored on each and nothing reads the UI machine | auto | FR-14, EC-3 |
| AC-18 | Given the second server is restarted during a scenario, when the scenario continues, then restore and the shell host behave as in PRB.E-001 | auto | EC-3 |
| AC-19 | Given PRB.E-002 is not closed on its single-server behaviour, when this story is checked, then it is not started (planning allowed) | manual (author) | EC-4 |
| AC-20 | Given a PRB.E-001 scenario step PRB.T-022 left failing on the second server, when this story ends, then it passes or its owner ticket is named, and none is skipped | auto | EC-5 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-027 | Epic order: after 7 | backlog |
| PRB.T-024 | Epic order: after 4; workspaces are created on a chosen server, and E3-S1 passes | backlog |
| PRB.T-022 | Settles U-7 (how a remote start gets its command); first replay of E-001 on the second server | backlog |
| PRB.T-021 | The harness second server | backlog |
| PRB.E-002 (PRB.T-016 to PRB.T-020) | Must have closed on its single-server behaviour; this story adds and runs its second-server checks | backlog |
| PRB.T-023 | Connect flow and the user docs this story completes | backlog |
| PRB.T-025, PRB.T-026 | Earlier in the chain; their docs and behaviour must be in place | backlog |

This story cannot close before Q-2 sets the allowance, because AC-16 needs it.

Blocks: closing PRB.E-003 (together with PRB.E-004's PRB.T-033 and the author's manual check); phase 3 (agent status through a remote server). Does not block PRB.E-002, which closes on single-server behaviour. No cycles.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The ticket references PRB.T-016 AC-24/AC-25, PRB.T-017 AC-15/AC-16, PRB.T-018 AC-26, PRB.T-019 AC-21 and PRB.T-020 AC-21 to AC-23 exist in those tickets as the epic cites them (AC-24 and AC-25 of PRB.T-016 verified 2026-11-09) | assumption | unverified for the others | Read the tickets at the plan stage; if a number moved, use the current one | author |
| SA-2 | The harness second server runs the mock agent and a shell like the default server | assumption | unverified | PRB.T-021 | author |
| SA-3 | E-001 and E-002 scenarios can be parameterised to show a workspace of the second server without a copy per scenario | assumption | unverified | Plan stage | author |
| SU-1 | U-7: how a remote start gets its command and how removed-or-disabled is judged | unknown | unverified | Settled by PRB.T-022 before this story is planned | author |
| SU-2 | The allowance added to 700 ms for the harness round trip (epic KPI, Q-2) | unknown | unverified | TBD (author, 2026-11-15) | author |
| SU-3 | Whether PRB.E-002 closes before this story is otherwise ready | unknown | unverified | Check the E-002 status at the plan stage | author |
