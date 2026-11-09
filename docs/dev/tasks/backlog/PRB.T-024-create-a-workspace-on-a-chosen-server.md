---
id: PRB.T-024
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Create a workspace on a chosen server

## Business Goal

**Problem:** "Create workspace" asks only for a name and creates the workspace on the one server that serves the UI. A user with a devcontainer or a build machine connected cannot say where a new workspace should live, and the machine they want may not be connected yet.

**Proposed solution:** "Create workspace" lists the default server and every connected remote and creates the workspace on the one the user picks. If the wanted server is not connected yet, the flow offers to connect it and creates the workspace there only once the connection works. The new workspace shows which server it belongs to, and the user can add a project, start a shell and use the terminal there.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 4 Create a workspace on a chosen server
- **Delivers:**
  - FR-1: "Create workspace" asks which connected server the workspace is created on and lists the default server and every connected remote; there is no Local or Remote mode. If the wanted server is not connected, the flow offers to connect it (the place is Q-1) and creates the workspace only after the connection works.
  - FR-2 (the creating half): creating a workspace on a remote brings that server's other workspaces into the list too, if they are not in it yet.
  - FR-3 (the created half): the new workspace is stored by the server it was created on and its entry shows that server.
  - FR-5 (the created half): the created workspace's folder browser, tree, "+" modal and terminals use only its server.
  - FR-14 (partly): the start request on the new workspace follows the U-7 finding of PRB.T-022.
  - FR-16 (the picker half): the choice only reads each server's connection state from PRB.T-023 and marks a server that is not usable; it keeps no state of its own.
  - NFR-5: choosing a server and connecting one work with the pointer alone; every error names the server and what to do next.
  - NFR-4: headless Chromium; mobile compiles.
- **One deployable outcome:** A user creates a workspace on the server they choose, connecting it first from the same flow if needed, then adds a project, starts a shell and works there, and sees the new workspace in the one list labelled with its server. This delivers scenario E3-S1.

## Current Behavior

Verified by reading the code on 2026-11-09 (the code search index was unavailable).

- **Dialog.** `apps/web/src/components/workspaces/CreateWorkspaceDialog.tsx` has one field, the name (validated by `workspaceNameProblem`), and calls `onCreate(name)`. It has no server choice and no "Local or Remote" mode. It shows the server's refusal (taken name, storage failure) under the field.
- **Creation.** `create` in `useWorkspaces` (`apps/web/src/state/workspaces.ts`) runs against the primary environment only.
- **Entry points.** The create dialog is opened from the "Workspaces" menu in `WorkspaceSidebar.tsx`. Unverified: whether the start screen offers it elsewhere (SA-4).
- **Connecting.** No connect action is offered from the create flow.
- **Permissions.** `workspaceEnvironment.create.permissionAtom(environmentId)` gates creation for a given environment (`useWorkspaces`); it is evaluated per environment id, not per chosen server.
- **Mobile.** Has its own server list; unaffected except by contract changes.

## Expected Behavior

- "Create workspace" shows a server choice listing the default server and each connected remote, with a state for a server that is not usable. With only the default server, the choice is the default and nothing extra is asked (no Local or Remote mode).
- The user enters a name and creates; the workspace is created on the chosen server, shown in the one list labelled with that server, and opened.
- If the wanted server is not connected, the flow offers "connect a server" (the same add flow as PRB.T-023, subject to Q-1). The workspace is created only after the connection works; if the connection fails or the user cancels, nothing is created and nothing is saved.
- A name taken on the chosen server is refused with that server's reason; the same name on another server is allowed.
- On creation on a remote, the server's other existing workspaces appear in the list (connecting brings them, FR-2).
- The new remote workspace works end to end: add a project (the folder browser shows that machine's folders), press "+", start a shell, the terminal works. A start on it follows the U-7 finding of PRB.T-022.
- A server that is unreachable or disconnected is shown in the choice as unavailable and cannot be picked (the full states are PRB.T-026).

### User Flow

1. The user chooses "Create workspace" from the Workspaces menu.
2. They pick a server: the default one, a connected remote, or "connect a server".
3. If connecting, they enter the address and pairing token as in PRB.T-023; on success the flow returns to step 2 with the server picked.
4. They type a name and create.
5. The workspace opens, labelled with its server. They add a project (that machine's folders), press "+", start a shell, and the terminal works.
6. They create a second workspace on the default server and both appear in the same list.

### Edge Cases

- EC-1: Only the default server exists: the choice is preselected and creation behaves as today.
- EC-2: The same name already exists on another server: creation succeeds; both entries are listed, labelled.
- EC-3: The server chosen goes away between picking and creating: creation is refused with a reason naming it; nothing is created.
- EC-4: The user connects a server from this flow and the connect is cancelled midway: nothing is saved and the dialog stays on the choice.
- EC-5: Many servers are connected: the choice stays readable and the default server stays first.
- EC-6: The user picks a server and then changes the pick before creating: the name stays, the last pick wins.

### Error Handling

- ER-1: A name taken or invalid on the chosen server is refused with the server's reason and no workspace is created.
- ER-2: The connect fails inside this flow (wrong or expired token, version mismatch, unreachable, public http): the same messages as PRB.T-023 show here; the workspace is not created and nothing is saved.
- ER-3: A chosen server that refuses creation (storage failure) shows its reason, names the server and creates nothing.
- ER-4: A server that is unavailable is not pickable and says why.

## Out Of Scope

- The connect flow, its refusals and the Settings section: PRB.T-023 (reused, not rebuilt).
- Server-owned Settings pages and client-owned values: PRB.T-025.
- The unreachable displays, reconnect, disconnect, remove: PRB.T-026 and PRB.T-027.
- Moving or copying a workspace between servers (a workspace belongs to one server).
- Starting containers (the user starts the remote themselves).
- Roles or permission changes.
- The starting-scripts remote halves: checked in PRB.T-028.

## Technical Scope

- **Layers:** web create dialog and workspace state (`CreateWorkspaceDialog.tsx`, `state/workspaces.ts`, the sidebar menu), reuse of the connect flow, scenario harness (E3-S1). No server change expected; contracts only if a label is needed (plan decision).
- **Docs impact:** `docs/user/remote-access.md` or the "Connect to a Probe server" section of PRB.T-023 gains choosing a server for a new workspace (NFR-7). No `docs/internals` change unless a rule changes.
- **Mobile impact:** none to the UI; shared client logic changes must still compile on mobile (`vp run check:changed`).

## Non-functional Requirements and Constraints

- Every action (choose a server, connect, create) works with the mouse or touchpad alone; Enter is a shortcut (scope decision 8).
- Every error names the server and what to do next (NFR-5).
- Create is checked against the destination server's permission, which remains authoritative; no new roles.
- No screen may assume a shared filesystem or loopback (FR-5).
- The UI keeps no copy of the created workspace.
- Where "connect a server" is offered follows Q-1; the author's veto before PRB.T-023 stands.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given the default server and a connected remote, when the user opens "Create workspace", then the choice lists both and there is no Local or Remote mode | auto | FR-1 |
| AC-2 | Given a name and the remote chosen, when the user creates, then the workspace file is in the remote's state folder and not the default server's, and the workspace opens labelled with the remote | auto | FR-1, FR-3 |
| AC-3 | Given the default server chosen, when the user creates, then the workspace appears in the same list as the remote's, labelled with the default server | auto | FR-3 |
| AC-4 | Given the wanted server is not connected, when the user picks "connect a server", enters a good address and token, then the server connects and the workspace is created there only after the connection works | auto | FR-1, FR-2 |
| AC-5 | Given the connect inside the flow fails with a bad token, an expired token, a version mismatch or an unreachable address, when it fails, then the message names the server, no workspace is created and nothing is saved | auto | FR-1, ER-2 |
| AC-6 | Given the user cancels the connect, when back at the choice, then nothing is saved and the dialog is intact | auto | EC-4 |
| AC-7 | Given a remote with other existing workspaces, when a workspace is created on it, then those appear in the list too, with no import step | auto | FR-2 |
| AC-8 | Given the new remote workspace, when the user adds a project, presses "+" and starts a shell, then the folder browser lists the remote's folders, the shell exists on the remote and its terminal works | auto | FR-5, FR-14 |
| AC-9 | Given a workspace named the same exists on another server, when the user creates it on the chosen one, then it is created and both entries are listed | auto | EC-2 |
| AC-10 | Given a name taken on the chosen server, when the user creates, then the server's reason shows and nothing is created | auto | ER-1 |
| AC-11 | Given the chosen server stops before creating, when the user creates, then the message names the server and nothing is created | auto | EC-3, ER-3 |
| AC-12 | Given only the default server, when the user opens the dialog, then it is preselected and creation works as before | auto | EC-1 |
| AC-13 | Given the harness stops a connected server, when the choice is shown, then it is marked unavailable with a reason and cannot be picked | auto | FR-16, ER-4 |
| AC-14 | Given a pick that is changed before creating, when the user creates, then the last pick is used | auto | EC-6 |
| AC-15 | Given every control in the flow, when driven by pointer only, then each step completes | auto | NFR-5 |
| AC-16 | Given the choice with several servers, when the author reads it, then the default server is first and the list is readable | manual (author) | EC-5 |
| AC-17 | Given the change, when `vp run check:changed` runs, then it passes, including mobile typecheck | auto | NFR-4 |

## Dependencies

Depends on:

- PRB.T-023: Settings > Probe servers adds a server (the connect flow the picker reuses), saved servers to pick, and the per-server connection state (FR-16) the picker reads. Until it ships, no connect action exists in the create flow.
- PRB.T-022: the list becomes the union over servers and carries the U-7 finding; a start on the created workspace uses it. Until it ships, `create` runs against the primary environment only. Transitively PRB.T-021.
- Q-1 (author): where connect is offered (proposed default: also here); the default is confirmed before PRB.T-023 and assumed here.

Blocks:

- PRB.T-028: the epic says story 8 follows story 4 (the picker is part of what is replayed on a remote).
- Scenario E3-S1 passing end to end (and with it the epic's primary KPI).

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-023 | Connect flow and saved servers to pick | backlog |
| PRB.T-022 | One list and the U-7 finding | backlog |
| Q-1 (epic) | Whether the create flow offers connecting | proposed default, author to confirm |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | `workspace.create` already works against any connected server given its environment id; only the UI picks the server | assumption | unverified | Plan stage reads the create path; AC-2 | author |
| SA-2 | The connect flow of PRB.T-023 can be reused inside a dialog without changing its refusals | assumption | unverified | Plan stage | author |
| SA-3 | The create permission for the chosen server can be checked before enabling Create (the permission atom takes an environment id) | assumption | unverified | Plan stage reads `workspaceEnvironment.create.permissionAtom` use | author |
| SA-4 | The create dialog is opened only from the Workspaces menu; no other entry point (start screen, tab strip, `probe` command) creates a workspace | assumption | unverified | Plan stage reads every entry point and lists them | author |
| SA-5 | Creation today runs against the primary environment only, so choosing a server needs a change in `useWorkspaces`, not only in the dialog | assumption | unverified | Plan stage reads `create` in `state/workspaces.ts` | author |
| SU-1 | Q-1: whether the create flow offers connecting a server (proposed yes) | unknown | unverified | TBD (author, 2026-11-15), before PRB.T-023 | author |
| SU-2 | The U-7 outcome for a start request on a remote workspace | unknown | unverified | PRB.T-022 finding | author |
