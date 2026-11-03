---
id: PRB.T-008
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, plan]
created: 2026-11-02
updated: 2026-11-02
---

# Restore and resume after an unexpected end

## Business Goal

**Problem:** A shell that dies while the user is away (killed by a signal, a crash, a machine reboot) takes its agent conversation with it. Today the terminal manager only marks the session exited and tells the client; nothing brings the shell back, and no agent is resumed. The user has to notice, start a new shell and find the conversation again. Without a way to tell a death that must be undone from one that must not, restoring would also bring back shells the user ended on purpose.

**Proposed solution:** When a shell's process ends unexpectedly, Probe restores it in place (same folder, worktree and branch) as a new shell and, if a mock agent was running with a saved session id, relaunches it with its resume command so the conversation continues. Probe tries automatically, at most 3 times, with no button to press. If all attempts fail, the shell stays listed with its output and shows an error, and the user can remove it. A shell killed through Probe, or one that exited cleanly, is never restored.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 8 Restore and resume after an unexpected end
- **Delivers:**
  - FR-17: the shell process is the tracked one; an unexpected end (death by a signal, or a lost owner such as a crash or reboot) restores a fresh shell in the same folder, worktree and branch, also when the tab was closed (the tab stays closed); a gone folder shows as unavailable (FR-15).
  - FR-18: a restored shell that was running an agent with a saved session id relaunches the agent with its resume command and that id.
  - FR-20: a restore or resume is attempted automatically, at most 3 times; if all fail, the shell stays listed with its output and shows an error, and the user can remove it.
  - FR-19 (part asserted by scenario S8): a shell whose process exits on its own in the normal way with any exit status, or that was killed through Probe, is removed and never restored. The requirement is owned by story 7; this story only has to keep restore from bringing such shells back.
  - FR-23 (part asserted by scenario S8): a shell that failed to restore is removed with the kill action. Owned by story 7; this story only has to show the action on a failed shell.
  - NFR-2 (resume part): a resume attempt starts within 5 seconds of the death being detected or the workspace being reopened (provisional limit, see SU-1).
  - NFR-5: every action in this story (remove) works with the mouse or touchpad alone.
  - NFR-6 (resume part): the server logs every resume attempt with its result.
  - NFR-7: docs updated in the same PR.
- **One deployable outcome:** A user whose shell died unexpectedly finds it back in place and the mock agent continuing the same conversation, or sees the shell listed with an error after 3 automatic attempts and can remove it; this completes the epic goal "a dead agent is resumed" and scenario S8.

## Current Behavior

Verified by reading `/Users/Dzmitry_Lahunouski/dev/probe-org/probe`; the index search was not used.

- **Terminal exit handling (server):** `apps/server/src/terminal/Manager.ts`. When a terminal process exits, the session is set to status `exited` with `exitCode` and `exitSignal` recorded, handles are cleaned up, and an `exited` event is published. Nothing starts a new process afterwards (the process-exit branch of the session event handling).
- **Restart of an exited terminal:** an exited or errored session starts a new process only when a client explicitly opens it again (the open-terminal path that restarts a session in status `exited` or `error`); history is cleared first. This is client-driven, not automatic restore, and it is keyed to a chat thread id and terminal id (the file has about 148 thread-id references, per the epic notes).
- **Close markers:** closing a terminal keeps an in-memory marker so unknown ids "recover after a server restart" (`Manager.ts`, `closedSessionKeys` and the `input.resume` check). The word "resume" in this file refers to reopening a terminal, not to resuming an agent session.
- **Agent resume:** no code found that stores an agent session id or relaunches an agent with a resume command. Not found by reading `apps/server/src`, unverified beyond that.
- **Cause of death:** `exitCode` and `exitSignal` are captured per session, so a non-zero exit and a signal can be told apart from status 0 at the point of exit. A Probe kill is not distinguished from an outside kill (no standalone shell or kill command exists yet; stories 2 and 6). Unverified for the final shape.
- **Survival across server restarts:** history is persisted to log files (`Manager.ts`, history path helpers), but running processes are owned by the server process. Whether they survive a server restart is the subject of A-14 and stories 2 and 7; unverified here.
- **Mock agent CLI, workspace layout, saved session id, automatic restore attempts and the failed-restore error:** do not exist yet; they are delivered by stories 1 to 7 (mock CLI in story 1, shells in story 2, layout in stories 3 and 7). No UI for them exists.
- **Logging:** the manager uses structured Effect logs (for example a warning in `closeIdle`); no resume-attempt log exists.
- **Mobile and desktop:** not required by the epic (NFR-4).

## Expected Behavior

Death is detected on the shell process only. The agent runs inside the shell; if the agent alone exits while the shell stays, nothing is removed or restored.

- An unexpected end (death by a signal, a lost owner such as a crash or machine reboot) is restored in place: a new shell in the same folder, worktree and branch, at the same place in the tree. It is not started through the "+" modal. No earlier output history is restored: a restored shell starts with a new history (history is kept only for shells that were never killed and kept running).
- If a mock agent was running with a saved session id, it is relaunched with its resume command and that id, and shows the same conversation continuing.
- An attempt is the relaunch of the shell, plus the agent resume when an agent with a saved session id was running; a plain restore failing counts the same as a failed resume. The restore or resume is attempted automatically, at most 3 times per death (the count starts fresh at each new death), 2 seconds apart, with no button to press. If all attempts fail, the shell stays in the tree, shows an error message, and the user can view the last output of the dead shell: the output it had shown up to its death, opened from a control on its tree entry. The user removes it with the "x" in the tree (force-kill).
- A shell killed through Probe (the "x" in the tree, or the in-shell kill command; both force-kill) and a shell that exited normally with any exit status (for example `exit` after a failed command) are removed and never restored, also after a restart.
- Restore applies only when the shell's process is actually gone when the death is detected or the workspace is reopened. A process that is still alive after a reload or server restart is reattached by story 7, not restored.
- A shell whose tab was closed before it died is restored and its tab stays closed.
- A restored shell carries a small "restored" marker.
- Each attempt and its result is logged by the server, and an attempt starts within 5 seconds of detection (provisional, SU-1).

### User Flow

1. The user has a running shell with the mock agent mid-conversation. The shell process is killed from outside Probe by a signal.
2. Probe restores the shell in place as a new shell; it stays in the tree under the same folder, worktree and branch.
3. The mock agent is relaunched with its resume command and saved session id, and the user sees the conversation continue.
4. In another run every attempt fails (for example the agent cannot find the session). After the third attempt the tree entry shows an error message and the user can open the last output of the dead shell.
5. The user removes the failed shell with the "x" in the tree; it leaves the tree and the saved layout.
6. The user types `exit` in a shell (with any exit status), or kills one with the "x" in the tree; the shell leaves the tree and does not come back.

### Edge Cases

- **EC-1:** The shell was killed by a signal from outside Probe: it is restored.
- **EC-2:** The shell was lost to a crash (its owner is gone, no normal exit): it is restored.
- **EC-3:** The machine rebooted or the server was restarted and the shell's process is gone (the harness reproduces it as: all server and shell processes gone, then the workspace is reopened; SU-4): the shell is restored in place on reopening the workspace. This supersedes the placeholder "shown as ended" in PRB.T-007 for this case; T-007's placeholder criteria (AC-15, AC-20, AC-29 and EC-5 there) now state the final behavior and point here. A shell whose process is still alive at reopen is not restored; it is reattached (T-007).
- **EC-4:** The tab was closed before the process ended: the shell is restored and the tab stays closed.
- **EC-5:** The shell exited normally with any exit status (for example `exit`): removed, not restored.
- **EC-6:** The shell was killed through Probe (the "x" or the kill command): removed, not restored, also after a restart.
- **EC-7:** The agent alone exited while the shell stays: nothing is removed or restored.
- **EC-8:** The shell had no agent running or no saved session id: it is restored as a new shell with no resume attempt. It carries the small "restored" marker like any restored shell.
- **EC-9:** `exit` typed after a failed command exits non-zero. It is a normal exit, so the shell is removed, not restored.
- **EC-10:** The folder or worktree is gone: the shell is shown as unavailable with the reason (FR-15) and is not restored.
- **EC-11:** A restored shell dies again: that is a new death, so it gets up to 3 fresh attempts.
- **EC-12:** The user removes a shell (the "x") while it waits between attempts: no further attempt starts and no process it started remains.
- **EC-13:** A shell dies in a workspace that is not the shown one: it is restored the same way, and the workspace shows it when opened.
- **EC-14:** A restored shell comes back on the branch the shell was on when it died, also when the user had switched branch inside it.

### Error Handling

- **ER-1:** All 3 automatic attempts fail: the shell stays listed, shows an error message, offers the last output of the dead shell, and no further attempt is made.
- **ER-2:** A shell that failed to restore is removed with the "x"; the force-kill leaves no process it started and removes it from the saved layout.

## Out Of Scope

- Telling a restorable end from a non-restorable one (decision U-7; the rule is decided: a normal exit with any status is intentional, a signal or lost owner is unexpected) and the persistence of the saved layout across server restarts: story 7.
- Shells that survive a server restart as the same running process, scrollback after reload, the unavailable-shell display: story 7 (AC-12 to AC-14 here only assert that restore leaves removed and unavailable shells alone).
- Start shell, kill from the tree, kill command: stories 4 and 6; this story only relies on them.
- A Retry or "Failed to resume" button: not built (user decision); the only manual action on a failed shell is removing it.
- Restoring earlier output history of a killed or dead shell: not done; a restored shell is new.
- A real Claude Code session id, a configurable resume command ("Resume Args"), and recovering sessions not in the workspace: later epics (epic Out of scope).
- Desktop and mobile: not required (NFR-4 note).
- Restoring or resuming subagents: later epic.

## Technical Scope

- **Layers:** server terminal and shell lifecycle (detecting the shell's end, relaunching it, counting attempts), the saved layout (storing session id and shell state, from story 7), the mock agent CLI contract (session id and resume command, from story 1), the browser tree and shell entry (error state, "x"), server logs, and scenario S8 in the harness (`vp run test:scenarios`). Contracts change for any new shell state sent to clients.
- **Docs impact:** `docs/` page describing the terminal-first screen and scenarios gets the restore and resume behavior and the S8 description (NFR-7).
- **Mobile impact:** none required (NFR-4); see SA-4 for the contracts.

## Non-functional Requirements and Constraints

- The first attempt starts within 5 seconds of detecting the death or reopening the workspace; later attempts are measured from their own trigger (NFR-2, provisional, TBD (author, 2026-11-09) to confirm by measuring; SU-1).
- Server logs every resume attempt with its result, with the shell id (NFR-6).
- Pointer-only operation for removing a failed shell (NFR-5); Enter or other shortcuts optional.
- Scenario S8 uses throwaway data and no real model (NFR-3), runs in headless Chromium (NFR-4), and follows the repo test rules: no sleeps, no polling.
- No continuously repainting animation on the new states (NFR-1 rule).

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a running shell with its tab open, when its process is killed from outside Probe by a signal, then a new shell runs in the same folder, worktree and branch, appears in the tree at its previous place, and no "+" modal opens | auto | FR-17, EC-1 |
| AC-2 | Given a running shell, when it is lost to a crash (its owner is gone, no normal exit), then it is restored in place | auto | FR-17, EC-2 |
| AC-3 | Given running shells, when all server and shell processes are gone and the workspace is then reopened, then each shell is restored in place | auto | FR-17, EC-3 |
| AC-4 | Given a shell whose tab is closed, when its process is killed from outside, then it is restored and its tab stays closed | auto | FR-17, EC-4 |
| AC-5 | Given a shell with a mock agent that printed a session id, when the shell is killed from outside, then the agent is relaunched with its resume command and that id and shows the same conversation continuing | auto | FR-18 |
| AC-6 | Given a mock agent running in a shell, when only the agent exits and the shell stays, then nothing is removed or restored | auto | EC-7 |
| AC-7 | Given a shell with no agent running or no saved session id, when its process is killed from outside, then it is restored in the same place and no resume attempt is logged | auto | FR-17, EC-8 |
| AC-8 | Given a restored shell, when its process was killed from outside, then its earlier output history is not shown and only output of the new shell is | auto | FR-17 |
| AC-9 | Given a shell whose resume fails every time, when 3 attempts have failed, then the shell stays listed, shows an error message, and a control on its tree entry opens the output the dead shell had shown before it died, which is displayed | auto | FR-20, ER-1 |
| AC-10 | Given a shell whose resume fails every time, when the 3rd attempt has failed, then its final-failure state is reached and no further attempt-start line is logged for it | auto | FR-20, ER-1 |
| AC-11 | Given a shell that failed to restore, when the user clicks the "x" on it in the tree and confirms, then it leaves the tree and the saved layout and no process it started remains | auto | FR-23, NFR-5, ER-2 |
| AC-12 | Given a running shell, when the user types `exit` and it exits normally, then it is removed and restore does not bring it back | auto | FR-19, EC-5 |
| AC-13 | Given a running shell, when it is killed through Probe with the "x" or with the kill command, then it is removed and restore does not bring it back, also after a server restart | auto | FR-19, EC-6 |
| AC-14 | Given a shell whose folder is gone, when its process dies, then it is shown as unavailable with the reason and not restored (display built in story 7) | auto | FR-15, FR-17, EC-10 |
| AC-15 | Given a death detected or a workspace reopened, when a restore attempt is made, then the log line for the detection (or the workspace reopen) and the log line for the attempt start are at most 5 seconds apart | auto | NFR-2 |
| AC-16 | Given any restore or resume attempt, when it succeeds or fails, then the server log has a line with the shell id and the result | auto | NFR-6 |
| AC-17 | Given a shell restored after the workspace is reopened and a failing resume, when the attempts are made, then the same rules hold as after a live death: up to 3 attempts, then an error | auto | FR-18, FR-20 |
| AC-18 | Given a shell with a failed last command, when the user types `exit` and it exits non-zero, then it is removed and restore does not bring it back | auto | FR-19, EC-9 |
| AC-19 | Given a restore attempt failed, when the next attempt is due, then it starts at least 2 seconds and under 5 seconds after the failure (read from the log timestamps; no sleeping in the test) | auto | FR-20 |
| AC-20 | Given a restored shell that dies again after being restored, when it is detected, then it gets up to 3 new attempts | auto | FR-20, EC-11 |
| AC-21 | Given a restored shell, when the user looks at it in the tree, then a small "restored" marker is shown | auto | FR-17, EC-8 |
| AC-22 | Given a shell waiting between attempts, when the user removes it with the "x" and confirms, then no further attempt-start line is logged for it and no process it started remains | auto | FR-20, EC-12 |
| AC-23 | Given a workspace that is not shown and a shell in it, when its process is killed from outside, then it is restored, and opening the workspace shows it | auto | FR-17, EC-13 |
| AC-24 | Given a shell on which the user switched branch inside it, when its process is killed from outside, then the restored shell is on that branch | auto | FR-17, FR-7, EC-14 |
| AC-25 | Given the change is complete, when the docs diff is reviewed, then the terminal-first docs describe automatic restore, resume, the error after 3 attempts and scenario S8 | manual (reviewer in the PR) | NFR-7 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-001 | Scenario harness and the mock agent CLI with session id and resume command (A-15) | done (2026-11-03); the always-fail resume switch is not built (SA-5) |
| PRB.T-002 | Standalone shells with their own identity | backlog |
| PRB.T-003 | Workspace, tree and the layout that restore writes back into | backlog |
| PRB.T-004 | Start shell, and the server log for starts and ends (NFR-6) | backlog |
| PRB.T-005 | Worktrees and branches that restore must reuse | backlog |
| PRB.T-006 | The "x" force-kill from the tree and the kill command; closed-tab behavior | backlog |
| PRB.T-007 | Hard gate: saved layout, restart survival, the unexpected-end versus clean-exit decision (U-7), unavailable shells, FR-19 and FR-23. This story supersedes T-007's placeholder behavior ("shown as ended") for a shell whose process is gone after a reboot or restart: here it is restored in place; T-007's criteria state this | backlog |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | The mock agent CLI prints a session id and accepts a fixed resume command with it, continuing the same conversation (epic A-15). Built in story 1: `node scripts/mock-agent/mock-agent.ts --resume <id>` prints `Mock Agent v1` and `session: <id>`, replays `> <line>` / `echo: <line>` for each earlier line, then continues; sessions live in `$MOCK_AGENT_HOME` | assumption | verified | Proved by PRB.T-001 (AC-13 to AC-16); re-check at plan time | author |
| SA-2 | Probe can tell, at the moment of death, an unexpected end (death by a signal or a lost owner) from any normal exit (any status) and from a Probe kill (epic U-7) | assumption | unverified | Decided in story 7; the plan must read that decision | author |
| SA-3 | Probe knows that an agent is running in a shell and its session id, without hooks (the mock CLI supplies its own) | assumption | unverified | Decide at plan time with story 1's CLI contract | author |
| SA-4 | Mobile and desktop code still compiles after any contract change here (not required by the epic) | assumption | unverified | Not checked; epic NFR-4 defers it | author |
| SA-5 | The mock agent CLI offers a way to make its resume fail every time (needed for AC-9, AC-10). Not built in story 1: today only an unknown session id fails (`mock-agent: no session <id>`, exit 1, a placeholder). This story owns the unknown-session behavior (T-001 SU-2) and adds the always-fail switch | assumption | unverified | Add to the mock CLI in this story; use `server.restart()` and `server.cli([...])` from the harness handle; the S8 scenario replaces its `pending` entry in `scripts/scenarios/registry.ts` | author |
| SU-1 | Whether 5 seconds for an attempt to start (NFR-2) is the right limit on the author's machine | unknown | unverified | Limit accepted as provisional by the user 2026-11-02; confirm by reading the AC-15 log timestamps over several runs and confirm or change the epic limit | author |
| SU-3 | How the user can tell a restored shell that had no agent was restored | unknown | verified | Decided by the user 2026-11-02: a small "restored" marker on the shell | author |
| SU-4 | Whether the harness can make all server and shell processes disappear and then reopen the workspace (epic A-7) | unknown | unverified | Prove with the restart capability in story 1 and story 7 | author |
| SU-5 | The wording and place of the error shown after 3 failed attempts, and whether it names the cause | unknown | verified | Decided by the user 2026-11-02: an error message plus access to the last output of the dead shell | author |
| SU-6 | Whether the limit of 3 counts per death or per shell lifetime, and the wait between attempts | unknown | verified | Decided by the user 2026-11-02: 3 attempts per death, count fresh at each new death, 2 seconds between attempts | author |
| SU-7 | What output a shell that failed all attempts shows, since earlier history is not restored (output of the attempts only, or the dead shell's last output) | unknown | verified | Decided by the user 2026-11-02: the dead shell's last output can be viewed | author |
| SU-8 | Outcome for `exit` typed after a failed command (EC-9), same as epic U-7 | unknown | verified | Decided by the user 2026-11-02: any normal exit with any status is intentional and removes the shell (AC-18) | author |
