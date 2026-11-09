---
id: PRB.T-027
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Disconnect and remove a server

## Business Goal

**Problem:** A user who connected a remote server has no way to step away from it: to stop seeing its workspaces without losing the pairing, or to forget it altogether and clear its credential. Whether a workspace of a remote can be removed from the UI is unverified (PRB.T-022), and a one-way door (connect only) is a bug.

**Proposed solution:** In Settings > Probe servers a remote can be disconnected (its workspaces leave the list, the pairing is kept, nothing is deleted on the server) and connected again without pairing, or removed (credential and routes forgotten, a confirmation names what stays on the server). A workspace of a remote can be removed while the server is up, as locally, and is refused with a reason while it is down.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 7 Disconnect and remove a server
- **Delivers:**
  - FR-10: disconnect ends the session, keeps the saved server and credential, removes its workspaces from the list, deletes nothing on the server; connect again needs no re-pairing and the workspaces return.
  - FR-11: remove forgets credential and saved routes, removes entry and workspaces from the list, changes nothing on the server; a confirmation names what stays on the server.
  - FR-17: removing a workspace on a remote kills that server's shells for it and deletes that server's file; refused with a reason while the server is unreachable.
  - FR-18 (actions): the Probe servers section offers disconnect, reconnect and remove for remotes, and by default none for the default server (Q-3).
  - FR-16 (disconnected state): the state is shown per server.
  - NFR-3 (credential half): the credential is forgotten on remove and never logged.
- **One deployable outcome:** A user can step away from a remote and come back without pairing again, or forget it entirely, knowing what stays on the server; this is scenario E3-S4 and the reverse of PRB.T-023.

## Current Behavior

Partly verified by reading code on 2026-11-09 (the code search index was unavailable).

- **Registry.** `packages/client-runtime/src/connection/registry.ts` has `remove` (removes an environment) and `removeRoute` (removing the last route removes the environment); `removeLocked` forgets the routing trust and deletes the persisted registration, and credentials are removed through the credential store (`credentialStore.ts`). Whether `remove` also deletes the stored credential in every path is unverified (a test is AC-6).
- **Disconnect.** Verified by reading: the registry's per-environment enable toggle (`registry.ts`, near the `lease.supervisor.disconnect` call) stores the entry with `enabled` off and ends the RPC session through the supervisor; for an SSH environment it also tears down the managed tunnel. The entry is kept and that path does not delete the credential, but the web UI that drives it, and that connecting again restores the session without pairing, are unverified (SA-1).
- **Settings.** `apps/web/src/components/settings/ConnectionsSettings.tsx` lists connections under the label "Environments"; which actions it offers today, and whether a confirmation names what stays on the server, is unverified.
- **Workspace removal.** The sidebar's "Remove workspace" menu (`apps/web/src/components/workspaces/WorkspaceSidebar.tsx`) removes a local workspace with no confirmation today (verified by reading); only removing a project and killing a shell ask first. `SavedWorkspaces.remove` (`apps/server/src/savedWorkspaces/SavedWorkspaces.ts`) deletes the workspace file and kills the shells of its projects (`removeFile`, `killShellsIn`). Verified by reading. How the UI reaches it for a workspace of a remote server is unverified (PRB.T-022).
- **Default server.** Whether the UI marks the default server as non-removable is unverified (Q-3).
- **Mobile.** Mobile keeps its own server list and is not touched.

## Expected Behavior

- **Disconnect:** the user disconnects a remote in Settings > Probe servers. Its workspaces leave the list; it remains as one entry, shown as disconnected, with a "Connect" action and a remove action (no workspace names). Nothing runs on the user's side for it; nothing is deleted on the server (its shells keep running there). "Connect" restores the session without pairing and the workspaces return.
- **Remove:** a confirmation names what stays on the server (its workspaces, worktrees and shells are not deleted) and that connecting again needs a new pairing. After accepting, the credential and saved routes are forgotten, the entry and its workspaces leave the list, and nothing is deleted or changed on the server.
- **Remove a workspace on a remote:** while the server is up, the workspace's shells are killed and its file is deleted on that server, as locally, with whatever confirmation the local removal has (none today, SU-3). The result is shown in the list.
- **Default server:** listed with its state but without disconnect and remove (Q-3 default).
- **Unavailable server:** its entry offers remove (and reconnect from PRB.T-026); a workspace removal on it is refused.
- Every action works with the pointer alone, and errors name the server.

### User Flow

1. The user opens Settings > Probe servers and clicks Disconnect on remote R. Its workspaces leave the list; R remains as a disconnected entry.
2. The user clicks Connect on R. The workspaces return, without a new pairing.
3. The user clicks Remove on R. A confirmation names what stays on R. The user accepts.
4. R's entry and workspaces leave the list; R's data is untouched.
5. To use R again the user connects it by address and a new pairing token (PRB.T-023).
6. For a workspace of a connected remote, the user removes the workspace from the list; its shells are killed and its file deleted on R.

### Edge Cases

- EC-1: Disconnect while a workspace of R is open: the screen returns to the start screen (other workspaces offered), and the remembered workspace is not reopened until R is connected.
- EC-2: Disconnect on an already unavailable server: it stays listed as one entry; Connect retries.
- EC-3: Remove while R is unreachable: allowed, with the same confirmation; the server is not contacted.
- EC-4: Remove a workspace whose shells are running: the shells are killed on R, with the same confirmation behaviour as locally (SU-3).
- EC-5: Disconnecting or removing R does not change client settings or the other servers' workspaces.
- EC-6: Two entries with workspaces of the same name on different servers: removing one touches only its server.
- EC-7: The default server: no disconnect or remove (Q-3); if the author vetoes the default, TBD (author, 2026-11-15).

### Error Handling

- ER-1: Removing a workspace on R fails because R is unreachable: refused with a reason naming R; the workspace is untouched (it is also not listed while R is down, so this arises when R drops after the action begins).
- ER-2: Connect after disconnect fails (R is down or the credential was revoked): the state says which (PRB.T-026 states); nothing is deleted.
- ER-3: Forgetting the credential fails (storage error): the remove is reported as failed, the entry stays and nothing is silently kept hidden.
- ER-4: The server refuses the workspace removal: the error names the server and the reason.

## Out Of Scope

- Connecting a server, pairing and the version check: PRB.T-023.
- Creating a workspace on a server: PRB.T-024.
- The unreachable displays and automatic reconnect: PRB.T-026 (this story reuses them).
- Deleting a server's data from the UI on remove: never done (nothing is changed on the server).
- Moving a default server off the UI: Q-3.
- Roles and permissions; mobile UI; desktop checks.

## Technical Scope

- **Layers:** web (Probe servers section actions, confirmations, workspace removal in the list), client-runtime (disconnect kept apart from remove; credential forgetting; workspace removal routed to the workspace's server), server (nothing new if `workspace.remove` is reachable; the guarded method scope is the server's own), scenario harness, docs.
- **Docs impact:** user section "Connect to a Probe server" (disconnecting, removing, what stays on the server); `docs/user/remote-access.md` reads "Probe servers" wherever it names the section (shared with PRB.T-023).
- **Mobile impact:** contracts may change; mobile must compile; no mobile UI.

## Non-functional Requirements and Constraints

- NFR-3: the credential is removed from the browser profile's storage on remove, never logged, and logs carry the server label and route kind only.
- NFR-5: pointer-only; errors name the server and the next step.
- NFR-4: mobile compiles.
- Nothing is deleted or changed on a server by disconnect or remove of the server.
- Follow the repo's client mutation convention and the server's own guards; no new roles.
- The UI keeps no copy of the server's workspaces.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a connected remote with workspaces, when the user disconnects it, then its workspaces leave the list, it remains as one disconnected entry with no workspace names | auto | FR-10, FR-16 |
| AC-2 | Given AC-1, when the server's state folder is read, then its workspace files and shells are unchanged | auto | FR-10 |
| AC-3 | Given AC-1, when the user connects again, then no pairing is asked and its workspaces return | auto | FR-10 |
| AC-4 | Given a connected remote, when the user opens Remove, then the confirmation names what stays on the server and that a new pairing is needed | auto | FR-11, NFR-5 |
| AC-5 | Given the confirmation, when accepted, then the entry and workspaces leave the list and the server's files and shells are unchanged | auto | FR-11 |
| AC-6 | Given a removed server, when the credential storage is read, then its credential and routes are gone, and connecting needs a new pairing | auto | FR-11, NFR-3 |
| AC-7 | Given the log, when disconnect and remove run, then no line holds the credential or pairing URL | auto | NFR-3 |
| AC-8 | Given a remote workspace while its server is up, when the user removes it, then its shells are killed and its file is deleted on that server, and the workspace leaves the list | auto | FR-17, EC-4 |
| AC-9 | Given the user has accepted a workspace removal and the server stops before the request completes, when it fails, then it is refused with a reason naming the server and the workspace is untouched | auto | FR-17, ER-1 |
| AC-10 | Given the default server, when the section is read, then it has no disconnect or remove (Q-3 default) | auto | FR-18, EC-7 |
| AC-11 | Given a workspace of R is open, when R is disconnected, then the start screen offers the others and does not reopen R's workspace | auto | EC-1 |
| AC-12 | Given R is unreachable, when the user removes R, then it is allowed with the confirmation and the server is not contacted | auto | EC-3 |
| AC-13 | Given a disconnected R, when connect fails, then the state says which failure and nothing is deleted | auto | ER-2 |
| AC-14 | Given a storage error when forgetting a credential, when remove runs, then the failure is reported, the entry stays and nothing is hidden | manual (reviewer) | ER-3 |
| AC-15 | Given the server refuses a workspace removal, when it happens, then the error names the server and reason | auto | ER-4 |
| AC-16 | Given two servers with a workspace of the same name, when one is removed, then the other is unchanged | auto | EC-6 |
| AC-17 | Given disconnect or remove, when client settings and the other servers' workspaces are read, then they are unchanged | auto | EC-5 |
| AC-18 | Given the Settings, when searched and read, then the section is named "Probe servers" and the actions work with the pointer alone | auto | FR-18, NFR-5 |
| AC-19 | Given the change, when `vp run check:changed` runs, then mobile and dependents type-check | auto | NFR-4 |
| AC-20 | Given the docs diff, when read, then the user docs describe disconnecting, removing and what stays on the server | manual (reviewer) | NFR-7 |
| AC-21 | Given a remote that is already unavailable, when the user disconnects it, then it stays listed as one entry, and Connect retries the connection | auto | EC-2 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-026 | Needs the unavailable entry and unreachable state; FR-17 is refused while down (epic order: after 6) | backlog |
| PRB.T-023 | The Probe servers section, saved servers and pairing | backlog |
| PRB.T-022 | The list and the workspace's server, for removing a workspace on a remote | backlog |
| PRB.E-001 (`workspace.remove`, PRB.T-003) | The server method that kills a workspace's shells and deletes its file, reused on a remote | in progress |

Blocks: PRB.T-028 (epic order: after 7), scenario E3-S4, and PRB.E-003 closing. Not blocked by PRB.T-024 or PRB.T-025 directly, though they are earlier in the chain. No cycles.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | A saved server can be disconnected and connected again without pairing, with the credential kept | assumption | unverified | Plan stage; AC-3 | author |
| SA-2 | The existing remove forgets the credential in every path (`registry.ts`, `credentialStore.ts`) | assumption | unverified | AC-6 | author |
| SA-3 | `workspace.remove` is reachable on a remote workspace through its server (epic FR-17) | assumption | unverified | AC-8 | author |
| SU-1 | Whether the default server can be disconnected or removed (epic Q-3, default no) | unknown | unverified | TBD (author, 2026-11-15), before PRB.T-023 | author |
| SU-2 | The exact wording and content of the remove confirmation | unknown | unverified | TBD (author, 2026-11-15), at the plan stage | author |
| SU-3 | Whether removing a workspace should ask for a confirmation: the local menu has none today, so the remote one matches it unless the author decides otherwise | unknown | unverified | TBD (author, 2026-11-15), at the plan stage | author |
