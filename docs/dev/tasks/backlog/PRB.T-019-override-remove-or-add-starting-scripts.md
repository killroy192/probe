---
id: PRB.T-019
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-08
---

# Disable user starting scripts or add workspace ones per workspace

## Business Goal

**Problem:** A user's starting scripts are the same in every workspace. One workspace has no use for a script that clutters its modal, or needs a script that makes sense only there (for example a test runner). Today the only way is to change the user list for everyone, or to type the command by hand in each shell.

**Proposed solution:** From the "Workspaces" menu, the user opens a workspace's starting scripts dialog. It shows the user scripts as inherited, which the user can disable in this workspace and enable again (they cannot be edited or renamed there), and it lets the user add, edit and remove scripts that exist only in this workspace. The modal in that workspace offers the resulting merged list; every other workspace, and Settings, are unchanged.

## Epic and Requirements

- **Epic:** PRB.E-002 Starting scripts: choose what a new shell runs
- **Candidate story:** #4 Workspace scripts
- **Delivers:**
  - FR-4: the workspace dialog (inherited user scripts with disable and enable, no edit or rename of a user script, add, edit and remove workspace scripts, disabling kept across renames of the user script, saved with the workspace only, workspace scripts never in the user list or Settings).
  - FR-5: the merged list for a workspace (Plain shell, user scripts not disabled in user-list order, then the workspace's scripts in the order added; entries told apart by identity, names and commands may repeat, also within one workspace's scripts).
  - FR-2 (reused): the name and command rules, including a name defaulting to the command's program and names not needing to be unique, applied to workspace scripts. The rules themselves belong to PRB.T-018.
  - FR-11 (part, as amended 2026-11-08): two clients changing different workspace scripts both survive; on the same script the last save wins. Live refresh of other clients is PRB.T-020.
  - NFR-2 (part): a damaged workspace file never stops Probe from starting, and for a workspace that fails to open the problem appears in the message that says why.
  - NFR-3 (part): logs never carry the command line; every user has the same permissions (settled 2026-11-08), so there is no permission check on edits.
  - NFR-5 and NFR-7 (part): pointer-only actions; user docs for workspace scripts.
  - Scenario E2-S2.
- **One deployable outcome:** A user can hide a user script in one workspace, add a script only there, undo each, and see the modal in that workspace offer exactly that merged list, while other workspaces and Settings keep the user list. It contributes to the epic goal of managing scripts "for themselves and per workspace from the UI".

## Current Behavior

Read from code by the earlier draft on 2026-11-08 (the code search index was unavailable); not re-read in the 2026-11-08 reworks, which changed the design only.

- **Workspaces menu:** the header "Workspaces" icon button (`aria-label="Workspaces"`) opens a menu with "Create workspace", "Open workspace" and "Remove workspace" (the first and last only when the UI allows changing workspaces). There is no starting scripts entry. File: `apps/web/src/components/workspaces/WorkspaceSidebar.tsx`.
- **Modal:** the Starting script dropdown is a disabled select whose only item is the constant "mock agent". File: `apps/web/src/components/workspaces/StartShellDialog.tsx`.
- **Workspace file:** each workspace is one JSON file named after it, read and written by `apps/server/src/savedWorkspaces/SavedWorkspaces.ts`. It holds projects, the last start and the tabs; older files are migrated on read. It has no field for scripts. Writes are atomic. A file that cannot be read or decoded fails to open with an invalid-workspace error but stays listed; `docs/user/workspaces.md` says opening it "shows why".
- **Contracts:** the workspace detail and last start are in `packages/contracts/src/workspace.ts` (`WorkspaceDetail`, `WorkspaceLastStart`). Neither carries scripts.
- **Permissions:** existing methods carry permission scopes (`packages/contracts/src/clientRpcPermissions.ts`). No method exists for starting scripts. By the 2026-11-08 decision, every user has the same permissions and this story adds no role or permission rule of its own.
- **Server command:** one server-wide command (`PROBE_AGENT_COMMAND`, `apps/server/src/cli/config.ts`, used in `apps/server/src/terminal/Shells.ts`) is typed into every shell. There is no user list, no per-start choice and no merge. (These arrive with PRB.T-016 and PRB.T-018.)
- **Mobile:** `apps/mobile` consumes shared contracts; it has no workspace or starting script UI. Unverified whether it imports the workspace contracts this story changes (SA-4).

## Expected Behavior

In a workspace, the user opens "Starting scripts" from the "Workspaces" menu and sees a dialog listing Plain shell (fixed), then each user script marked inherited, then the workspace's own scripts. An inherited script can be disabled in this workspace and enabled again; its name and command are shown but cannot be edited or renamed there. A disabled script stays visible in the dialog, marked disabled, and is not offered in the modal. "Add script" creates a workspace script from a command and an optional name (the name defaults to the command's program: the first word after any leading env assignments, whitespace trimmed; the user can type another name). A workspace script can be edited (name and command) and removed. Changes are saved with the workspace and apply to that workspace only; workspace scripts never appear in the user list or in Settings.

The modal offers the merged list: Plain shell, then the user scripts not disabled (user-list order), then the workspace's scripts (order added). Names and commands may repeat between the user list and a workspace and between workspaces; entries are told apart by identity, not by name, so there is no collision rule.

Disabling belongs to the user script, not to its name: renaming the user script in Settings keeps it disabled. If the user script is deleted, the disabled mark goes away with it.

Names need not be unique, even among one workspace's own scripts (settled 2026-11-08).

Concurrent edits merge per script: each change is applied to the workspace's scripts as saved at that moment, not to the copy a client holds. If two clients change different scripts, both changes remain; if they change the same script, the last save wins.

### User Flow

1. In workspace "sparta", the user opens the "Workspaces" menu and chooses the starting scripts entry. The dialog lists Plain shell, then "mock agent" and "echo agent" marked inherited, with no way to edit or rename them.
2. The user disables mock agent. The entry shows as disabled with "Enable".
3. The user adds a workspace script with a command and no name; it is named from the command's program. The user renames it to "sparta tests", later removes it.
4. The user adds another workspace script whose command is the same as echo agent's.
5. The user opens the "Create shell" modal in sparta: Starting script offers Plain shell, echo agent, and the workspace scripts that still exist, but not mock agent.
6. In another workspace the modal still offers the user list unchanged and none of sparta's scripts; Settings does not list them.
7. Back in sparta, the user enables mock agent. The modal again matches the user list plus sparta's scripts.

### Edge Cases

- EC-1: A name or command that breaks the FR-2 rules (name empty after defaulting or over 64 characters, command empty) is rejected with a reason. Rules are reused from PRB.T-018, not redefined here.
- EC-2: A workspace script is saved with no name: its name is the command's program (first word after any leading env assignments, whitespace trimmed; `FOO=1 claude` gives `claude`). A command made only of env assignments with no name typed is rejected with a reason, because there is no program to name it from. A defaulted name does not follow later edits of the command, and clearing the name re-defaults it (settled in PRB.T-018 EC-10).
- EC-3: A workspace script has the same name, or the same command, as a user script or as a script of another workspace: allowed. The dialog and the modal show both entries.
- EC-4: A user script that a workspace disabled is renamed in Settings: it stays disabled in that workspace under its new name.
- EC-5: A user script that a workspace disabled is deleted in Settings: the disabled mark goes away; the dialog and modal show no entry for it. A user script later added with the same name and command is a new script and is offered (enabled) in that workspace.
- EC-6: A user script is added in Settings after a workspace was set up: it is offered in every workspace, including those that disabled other scripts.
- EC-7: A workspace file saved before this story (every existing file) has no scripts data: every user script is enabled, there are no workspace scripts, and the modal offers the user list.
- EC-8: Two clients edit the workspace's scripts at the same time: different scripts both survive, the same script keeps the last save (see Expected Behavior). Live refresh of the other client is PRB.T-020.
- EC-9: Disabling or enabling a user script that was deleted meanwhile: nothing to change; the dialog shows the current state without an error.
- EC-10: A user script is disabled in sparta and has the same name as a workspace script there: only the workspace script is offered in the modal; the disabled user script stays listed as disabled in the dialog.

### Error Handling

- ER-1: The workspace file cannot be read or decoded (damaged, including a damaged scripts part: the file is treated as a whole). Probe still starts; the workspace stays listed; opening it fails and shows why, as today. The starting scripts dialog is not reachable for a workspace that cannot be opened.
- ER-2: Saving a change fails (disk error, file locked): the dialog shows the failure with the reason and stays open, the previous state stays shown and the saved file is unchanged (no half-written file).
- ER-3: Validation failures (EC-1, EC-2) show the reason next to the field and nothing is saved.
- ER-4: The workspace was removed or renamed while the dialog was open: the action fails, the dialog shows a not-found message and stays open, and no file is recreated.

## Out Of Scope

- The persisted user list, the modal's dropdown and the remembered choice: PRB.T-016.
- Settings > Starting scripts and the FR-2 name and command rules themselves: PRB.T-018 (this story reuses them).
- A missing program being named and exiting commands: PRB.T-017.
- A start that picks a script disabled or removed meanwhile being refused with a message naming it (FR-12, E2-S5): PRB.T-020.
- Running shells staying untouched, the remembered choice falling back to Plain shell, Restore starting a plain shell and live updates to other clients (FR-9, FR-10, FR-11, E2-S5): PRB.T-020.
- Editing, renaming or overriding a user script's command from a workspace, and resetting such overrides: decided out by the user on 2026-11-08 (a workspace only disables user scripts or adds its own).
- Env vars and a folder per script, scripts in a repository file, field-level merges, several user profiles: epic Out.
- Desktop and mobile UI: browser first (epic scope).
- Reordering scripts in the dialog or the modal: not requested; order is fixed by FR-5.

## Technical Scope

- **Layers:** terminal UI (new dialog entry in the "Workspaces" menu, the dialog itself, the modal reading the merged list); server (workspace storage carries the disabled user scripts and the workspace scripts; the merge; the per-script merge of concurrent edits); contracts (workspace detail and the commands that change a workspace's scripts); data (workspace file gains this data, older files must still open unchanged).
- **Docs impact:** `docs/user/workspaces.md` (a section on a workspace's starting scripts: inherited, disable and enable, add, edit and remove workspace scripts, default names, what happens when a user script is renamed or deleted); the epic's "Starting scripts" user section (NFR-7) is shared with PRB.T-016 and PRB.T-018, so extend rather than duplicate it. `docs/internals/` only if the merge rule or the workspace file field carries a cross-component constraint the code cannot show (decide in the plan).
- **Mobile impact:** contracts change, so mobile must still compile (`vp run check:changed` type-checks it); no mobile UI is built.

## Non-functional Requirements and Constraints

- NFR-2: a damaged workspace file never stops Probe from starting; for a workspace that fails to open, the problem appears in the message that says why (settled 2026-11-08; the epic's NFR-2 is narrowed the same way).
- NFR-3: scripts are stored only in the workspace file in Probe's state folder; logs carry the script name and program, never the full command line, and saving an edit must not log it. Every user has the same permissions; this story adds no permission checks (settled 2026-11-08).
- NFR-5: every action (disable, enable, add, edit, remove, open the dialog) works with the mouse or touchpad alone; Enter is only a shortcut.
- NFR-1: no continuously repainting animation in the dialog (code review).
- Client mutations follow the repo's command conventions in AGENTS.md.
- Existing workspace files (without this data) must open and save unchanged in meaning (EC-7).
- Do not weaken the existing workspace-file safety: atomic writes, and a damaged file stays listed.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a workspace and a user list "mock agent", "echo agent", when the user opens the starting scripts dialog from the "Workspaces" menu, then it shows Plain shell, then both user scripts marked inherited with no edit or rename action, and no workspace scripts | auto | FR-4, EC-7 |
| AC-2 | Given the dialog, when the user disables mock agent, then the dialog shows it as disabled with an Enable action, the modal in sparta does not offer it, the modal in another workspace still does, and the user list in Settings is unchanged | auto | FR-4, FR-5 |
| AC-3 | Given mock agent is disabled in sparta, when the user enables it, then the modal in sparta offers it again at its user-list position | auto | FR-4, FR-5 |
| AC-4 | Given the dialog, when the user adds a workspace script with the command `FOO=1 claude` and no name, then it is named "claude", it is listed in the dialog and offered last in the modal in sparta, and it is absent from Settings and from the modal in another workspace | auto | FR-4, FR-2, EC-2 |
| AC-5 | Given a workspace script, when the user changes its name and command, then the dialog and the modal show the new values at the same position; when the user removes it, then it is gone from both | auto | FR-4 |
| AC-6 | Given a disabled user script and two workspace scripts added in turn, when the user opens the modal, then the list is Plain shell, the enabled user scripts in user-list order, then the workspace scripts in the order added | auto | FR-5 |
| AC-7 | Given a workspace script with the same command as echo agent and another with the same name as a user script, when the user opens the dialog and the modal, then every entry is shown, and starting each one runs its own command | auto | FR-5, EC-3, EC-10 |
| AC-8 | Given an invalid name (over 64 characters), an empty command, or no name with a command made only of env assignments, when the user saves a workspace script, then a reason is shown next to the field and nothing is saved; and two workspace scripts with the same name are both accepted | auto | FR-2, EC-1, EC-2, ER-3 |
| AC-9 | Given a user script disabled in sparta, when it is renamed in Settings, then it is still shown disabled under the new name and not offered in the modal | auto | FR-4, EC-4 |
| AC-10 | Given a user script disabled in sparta, when it is deleted in Settings, then the dialog and modal in sparta show no entry for it and no error; and when a user script with the same name and command is added afterwards, then it is offered in sparta | auto | FR-4, EC-5, EC-9 |
| AC-11 | Given sparta has a disabled user script, when a new user script is added in Settings, then the modal in sparta offers it | auto | FR-5, EC-6 |
| AC-12 | Given a workspace file saved before this story, when it is opened, then the dialog shows the whole user list as inherited and enabled, and the modal offers it | auto | EC-7 |
| AC-13 | Given a damaged workspace file, when Probe starts, then it starts and the workspace is listed; when the user opens the workspace, then opening fails and shows why, as today | auto | NFR-2, ER-1 |
| AC-14 | Given a save that fails, when the user changes a script, then the dialog shows the failure with its reason and stays open, shows the previous state, and the saved file is unchanged | auto | ER-2 |
| AC-15 | Given the workspace was removed while the dialog was open, when the user saves a change, then a not-found message is shown in the open dialog and no file is recreated | auto | ER-4 |
| AC-16 | Given two clients with the dialog open on one workspace, when client A adds script "a" and client B, which loaded before A saved, then adds script "b", then reopening the dialog shows both "a" and "b" | auto | FR-11, EC-8 |
| AC-17 | Given two clients with the dialog open, when A edits the command of one workspace script to X and B then edits the same script's command to Y, then reopening the dialog shows Y, and a third script changed by neither is unchanged | auto | FR-11, EC-8 |
| AC-18 | Given scenario E2-S2 driven with pointer actions only (disable, add, rename, remove, enable; other workspace and Settings unchanged), when run from a clean shell, then it passes | auto | FR-4, FR-5, NFR-5 |
| AC-19 | Given the server log, when a workspace script is saved, edited and started, then the log lines carry the script name and program and never the command line | manual | NFR-3 |
| AC-20 | Given the PR, when a reviewer reads the diff, then the user docs describe workspace scripts and disabling, the dialog has no continuously repainting animation, and mobile still type-checks | manual | NFR-7, NFR-1 |

AC-19 and AC-20 are manual (code review, as the epic's verification table says); the reviewer is the author.

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-018 | Reuses the FR-2 name and command rules and the user list management (renames and deletes that EC-4, EC-5 and EC-6 react to) | backlog |
| PRB.T-016 | Through PRB.T-018: the persisted user list, the stable identity of a user script, and the dropdown that shows the merged list | backlog |

PRB.T-020 depends on this story (live updates cover both lists); PRB.T-017 is independent.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The workspace file can carry the disabled user scripts and the workspace scripts next to its layout, older files still open (epic A-3), and a change can be applied to the file's current content so that edits to different scripts both survive (EC-8, AC-16) | assumption | unverified | Plan stage: the file already has optional fields and a migration on read (`SavedWorkspaces.ts`) | author |
| SA-2 | The FR-2 name and command rules from PRB.T-018 can be reused as they are for workspace scripts | assumption | unverified | Plan stage, once PRB.T-018 is planned | author |
| SA-3 | The "Workspaces" menu is the right and only entry point for the dialog; keybinding and command-palette entries are not required (the epic names the menu) | assumption | unverified | Author confirms at story review | author |
| SA-4 | Changing workspace contracts does not break mobile beyond compile (no mobile screen uses workspace detail) | assumption | unverified | `vp run check:changed` in the plan stage | author |
| SA-5 | A user script has an identity that survives a rename and that a workspace can refer to (epic FR-6 and FR-4 already rely on this) | assumption | unverified | Read PRB.T-016 when it is planned | author |
