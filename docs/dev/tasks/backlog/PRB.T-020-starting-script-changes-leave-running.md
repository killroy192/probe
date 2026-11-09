---
id: PRB.T-020
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-08
---

# Starting script changes leave running shells alone and update every client

## Business Goal

**Problem:** Once users can edit and remove starting scripts and disable, enable or add them per workspace (PRB.T-018, PRB.T-019), four things can go wrong that the user cannot see coming: an edit might disturb a shell that is already running, a project's remembered script might point at something that no longer exists, a second browser or device might keep showing the old lists until it is reloaded, and a start might pick a script another client just removed. Restore (PRB.T-008) is also unspecified for shells that were started from a script.

**Proposed solution:** Changing, removing or disabling a script never touches a shell that is already running, and never changes its name. A remembered script that is gone falls back to Plain shell in the modal. A start that picks a script removed or disabled meanwhile is refused with a message naming it. Restore always brings back a plain shell. Every connected client shows list changes as they happen, without a reload, from both sources: the user list from the default server and a workspace's scripts from its own server (user decision 2026-11-09).

## Epic and Requirements

- **Epic:** PRB.E-002 Starting scripts: choose what a new shell runs
- **Candidate story:** # 5 Changes after start and live updates
- **Delivers:**
  - FR-9: editing, disabling or removing a script leaves running shells running and does not change their names (a name stays "Shell N · folder · program", with the program running in the shell, as today).
  - FR-10: Restore on an ended shell starts a plain shell, whatever script the shell was started with.
  - FR-6 (fallback part only): a remembered script that is no longer in the merged list (the default server's user list plus the workspace's file) preselects Plain shell. The preselection itself and the rename-following part are delivered by PRB.T-016. The remembered choice is checked by script identity, not by name.
  - FR-11 (as amended 2026-11-08 and 2026-11-09): every connected client sees a change to the user list (from the default server) or to a workspace's scripts (from that workspace's server) without a reload; when two clients change different scripts both changes survive, and on the same script the last save wins.
  - FR-12: a start that picks a script removed (on the default server) or disabled (in the workspace's file) meanwhile, for example by another client, is refused with a message naming the script, and no shell is opened.
  - Scenario E2-S5.
  - NFR-2 (a command is typed only into the shell started with it, exactly once), NFR-5 (every action reachable with a pointer; the scenario ACs below are pointer-driven) apply to what this story adds.
- **One deployable outcome:** A user can change, disable or remove a script while shells started from it keep running unchanged, sees the modal fall back to Plain shell, is refused (with the script named) when starting a script that is gone, can Restore an ended shell as a plain shell, and sees every open client follow script changes live; this closes the epic's "change after start" gap.

## Current Behavior

Verified by reading code on 2026-11-08. The code search index (`cocoindex-code`) was unavailable, so searches were by grep.

- **Starting command is server-wide, not per script.** `apps/server/src/terminal/Shells.ts` (`makeShells`, `open`) reads one `agentCommand` option (from `PROBE_AGENT_COMMAND`, `apps/server/src/cli/config.ts`), checks its program, and types `<command>\r` once after the shell-ready mark (`apps/server/src/terminal/shellReady.ts`). There is no user list, no workspace disabling or workspace scripts and no per-start script yet (PRB.T-016, PRB.T-018, PRB.T-019 are backlog stories, not built yet).
- **A shell does not remember its script.** The saved shell record (`SavedShell` in `Shells.ts`) holds id, pid, cwd, label, title, project, worktree, home, token hash, ended state and a `restored` flag, and no script or command.
- **Restore opens a plain shell today.** `Shells.restore` (`Shells.ts`) reopens the same terminal under the same id and folder, drops the old output and sets `restored`. It does not type any command. `docs/internals/terminal-runtime.md` says nothing calls it automatically.
- **The shell's name.** `apps/web/src/components/workspaces/shellName.ts` builds "Shell N · folder · program": `title` is the fixed workspace number, the folder is optional, and the last part is `shell.process`, which `Shells.ts` fills from the terminal's current running-program label (only while a subprocess runs, otherwise null). So today the program part follows what is running in the shell now, not a value fixed at start. The epic's FR-9 (amended 2026-11-08, SU-1) keeps it that way: a script edit must not change a name, and the program part stays what runs in the shell.
- **Remembered choice.** The modal's dropdown is a fixed, disabled "mock agent" (`STARTING_SCRIPT` in `apps/web/src/components/workspaces/StartShellDialog.tsx`). `WorkspaceLastStart` (`packages/contracts/src/workspace.ts`) holds the project and worktree choice only, no script.
- **How clients receive changes today.** Shells: the `subscribeShells` stream sends a snapshot, then `upsert` and `remove` events (`ShellListStreamEvent` in `packages/contracts/src/shell.ts`, served in `apps/server/src/ws.ts`). Workspaces: `subscribeWorkspaces` streams the workspace summaries from `SavedWorkspaces.streamChanges` (`apps/server/src/savedWorkspaces/SavedWorkspaces.ts`). Whether either stream can carry script lists is unverified (SU-2).
- **Entry points that start a shell today.** The only caller of the Create shell modal (`StartShellDialog`) is the workspace sidebar (`apps/web/src/components/workspaces/WorkspaceSidebar.tsx`). The command palette (`apps/web/src/components/CommandPalette*.tsx`) and the keybindings (`apps/web/src/keybindings.ts`) have no entry that starts a shell or a script (grep, 2026-11-08). Mobile has its own state files that read these shapes (`apps/mobile/src/state/shell.ts`, `workspace.ts`, `workspaceModel.ts`).

## Expected Behavior

Once PRB.T-016, PRB.T-018 and PRB.T-019 exist, this story makes the following hold.

- Saving, removing, disabling, enabling or adding a script never stops, restarts, retypes into, renames or otherwise changes a running shell. It does not alter the tree or tabs beyond what the user did.
- A shell that is running keeps the name it has. Script edits cause no name change; the name stays "Shell N · folder · program" with the program running in the shell, as today (settled, SU-1).
- When the project's remembered script is no longer in the workspace's merged list (removed from the default server's user list, disabled in this workspace's file, or removed from it), the modal preselects Plain shell. The user can still pick another script. The stored remembered value is not required to be rewritten by this story. Whether the remembered script is still there is decided by script identity, not by name, because names may repeat between lists.
- Restore on an ended shell starts a plain shell in the same folder (on the shell's own server), whatever script the shell was started with. No script is typed, now or later, even if the script still exists unchanged. A shell's start is not affected by later edits to the script it was started from.
- A change to the user list or to a workspace's scripts made in one client appears in every other connected client without a reload. The user list comes from the default server; a workspace's disabled scripts and workspace scripts come from that workspace's server; the modal shows the merge of both, so the same page can follow two servers at once. It appears: in Settings > Starting scripts, in the workspace dialog and in the modal's dropdown. An open modal or dialog reflects the change, or tells the user the list changed, instead of showing a stale list. When two clients save at nearly the same time to the same source, changes to different scripts both survive, a change to the same script is decided by the last save, and every client shows the same result.
- A start that picks a script removed or disabled meanwhile is refused with a message naming the script, and no shell is opened (settled, SU-3).

### User Flow

1. The user has a shell running echo agent, started from a project in workspace "sparta".
2. The user edits echo agent's command in Settings (or disables it in "sparta") and later removes it. The running shell keeps running and keeps its name.
3. The user opens the "+" modal on that project, whose remembered script was echo agent. The dropdown shows Plain shell preselected; the user can pick another script.
4. A shell started from a script ends unexpectedly. The user clicks Restore. The shell comes back as a plain shell at its prompt in the same folder; nothing is typed.
5. With a second browser page open on the same server, the user changes a script on the first page. The second page shows the change without a reload.
6. On the second page the modal was already open with echo agent selected when the first page removed it. The user clicks start: the start is refused with a message naming echo agent, and no shell appears.

### Edge Cases

- **EC-1:** A script is edited, disabled or removed while a shell started from it is still starting (command not yet typed). The command that was chosen at the start is the one typed, once, into that shell.
- **EC-2:** The remembered script is a workspace script removed from that workspace, a user script disabled in this workspace only, or a user script removed from the user list: each falls back to Plain shell in that workspace. In a workspace where the user script is still enabled it stays preselected.
- **EC-3:** The remembered script is a user script that is disabled in this workspace and then enabled again before the modal is opened: it is the same script (same identity), so the modal preselects it again.
- **EC-3b:** The remembered script is removed (a workspace script, or a user script from the user list) and a script is then added again, even with the same name and command: it is a new script with a new identity and is not preselected. Plain shell stays preselected, since the choice follows identity, not name.
- **EC-4:** Restore of a shell started from a script that still exists unchanged: still a plain shell, nothing typed.
- **EC-5:** A shell from before this epic (no script recorded), a shell started with Plain shell, and a shell lost with its server (`ended: "lost"`) all restore the same way, as a plain shell.
- **EC-6:** The modal or a dialog is open in client B when client A changes the lists. The user does not start a shell from a script that no longer exists without being told: the start is refused (ER-2).
- **EC-7:** A client that was offline or disconnected reconnects after changes: it shows the current lists, not the ones from before the disconnect.
- **EC-8:** Two clients change the lists at nearly the same time: changes to different scripts both survive; if both change the same script, the last save wins. Both clients end up showing the same final lists as the server.
- **EC-9:** The workspace is on a second server (PRB.E-003). A user script changed on the default server reaches the modal of that workspace live, and a workspace script changed on the second server reaches every client that shows that workspace live. If the workspace's server is unreachable the modal cannot start a shell anyway (PRB.E-003 FR-8) and its workspace scripts are not shown; the user list from the default server is unaffected.
- **EC-10:** The remembered script is a user script of the default server and the workspace is on a second server: the fallback and the identity check use the default server's list and the workspace's file together; the same holds for "removed or disabled meanwhile" at the start.

### Error Handling

- **ER-1:** A damaged saved list (NFR-2): other clients still receive updates for the lists that can be read, the modal still offers Plain shell, and the problem shown in Settings or the dialog is shown on every client.
- **ER-2:** The user starts a shell from a script that was removed or disabled by another client a moment earlier: the start is refused with a message naming the script, and no shell is opened or left in the tree. It does not fall back to Plain shell (settled, SU-3). The exact message text is TBD (author, 2026-11-15).
- **ER-3:** The live update cannot reach a client (connection lost to either server): the client keeps its last lists from that source, and on reconnect shows the current ones (EC-7). It does not claim to be live while disconnected.

## Out Of Scope

- Re-running the script on Restore and resuming agents: later, with agent state (phase 3); stays as the epic's Out list says.
- Editing, removing, disabling, enabling or adding scripts, Settings and the workspace dialog themselves: PRB.T-018 and PRB.T-019. This story adds no editing screen.
- The modal's dropdown, the remembered choice and following a rename: PRB.T-016 (this story only adds the fallback when the script is gone).
- Naming a missing program and exiting commands: PRB.T-017.
- Live updates for anything other than the two script lists (shells and workspaces already stream).
- Conflict resolution between two people editing at once beyond merging per script (different scripts both survive, same script last save wins) and showing the same final state on every client (EC-8).
- A command-palette or keybinding entry for starting a script: none exists today and the epic names only the Create shell modal, so none is in scope for this epic.
- Desktop and mobile UI: mobile must still compile; no mobile screen is built.

## Technical Scope

- **Layers:** server (making Restore and shell names independent of later script edits, refusing a start of a script that is gone; broadcasting list changes), contracts (the shape in which list changes reach clients), web client (modal fallback, Settings, dialog and open modal following live changes), scenario harness (E2-S5, and E2-S2 with a second page open). Names areas only; the plan decides how.
- **Docs impact:** `docs/user/` "Starting scripts" section (from the epic's NFR-7): add that running shells are unaffected by changes, that a missing remembered script falls back to Plain shell, that Restore starts a plain shell, and that other open clients update live. `docs/internals/terminal-runtime.md`: Restore paragraph states that it starts a plain shell and why (agent state is phase 3). Same PR.
- **Mobile impact:** the contract change must still compile in `apps/mobile` (`vp run check:changed` type-checks it). No mobile UI. Add the `mobile-impact` label at hand-off.

Hit-every-surface decisions: entry points (Settings, workspace dialog and modal; the command palette and keybindings start no shell today and are out of scope for this epic, see Out Of Scope); providers and agents-through-MCP: not applicable (terminal shells only); reverse states: enabling a disabled script and removing a workspace script come from PRB.T-019, the fallback here reverses by itself (EC-3); connection modes: local, remote/relay and tunnel all use the same websocket streams, and a client may hold connections to the default server and to a workspace's server at once, so live updates must work over each of them and a dropped connection is covered by EC-7 and ER-3.

## Non-functional Requirements and Constraints

- Live updates must not repaint continuously or send large payloads on every keystroke; changes are sent when saved (epic NFR-1, AGENTS.md "Performance without compromise").
- A command is typed only into the shell started with it, exactly once; a change never causes a second typing (epic NFR-2).
- The new client-visible state follows the repository's rules: typed in `packages/contracts`, client mutations through the existing RPC command pattern, no handler logic in transports.
- Every action stays reachable with a pointer (epic NFR-5); the scenario acceptance criteria are driven with pointer actions only.
- Scenarios use a temporary state folder, never the user's real data.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a shell running echo agent, when the user edits echo agent's command in Settings, then the shell keeps running, nothing is typed into it, and its name in the tree and tabs is unchanged | auto | FR-9, NFR-2 |
| AC-2 | Given a shell running echo agent in workspace "sparta", when echo agent is disabled in "sparta", enabled again, and then removed from the user list, then the shell still runs and keeps its name each time | auto | FR-9 |
| AC-3 | Given a shell started from a script whose first prompt is held back (the scenario's shell startup waits for a release signal, or a server-level test controls the shell-ready mark), so the command is deterministically not typed yet, when the script is edited, then disabled, then removed, and the prompt is then released, then the command chosen at the start is typed once into that shell | auto | EC-1, NFR-2 |
| AC-4 | Given a project whose remembered script was echo agent, when echo agent has been removed from the user list and the user opens the modal, then Plain shell is preselected and the other scripts can be picked | auto | FR-6, E2-S5 |
| AC-5 | Given the remembered user script is disabled in workspace A only, when the modal is opened in A and in B, then A preselects Plain shell and B still preselects the script | auto | EC-2, FR-6 |
| AC-6 | Given the remembered user script was disabled and then enabled again, when the modal is opened, then it preselects that script again | auto | EC-3, FR-6 |
| AC-20 | Given the remembered script was a workspace script that was removed and then a script with the same name and command was added again, when the modal is opened, then Plain shell is preselected (the new script is offered but not preselected) | auto | EC-3b, FR-6 |
| AC-7 | Given a shell started from a script that ended unexpectedly, when the user clicks Restore, then it comes back as a plain shell in the same folder and no script is typed | auto | FR-10, NFR-2 |
| AC-8 | Given the same shell as AC-7 and the script still unchanged, when the user clicks Restore, then it is still a plain shell with nothing typed | auto | EC-4, FR-10 |
| AC-9 | Given a shell started with Plain shell, a shell saved before this epic, and a shell lost with its server, when each is restored, then each comes back as a plain shell | auto | EC-5, FR-10 |
| AC-10 | Given two browser pages open on the same server, when page 1 adds, edits, removes a user script, then page 2 shows the change in Settings and in the modal's dropdown without a reload | auto | FR-11 |
| AC-11 | Given two browser pages open, when page 1 disables, enables, adds, edits or removes a script in workspace "sparta", then page 2 shows the change in the workspace dialog and the modal for "sparta" without a reload, and other workspaces are unchanged | auto | FR-11 |
| AC-12 | Given the modal is open on page 2, when page 1 removes the selected script, then page 2 shows one of two outcomes: the script is gone from the dropdown, or a visible notice says the list changed; it never keeps offering the removed script silently | auto | EC-6, FR-11 |
| AC-13 | Given a client that was disconnected while lists changed, when it reconnects, then it shows the current lists | auto | EC-7, ER-3, FR-11 |
| AC-14 | Given two clients change lists at nearly the same time, when both settle, then two edits to different scripts both survive, two edits to the same script leave the last save, and both clients show the same as the server | auto | EC-8, FR-11 |
| AC-15 | Given a script removed or disabled by another client a moment before, when the user starts a shell from it, then the start is refused with a message naming the script, no shell is opened or left in the tree, and nothing falls back to Plain shell (exact message text TBD, SU-3) | auto | FR-12, ER-2 |
| AC-16 | Given a damaged saved list, when another client is connected, then both still offer Plain shell, both show the problem, and updates to the readable list still arrive | auto | ER-1 |
| AC-17 | Given the connection to the server is lost, when the user looks at Settings, then the page does not claim to be live and shows the last known lists | manual (author) | ER-3 |
| AC-18 | Given the user docs and `terminal-runtime.md`, when the PR is reviewed, then they describe the fallback, Restore as a plain shell and live updates, and no longer describe the old behavior | manual (author, in review) | NFR-7 |
| AC-19 | Given mobile, when `vp run check:changed` runs, then `apps/mobile` still type-checks with the changed contracts | auto | NFR-4 |
| AC-21 | Given the harness has a second server (PRB.E-003) and a workspace of it is shown on page 2, when page 1 adds, edits or removes a user script (default server), then page 2 shows the change in the modal of that workspace without a reload; and when page 1 disables a user script or adds a workspace script in that workspace (second server), then page 2 shows it in the dialog and the modal without a reload | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story; PRB.E-003 adds and runs it) | FR-11, EC-9 |
| AC-22 | Given the workspace of AC-21 whose project remembered a user script, when that script is removed on the default server, and separately when it is disabled in the workspace's file on the second server, then the modal preselects Plain shell each time and, when the script is enabled again in the second case, preselects it again | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story) | FR-6, EC-10 |
| AC-23 | Given the workspace of AC-21 and a modal open on page 2 with a user script selected, when page 1 removes that script on the default server and page 2 starts, then the start is refused with a message naming the script and no shell is opened on the second server | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story) | FR-12, EC-10 |

## Dependencies

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-019 | Live updates cover both lists (user list and workspace lists), so workspace disabling and workspace scripts must exist | backlog |
| PRB.T-018 | Through PRB.T-019: the user list must be editable to be changed after start | backlog |
| PRB.T-016 | Through PRB.T-019 and PRB.T-018: the per-start script choice and remembered script that the fallback and the refusal act on | backlog |
| PRB.E-003 (not a blocker) | Carries the multi-server connection. This story works fully with one server; AC-21 to AC-23 are verified by PRB.E-003 story 8, does not gate this story (PRB.E-003 adds and runs them against its harness second server) | backlog |
| PRB.T-008 | Restore exists and is only extended by a test for script-started shells | done |

Note: PRB.T-017 (missing program and exiting commands) is not a prerequisite; nothing here needs the missing-program check, and the refusal in FR-12 is a separate refusal.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | Restore never types a command today, so FR-10 mostly needs a guard test and a check that it stays so once scripts exist | assumption | verified (Shells.ts `restore`, 2026-11-08) | Re-check in the plan stage | author |
| SA-2 | A script edit cannot reach a running shell because the shell process and its typed command are not linked to the list after start | assumption | unverified | Plan stage: confirm that a shell's start is not affected by later edits once PRB.T-016 exists (outcome: AC-1 to AC-3) | author, plan stage |
| SA-3 | The `subscribeShells` and `subscribeWorkspaces` streams, or an addition to them, can carry both lists to every client, locally and over relay and tunnel; the user list's stream comes from the default server and a workspace's from its own server, and a client can follow both at once | assumption | unverified | Plan stage: read `ws.ts` and the client state for each connection mode | author, plan stage |
| SA-4 | The name's fixed part ("Shell N") does not depend on any script | assumption | verified (`shellName.ts`, `title` from the record, 2026-11-08) | none further | author |
| SU-1 | Whether FR-9 means the program in a shell's name is fixed at start, or only that a script edit does not change it | unknown | verified (settled by the user, 2026-11-08: the name stays "Shell N · folder · program" with the program running in the shell today; the epic's FR-9 is amended) | none further | author |
| SU-2 | Whether the existing workspace stream carries a workspace's script lists, or a new stream is needed | unknown | unverified | Plan stage, after PRB.T-019 fixes where workspace scripts and disabled scripts are stored | author, plan stage |
| SU-3 | What a start from a just-removed or disabled script does (ER-2) | unknown | verified (settled by the user, 2026-11-08: refused with a message naming the script, no shell opened; epic FR-12). Only the exact message text is open | Wording decided before the plan stage | author, 2026-11-15 |
| SU-4 | Whether an open modal or dialog should update in place or show a "the list changed" notice (EC-6) | unknown | unverified | Decide in the plan stage; both satisfy AC-12 | author, plan stage |
| SU-5 | Concurrent saves from two clients: changes merge per script (different scripts both survive; same script last save wins) | unknown | verified (settled by the user, 2026-11-08; epic FR-11 amended) | none further | author |
| SU-6 | Names may repeat across lists, so the remembered choice and the "removed or disabled" checks work by script identity, not by name | unknown | verified (settled by the user, 2026-11-08; epic FR-5) | none further | author |
| SU-7 | How the "removed or disabled meanwhile" check (FR-12) is decided on the workspace's server when the user script was removed on the default server: it depends on how the command reaches the workspace's server (epic U-4, cross-epic: E-003 U-7) | unknown | unverified | Settled by PRB.E-003 story 2; AC-23 follows its answer and is verified by PRB.E-003 story 8. Not a gate for this story | PRB.E-003 story 2, 2026-11-15 |
