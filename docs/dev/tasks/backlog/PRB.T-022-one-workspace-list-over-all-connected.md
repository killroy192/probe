---
id: PRB.T-022
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# One workspace list over all connected servers

## Business Goal

**Problem:** The workspace list, the shown workspace and every action behind them use the one server that serves the UI. A person with a second Probe server (a devcontainer, a build machine) cannot see its workspaces beside their own, so there is nothing to build the connect flow, the server picker or the unreachable states on.

**Proposed solution:** The workspace list becomes the union over every server the UI is connected to, each entry labelled with its server, and a connected server's existing workspaces appear with no import step. Opening a workspace serves its tree, "+" modal, terminals, Add project and folder browser from the server it belongs to, and the browser remembers which server's workspace was shown. This story proves it on the second server the harness seeds in PRB.T-021; connecting a server from the UI is PRB.T-023.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 2 One workspace list over all connected servers
- **Delivers:**
  - FR-2 (the list half): a connected server's existing workspaces appear automatically, with no per-workspace step.
  - FR-3: one list, the union over the connected servers, the default server included; every entry shows its server wherever workspaces are listed or opened; the UI keeps no copy.
  - FR-5: the shell tree, the "+" modal, terminals, Add project and the folder browser use only the opened workspace's server. Server-owned Settings pages follow in PRB.T-025.
  - FR-6 (the remembered half): the shown workspace is remembered per browser with its server and returns after a reload. The unreachable half is PRB.T-026.
  - FR-14 (partly): PRB.E-001 S1 to S8 behave on a second-server workspace as locally. The starting-scripts half is settled here as U-7 and checked in PRB.T-028.
  - FR-7 (minimum): a server whose workspace list cannot be read does not hide or change the others; the full unavailable entry is PRB.T-026.
  - NFR-1: plain-shell start-to-banner time (at most 2 s) and one session's bytes on the second server are measured; the list-ready time for 30 workspaces over 3 servers is recorded, not pass or fail (Q-2).
  - NFR-2 (the independence half): one server's list loading or failing never delays or empties the others.
  - NFR-4, NFR-5: headless Chromium; pointer-only; mobile compiles.
- **One deployable outcome:** With the harness's second server connected, a user sees both servers' workspaces in one labelled list, opens one from each, and works in it (tree, "+", terminal, folders), and a reload returns to the same workspace on the same server. This is the base every later story builds on.

## Current Behavior

Verified by reading the code on 2026-11-09 (the code search index was unavailable).

- **One server.** `useWorkspaces` in `apps/web/src/state/workspaces.ts` reads the list of the primary environment only (`usePrimaryEnvironmentId`, one `workspaceEnvironment.list`), and `create`, `open`, `remove`, `addProject`, `startShell` and the rest run against that id.
- **Entries.** `WorkspaceSummary` (`packages/contracts/src/workspace.ts`) is the name only; names are unique per server, not across servers. The list is rendered by `WorkspaceItems` in `WorkspaceSidebar.tsx` as menu items of names.
- **Shown workspace.** The shown workspace carries an environment id (`ShownWorkspace`), and the tabs are keyed by environment id and name. The remembered shown workspace is stored in the browser under `probe:shown-workspace:` plus an environment id, so it is remembered per server, not as one choice across servers.
- **Screens.** `WorkspaceScreen.tsx`, `WorkspaceSidebar.tsx` (the shell tree), `ShellTerminal` and `AddProjectDialog.tsx` (folder browser, `filesystemEnvironment.browse`) receive an environment id from the view state. `AddProjectDialog.tsx` also checks whether the connection target is the primary one, and `serverLocation.ts` guesses "remote" from the OS and page host. Other screens may still reach the primary server (the story-1 audit, PRB.T-021, lists them).
- **Live updates.** A `subscribeWorkspaces` request exists in `packages/contracts/src/rpc.ts`. Unverified: what it pushes (A-8).
- **Starting scripts.** PRB.T-016 (backlog) has not been built; today a start uses the server-wide command. How a start request gets its command on a workspace of another server is open (U-7).
- **Scenarios.** `scripts/scenarios/scenarios/` has PRB.E-001 S1 to S8 and a start-to-banner time printed by S2. PRB.T-021 adds the second server; until then no scenario runs against another server.
- **Mobile.** Has its own server list; contracts may change here, so mobile must still compile.

## Expected Behavior

- The workspace list shows the default server's workspaces and those of every connected server in one list. Each entry names its server; the same workspace name on two servers shows as two entries. There is no import step: connecting a server (here, the harness seam) brings all of its saved workspaces.
- Opening an entry shows that workspace served by its own server: its tree, shells, "+" modal, Add project and the folder browser (the folders are that machine's) and terminals. A workspace belongs to the server it was created on; the UI keeps no copy of it or its shells.
- The browser remembers the last shown workspace together with its server. After a reload it returns to that workspace on that server; if it is gone, the start screen shows.
- The list follows changes on any connected server (a workspace created or removed there appears or leaves) without a reload.
- If one server's list cannot be read, the other servers' workspaces stay listed and unchanged, and the failed server shows a plain error line naming it. The full unavailable entry with reconnect and remove comes in PRB.T-026.
- The author settles U-7 as a written finding: how a start request for a workspace on another server gets its command (carried by the client, which holds the user list on the default server, or resolved on the workspace's server), and how "script removed or disabled meanwhile" is judged there. This is an explicit deliverable and gates PRB.T-024 and PRB.T-028.
- The plain-shell time on the second server, one session's bytes and the 30-workspace list-ready time over 3 harness servers are measured and printed.

### User Flow

1. A user with the default server and a connected second server (here seeded by the harness) opens the workspace menu.
2. They see all workspaces, each labelled with its server, and open one from the second server.
3. They add a project; the folder browser shows the second server's folders.
4. They press "+" and start a shell; its terminal works. They do the same on a default server workspace.
5. They reload the page and the same workspace on the same server is shown with its tabs.
6. A workspace is created on the second server by another client; it appears in the list without a reload.

### Edge Cases

- EC-1: Two servers each hold a workspace with the same name; both are listed, labelled, and opening one never opens the other.
- EC-2: The remembered workspace belongs to a server that no longer has it; the start screen shows with no error.
- EC-3: A server has no workspaces; it contributes nothing, and the list is the others' entries.
- EC-4: 30 workspaces over 3 servers: the list renders and opens without waiting for the slowest server; each server's entries load independently.
- EC-5: The shown workspace's server is removed from the list; the UI does not keep showing its tree (the reverse states are PRB.T-026 and PRB.T-027, here only the seam being turned off is covered).
- EC-6: The folder browser on the second server lists folders that do not exist on the UI machine.

### Error Handling

- ER-1: One server's list read fails; the others stay listed, and a message names the failed server (replaced by the unavailable entry in PRB.T-026).
- ER-2: A workspace request on a server that refuses it (for example open of a workspace removed meanwhile) shows that server's reason and changes nothing for the other servers.

## Out Of Scope

- Connecting a server from the UI, the rename, the pairing refusals and the version check: PRB.T-023.
- Choosing a server when creating a workspace: PRB.T-024.
- Server-owned Settings pages under their server, the client-owned values: PRB.T-025.
- The full unavailable entry, reconnect, disconnect and remove: PRB.T-026 and PRB.T-027.
- The PRB.E-002 second-server checks and the E2-S3 timing: PRB.T-028.
- A client-side cache of workspace or shell names (decided: none).
- A workspace that spans several servers, and moving one between servers.

## Technical Scope

- **Layers:** web client state and sidebar/start screen (`apps/web/src/state/workspaces.ts`, `components/workspaces`), `packages/client-runtime` where shared logic belongs, scenario harness (E-001 replay on the second server). Contracts only if the list needs a server label or change events (unverified, plan decision).
- **Docs impact:** `docs/internals/` gets the rule that a workspace belongs to its server and no screen assumes a shared filesystem or loopback (NFR-7), first written by this story if it lands the behavior, otherwise explicitly by PRB.T-028 (the epic's NFR-7 should list story 5, this one, too); if this story changes an existing internals paragraph, it fixes it in the same PR. `docs/user/` unchanged until PRB.T-023.
- **Mobile impact:** contracts may change, so mobile must still compile (`vp run check:changed`); no mobile UI.

## Non-functional Requirements and Constraints

- Plain-shell start-to-banner time on the second server at most 2 s (PRB.E-001 NFR-1), or a harness-local timing of the same step; one session's bytes on the second server and locally are recorded for comparison, not pass or fail (NFR-1, measured in story 2).
- Having several servers connected costs each server no more than its own session (NFR-1); entries load independently (NFR-2).
- No continuously repainting animation; the list does not repaint on unrelated terminal output (repo rule).
- The UI keeps no copy of any server's workspaces or shells (epic decision).
- No screen may read the UI machine's files or assume loopback (FR-5; repo "Remote ready").
- The 30-over-3 figures are only recorded, not pass or fail, until the author sets the limit (Q-2, after PRB.T-026).
- The user list of starting scripts is on the default server, a workspace's own scripts in its workspace file on its server (settled rule); this story does not build scripts.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given the default server and a harness second server with two seeded workspaces, when the UI opens the workspace menu, then all workspaces of both appear, each labelled with its server, with no import step | auto | FR-2, FR-3 |
| AC-2 | Given a workspace named the same on both servers, when the list shows, then both entries appear and opening each shows the workspace of its own server | auto | FR-3, EC-1 |
| AC-3 | Given a second-server workspace is open, when the user adds a project with the folder browser, then the folders listed are the second server's and one that exists only on the UI's own server is absent | auto | FR-5, EC-6 |
| AC-4 | Given a second-server workspace, when the user presses "+" and starts a shell, then its terminal works and the shell exists in the second server's state, not the default server's | auto | FR-5, FR-14 |
| AC-5 | Given a second-server workspace open with tabs, when the page is reloaded, then the same workspace on the same server is shown with its tabs | auto | FR-6 |
| AC-6 | Given the remembered workspace no longer exists on its server, when the page loads, then the start screen shows with no error | auto | FR-6, EC-2 |
| AC-7 | Given a workspace is created on the second server by another client, when the list is open, then it appears without a reload; when removed, it leaves | auto | FR-3, FR-2 |
| AC-8 | Given the harness stops the second server so its list read fails, when the list shows, then the default server's workspaces stay listed and a message names the failed server | auto | FR-7, NFR-2, ER-1 |
| AC-9 | Given a server with no workspaces, when the list shows, then only the others' entries appear and no empty placeholder claims the server | auto | EC-3 |
| AC-10 | Given the seam is switched off with a second-server workspace shown, when the list updates, then that tree is no longer shown (this AC is rewritten or retired in PRB.T-023, which replaces the seam with the connect flow) | auto | EC-5 |
| AC-11 | Given the harness makes the second server refuse a request (a workspace removed on it meanwhile), when it is shown, then the server's reason is displayed and other servers' entries are unchanged | auto | ER-2 |
| AC-12 | Given PRB.E-001 scenarios S1 to S8, when each runs with a second-server workspace in view instead of a default one, then all eight pass | auto | FR-14, NFR-4, NFR-5 |
| AC-13 | Given the S2 plain-shell step on the second server, when the scenario runs, then the start-to-banner time is printed and is at most 2 s | auto | NFR-1 |
| AC-14 | Given one terminal session on the second server and the same session on the default server, when bytes over the connection are counted, then the bytes of each are printed for comparison (measurement only, no tolerance, matching the epic's NFR-1 "measured in story 2") | auto (print) | NFR-1 |
| AC-15 | Given 30 workspaces over 3 harness servers, when the list loads, then the time until it is ready and the bytes of one session are printed (not pass or fail) | auto (print) / manual (author sets limit after PRB.T-026) | NFR-1, EC-4 |
| AC-16 | Given the finding on U-7, when read, then it states how a remote workspace's start request gets its command and how the removed or disabled check is judged there, in line with the settled rule | manual (author) | FR-14 |
| AC-17 | Given the change, when `vp run check:changed` runs, then it passes, including mobile typecheck | auto | NFR-4 |
| AC-18 | Given the harness delays the second server's list reply, when the list shows, then the default server's entries appear before the delayed reply and the delayed server's entries join when it arrives | auto | NFR-2, EC-4 |

## Dependencies

Depends on: PRB.T-021 (the second server, the seam, the seeded workspaces and the audit's local-assumption list). PRB.E-001 should be closed.

Blocks:

- PRB.T-023: its connect flow must feed a list that already shows a connected server's workspaces.
- PRB.T-024: needs the list and the U-7 finding (the picker's creation on a remote and the start request).
- PRB.T-028: needs U-7 settled here; replays E-002 checks on a second server.
- Indirectly PRB.T-025 to PRB.T-027, via PRB.T-023.
- PRB.T-016 to PRB.T-020 (PRB.E-002): their second-server halves wait on the U-7 finding, but their single-server behavior does not wait for this story.

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-021 | Second server, seam, seeded workspaces, audit | backlog |
| PRB.E-001 | Workspaces, tree, "+" modal, restore exist and the scenarios S1 to S8 are replayed | should be closed first |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | The connection registry can hold the default server and the harness second server at once, and the workspace list can be assembled from both (epic A-1) | assumption | unverified | PRB.T-021 audit | author |
| SA-2 | A server can list all its saved workspaces in one request and push changes (epic A-8) | assumption | unverified | PRB.T-021 reads the contracts; this story proves it | author |
| SA-3 | A workspace's file lives in its server's state folder and survives that server's restart (epic A-5) | assumption | unverified | Restart the second server in a scenario | author |
| SA-4 | Server-side shell and workspace requests never read the UI machine's disk (epic A-4) | assumption | unverified | PRB.T-021 audit; AC-3 and AC-4 | author |
| SU-1 | U-7: how a start request gets its command on a workspace of another server and how the removed or disabled check is judged there | unknown | unverified | Written finding in this story (AC-16) | author |
| SU-2 | How a list entry shows its server without crowding the menu with many servers | unknown | unverified | Plan stage; reviewed in the PR | author |
| SU-3 | Whether the 2 s start-to-banner limit holds on loopback second server with 3 servers connected | unknown | unverified | AC-13 and AC-15 | author |
