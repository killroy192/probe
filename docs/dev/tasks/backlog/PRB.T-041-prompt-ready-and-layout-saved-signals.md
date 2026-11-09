---
id: PRB.T-041
type: story
parent: PRB.E-005
phase: 1
labels: [testing, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Prompt-ready and layout-saved signals so scenarios stop guessing

## Business Goal

**Problem:** Scenarios type into a terminal as soon as a tab is clicked, with no wait for the terminal to be attached or for the shell to reach its first prompt, so a line can be typed before the shell can read it. They reload the page right after a tab change while the layout save may still be in flight, so the tab strip can come back stale (the suspected S4 flake). They decide that a shell process has ended by polling `kill(pid, 0)` every 100 ms for up to 5 s. Each guess is a source of flakes that parallel load makes worse, and the repo's own test rules forbid the polling.

**Proposed solution:** The app tells the truth about three facts it already has, and the scenarios wait on them. The page shows when a shell's terminal is attached and the shell has printed its first prompt, and when the shown workspace's layout has been saved. For a shell process the server owns, a scenario waits on the shell list's event (ended, or removed after a kill) and makes one process check, instead of polling. The signals are small: one state change per shell and per layout save, no new stream, no repaint.

## Epic and Requirements

- **Epic:** PRB.E-005 Fast, deterministic scenario tests
- **Candidate story:** # 6 PRB.T-041 Prompt-ready and layout-saved signals (phase 5 of the analysis; needs the user's OK for production code, given 2026-11-09)
- **Delivers:**
  - FR-12: tests wait on a terminal-attached-and-prompt-ready state and a layout-saved state exposed by the app, never type or reload on a guess; `gone()` polling is replaced by the shell's ended event plus one process check where the server owns the pid.
  - NFR-1 (the signal half): no continuous repaint and no extra websocket traffic beyond one small state change per terminal or layout save; the terminal output stream is unchanged.
  - NFR-4: mobile still compiles after the signal contract change; Linux and macOS; zsh and bash.
  - NFR-5: scenarios stay pointer-only.
- **One unit:** The three signals (prompt ready, layout saved, process end) ship as one story because the PRB.T-040 flake-free claim needs all three.
- **One deployable outcome:** A scenario (or a user of the page's state) can tell that a terminal is attached and its shell is at a prompt, and that the layout is saved, without guessing, and the scenarios use those facts. This is what lets PRB.T-040 claim a flake-free parallel run (epic R-4).

## Current Behavior

Read on 2026-11-09 (code search index unavailable); the scenario edits of PRB.T-036 to PRB.T-040 had not landed.

- **Server: first prompt.** A shell started in zsh or bash through the wrapper startup files prints the OSC 133;B input-start mark (`apps/server/src/terminal/shellReady.ts:8-11`, scanner at `shellReady.ts:20-37`). `Shells.open` scans for it only when a starting script was chosen: the output queue exists only then (`apps/server/src/terminal/Shells.ts:872`), `waitForPromptMark` waits for the first mark or a timeout (`Shells.ts:929-946`, `shellReady.ts:136-155`) and types the script. For a plain shell nothing scans, so the server does not know whether the first prompt has appeared (epic A-3 is false for plain shells). `Manager.printsPromptMark` only says whether the process is wrapped (`apps/server/src/terminal/Manager.ts:3746-3755`). Input to a script shell is held until the script is typed (`Shells.ts` `write`, around line 963).
- **Contract.** `ShellSummary` (`packages/contracts/src/shell.ts:55-86`) has no prompt or attach field. The list stream sends `snapshot`, `upsert` and `remove` (`shell.ts:106-110`). `ended` is `signal` or `lost` and is set only for a shell kept in the list; a normal exit or a kill removes the shell instead (`shell.ts:75-80`). `Shells.kill` ends the process tree before it forgets the shell and emits the removal (`Shells.ts:615-657`).
- **Web: attach.** `ShellTerminal` (`apps/web/src/components/ShellView.tsx`) renders `TerminalViewport` (`apps/web/src/components/ThreadTerminalDrawer.tsx:483`), which attaches through `attachedShellSessionAtom` (`apps/web/src/state/shells`) and treats a session as live when its version is above 0 and its status is `running` (`ThreadTerminalDrawer.tsx:438`). A hidden tab stays mounted so its output keeps arriving (`ShellView.tsx`). The page exposes no attached or prompt state; the only terminal markers are focus attributes (`ThreadTerminalDrawer.tsx:708`). Unverified that nothing else is exposed.
- **Web: layout save.** Tab changes call `updateTabs`, which queues a `saveTabs` request per workspace as a fire-and-forget chain (`apps/web/src/state/workspaces.ts:261-287`); `show` waits for the pending saves before reading the workspace (`workspaces.ts:~296-303`); a failed save sets `layoutError` (`workspaces.ts:83-85,281-286`). A page reload does not wait for a save in flight.
- **Scenarios: typing.** `typeLine` clicks the visible tab panel's textarea with `force`, types and presses Enter, with no wait (`scripts/scenarios/scenarios/workspaceUi.ts:247-252`). It has 26 call sites across 9 scenario files (grep, 2026-11-09). The only prompt wait is on raw websocket frames containing `]133;B` (`scripts/scenarios/scenarios/starting-scripts.ts:38,113`).
- **Scenarios: reload.** S4 reloads and then reads the tab strip once, with no wait (`scripts/scenarios/scenarios/many-shells.ts:157-173`); the layout save before it is not awaited. That this is the cause of the flake is unverified (epic A-2).
- **Scenarios: `gone()`.** `gone` polls `process.kill(pid, 0)` every 100 ms for up to 5 s (`scripts/scenarios/support.ts:50-58`). Callers: `kill-shell.ts:138,160,196`, `many-shells.ts:143`, `plus-modal.ts:352`, `worktrees.ts:116`, `restore-shell.ts:60`, `restart.ts:171`, `standalone-shell.ts:127` and `allGone` in `workspaceUi.ts:~329`, which S6 also uses for the shell's background jobs (descendants the server does not list).
- **Epic A-3.** The epic's assumption that the server already knows the first prompt is false for plain shells (SA-1); the epic is being corrected separately.
- **Surfaces.** Mobile reads `ShellSummary` (`apps/mobile/src/state/shell.ts`, `workspaceModel.ts`) and shared client code is in `packages/client-runtime/src/state/shell.ts` and `terminal.ts`; desktop wraps the web app. Shells are started from the tree, the "+" modal, the Workspaces menu and the `probe` command in a shell; all of them go through `Shells.open` (unverified for `probe`).

## Expected Behavior

- **Prompt ready.** Every shell started in zsh or bash tells the app, once, that its first prompt has appeared, whether or not a starting script was chosen. The same single scan serves the starting-script typing; there is not a second one. The page shows, per shell tab, whether its terminal is attached to this page and whether the shell is ready. A scenario waits on "attached and ready" before it types.
- **Not ready stays not ready.** A shell that never prints the mark (fish, a startup file that replaced the wrapper) never shows as ready; the starting-script timeout behavior of PRB.T-016 is unchanged.
- **Survives lifetimes.** A shell that was ready stays ready after a page reload (once the page attaches again), after a server restart that reattaches it, and in a second client. A restored shell (a new process) is not ready until its own first prompt.
- **Layout saved.** The page shows whether the shown workspace's layout has been saved: pending while a tab change's save is in flight, saved once the server has confirmed the last one, and a visible failure state when the save failed (today's `layoutError` message stays). A scenario reloads only after "saved".
- **Process end.** A scenario that ends a shell it started waits on the shell list's event for it (a removal after a kill, an `ended` entry after a signal) and then makes one process check on the pid the list reported. For processes the server does not list (a shell's background jobs), the check is one check after the removal, not a poll.
- **Cost.** One additional state change per shell (when its first prompt is seen) and none per output chunk; layout-saved adds no request; the terminal output stream, its framing and its repaint are unchanged; the scan stops at the first mark.
- **Contract change (stated for the plan).** The prompt-ready signal reaches every client (browser, a second client, mobile, remote and relay) with no extra stream, no new RPC method and no change to the terminal output protocol. Where the field lives and where the scan sits are left to the plan. Attach and layout-saved are client-side states derived from the existing attach session and `saveTabs` results and need no contract change (unverified, SA-3). Mobile, desktop and `packages/client-runtime` follow the contract and must still compile.
- **Docs.** The facts about the signals go where a maintainer would otherwise get them wrong (the terminal runtime page, and the testing page for how scenarios wait); no user docs, since no user-visible control changes.

### User Flow

1. A scenario starts a shell (by API or the "+" modal); the tab appears.
2. The scenario waits for the tab to show "attached" and "ready", then types a line; the line reaches a shell that can read it.
3. The scenario changes the tabs (open, close, select), waits for "saved", then reloads; the tab strip after the reload is the one it set.
4. The scenario kills a shell; it waits for the shell list's removal, makes one process check, and goes on.
5. A developer or agent inspecting the page sees the same facts (attached, ready, saved) without reading raw frames.

### Edge Cases

- EC-1: A shell started with a starting script: ready is shown when its first prompt is seen, and the script is still typed exactly once, after that prompt (PRB.T-011 and PRB.T-016 behavior unchanged).
- EC-2: A shell that prints no mark (not zsh or bash): never ready; the page does not claim ready on a timeout.
- EC-3: A tab that is hidden (not selected) is attached and shows its state, since hidden terminals stay mounted.
- EC-4: A shell that was running when the server stopped and is reattached by the next server: shown as ready if it had passed its first prompt before; what is shown for a shell that had not yet printed it is open (SU-1).
- EC-5: A shell restored after it ended (PRB.T-008): not ready until its new first prompt.
- EC-6: A shell sitting at a later prompt (after an agent exits): this story gives only "first prompt seen"; whether scenarios also need "back at a prompt" is SU-2.
- EC-7: Several layout changes in quick succession: "saved" appears only after the last save is confirmed, not after the first.
- EC-8: A layout save fails (for example the workspace file cannot be written): the page shows the failure, not "saved".
- EC-9: A shell ends while a scenario waits for its attach: the wait fails naming the shell instead of hanging to the action timeout.

### Error Handling

- ER-1: A save fails: the failure message of today stays visible and the saved state is not shown; a later successful save clears it.
- ER-2: An older server that sends no prompt field to a newer web client (or the reverse): the client treats the state as unknown and nothing breaks; pages of other clients keep working. Remote and relay clients are affected the same way.
- ER-3: A process check finds the pid still alive after its end event: the scenario fails naming the shell and pid at once; it does not wait.

## Out Of Scope

- Agent status (working, waiting, done) and any agent-specific adapter: a separate epic; this signal is the shell's first prompt, not agent state.
- The terminal's rendered text as a test signal (the analysis's optional third item): not needed for the facts above.
- "Back at a prompt after a command" for every later prompt, unless SU-2 shows scenarios need it.
- The runner, the shared server and parallel workers: PRB.T-040. RPC setup and splitting: PRB.T-038, PRB.T-039.
- Showing these states to end users in the UI; this story exposes them to the page's state only.
- Mobile and desktop UI.
- fish prompt readiness: PRB.T-012.

## Technical Scope

- **Layers:** server (the shell service's single scan and the shell summary it publishes), contracts (the shell summary), client-runtime and web (the attach session, the shell list and the layout save state, exposed on the page), scenario harness (`typeLine`, reload waits, process-end waits), the terminal runtime and testing docs.
- **Docs impact:** `docs/internals/terminal-runtime.md` (who scans the first prompt and what the signal means; today it describes typing after the prompt); `docs/internals/testing.md` (scenarios wait on these signals, not on frames or `kill(0)` polling). No `docs/user/` change. AGENTS.md "Verifying" checked; unlikely to change.
- **Mobile impact:** the contract changes, so mobile (`apps/mobile`) must still type-check; no mobile code is expected to change; checked with `vp run check:changed` or `vp run typecheck` of dependents.
- **Surface checklist (AGENTS.md "Hit every surface").**
  - Entry points: the signal belongs to the shell, so it holds for shells started from the tree row actions, the "+" modal, the tab strip, the Workspaces menu, Settings and the `probe` command alike; one scenario path each is not needed, but one start path other than the "+" modal is exercised (AC-1).
  - Clients: browser is the target; desktop wraps it and is not rebuilt; mobile compiles. Shared logic lives in `packages/client-runtime`, not in web only.
  - Agent CLIs: mock agent: ready is the shell prompt before it is typed; Claude Code and every other CLI: plain terminal here, no adapter and no agent status.
  - Shells: zsh and bash only (wrapped); fish and others never ready (EC-2); Linux and macOS behave the same since the scan is on output.
  - Agents: the prompt state is a shell-service fact, so an agent can reach it later through `probe` or MCP without handler code; no new command now.
  - Contracts: the summary field above; web, mobile, desktop and server follow.
  - Reverse states: ready resets on restore (EC-5) and ends with the shell; saved goes back to pending on the next change; failure clears on the next success.
  - Lifetimes: checked after a reload, a server restart and with a second client (AC-4).
  - Connection modes: same websocket path for local, relay and tunnel; a second server's shells show their own state (AC-12); the UI never reads the server's files or process table.

## Non-functional Requirements and Constraints

- NFR-1 (epic): no continuous repaint; no extra stream; one small state change per shell and per layout save; the scan stops at the first mark; plain-shell click-to-prompt does not get slower (checked against the PRB.T-036 measure).
- One scan per shell serves both the script typing and the signal.
- Wire shapes are in `packages/contracts`; a server feature is a service method, not handler code; the client mutation pattern stays (`AGENTS.md` "Taste").
- The signal is exposed through the page's normal state, not a test-only code path or global that production code carries only for tests (the plan decides the form; SU-3).
- Repo test rules hold for the scenario edits: no sleeps or polling loops, no wall-clock deltas, no per-test timeout argument.
- Mouse-first: scenarios keep typing into the terminal only through the page's terminal.

## Acceptance Criteria

| ID    | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ----- | ------------------------------- | --------------------- | --------------------------- |
| AC-1  | Given a plain shell started without a starting script, once from the "+" modal and once by API, when its tab is attached and the shell prints its first prompt, then the page shows that tab as attached and ready, and does not before the prompt | auto | FR-12, EC-1 |
| AC-2  | Given a shell started with the mock agent as starting script, when the first prompt appears, then the page shows ready and the command is typed exactly once after that prompt | auto | FR-12, EC-1 |
| AC-3  | Given a shell that never prints the prompt mark (a shell that is not zsh or bash), when the page attaches, then it is shown as attached and never as ready | auto | EC-2 |
| AC-4  | Given a ready shell, when the page reloads, the server restarts with the shell reattached, or a second client opens the workspace, then each shows it attached and ready once it has attached; this covers a shell that had already printed its first prompt, and a shell that had not yet printed it is left to what SU-1 decides | auto | FR-12, EC-4 |
| AC-5  | Given a ready shell in a hidden tab, when the page is checked, then the hidden tab shows attached and ready | auto | EC-3 |
| AC-6  | Given an ended shell that the user restores, when the restored shell starts, then it is not ready until its own first prompt | auto | EC-5 |
| AC-7  | Given a scenario that types with `typeLine`, when the target shell is not yet ready, then `typeLine` waits for attached and ready and then types; and when the shell never becomes ready, it fails naming the shell instead of typing (negative control) | auto | FR-12, EC-9 |
| AC-8  | Given several tab changes in quick succession, when the page shows the layout as saved, then the server already holds the last tab list, and the "saved" state did not appear after only the first save | auto | FR-12, EC-7 |
| AC-9  | Given a layout save held back on purpose by the harness, when the scenario waits for "saved" before reloading, then the tab strip after the reload is the one it set; and the same scenario reloading without waiting shows the stale tab strip (negative control that reproduces the suspected S4 flake and settles epic A-2) | auto | FR-12, EC-7 |
| AC-10 | Given a layout save that fails, when the page is checked, then the failure message shows and "saved" does not; given a later save that succeeds, then the message clears | auto | ER-1, EC-8 |
| AC-11 | Given S4 and the other scenarios that reload after a tab change, when they run, then each waits for "saved" before the reload and reads the tab strip only after the tree shows | auto | FR-12 |
| AC-12 | Given the second-server scenario R1, when a shell is started in a workspace on the second server, then that server's shell shows attached and ready on the page | auto | FR-12 (connection modes) |
| AC-13 | Given a shell killed from the tree, signalled from outside, or ended by `probe kill`, when a scenario checks it, then it waits for the shell list's removal or `ended` entry and makes one process check on the reported pid; `gone()` is no longer used for a pid the shell list reports | auto | FR-12 |
| AC-14 | Given a pid still alive when its end event has been seen, when the scenario checks, then it fails at once naming the shell and pid, without waiting (negative control) | auto | ER-3 |
| AC-15 | Given S6's shell and its background jobs, when the shell is killed, then after the removal one check finds the shell and the jobs gone; if a job survives the check fails | auto | FR-12 |
| AC-16 | Given a shell that prints thousands of lines, when the shell list stream and the terminal output frames are counted, then the shell has exactly one extra state change for the prompt, none per output chunk, the output frames are unchanged and no new request is made for layout-saved | auto | NFR-1 |
| AC-17 | Given the plain-shell click-to-prompt measure of PRB.T-036, when it is taken before and after this story, then it is not slower than the slowest of the baseline's N runs (the PRB.T-036 baseline's min to max range is the allowed spread) | manual (author) | NFR-1 |
| AC-18 | Given a shell summary without the prompt field (an older server) and one with it, when the web client and the mobile and client-runtime decoders read them, then both decode and the absent one means unknown | auto | ER-2, NFR-4 |
| AC-19 | Given the contract change, when `vp run check:changed` runs, then the typecheck of mobile and the other dependents passes | auto | NFR-4 |
| AC-20 | Given the scenarios, when they are searched, then no scenario types before waiting for attached and ready, none reloads after a tab change without waiting for saved, and the S6/S4/S8/S7 paths use the new waits | manual (reviewer) | FR-12 |
| AC-21 | Given the docs after the change, when the terminal runtime and testing pages are read against the code, then they describe the single scan, the signals and the process-end wait and contradict nothing | manual (docs diff review, developer) | NFR-7 (epic) |
| AC-22 | Given ten consecutive runs of the scenarios that use the signals, with several workers if PRB.T-040 has landed, when they finish, then all pass with no retries | manual (developer, loop) | FR-12 |
| AC-23 | Given a shell that ends while a scenario waits for its attach, when the shell ends, then the wait fails at once naming the shell, well before the action timeout | auto | EC-9 |

## Dependencies

Depends on: PRB.T-036 (the fixtures module and the server-side prompt measure it adds). Blocks: PRB.T-040 cannot close before this lands (the flake-free parallel claim needs it); PRB.T-037 to PRB.T-040 do not need it to start.

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-036 | One fixtures module is where `typeLine` and the reload and kill waits are changed once; the baseline click-to-prompt measure is what AC-17 compares with | backlog |
| PRB.T-016 | The single first-prompt scan and the typing of the starting script this story reuses | done |
| PRB.T-011 | Typing once after the first prompt, which must stay true | done |
| PRB.T-008 | Restore, whose new process starts not ready | done |
| User OK for production code | The epic's user decision of 2026-11-09 allows small production signals | given |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The server already knows the first prompt, so the signal needs no new terminal work (epic A-3) | assumption | false for plain shells (2026-11-09: only a shell with a starting script is scanned, `Shells.ts:872,929`); true for script shells | Plan: add the scan to every shell start and stop it at the first mark; AC-16 | author |
| SA-2 | The suspected S4 tab-list flake is a reload with the layout save in flight (epic A-2) | assumption | unverified | AC-9: hold the save on purpose and reload without waiting | author |
| SA-3 | Attach and layout-saved need no contract change: the attach session and the `saveTabs` result already say it | assumption | unverified | Read the web and client-runtime state when planning | author |
| SA-4 | `Shells.kill` ends the process tree before it emits the removal, so one pid check after the event is enough for the shell and its jobs | assumption | unverified (read at `Shells.ts:615-657`; not run) | AC-13, AC-15 | author |
| SA-5 | A signalled or lost shell's `ended` entry is emitted after the server saw the process exit | assumption | unverified | AC-13 | author |
| SA-6 | Mobile, client-runtime and desktop compile with an additive summary field | assumption | unverified | AC-19 | author |
| SA-7 | Every start path (tree, "+" modal, Workspaces menu, `probe`) goes through the same `Shells.open` | assumption | unverified for `probe` | Read the `probe` command's server route when planning; AC-1 | author |
| SA-8 | A layout save can be held back in a scenario (AC-9) without a test-only hook in production code, for example by delaying the request from the test's side of the connection | assumption | unverified | Spike when planning; if impossible, AC-9 needs a different negative control | author |
| SU-1 | Whether a shell reattached after a server restart that had not yet printed its first prompt is ready or not, and how the server knows | unknown | unverified | Decide in the plan; EC-4 | author |
| SU-2 | Whether scenarios need "back at a prompt" after an agent exits (`leaveAgent`) and not only the first prompt | unknown | unverified | List the scenarios' `leaveAgent` and typing-after-exit uses when planning; extend or park | author |
| SU-3 | In what form the page exposes the facts (the plan decides) without a test-only path | unknown | unverified | Plan stage; TBD (author, before the plan) | author |
