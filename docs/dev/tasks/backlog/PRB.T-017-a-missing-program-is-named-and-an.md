---
id: PRB.T-017
type: story
parent: PRB.E-002
phase: 1
labels: [terminal-first]
created: 2026-11-08
updated: 2026-11-08
---

# A missing program is named and an exiting command keeps the shell

## Business Goal

**Problem:** Once a user can pick any starting script, a typo or an uninstalled CLI becomes common. A start that fails must say what is missing and must not leave a dead shell in the tree. A command that finishes at once (a script that runs and returns) must not take the shell with it, or the user loses the place they just opened.

**Proposed solution:** When the chosen script's program cannot be found on the workspace's server (the machine where the command runs), the modal names that program (and, in the second-server case, that server), and no shell is created. When the command exits, the shell stays open at its prompt and stays in the tree. A program the user's interactive shell on that server can run is never refused.

## Epic and Requirements

- **Epic:** PRB.E-002 Starting scripts: choose what a new shell runs
- **Candidate story:** # 2 Missing program and exiting commands
- **Delivers:**
  - FR-7: the program of the chosen script is checked per start, on the workspace's server (user decision 2026-11-09: that is where the command runs, and a program can be missing on a remote while present on the default server); a missing one is named and leaves no shell; with a second server (AC-15, verified by PRB.E-003 story 8, does not gate this story) the server where it was not found is named too. Which `PATH` is searched, and how aliases, functions, builtins and leading env assignments are treated, follows the result of the U-1 spike in PRB.T-016.
  - FR-8: when the command exits, the shell stays open at its prompt and in the tree. If SA-3 is verified true (it was read in the code on 2026-11-08, see Assumptions), this half ships as test coverage only, with no behavior change.
  - NFR-6 (part): the server logs each start refused for a missing program, with that program (the start log line itself belongs to PRB.T-016).
  - NFR-3 (part): the refusal log carries the script name and the program, never an env assignment or an argument of the command line.
  - NFR-5 (part): the failure is shown, and the retry made, with pointer actions only.
- **One deployable outcome:** A user who picks a script whose program is missing sees which program was not found and gets no shell, and a user whose command exits keeps a usable shell; this makes the per-start choice of PRB.T-016 safe to use with real CLIs such as Claude Code.

## Current Behavior

Verified by reading the code (the code search index was unavailable, so by file reads). The checks below apply to the one server-wide command, not to a per-start choice, in a setup with one server (PRB.E-003 adds others).

- **Missing program, server** (`apps/server/src/terminal/Shells.ts`): `shell.open` with `agent: true` runs `agentProblem` before anything is spawned. It takes the first whitespace-separated word of the configured command (`programOf`, surrounding quotes stripped), and `findProgram` looks for a file with that name in the server process's `PATH` (or `searchPath` option), or resolves a word containing a path separator against the cwd. A leading env assignment such as `FOO=1 claude` is not skipped, so `FOO=1` would be looked up as the program. Aliases, functions and builtins are not considered; only files are found. On failure the message is "The agent command was not found: <program>", `failToStart` logs "shell failed to start" with the cwd and reason, and the open fails with `ShellLaunchError`; no record, saved entry or terminal is created. An unset command gives "No agent command is configured."
- **Missing program, client** (`apps/web/src/components/workspaces/StartShellDialog.tsx`): the failure reaches the modal as an alert (`role="alert"`) in the dialog.
- **Command exits, server** (`Shells.ts`): the command is typed as `<command>\r` into a normal interactive shell after the first prompt mark, so the shell is the tracked process and stays alive when the command ends (`docs/internals/terminal-runtime.md`). A shell that itself exits on its own is removed (`removeExited`); that is not changed here.
- **Tests and scenarios:** `apps/server/src/terminal/Manager.test.ts` ("refuses to start an agent shell when the agent command cannot be found") covers the missing-program refusal with no spawn, no list event and the log line. Scenarios `plus-modal.ts` (AC-16) and `worktrees.ts` restart the server with `PROBE_AGENT_COMMAND=no-such-agent-cli --start` to cover the modal alert, no tree node and the log line. No test was found for a command that exits at once leaving the shell at its prompt (unverified, see SA-3). The mock agent (`scripts/mock-agent/mock-agent.ts`) can exit but is the only command the harness types.
- **Per-start choice:** none yet; the dropdown is disabled (PRB.T-016 delivers it).

## Expected Behavior

Once a script is chosen per start (PRB.T-016), the check and the log apply to that script's command. The check runs on the workspace's server, because that is where the command is typed and run; the script itself comes from the user list on the default server (PRB.T-016). With one server these are the same machine. How the command reaches the workspace's server is epic U-4 (cross-epic: E-003 U-7, SU-4 here), settled by PRB.E-003's story 2; it is not designed in this story and does not gate it.

### User Flow

1. The user opens the "Create shell" modal, picks a script whose program is not available, and clicks start.
2. The modal stays open and shows an alert that names the program that was not found (and, for a workspace on a second server, the server where it was not found).
3. No shell appears in the tree and no shell process is left running.
4. The user picks another script, or Plain shell, and starts normally; the alert is gone or replaced.
5. The user picks a script whose command exits at once and starts. A shell opens in the tree, the command runs and ends, and the shell stays open at its prompt, ready for input.

### Edge Cases

- **EC-1.** A program that is a path (contains a separator) is found or not found relative to the chosen worktree, as today.
- **EC-2.** A command with leading env assignments (`FOO=1 claude`) is checked on the program after the assignments, per the U-1 result.
- **EC-3.** A program that the user's interactive shell can run but the server's `PATH` lacks (an alias, a function, a program on a `PATH` set by startup files) is not refused, per the U-1 result. What exactly counts is TBD (author, 2026-11-15, set by the U-1 spike in PRB.T-016).
- **EC-4.** Plain shell has no command and is never refused.
- **EC-5.** A command that exits non-zero leaves the shell open at its prompt just like one that exits cleanly; the shell is not marked ended.
- **EC-6.** A refused start leaves no saved shell entry: after a server restart the shell list is unchanged.
- **EC-7.** Two scripts may share a name (also within one list; names need not be unique), with different programs. Each start is judged on its own script's program: one may be refused while the other starts. The alert names the program checked; the log line carries the script name.
- **EC-8.** The workspace is on a second server and the program exists only on the default server: the start is refused, and the alert names the program and the second server.
- **EC-9.** The workspace is on a second server and the program exists there but not on the default server: the start is not refused.

### Error Handling

- **ER-1.** Program not found: the alert names the program (the word checked, not the whole command line). With one server the alert names only the program; the server name is required only in the second-server case (AC-15), where it is the name the UI shows for that server; the start does not create a shell; the modal remains usable for another attempt.
- **ER-2.** The workspace's server logs the refusal with the script name, the program and the working folder, and never an env assignment or an argument of the command line (a leading `TOKEN=...` must not leak) (NFR-3). The log level is TBD (user, 2026-11-15); the first draft proposed warning and nothing is decided.
- **ER-3.** If the check itself cannot decide (the U-1 result may allow this; for example the shell's `PATH` cannot be read), the behavior is TBD (user, 2026-11-15); it must not refuse a program the interactive shell can run. It has no acceptance criterion yet: see the note under the Acceptance Criteria table.

## Out Of Scope

- Choosing a script per start, the user list and the remembered choice: PRB.T-016.
- Managing user scripts in Settings: PRB.T-018. Disabling user scripts and workspace scripts: PRB.T-019. Running shells and live updates after a change: PRB.T-020.
- Connecting to other servers and naming them: PRB.E-003; this story only uses the server's name as the UI shows it.
- Running the U-1 spike itself: PRB.T-016 owns it; this story consumes its result.
- Re-running the script on Restore, and detecting that a command failed after the shell started (exit code, "command not found" printed by the shell): later, with agent state (phase 3).
- Validating the command when a script is saved in Settings or the workspace dialog (a save-time hint): only the start is checked here; whether to add a hint is TBD (user, 2026-11-15) and not decided.
- Detecting a failure after the shell started is the late-failure item above; whether to ever do it is TBD (user, 2026-11-15).
- Desktop and mobile UI.

## Technical Scope

- **Layers:** server shell start on the workspace's server (the check and its log), the "Create shell" modal's error display, scenario harness (a missing-program case that no longer relies on the server-wide env var, and a command-that-exits case). Contracts only if the failure needs a field the existing launch error does not carry (SA-4; decided in the plan).
- **Docs impact:** `docs/internals/terminal-runtime.md` (the paragraph on the `agent: true` check and logging, which names `PROBE_AGENT_COMMAND`); the "Starting scripts" section of the user docs gains what "not found" means (NFR-7, shared with the other stories of the epic).
- **Mobile impact:** none beyond compiling if a contract changes.

## Non-functional Requirements and Constraints

- NFR-3: logs carry the script name and program, never an env assignment or an argument of the command line.
- NFR-6: the refused start is logged, by the workspace's server, with the missing program.
- NFR-5: the failure and the retry work with pointer actions alone.
- R-1 of the epic: a working command must not be refused; the U-1 result governs the check.
- The shell, not the command, is the tracked process (as in PRB.E-001); the typed-after-first-prompt behavior of PRB.T-011 stays as it is.
- PRB.E-001's scenarios S1 to S8 stay green.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a script whose program is not available, when the user starts it from the modal, then the modal shows an alert that names that program (with one server, the program only) | auto (scenario E2-S4) | FR-7, ER-1 |
| AC-2 | Given the refused start of AC-1, when the shell tree and the shell list are read, then neither holds a new shell and no shell process was spawned | auto (scenario E2-S4; server test for the process) | FR-7, ER-1 |
| AC-3 | Given the refused start of AC-1, when the server restarts, then the shell list is unchanged | auto (server test) | EC-6 |
| AC-4 | Given the refused start of AC-1, when the user picks Plain shell and starts, then a shell opens normally | auto (scenario E2-S4) | ER-1, EC-4 |
| AC-5 | Given the refused start of AC-1 with a command that begins with an env assignment (`TOKEN=secret missing-cli --flag`), when the server log is read, then it holds a line with the script name, the missing program and the working folder, and no env assignment and no argument of the command line appears in any log line | auto (scenario E2-S4 reads the log) | NFR-6, NFR-3, ER-2 |
| AC-6 | Given a script whose command starts with an env assignment and whose program exists, when it is started, then the start is not refused | auto (server test) | FR-7, EC-2 |
| AC-7 | Given a script whose program is a path inside the chosen worktree, when it is started, then it is found or refused by that path | auto (server test) | EC-1 |
| AC-8 | Given a program that the user's interactive shell can run, as defined by the U-1 result (for example one only on the shell's `PATH`), when it is started, then it is not refused | auto (server test; gated on the U-1 spike result of PRB.T-016 (its AC-15); the exact case is TBD (author, 2026-11-15)) | FR-7, EC-3 |
| AC-9 | Given a script whose command exits at once, when it is started, then a shell is listed in the tree and is still running at its prompt after the command ended | auto (scenario E2-S4) | FR-8 |
| AC-10 | Given the shell of AC-9, when the user types a line, then the shell runs it | auto (scenario E2-S4) | FR-8 |
| AC-11 | Given a command that exits with a non-zero code, when it is started, then the shell stays open and is not shown as ended | auto (server test) | FR-8, EC-5 |
| AC-12 | Given the refusal alert and the retry, when the flow is driven, then it needs only pointer actions | auto (scenario E2-S4 is pointer-driven) | NFR-5 |
| AC-13 | Given the real Claude Code script and one missing program, when the author starts each from the modal, then the missing one is named and Claude Code runs (author sign-off) | manual (author) | FR-7, FR-8, EC-3 |
| AC-14 | Given two scripts with the same name and different programs, one available and one missing, when each is started, then the missing one is refused with an alert naming its program and the other opens a shell | auto (server test) | EC-7 |
| AC-15 | Given the harness has a second server (PRB.E-003) and a workspace of it is open, and a script whose program exists on the default server but not on the second server, when the user starts it, then the alert names the program and the second server, and no shell is created on the second server | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story; PRB.E-003 adds and runs it) | FR-7, EC-8, ER-1 |
| AC-16 | Given the same two servers and a script whose program exists on the second server but not on the default server, when the user starts it in the workspace of the second server, then the start is not refused and the command runs there | auto (second-server check: verified by PRB.E-003 story 8, does not gate this story) | FR-7, EC-9 |

ER-3 and AC-8's exact case are gated on the U-1 spike result (PRB.T-016 AC-15): TBD (author, 2026-11-15). ER-3 has no criterion until U-1 says whether the check can fail to decide; the story is not ready to plan until both are filled.

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-016 | Delivers the per-start choice that this story checks, the start log line, and the U-1 spike result that decides how "not found" is judged (gate before FR-7 is built). Do not plan this story until PRB.T-016 AC-15a to AC-15e are done (the gate for ER-3 and AC-8) | backlog |

PRB.E-003 carries the multi-server connection and is not a blocker: this story works fully with one server, and AC-15 and AC-16 are verified by PRB.E-003 story 8, does not gate this story (PRB.E-003 adds and runs them against its harness second server).

Sequencing: this story can run in parallel with PRB.T-018 (Settings management). PRB.T-019 and PRB.T-020 do not need it.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | The existing "program not found" check can be applied to a per-start command (epic A-5) | assumption | unverified | Plan stage, after the PRB.T-016 plan fixes how the command reaches the server | author |
| SU-1 | The "not found" rule (epic U-1) | unknown | unverified | Settled by the epic's U-1 row (PRB.T-016 spike); must be done before this story is planned | author |
| SA-2 | The refusal reaches the modal as the same alert as today, so no new error display is needed | assumption | unverified | Plan stage: the alert at `StartShellDialog.tsx` shows launch errors today | author |
| SA-3 | A command that exits leaves the shell open today, because the shell, not the command, is tracked (no test was found that proves it) | assumption | verified | Read in `Shells.ts` on 2026-11-08: the command is typed into the shell; only `removeExited` on the shell's own exit removes it. The behavior test is still absent. Plan stage: write the scenario case first; it should pass on `main`. If it fails, FR-8 becomes a change and this note is wrong | author |
| SU-2 | The behavior when the check cannot decide (ER-3) | unknown | unverified | TBD (user, 2026-11-15, decide with the U-1 result) | author |
| SA-4 | The existing launch error carries a program name and a script name, so contracts do not change; if they must, server, web and mobile follow and mobile must still compile | assumption | unverified | Plan stage: read `ShellLaunchError` in `packages/contracts/src/shell.ts` against the message needed | author |
| SU-3 | Refusal log level, save-time hint in Settings, late failure detection: open decisions | unknown | unverified | TBD (user, 2026-11-15) | user |
| SU-4 | How the command reaches the workspace's server for a workspace on another server (epic U-4, cross-epic: E-003 U-7); the check needs it there, and the "not found" rule (SU-1) is judged on that server's shell | unknown | unverified | Settled by PRB.E-003 story 2; AC-15 and AC-16 follow its answer and are verified by PRB.E-003 story 8. Not a gate for this story | PRB.E-003 story 2, 2026-11-15 |
