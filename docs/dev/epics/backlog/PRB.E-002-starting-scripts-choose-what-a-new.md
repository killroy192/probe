---
id: PRB.E-002
type: epic
parent:
phase: 1
labels: [terminal-first, testing]
created: 2026-11-08
updated: 2026-11-08
---

# Starting scripts: choose what a new shell runs

## Goal

A Probe user starts any agent CLI or script on their `PATH` (for example Claude Code) in a new shell by picking a starting script in the "Create shell" modal, and manages those scripts for themselves and per workspace from the UI, without editing env vars, files or restarting the server.

## Why and why now

- Today every shell runs one server-wide command from a server setting (the mock agent in the harness), and the modal's "Starting script" dropdown is disabled with "mock agent" as its only item. A user cannot start Claude Code, a plain shell, or anything else from Probe.
- Phase 2 (agent state from Claude Code hooks) needs real Claude Code running in Probe shells. Without this epic there is nothing for hooks to report on.
- Scope decision 4 in `roadmap.md` (tabs are a terminal or a terminal + script, user-configurable) has no owner; this epic delivers it in the narrowed form decided in the interview (name and command, no env, no folder).
- If skipped: phase 2 is blocked, and the author keeps using plain terminal tabs instead of Probe.

## KPI

| Metric | Kind | Baseline | Target | Measured how and where | By when |
| --- | --- | --- | --- | --- | --- |
| Automated scenarios E2-S1 to E2-S5 (below) passing from a clean shell with one command | primary | 0 of 5 | 5 of 5 | `vp run test:scenarios`, run locally on the author's machine (scenarios are not run in CI, as in PRB.E-001) | when this epic closes |
| Time from the click on the up-arrow button to the first prompt of a **Plain shell** (no script) | guardrail | unknown, measured first in story 1 (the 700 to 780 ms of 2026-11-07 is to the mock agent's banner, not to a plain prompt) | at most 700 ms on the author's machine (user, 2026-11-08); if the story 1 baseline is already above it, the author sets a new target before the next story | Scenario E2-S3 prints the time, as PRB.E-001's S2 does today | every story |

## Users and scenarios

User: the author first, then a small team of peers who run CLI agents.

Vocabulary: a **starting script** is a name and a command line. Starting a shell with it opens an interactive shell in the chosen worktree and, once the shell is ready, types the command; the command's program is found on the shell's `PATH`. **Plain shell** is the built-in entry with no command. **User scripts** are the user's own list, kept in Probe's state folder and available in every workspace. A workspace can **disable** a user script (hide it there; **enable** brings it back) and can **add** its own **workspace scripts**. A workspace cannot edit or rename a user script, and workspace scripts never appear in the user list. These changes are saved in the workspace and apply only there. The modal shows the **merged list** for the current workspace. A script's name defaults to its command's program (the first word after any leading env assignments, whitespace trimmed); the user can type another name. Names and commands may repeat between the user list and a workspace and between workspaces.

1. **E2-S1, user scripts.** As a user, I open Settings > Starting scripts and see "mock agent" in my list (and "Plain shell" as a built-in entry). I add "echo agent" with a command found on `PATH`. In two different workspaces, the "+" modal's Starting script dropdown offers Plain shell, mock agent and echo agent. I pick echo agent and start: the shell opens in the chosen worktree and the command is typed once, after the first prompt, and runs. The next time I open the modal on that project, echo agent is preselected. After a reload and a server restart, my user list is unchanged.
2. **E2-S2, workspace scripts.** As a user, in workspace "sparta" I open its starting scripts from the "Workspaces" menu. I see my user scripts marked as inherited, with no way to edit or rename them. I disable mock agent and add a workspace script "sparta tests" (named from its command, then renamed by me, and later removed). I also add a workspace script whose command is the same as echo agent's. The modal in "sparta" offers Plain shell, echo agent and the workspace scripts, but not mock agent. In another workspace the modal still offers my user list unchanged and none of sparta's scripts, and Settings does not list them. Back in "sparta", I enable mock agent again; the modal matches the user list plus sparta's scripts.
3. **E2-S3, plain shell.** As a user, I pick Plain shell and start: a shell opens at its prompt in the chosen worktree and nothing is typed into it. The time from the click to the prompt is at most 700 ms.
4. **E2-S4, failures.** As a user, I start a script whose program is not on `PATH`: the modal says which program was not found and no shell is left in the tree. I start a script whose command exits at once: the shell stays open at its prompt, listed in the tree.
5. **E2-S5, change after start.** As a user, I have a shell running echo agent, then edit echo agent's command and later remove it. The running shell is untouched and keeps its name. The modal on that project, which remembered echo agent, now preselects Plain shell. When a shell started from a script ends unexpectedly and I click Restore, it comes back as a plain shell; no script is typed. A start that picks a script just removed in another client is refused with a message naming it.

## Scope

**In:**

- Starting scripts made of a name and a command line, run in the worktree chosen in the modal.
- A built-in Plain shell entry, and "mock agent" as the one user script a new install starts with.
- A Settings page to add, edit and remove user scripts.
- A workspace dialog, from the "Workspaces" menu, to disable and enable user scripts for that workspace and to add, edit and remove its own workspace scripts.
- The modal's Starting script dropdown enabled, offering the merged list, with the last choice remembered per project.
- Clear start failures for a program that is not found, with no shell left in the tree.
- The server-wide agent command setting replaced by the per-start choice (the harness seeds its scripts in its temporary state folder).

**Out (non-goals, with a reason):**

- Env vars and a folder per script: user decision 2026-11-08; the command line can set env (`FOO=1 claude`) and the shell starts in the chosen worktree.
- Re-running the script on Restore, and resuming agents: later, with agent state (phase 2); Restore stays as PRB.T-008 built it.
- Per-project scripts kept in the repository (such as `t3.json`): user and workspace levels only for now; team-shared files are a later epic.
- Separate script tabs (a dev server or test runner as its own tab kind next to a shell): one shell per start; a second tab kind is later.
- Several user profiles: there is one user level.
- Editing, renaming or overriding a user script from a workspace: user decision 2026-11-08; a workspace only disables user scripts or adds its own.
- Agent-specific setup (choosing a harness with its own options, an initial prompt): later, with agent state.
- Desktop and mobile UI: browser first (scope decision 2); `mobile-impact`: contracts change, so mobile must still compile, and no mobile UI is built.
- Chat removal: not touched; the Settings page is a new Probe page, not a chat settings page.

## Functional requirements

| ID | Requirement | Priority | Scenario |
| --- | --- | --- | --- |
| FR-1 | A starting script is a name and a command line. Starting a shell with it opens an interactive shell in the worktree chosen in the modal and types the command once, after the shell's first prompt; a shell started with Plain shell gets nothing typed | must | 1, 3 |
| FR-2 | Settings > Starting scripts lists the user scripts and lets the user add, edit (name and command) and remove them. A command is not empty. A name is 1 to 64 characters after trimming; if the user gives none it is the command's program (first word after any env assignments). Names need not be unique: names and commands may repeat, also within one list (decided 2026-11-08). An invalid entry is rejected with a reason. The list survives a reload and a server restart. A damaged saved list is shown as a problem in Settings with an explicit Reset, and the file is left alone until the user resets | must | 1 |
| FR-3 | Plain shell is always offered first and cannot be edited or removed. Where the mock agent can run (dev and the scenario harness; elsewhere per U-2), a state folder with no saved user list (new, or one from before this epic) gets a user list holding "mock agent", which the user can edit or remove like any user script; otherwise the user list starts empty | must | 1, 3 |
| FR-4 | A workspace's starting scripts dialog, opened from the "Workspaces" menu, shows the user scripts marked as inherited and lets the user disable one in this workspace and enable it again; user scripts cannot be edited or renamed there. It also lets the user add, edit and remove workspace scripts (same name and command rules as FR-2). Disabling belongs to the user script, not to its name: renaming the user script keeps it. Changes are saved with the workspace and do not change the user list or any other workspace; workspace scripts never appear in the user list or in Settings | must | 2 |
| FR-5 | The modal's merged list for a workspace is: Plain shell, then the user scripts not disabled in that workspace (user-list order), then its workspace scripts (order added). Names and commands may repeat between the user list and workspaces and between workspaces; entries are told apart by identity, not by name | must | 1, 2 |
| FR-6 | The "Create shell" modal's Starting script dropdown is enabled and offers the merged list. It preselects the script of the project's last start in this workspace (alongside the worktree choice of PRB.E-001 FR-22), following the script through a rename; if that script no longer exists in the merged list, it preselects Plain shell | must | 1, 5 |
| FR-7 | If the program of the chosen script cannot be found, the user sees which program was not found and no shell is left in the tree. The program is the command's first word after any leading env assignments (`FOO=1 claude` checks `claude`). Which `PATH` is searched, and how aliases, functions and builtins are treated, is settled by U-1 in story 1 before this check is built; a program the user's interactive shell can run must not be refused | must | 4 |
| FR-8 | When the script's command exits, the shell stays open at its prompt and stays in the tree (the shell, not the command, is the tracked process, as in PRB.E-001) | must | 4 |
| FR-9 | Editing, disabling or removing a script never changes a running shell: it keeps running and its name is not changed by the edit (the name stays "Shell N · folder · program", with the program running in the shell, as today) | must | 5 |
| FR-10 | Restore on an ended shell (PRB.T-008) starts a plain shell, whatever script the shell was started with | must | 5 |
| FR-11 | Every connected client sees a change to the user list or a workspace's scripts without a reload; when two clients change different scripts both changes survive, and on the same script the last save wins | should | 1, 2 |
| FR-12 | A start that picks a script that was removed or disabled meanwhile (for example by another client) is refused with a message naming the script, and no shell is opened | must | 5 |

## Non-functional requirements

| ID | Quality | Requirement with a measurable limit | Not applicable because |
| --- | --- | --- | --- |
| NFR-1 | Performance | Plain shell: click to first prompt at most 700 ms on the author's machine (KPI guardrail, E2-S3). A script start adds no fixed wait: the command is typed as soon as the first prompt is seen. No continuously repainting animation in the Settings page, dialog or modal (code review). | |
| NFR-2 | Reliability and recovery | A saved list that cannot be read (a damaged state or workspace file) never stops Probe from starting: the modal still offers Plain shell and the problem is shown in Settings (user list) or, for a damaged workspace file, in the message that says why it cannot be opened. A script's command is typed only into the shell started with it, exactly once. | |
| NFR-3 | Security and privacy | Scripts are stored only in Probe's state folder and workspace files, never in a repository. Logs carry the script name and program, never the full command line (it may carry a secret, such as `TOKEN=… claude`). Scenarios use a temporary state folder, never the user's real data. Every user of the app and its workspaces has the same permissions: this epic adds no roles and no permission checks of its own (decided 2026-11-08). | |
| NFR-4 | Compatibility (OS, browsers, agent CLIs, mobile impact) | The command is typed once after the first prompt in zsh and bash (the shells PRB.T-011 wraps); fish is PRB.T-012 and is not a gate here. Claude Code started from a script runs its TUI with working input and resize (manual check). Scenarios run in headless Chromium. Mobile must still compile after the contract change; desktop is not required (scope decision 2). | |
| NFR-5 | Usability and accessibility | Every action (add, edit, remove, disable, enable, pick a script, start) works with the mouse or touchpad alone; Enter is only a shortcut (scope decision 8). Every scenario drives the UI with pointer actions. | |
| NFR-6 | Observability (logs, status, how we tell it broke) | The server logs each shell start with the script name and program (or "plain"), and each start refused for a missing program with that program. | |
| NFR-7 | Maintainability and docs | The user docs gain a short "Starting scripts" section (user list, workspace scripts, Plain shell, what "not found" means); `docs/internals/terminal-runtime.md` is updated where it describes how the agent command is typed. Same PR as the behavior. | |

## Approach

1. Replace the one server-wide command with a per-start choice first, with the user list holding the defaults (Plain shell, mock agent), so the app stays runnable and the harness moves off the env var. Measure the plain-shell guardrail here.
2. Add the Settings page so a user can manage their own list.
3. Add workspace scripts and disabling of user scripts on top of the user list, with their reverse actions.
4. Close the edges: changes after start, the remembered choice falling back, Restore staying plain, and live updates to other clients.

Alternatives considered: several named launch profiles per user (rejected by the user: one user level); per-project files in the repository (later, team sharing); overriding or renaming a user script per workspace (rejected by the user 2026-11-08: a workspace only disables user scripts or adds its own); running the command as the process itself, without a shell around it (rejected: the shell stays when the agent exits, as PRB.E-001 tracks the shell); env and folder fields (rejected by the user).

## Stories (candidates)

| # | Title | Value in one line | Order / depends on |
| --- | --- | --- | --- |
| 1 | Choose a starting script in the modal | Starts with the U-1 spike (gate for FR-7); Plain shell or a user script per start, user list with defaults kept across restarts, remembered choice, harness off the env var, guardrail measured, manual Claude Code check (E2-S3, part of E2-S1) | first |
| 2 | Missing program and exiting commands | A program that is not found is named and leaves no shell; a command that exits leaves the shell at its prompt (E2-S4, FR-7, FR-8) | after 1 (needs the per-start choice and U-1) |
| 3 | Manage user scripts in Settings | The user adds Claude Code without touching files (E2-S1) | after 1 (needs the persisted user list) |
| 4 | Workspace scripts | One workspace hides user scripts or adds its own (E2-S2) | after 3 (reuses the name and command rules of FR-2) |
| 5 | Changes after start and live updates | Running shells untouched, remembered choice falls back, Restore stays plain, all clients in sync (E2-S5, FR-11) | after 4 (live updates cover both lists) |

Stories 2 and 3 do not depend on each other and can run in parallel after story 1.

## Verification

- **Traceability:** every FR and NFR appears in one row.

| Requirement | Verified by | Owner |
| --- | --- | --- |
| FR-1 | Scenarios E2-S1 (typed once after the first prompt, in the chosen worktree) and E2-S3 (nothing typed) | story 1 |
| FR-2 | Scenario E2-S1 (add through Settings; list survives a server restart) | story 3 |
| FR-3 | Scenarios E2-S1 and E2-S3 (Plain shell fixed, mock agent on a fresh state folder) | story 1 |
| FR-4 | Scenario E2-S2 | story 4 |
| FR-5 | Scenario E2-S2 (merged order, other workspace unchanged) and a test of the merge rule, including repeated names and commands | story 4 |
| FR-6 | Scenarios E2-S1 (remembered script) and E2-S5 (fallback to Plain shell) | story 1 and story 5 |
| FR-7 | Scenario E2-S4 | story 2 |
| FR-8 | Scenario E2-S4 | story 2 |
| FR-9 | Scenario E2-S5 | story 5 |
| FR-10 | Scenario E2-S5 | story 5 |
| FR-11 | Scenario E2-S2 with a second browser page open | story 5 |
| FR-12 | Scenario E2-S5 (start from a script removed in a second browser page) | story 5 |
| NFR-1 | Scenario E2-S3 prints and asserts the plain-shell time; animation rule in code review | story 1 (measured), every story (kept) |
| NFR-2 | A test that a damaged saved list still offers Plain shell; scenario E2-S1 checks the command shows once; the problem is shown in Settings and in the message for a workspace that fails to open | story 1, story 3 and story 4 |
| NFR-3 | Code review of the log lines; harness test of the temporary state folder (existing) | each story |
| NFR-4 | Scenarios run in headless Chromium with zsh; the PRB.T-011 shell-ready tests gain a second command for zsh and bash (A-1); the author's manual check with Claude Code; `vp run check:changed` type-checks mobile | story 1 and story 3 |
| NFR-5 | Scenarios E2-S1 to E2-S5 (pointer-driven) | each story |
| NFR-6 | Scenarios E2-S1 and E2-S4 read the server log lines | story 1 and story 2 |
| NFR-7 | Docs diff reviewed in the PR | each story |

- **KPI measurement:** run `vp run test:scenarios` from a clean shell; count passing E2-S1 to E2-S5; read the plain-shell time E2-S3 prints.
- **Automated scenarios** (the scenario harness from PRB.E-001): E2-S1 to E2-S5.
- **Manual checks:** the author adds a "Claude Code" script (`claude`) in Settings, starts it in a worktree from the modal, works in it (input, resize, exit back to the prompt), and disables it in one workspace.
- **Sign-off:** the author.

## Dependencies and sequencing

- Phase 1 of `roadmap.md` (the "Next" item: configurable launch command and script tabs). Builds on PRB.E-001: the "Create shell" modal, the workspace file and its remembered last start, Restore (PRB.T-008) and typing after the first prompt (PRB.T-011).
- PRB.E-001 should close first (it is still in progress).
- PRB.T-012 (fish) and PRB.T-014 (mobile replay of terminal text) are independent; fish users still see the command twice until T-012 lands.
- Blocks phase 2 (agent state and agents sidebar): real Claude Code runs in Probe only after this epic.

## Risks

| ID | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R-1 | The "not found" check sees a different `PATH` than the shell after its startup files ran (agents installed through nvm, `~/.local/bin` and similar), so a working command is refused, or an alias or function defined in the user's rc files is refused | high / high | Settle U-1 in story 1 before building the check; a refused start names the program, so the cause is visible |
| R-2 | A user script disabled in one workspace quietly goes missing there and the user does not see why | medium / medium | FR-4: the dialog shows inherited and disabled entries, each with its reverse action |
| R-3 | A real agent TUI (Claude Code) behaves differently from the mock agent once typed into a shell (raw mode, resize, a first-run prompt) | medium / high | The manual check with Claude Code in story 1 (A-2) |
| R-4 | Moving the harness off the env var breaks PRB.E-001's scenarios S1 to S8 | medium / medium | Story 1 keeps S1 to S8 green as part of its done check, and every later story re-runs them |

## Assumptions and unknowns

| ID | Statement | Kind | Status | How and when to verify | Owner | Affects |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | Typing after the first prompt (PRB.T-011) works for any command line, not only the mock agent | assumption | unverified | Story 1: a scenario that seeds a second script in its temporary state folder and starts it; PRB.T-011 tests cover zsh and bash with the mock agent only | author | FR-1, NFR-4 |
| A-2 | Claude Code typed into a ready Probe shell starts and works like in a plain terminal (input, resize, exit back to the prompt) | assumption | unverified | Story 1: the author's manual check | author | Goal, NFR-4, phase 2 |
| A-3 | The workspace file can carry the workspace's disabled user scripts and workspace scripts next to its layout | assumption | unverified | Story 4 plan (cheap: the workspace file is Probe's own format, PRB.T-003, PRB.T-007) | author | FR-4 |
| A-4 | Settings has room for a new Probe page while chat-only settings pages stay hidden (PRB.T-003) | assumption | unverified | Story 3 plan (cheap: a look at the Settings routes) | author | FR-2 |
| A-5 | The existing "program not found" check (today run for the server-wide command) can be applied per start | assumption | unverified | Story 2; it depends on U-1 | author | FR-7 |
| U-1 | Which `PATH` decides "not found": the server's, or the shell's after its startup files; and what happens to a command whose first word is an alias, a function, an env assignment (`FOO=1 claude`) or a builtin | unknown | unverified | Story 1 spike, a gate before FR-7 is built | author | FR-7, R-1 |
| U-2 | Whether "mock agent" can be a default user script outside the repository (it runs a script from this repo's `scripts/`), or only in dev and the harness | unknown | unverified | Story 1 plan | author | FR-3 |
| U-3 | The plain-shell click-to-prompt time today | unknown | unverified | Story 1: measured in E2-S3 before changes | author | KPI guardrail, NFR-1 |

## Open questions

None.

## Notes for stories

- Today: `PROBE_AGENT_COMMAND` (`apps/server/src/cli/config.ts`) feeds `agentCommand` in `apps/server/src/terminal/Shells.ts`, which checks the program with `agentProblem`/`findProgram` and types `<command>\r` after the shell-ready mark (`apps/server/src/terminal/shellReady.ts`). The harness sets the env var in `scripts/scenarios/server.ts`. The modal's dropdown is `STARTING_SCRIPT` in `apps/web/src/components/workspaces/StartShellDialog.tsx`; the remembered start is `WorkspaceLastStart` in `packages/contracts/src/workspace.ts`.
- T3's project scripts (`ProjectScript` in `packages/contracts/src/project.ts`, `t3.json` actions) belong to the chat-era project model; do not reuse them for this epic's storage.
- Shell readiness waits up to 15 seconds for the prompt mark before typing anyway (`docs/internals/terminal-runtime.md`).

## Done when

- [ ] The scenario command shows E2-S1 to E2-S5 passing from a clean shell, and PRB.E-001's S1 to S8 still pass.
- [ ] E2-S3's plain-shell time is at most the guardrail target on the author's machine (700 ms unless reset after story 1).
- [ ] The author starts Claude Code from a starting script and signs off.
- [ ] The user docs describe starting scripts.
