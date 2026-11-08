---
id: PRB.T-018
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-08
---

# Manage user starting scripts in Settings

## Business Goal

**Problem:** A Probe user cannot start Claude Code or any other agent CLI from Probe, because the only starting scripts come from a built-in default and a server setting. Adding one today means editing files or environment variables and restarting the server.

**Proposed solution:** A new Settings > Starting scripts page lets the user add, edit and remove their own starting scripts (a name and a command line). The list is saved by the server and survives a reload and a server restart, and the scripts show up in the "Create shell" modal.

## Epic and Requirements

- **Epic:** PRB.E-002 Starting scripts: choose what a new shell runs
- **Candidate story:** # 3 Manage user scripts in Settings
- **Delivers:**
  - FR-2: the Settings page, add, edit (name and command), remove, validation with a reason, the default name taken from the command's program, names and commands that may repeat (also within the list), persistence across reload and server restart, and the damaged-list problem with an explicit Reset.
  - NFR-1 (Settings part): no continuously repainting animation in the Settings page.
  - NFR-2 (Settings part): a damaged saved list is shown as a problem in Settings, and Probe still starts.
  - NFR-3 (Settings part): scripts are stored only in Probe's state folder; saving, editing, removing and resetting log the script name and never the command line. The epic adds no roles and no permission checks (decided 2026-11-08), so this story adds none.
  - NFR-4 (contracts part): mobile and every other dependent of the contracts package still type-check after this story's contract change.
  - NFR-5 (Settings part): every action works with the mouse or touchpad alone.
  - NFR-7 (user docs part): the "Starting scripts" section of the user docs for the user list.
  - Scenario E2-S1 (the Settings part: add "echo agent", see it offered in two workspaces, list unchanged after reload and restart).
- **One deployable outcome:** A user adds, edits and removes their own starting scripts in Settings, without touching files, and sees them in the modal in every workspace; this gives the epic goal its "manage them from the UI" half for the user level.

## Current Behavior

Verified by reading code on 2026-11-08 (the cocoindex-code index was unavailable). PRB.T-016 (the persisted user list) is now written but not yet built, so the list below describes the code as it is today and the user list as PRB.T-016 specifies it (a list in Probe's state folder, absent until seeded or saved; a damaged one is logged, the file kept, and the modal offers Plain shell only); see Assumptions.

- **Settings (web).** Settings sections are routes named `apps/web/src/routes/_chat.settings.<section>.tsx` (general, appearance, keybindings, connections, and others). The sidebar lists them from `SETTINGS_NAV_GROUPS` in `apps/web/src/components/settings/settingsSearch.ts`, which drops any path in `HIDDEN_SETTINGS_PATHS` (this is how chat-only pages are hidden, PRB.T-003). Section labels are in `SETTINGS_SECTION_LABELS` in the same file. There is no "Starting scripts" route, label, nav entry or search entry.
- **Starting script today.** One server-wide command from `PROBE_AGENT_COMMAND` (`apps/server/src/cli/config.ts`) feeds `agentCommand` in `apps/server/src/terminal/Shells.ts`; there is no user list and no endpoint to read or write scripts. The modal's dropdown (`STARTING_SCRIPT` in `apps/web/src/components/workspaces/StartShellDialog.tsx`) is disabled.
- **Client-guarded methods.** Protected methods are listed in `packages/contracts/src/clientRpcPermissions.ts`. No method exists for starting scripts. This story adds no roles or permission logic (every user has the same permissions, decided 2026-11-08).
- **Persistence conventions.** Workspaces are files in the server's `userdata/workspaces` folder (`docs/user/workspaces.md`, "Names"); an unreadable file stays in the list and opening it shows why.
- **Mobile.** `apps/mobile` is a separate React Native app with its own navigation; it has no starting-script UI.
- **Docs.** `docs/user/workspaces.md` describes the "Agent command" (`PROBE_AGENT_COMMAND`) and says the Starting script cannot be changed yet. `docs/internals/terminal-runtime.md` describes how the agent command is checked and typed. Neither mentions a user list.

## Expected Behavior

Settings has a "Starting scripts" section, reachable from the Settings sidebar and from Settings search. It shows "Plain shell" as a fixed built-in entry first, then the user's scripts, each with a name and a command. The user can add a script, edit a script's name and command, and remove a script, each with the mouse or touchpad. An invalid entry is refused with a reason and nothing is saved. The list is kept by the server in Probe's state folder, so it is the same after a reload and after a server restart, and the "Create shell" modal in any workspace offers the saved scripts. Editing or removing a script never changes a shell that is already running (that rule is PRB.T-020's to prove; this story must not break it).

Settled by the user on 2026-11-08, and applied below:

- There are no roles and no permission model: every user of the app and its workspaces has the same permissions. The page has no read-only mode and no permission check.
- A damaged saved list is shown with what is wrong, in Settings only, and is left alone until the user clicks Reset. While it is damaged, add, edit and remove are disabled. Reset gives an empty list (no re-seed with "mock agent").
- Script names need not be unique, even within one list: a second script with the same name (and/or the same command) is accepted as a separate entry.
- Surrounding whitespace on a name or command is trimmed; a whitespace-only name counts as no name.
- A defaulted name is saved as the script's name and does not follow later edits of the command; clearing the name in an edit takes the default again. PRB.T-019 applies the same rule and cites this one.
- A command with no program and no name, a program over 64 characters, or a program equal to "Plain shell" (any letter case) with no name, is refused with a reason asking for a name.
- When two pages save, the last save wins.
- A script's name defaults to its command's program (the first word after any leading env assignments, surrounding whitespace trimmed) and the user can type another name. Names and commands may repeat within the user list, between the user list and workspaces and between workspaces. "Plain shell" is a reserved name.
- Workspace scripts never appear in Settings, and a workspace cannot edit user scripts (the workspace side is PRB.T-019).

### User Flow

1. The author starts a server on a temporary state folder seeded with "mock agent" (the E2-S1 scenario harness) and opens Settings, then "Starting scripts".
2. The page shows Plain shell (fixed) and "mock agent".
3. The user chooses to add a script, types the name "echo agent" and a command line, and saves. The script appears in the list.
4. The user adds a second script with a command only (`FOO=1 claude --resume`) and no name; it is saved and listed as "claude".
5. The user opens the "+" modal in two different workspaces and sees Plain shell, mock agent, echo agent and claude in the dropdown.
6. The user edits echo agent's command and saves; the page shows the new command and the modal offers the script under the same name.
7. The user removes mock agent; it disappears from the list and from the modal.
8. The user reloads the page and restarts the server; the list is the same.

### Edge Cases

- EC-1: A user script is added, or another is renamed, with the same name (and/or the same command) as an existing user script. It is accepted as a separate entry; both appear in the list and in the modal, told apart by identity, and editing or removing one leaves the other unchanged.
- EC-2: A name is trimmed of surrounding whitespace before it is checked and saved. A trimmed name of 1 to 64 characters is accepted; one of 65 characters is refused. An empty or whitespace-only name means "no name given" and takes the default (EC-10).
- EC-3: A command that is empty or only whitespace is refused. Surrounding whitespace on a command is trimmed when saved.
- EC-4: Editing a script and saving it with its own, unchanged name is accepted.
- EC-5: The name "Plain shell" (any letter case) cannot be used by a user script, because the built-in entry is always offered first and cannot be edited or removed (FR-3).
- EC-6: The user removes every script. The page shows an empty list with Plain shell still present, and the list stays empty after a server restart: a saved empty list is not the same as no list, and only no list is seeded with mock agent (PRB.T-016, EC-1).
- EC-7: The Settings page is open in two browser pages and both save. The last save wins and is not refused; the other page shows the saved state on its next load. Whether the first save's change survives is not promised. Live updates without a reload are FR-11, owned by PRB.T-020.
- EC-8: An edited script's command is long or contains characters such as quotes and `$`. It is saved and shown exactly as typed (apart from surrounding whitespace, EC-3).
- EC-9: A script is renamed (AC-4). The rename is accepted and the list and the modal show the new name; the modal's remembered choice for a project following the rename (FR-6) is PRB.T-016's.
- EC-10: No name is given. The name becomes the command's program: the first word after any leading env assignments (`FOO=1 BAR=2 claude --flag` gives "claude"), with surrounding whitespace trimmed. It is saved as the script's name (settled 2026-11-08), so editing the command later does not change it; clearing the name in an edit takes the default again. If the command has no program (only env assignments), or the program is longer than 64 characters, or it equals "Plain shell" in any letter case (for example the command `plain shell`), the entry is refused with a reason asking for a name.

### Error Handling

- ER-1: A validation failure (EC-2, EC-3, EC-5, EC-10) shows the reason next to the field, keeps what the user typed, and saves nothing.
- ER-2: The server cannot save the list (for example the state folder is not writable). Settings says the change was not saved and shows the previous list; no partial change is kept.
- ER-3: The saved list cannot be read (damaged file). Probe still starts and the modal still offers Plain shell (NFR-2). Settings (and only Settings) shows that the saved list could not be read and what is wrong, leaves the file untouched, and disables add, edit and remove until the user clicks Reset. Only then is the damaged file replaced by an empty list (no re-seed with mock agent). After Reset the page shows an empty list with Plain shell, and adding works. Nothing is overwritten or deleted before the user chooses Reset, including across a server restart.
- ER-4: The connection to the server is lost while saving. The page says the change was not saved; the list is not shown as changed.

## Out Of Scope

- Workspace scripts, disabling and enabling user scripts per workspace: PRB.T-019 (it applies the same name and command rules as this story, with identical outcomes, including the defaulted name that does not follow command edits). Workspace scripts never appear on this page, and a workspace cannot edit or rename user scripts; PRB.T-019 proves that.
- Running a script's command, "not found" checks and exiting commands: PRB.T-016 and PRB.T-017.
- The persisted user list, its seeding with "mock agent", and the modal's dropdown and remembered choice (including following a rename): PRB.T-016. This story edits that list; it does not create it.
- Changes after start (running shells keep their name, remembered choice falls back to Plain shell, Restore stays plain) and live updates to other connected clients (FR-9, FR-10, FR-11, E2-S5): PRB.T-020.
- Env vars and a folder per script: decided out by the user on 2026-11-08; the command line can set env.
- Checking, at save time, that the command's program exists on `PATH`. A script can be saved before its program is installed; "not found" appears at start (PRB.T-017).
- Importing, exporting, reordering or duplicating scripts: not requested.
- Merging two pages' changes when both save (the last save wins, EC-7).
- Desktop and mobile UI: browser first (scope decision 2).
- Chat settings pages: stay hidden; this is a new Probe page.

## Technical Scope

- **Layers:** Settings UI in the web app (a new section reachable from the sidebar and Settings search); server reading and writing of the user list (the stored list from PRB.T-016), including the damaged-list state and Reset; contracts for the new methods (listed among the client-guarded methods if the existing pattern requires it, per AGENTS.md; no new permission is defined); user docs. Agent reach: the epic's AGENTS.md "Agents" point applies, but exposing the list to agents is SU-1, TBD (author, 2026-11-15).
- **Docs impact:** `docs/user/workspaces.md` gains a "Starting scripts" section for the user list (what it is, how to add, edit and remove, name defaults and command rules, that names and commands may repeat, the damaged-list Reset, where it is in Settings, what "not found" means once PRB.T-017 lands) and its "Agent command" section is rewritten or removed if PRB.T-016 has not already done so. `docs/internals/terminal-runtime.md` is touched only if this story changes how the command is typed (expected: no). `docs/user/remote-access.md` is checked for any text on what a remote client may change and updated if it conflicts. `docs/dev/roadmap.md` records the decisions of 2026-11-08 above (no roles or permissions, repeated names allowed, damaged-list Reset, defaulted name kept); any matching `docs/dev/questions.md` row is deleted.
- **Mobile impact:** contracts change, so mobile must still compile (`vp run check:changed` type-checks it). No mobile UI is built. The new methods are not reachable from mobile screens.

## Non-functional Requirements and Constraints

- NFR-2: a damaged saved list never stops Probe from starting; the problem is shown in Settings and the file is left alone until Reset.
- NFR-3: scripts are stored only in Probe's state folder, never in a repository. Logs carry a script's name and program, never its full command line (it may carry a secret). Saving, editing, removing and resetting must not log the command line. Scenarios use a temporary state folder, never the user's real data. Every user has the same permissions; no role or permission check is added (decided 2026-11-08).
- NFR-4: mobile and every other dependent of the contracts package still type-check after the contract change; no mobile UI.
- NFR-5: add, edit, remove, Reset and save work with the mouse or touchpad alone; Enter may be a shortcut.
- NFR-1: no continuously repainting animation in the Settings page.
- The server decides validation; the page only reflects the result.
- The name and command rules (FR-2) give identical accept and refuse outcomes and reasons wherever they apply: this story and PRB.T-019.
- The page uses the existing Settings layout and shared UI components; it does not restyle them.
- Persisting a change must not lose the existing list if the write fails midway.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given the Settings sidebar, when the user opens "Starting scripts", then the page lists Plain shell first (not editable, not removable) and the saved user scripts, and the section also appears in Settings search | auto | FR-2, FR-3 |
| AC-2 | Given a state folder seeded with mock agent, when the user adds "echo agent" with a non-empty command and saves, then it appears in the list and in the "+" modal dropdown of two different workspaces (E2-S1) | auto | FR-2 |
| AC-3 | Given a saved user list, when the page is reloaded and then the server is restarted on the same state folder, then the list, names and commands are unchanged | auto | FR-2 |
| AC-4 | Given a script, when the user edits its name and command and saves, then the list and the modal show the new name and command (the rename is accepted) and no extra entry remains | auto | FR-2, EC-9 |
| AC-5 | Given a script, when the user removes it, then it is gone from the list and the modal, and stays gone after a server restart | auto | FR-2 |
| AC-6 | Given the user removes every script and restarts the server, when the page loads, then the list is empty, Plain shell is still shown, and "mock agent" is not restored (a saved empty list is not a missing list) | auto | EC-6, FR-3 |
| AC-7 | Given "echo agent" exists, when the user adds another script named "echo agent" (with the same or a different command), and when the user renames a third script to "echo agent", then each is accepted as a separate entry, the list and the modal show all of them, and editing or removing one leaves the others unchanged | auto | FR-2, EC-1 |
| AC-8 | Given a script, when the user saves it with its own unchanged name and a new command, then it is accepted | auto | EC-4 |
| AC-9 | Given the name field, when the user saves a name of 1 and of 64 characters, then both are accepted; when the name has 65 characters, then it is refused with a reason, the typed text is kept and nothing is saved | auto | FR-2, EC-2, ER-1 |
| AC-10 | Given the command field, when the user saves an empty or whitespace-only command, then it is refused with a reason and nothing is saved | auto | FR-2, EC-3, ER-1 |
| AC-11 | Given the name "Plain shell" in any letter case, when the user saves a script with it, then it is refused with a reason | auto | EC-5, ER-1 |
| AC-12 | Given a command with quotes, `$` and spaces, when the user saves it, then reopening the page shows it exactly as typed | auto | EC-8 |
| AC-13 | Given a name with surrounding spaces ("  echo agent  ") and a command with surrounding spaces, when the user saves, then the list shows "echo agent" and the command without the surrounding spaces; a name of only spaces is treated as no name | auto | FR-2, EC-2, EC-3 |
| AC-14 | Given a command `FOO=1 BAR=2 claude --flag` and no name, when the user saves, then the script is listed as "claude" and the name stays "claude" after the command is edited; clearing the name in an edit takes the program of the current command | auto | FR-2, EC-10 |
| AC-15 | Given no name and a command with no program (`FOO=1`), or a program of 65 characters or more, or the command `plain shell` (program equal to "Plain shell" in any case), when the user saves, then each is refused with a reason asking for a name, the typed text is kept and nothing is saved; with a name given, each is accepted | auto | FR-2, EC-5, EC-10, ER-1 |
| AC-16 | Given the state folder cannot be written, when the user saves, then the page says the change was not saved and shows the previous list, and a restart shows the previous list | auto | ER-2 |
| AC-17 | Given a damaged saved list, when the server starts, then it starts, the modal offers Plain shell, and Settings shows that the list could not be read and what is wrong, with add, edit and remove disabled until Reset; the file's contents are unchanged after the start and after a further restart | auto | NFR-2, ER-3 |
| AC-18 | Given the damaged list shown in Settings, when the user chooses Reset, then the file is replaced by an empty list ("mock agent" is not restored), the page shows an empty list with Plain shell, adding a script works, and the list is the same after a restart | auto | NFR-2, ER-3 |
| AC-19 | Given the connection is lost while saving, when the save fails, then the page says the change was not saved and does not show it as saved. Checked by the author in a browser with the server stopped mid-edit | manual (author) | ER-4 |
| AC-20 | Given a script is saved, edited, removed or the list is reset, when the server log is read, then it carries the script name but never the command line | auto | NFR-3 |
| AC-21 | Given the page, when the user adds, edits, removes and (for a damaged list) resets using only pointer actions, then every step works | auto | NFR-5 |
| AC-22 | Given two browser pages open on the page with the same list, when each adds a different script and saves, one after the other, then neither save is refused, the later saver's script is in the list, and the list is valid after a reload | auto | EC-7 |
| AC-23 | Given the PR, when the docs diff is read, then `docs/user/workspaces.md` has the "Starting scripts" section for the user list (including that names and commands may repeat and the damaged-list Reset) and no text still describes the server-wide agent command as the starting script. Checked by the author | manual (author) | NFR-7 |
| AC-24 | Given the PR, when `vp run check:changed` runs, then mobile and every other affected package still type-check after the contract change | auto | NFR-4 |
| AC-25 | Given the page, when reviewed by the author, then it uses no continuously repainting animation | manual (author) | NFR-1 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-016 | Persisted user list (and the modal dropdown that shows it); this story edits that list | backlog (written, not yet built) |

PRB.T-017 is independent of this story and can run in parallel after PRB.T-016. PRB.T-019 (workspace scripts) and PRB.T-020 (changes after start, live updates) come after this story: PRB.T-019 applies its name and command rules, and PRB.T-020 covers the list this story creates.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | PRB.T-016 persists the user list in Probe's state folder in a form this story can read and write, gives each script an identity that survives edits, and tells apart a damaged list, a missing list (the only one seeded with "mock agent") and a saved empty list (not seeded, per PRB.T-016's EC-1). PRB.T-016 specifies the missing/damaged cases and identity (its SA-10) but leaves open the file's exact shape and the saved-empty-list case, which this story's AC-6 needs | assumption | unverified | Read PRB.T-016 when it is planned and add the saved-empty-list case to its EC-1 and ACs if missing; before this story's plan | author |
| SA-2 | Settings has room for a new Probe page while chat-only pages stay hidden (epic A-4). Verified in part: routes are `_chat.settings.<section>.tsx` and hidden paths are filtered in `settingsSearch.ts`; whether a new route needs the `_chat` layout is not checked | assumption | unverified | This story's plan, a look at the route tree and `HIDDEN_SETTINGS_PATHS` | author |
| SA-3 | Adding a protected method to the contracts follows the existing pattern in `clientRpcPermissions.ts` and mobile compiles unchanged | assumption | unverified | This story's plan; `vp run check:changed` | author |
| SU-1 | Whether the user list should also be reachable by agents through MCP tools (AGENTS.md "Agents") | unknown | unverified | TBD (author, 2026-11-15); likely a later story | author |
