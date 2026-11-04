---
id: PRB.T-002
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, plan, implement, verify]
created: 2026-11-02
updated: 2026-11-04
---

# Standalone shells without chat threads or tabs

## Business Goal

**Problem:** Today a terminal only exists inside a chat thread: the server keys every terminal by a thread id and the web app shows it in a drawer under a chat. Every later story of the epic (workspace, shell tree, "+" modal, restart survival) needs a shell that exists on its own, but nobody yet knows how much of the terminal code depends on a chat thread, or whether shells can outlive a browser reload or a server restart.

**Proposed solution:** Open with a spike that answers how a shell is identified without a thread (U-1) and checks A-2, A-6 and A-14. Then make a shell a thing that exists and keeps running without a chat thread and without any open tab, so stories 3 to 8 can build the workspace screen, tree, start flow and restore on top of it.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 2 Standalone shells (large story with subtasks); this is one large story with subtasks, as decided by the user; the epic is not re-planned.
- **Delivers:** The epic's verification table assigns no FR or NFR to story 2 as owner. This story delivers the capability that later stories verify, and resolves U-1:
  - U-1: how a standalone shell is identified, answered by the spike.
  - A-2, A-6, A-14: checked by the spike and their status updated; R-6 is sized from the result (story 7 is sized from it).
  - Capability only (verified in the owning stories, not here): FR-6 (no chat thread), FR-7 (shell list), FR-8 (input, output, resize), FR-9 (several at once), FR-10 (closing a view does not end the shell), FR-11 (a shell can be ended), FR-14 (output history after reload).
  - NFR-5 (every new control usable with the mouse or touchpad) and NFR-7 (docs in the same PR), which the table assigns to each story.
- **One deployable outcome:** After this ships, the server and the web client can start, list, use, detach from and end a shell that has no chat thread and is not tied to an open tab, while existing chat-thread terminals keep working, and the spike's findings tell the author whether the epic's restart-survival plan (story 7) holds. Accepted as an enabling story by the epic and the user's decision (SU-6 asks only the user to confirm). This contributes to the epic goal by removing the chat dependency that every later story would otherwise inherit.

## Current Behavior

Read from `/Users/Dzmitry_Lahunouski/dev/probe-org/probe` at commit 65e00bd57; nothing was run. Items not read from code are marked unverified.

**Server**
- `apps/server/src/terminal/Manager.ts` (3,460 lines) owns terminal sessions. Sessions are keyed by thread id plus terminal id (`toSessionKey`, about line 1310); `threadId` appears on 148 lines of the file. Per-thread locks, history file names and close markers are also derived from the thread id.
- The terminal RPCs (`terminal.open`, `attach`, `observe`, `write`, `resize`, `clear`, `close`) are defined in `packages/contracts/src/rpc.ts` and `packages/contracts/src/terminal.ts`; every input carries `threadId`, and terminal ids are chosen by the client (comment in `terminal.ts`). The handlers in `apps/server/src/ws.ts` (about lines 3001 to 3019) pass the input straight to the manager. In the code read, the terminal path does not look up a chat thread in the orchestration projections; the thread id is treated as an opaque string (unverified by running).
- `terminal.subscribeTerminalMetadata` (`ws.ts`, about line 3016) streams a list of terminal summaries (thread id, terminal id, cwd, worktree path, status, pid, exit code or signal, label) to clients.
- The shell program is spawned through `NodePtyAdapter.ts` and `agentScope.wrap` with `survivesRestart: true` (`Manager.ts` about line 2365). In `apps/server/src/process/agentScope.ts` that flag selects a different systemd slice and only has an effect where systemd is available (it returns the command unchanged when it is not). Whether this keeps a shell alive across a server restart is unverified.
- A finalizer in `Manager.ts` (about lines 2796 to 2822; read, not run) ends every session's process when the manager is closed, so today a server shutdown ends all shells. Output history is persisted to files in the logs directory (persist worker, `Manager.ts` about lines 1900 to 2070); closed-session markers are kept in memory only (comment about line 1624).
- History limits: default 5,000 lines and 8 MiB (`Manager.ts` lines 92 and 93); `DEFAULT_MAX_TERMINAL_BUFFER_BYTES` is 512 KiB in `terminal.ts`.
- Worktree creation exists as `GitWorkflowService.createWorktree` (`apps/server/src/git/GitWorkflowService.ts`, about line 412) on top of `GitVcsDriver.createWorktree` (`apps/server/src/vcs/GitVcsDriver.ts`, about line 357). It is called from the chat orchestration (`orchestration-v2/ThreadLaunchService.ts`), from an RPC in `ws.ts` (about line 2990) and from `mcp/WorktreeMcpService.ts`, so it is reachable without a chat turn. Reuse for this epic is unverified.

**Web client**
- The terminal view is `apps/web/src/components/ThreadTerminalDrawer.tsx`, mounted per thread by `PersistentThreadTerminals.tsx` and `chat/ChatTerminalDrawers.tsx`, which are used from `ChatView.tsx` and `chat/RightPanelSurfaceContent.tsx`.
- Client state for known sessions is in `apps/web/src/state/terminalSessions.ts` and `state/terminal.ts`, grouped by thread id; per-thread drawer UI state is in `terminalUiStateStore`. The terminal attach input has a `resume` option meant for re-subscribing after a drop (`terminal.ts`: "Resubscriptions preserve stopped terminals; unknown IDs recover after a server restart").
- Whether a running shell keeps running and shows its history after a browser reload today is unverified (A-6).

**Mobile / desktop:** not examined; out of the epic (NFR-4 note).

## Expected Behavior

Once the work is complete, a shell is a server-side thing with its own identity, folder, status and output history. It does not need a chat thread to exist, and it keeps running when no tab or browser is showing it. A client can start one, see it in a list of shells, attach to it, type into it, resize it, detach, attach again and see its history, and end it. Terminals that belong to chat threads keep working exactly as before; hiding them is story 3. There is no new workspace screen, tree or "+" modal here (stories 3 to 5), so a standalone shell has no user-reachable way to be started or found in this story. The harness (or the author) has a way to start one and a way to open the existing terminal view on it by identity; the mechanism is decided in the plan stage (SU-7). Real user entry points arrive in stories 3 to 5. A running standalone shell very likely survives a browser reload, since it runs on the server; the spike checks this, and if it does not, making it survive is built in this story (subtask 8).

The spike result is written down before the rest is planned: how a shell is identified (U-1), whether worktree creation can be reused as is (A-2), whether a running shell survives a browser reload (A-6), and whether shells can keep running while the server restarts and be reattached (A-14), with a statement of how large story 7 is as a result (R-6).

### User Flow

1. The author runs the spike and records findings for U-1, A-2, A-6 and A-14 and the size of story 7.
2. A client starts a shell in a folder, with no chat thread in the environment.
3. The shell appears in the list of shells that clients receive, with its identity, folder and status.
4. The harness (or the author) opens the shell by identity in the existing terminal view, then the user types a line and sees the output, and resizes the view and the terminal size follows.
5. The user closes the view, or reloads the browser. The shell keeps running.
6. The user opens the shell again and sees its earlier output.
7. The user ends the shell. Its process ends and it leaves the list.

### Edge Cases

- EC-1: A chat thread that has its own terminals still opens, shows and ends them as before while standalone shells exist.
- EC-2: Two standalone shells in the same folder have separate output and separate lifetimes.
- EC-3: A shell with no client attached keeps running and keeps collecting output history.
- EC-4: A shell whose process ended on its own is listed as ended with its exit code or signal, and is not silently shown as running. (Restoring it is story 8; removal of a clean exit, FR-19, is story 7 or 8. AC-8 covers only that the ended state is visible.)
- EC-5: The behavior of a standalone shell when the server restarts is whatever the spike found (A-14); the manager ends every shell when the server stops, and this story keeps that behavior. It records whether and how shells could outlive a server stop (user decision: the spike only records; building it is story 7) and handles no orphan processes (AC-14).

### Error Handling

- ER-1: Starting a shell in a folder that does not exist or is not a directory fails with a reason the client can show, and no shell is listed.
- ER-2: Attaching to, writing to or resizing a shell that does not exist returns an error for that request and does not affect other shells.
- ER-3: If the shell program cannot be launched, the shell is reported as failed with a reason, not as running.
- ER-4: An invalid size (outside the existing column and row limits) is rejected and the shell keeps its previous size.

## Out Of Scope

- Workspaces, the start screen and the shell tree: story 3.
- The "+" modal and starting a local shell as a user action: story 4. Worktrees, existing or new: story 5.
- Multiple-shell UI, close-tab control, kill from the tree, the in-shell kill command and rename: story 6. Ending a shell here means only the server operation.
- Output history that survives a restart, the saved layout, and making shells survive a server restart (build): story 7. This story only records feasibility (A-14, U-1), it builds nothing for survival.
- Restore and resume after an unexpected end: story 8.
- Hiding chat entry points and deleting chat or orchestration code: story 3 and a later epic.
- Desktop and mobile: not required (epic decision, 2026-11-02).
- The mock agent CLI and scenario harness: story 1 (this story's automated checks use them).

## Technical Scope

The story is large; it is a spike followed by these subtasks, each an outcome:

1. **Spike report.** Written findings for U-1, A-2, A-6, A-14, with evidence, plus a size statement for story 7 (R-6). If the finding says story 7 is too big, the epic is re-planned with the user, as the epic says.
2. **Thread-free shell on the server.** A shell can be started, attached, written to, resized, ended and listed without a chat thread, with its output history kept.
3. **Shell list for clients.** Clients receive shells (identity, folder, status) independently of any thread grouping.
4. **Thread-free terminal view in the web client.** The existing terminal view can show a shell that has no thread, and closing the view or reloading does not end it.
5. **Existing thread terminals unchanged.** No regression for chat terminals (EC-1).
6. **Scenario coverage.** Automated checks for the above run through the story 1 harness.
7. **Docs.** The shell concept (a shell exists without a chat thread) is documented where the terminal is described.
8. **Reload survival (only if the spike finds A-6 false).** A running shell stays running and shows its history after a browser reload (AC-5). Skipped when A-6 holds.

- **Layers:** server terminal service and RPC handlers; contracts (`packages/contracts/src/terminal.ts`, `rpc.ts`) if the wire shape changes; web terminal view and its session state; the scenario harness (story 1).
- **Docs impact:** pages under `probe/docs/` that describe terminals or the thread drawer. Exact pages TBD (author, 2026-11-09), found while working (SU-4).
- **Mobile impact:** none required (epic NFR-4). Contract changes must not break the mobile or desktop packages' type checks if CI builds them; unverified (SU-5).

## Non-functional Requirements and Constraints

- Server work follows the repo rules in `probe/AGENTS.md` and `docs/internals/effect-services.md`: server features are services and transports stay thin; wire types live in `packages/contracts`.
- NFR-5: any control this story adds (none is planned; entry points arrive in stories 3 to 6) or changes can be used with the mouse or touchpad; shortcuts are optional.
- NFR-7: docs change in the same PR as the behavior.
- NFR-3: the automated checks use a throwaway data directory and never touch `~/.t3`.
- AGENTS.md performance rule: no continuously repainting animation and no extra data over the websocket beyond what the shell list and output stream need (review-only, no AC).
- The spike must not start a server against the developer's live data (AGENTS.md rule 2) and must stop only processes it started.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given an environment with no chat thread, when a client starts a shell in an existing folder, then the shell is running and no chat thread has been created | auto | FR-6 (capability), U-1 |
| AC-2 | Given a running standalone shell, when a client writes a line and later resizes to a new size, then the line is echoed in the output and the shell reports the new size | auto | FR-8 (capability) |
| AC-3 | Given a running standalone shell, when a client asks for the list of shells, then the shell is listed with its identity, folder and status, without being grouped under a chat thread | auto | FR-7 (capability), FR-6 (capability) |
| AC-4 | Given a running standalone shell with a client attached, when the client detaches and later attaches again, then the shell is still running and the output produced meanwhile and before is shown | auto | FR-10 (capability), EC-3 |
| AC-5 | Given a running standalone shell with output, when the browser page is reloaded with the server still running, then the shell is still running and its earlier output is shown again; if the spike finds A-6 false, the survival on reload is built in this story | auto | FR-14 (capability), A-6 |
| AC-6 | Given two standalone shells in the same folder, when each gets different input, then each keeps only its own output and ending one leaves the other running | auto | FR-9 (capability), EC-2 |
| AC-7 | Given a running standalone shell, when a client ends it, then its process is gone and it is removed from the list (a shell that exits on its own is AC-8) | auto | FR-11 (capability) |
| AC-8 | Given a standalone shell whose process exits on its own, when a client lists shells, then it shows as ended with its exit code or signal and not as running | auto | EC-4 |
| AC-9 | Given a chat thread that has terminals and a standalone shell, when the thread terminals are opened, used and closed, then they behave as before and the standalone shell is unaffected | auto | EC-1 |
| AC-10 | Given a folder path that does not exist or is a file, when a client starts a shell there, then the request fails with a readable reason and no shell is listed | auto | ER-1 |
| AC-11 | Given a shell id that does not exist, when a client attaches, writes or resizes, then that request fails with an error and other shells keep running | auto | ER-2 |
| AC-12 | Given a shell program that cannot be launched, when a client starts a shell, then the shell is reported as failed with a reason and not as running | auto | ER-3 |
| AC-13 | Given a running shell, when a client sends a size outside the allowed limits, then the request is rejected and the shell keeps its previous size | auto | ER-4 |
| AC-14 | Given the finished spike, when the author reads its findings in the place chosen under SU-2 (maps to the epic's unknowns and assumptions, not to FR/NFR), then U-1, A-2, A-6 and A-14 each have a status, evidence and, for A-14, a statement of how large story 7 is (R-6) | manual (author) | U-1, A-2, A-6, A-14, R-6, EC-5 |
| AC-15 | Given a standalone shell open in the existing terminal view in a browser, when the user closes the view with the existing close control by pointer and the view is opened again by identity, then the shell shows its earlier output and every existing control used was reachable by pointer; NFR-5 for the new entry points is verified in stories 3 to 6 | manual (author) | FR-10 (capability), NFR-5 |
| AC-16 | Given a standalone shell with output and a pane resized in the browser, when the pane size changes, then the terminal size matches the pane | auto (browser) | FR-8 (capability) |
| AC-17 | Given standalone shells exist, when the existing chat drawer lists its thread's terminals, then thread-less shells do not appear in it and it works as before | auto | EC-1 |
| AC-18 | Given the PR for this story, when the docs diff is reviewed, then the docs describe a shell that exists without a chat thread | manual (author) | NFR-7 |

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-001 | The scenario harness and mock agent CLI run the automated checks through `vp run test:scenarios` (scenario command, per the epic). AC-1 to AC-13, AC-16 and AC-17 are accepted through it (the browser ones also depend on SU-7) | done (2026-11-03). Handle: `server.restart()`, `server.cli([...])`, `openPage()` (pointer-only `PointerPage`), `pairingUrl()`; a scenario replaces its `pending` entry in `scripts/scenarios/registry.ts`. Server-level tests first is no longer needed |

Stories 3 to 8 depend on this one (epic order).

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | The terminal RPCs and manager treat the thread id as an opaque string and never need the thread to exist in orchestration (read from code, not run) | assumption | verified | First step of the spike: start a terminal for a made-up thread id in a throwaway environment | author |
| SA-2 | Existing chat-thread terminals can stay in place and work while standalone shells are added (chat is hidden in story 3, not removed) | assumption | verified | Spike plus the AC-9 test (`Manager.test.ts`, "leaves a shell running while a thread's terminals open, run and close") | author |
| SA-3 | A-2 (epic): worktree creation can be reused without a chat. Seen called from `ws.ts` and `WorktreeMcpService.ts` | assumption | verified | Spike: call it without a thread | author |
| SA-4 | A-6 (epic): a running shell survives a browser reload. Very likely true: shells run on the server, not in the browser (user, 2026-11-02). If the spike finds it false, the fix is built in this story. | assumption | verified | Spike and AC-5 | author |
| SA-5 | A-14 (epic): shells can keep running while the server restarts and the new server can reattach. Today a finalizer ends them on manager close (read, not run) and the `survivesRestart` flag depends on systemd (unverified on macOS, the author's machine) | assumption | false | Spike on the author's machine; result decides the size of story 7 (R-6) | author |
| SU-1 | U-1 (epic): how a standalone shell is identified without a thread | unknown | verified (see spike note) | Spike; the answer is the output of subtask 1 | author |
| SU-2 | Where the spike findings are recorded. Default: a note in `research/` (vault), linked from this story. Fallback: a section at the end of this story if the author prefers | unknown | verified | Defaulted 2026-11-02 to avoid blocking; the author may move it | author |
| SU-3 | Must this story prevent orphan shell processes after a server restart (EC-5)? Closed: no, the spike only records; orphan handling belongs to story 7 | unknown | verified | Decided by the user (epic update) | author |
| SU-4 | Which `probe/docs/` pages describe terminals and the drawer | unknown | verified | Pages are `docs/internals/terminal-runtime.md` and `docs/internals/glossary.md`; `docs/user/terminal.md` covers history only and gets no shell section until a user can start one (story 3+) | author |
| SU-5 | Whether CI type-checks desktop or mobile against contract changes | unknown | verified | `vp run check:changed` typechecks every dependent package (36, including `apps/mobile` and `apps/desktop`); green on 2026-11-04 | author |
| SU-6 | Whether a story with no new screen counts as a shippable outcome. Default: yes, as an enabling story (the user accepted one large story with subtasks). Fallback: if the user objects at review, fold this story into story 3 | unknown | verified | Defaulted 2026-11-02; confirmed or reversed at the user's review of this story | author |
| SU-7 | How the existing terminal view is pointed at a standalone shell before the tree exists; affects AC-5 and AC-15. Default: a direct address that carries the shell id. Fallback: a test-only hook if an address needs a product route this story should not add | unknown | verified | Default kept: route `/shell/$environmentId/$shellId` (`apps/web/src/routes/_chat.shell.$environmentId.$shellId.tsx`), no nav entry | author |

## Implementation Status and Handoff

Branch `feat/standalone-shells-prb-t-002`. Spike findings: `docs/dev/research/t-002-standalone-shell-spike.md`. The working plan is `.plans/PRB.T-002-standalone-shells.md` (gitignored, local); this section is enough to continue without it.

**Decisions**
- Identity (U-1): separate `shell.*` RPCs, a server-allocated shell id, and a `shell:<id>` owner id used as the `threadId` key inside the terminal manager (`packages/contracts/src/shell.ts`). Chosen over a tagged `kind` and over an optional `threadId` because the latter ripples into mobile, MCP and storage cleanup.
- The shell list (`subscribeShells`) carries `ShellSummary` with no thread id. `shell.attach` reuses `TerminalAttachStreamEvent`, so those events still carry the `shell:<id>` owner in `threadId`.
- The thread terminal list (`subscribeTerminalMetadata`) filters shells out (`Shells.withoutShells`), which covers AC-17.
- Story 7 scope is still open (A-14 is false): a restart-surviving process host versus saved history plus a fresh shell. Ask the user before planning story 7.

**Done (checkpoints 0 to 3)**
- Spike: U-1, A-2, A-6 verified; A-14 false.
- `packages/contracts/src/shell.ts` and the six `shell.*` / `subscribeShells` methods in `rpc.ts`.
- `apps/server/src/terminal/Shells.ts` over `TerminalManager`, plus `TerminalManager.has` (the manager ignores a resize for an unknown session, so `Shells.resize` checks `has` first for AC-11).
- ws handlers, auth scopes (`RpcAuthorization.ts`) and `RpcInstrumentation.ts` entries.
- Tests: `contracts/src/shell.test.ts`, the `Shells` block in `terminal/Manager.test.ts`, extended `RpcAuthorization.test.ts`.

**Done (checkpoints 4, 5 and 7)**
- Client runtime: `createShellEnvironmentAtoms` (list, attach, open, write, resize, close) in `packages/client-runtime/src/state/terminal.ts`, `applyShellListStreamEvent` reducer with a test row in `terminalSession.test.ts`.
- Web: `apps/web/src/state/shells.ts`, `ShellView.tsx` and the shell route. `TerminalViewport` takes an optional `shellId` and then attaches, writes and resizes through `shell.*` (links open in the browser, since the preview panel needs a thread). Shells need operate scope to view; there is no read-only observe for them. AC-17 needs no web change: the server already filters shells out of the thread list.
- No web browser test: the viewport mounts the Ghostty WASM surface, so the end-to-end check is the scenario.
- Scenario `T-002` passes in headless Chromium (`vp run test:scenarios --rebuild`: S1 plus story checks 1/1; `--selftest` and `harness.test.ts` green). It waits for the page's first grid before reading `stty size`, since the surface reports its size only after attaching. Scenario `T-002` lives in `scripts/scenarios/scenarios/standalone-shell.ts`, registered in `storyScenarios` (runs after S1 to S8, reported as "story checks", not counted in the epic's out-of-8 KPI). It drives the server through `scripts/scenarios/rpc.ts` (WS RPC client signed in with the page's cookie) and reads what the page receives from its websocket frames. Covers AC-1, AC-3, AC-5, AC-7, AC-16, the automated half of AC-15, and A-14 (restart ends shells).
- Docs: shells section in `docs/internals/terminal-runtime.md`, glossary entry.
- After the first verify run: `shell.open` fails with `ShellLaunchError` (the manager's readable reason) when the program cannot start, and the failed shell is closed so it is never listed (AC-12). `terminal.*` inputs reject `shell:` owner ids at the contract (`TerminalThreadInput`), so a thread request cannot create, reopen or close a shell. New `Shells` tests cover AC-9 (thread terminals opened, written and closed leave the shell running), AC-10 (missing folder and a file, with reasons, nothing listed) and AC-11 (the other shell's live status). Decision (user, 2026-11-04): the AGENTS.md and `.gitignore` policy edits stay in this PR; making `Shells` a server service is left to a later story.
- `vp run check:changed` green.

- AC-15 manual pass (author, 2026-11-04): a shell opened on the dev server showed its earlier output at `/shell/$environmentId/$shellId`; after leaving the page by pointer and reopening the same address, the output was still there and the prompt was live.
- `verify-story-implementation` (second run, 2026-11-04): every gate 2 except specification and evidence (1, both only for AC-15, now done); AC-1 to AC-14 and AC-16 to AC-18 met.

**Not done**
- Nothing for this story. Story 7 scope (A-14 false) still needs the user's choice before it is planned.

**Known gaps**
- Bad-size rejection (AC-13) is covered by the contract schema test only.
- No ws-level test: `ws.test.ts` mocks the manager and has no terminal cases.

**Environment**
- Run `nvm use`, then `vp` from `node_modules/.bin` (no global `vp`).
- Local port binds are blocked in the Claude sandbox; the scenario harness and any server run need `sandbox.network.allowLocalBinding: true` or an unsandboxed run.
- The pre-commit hook runs format, lint and knip; an unused export fails the commit.
