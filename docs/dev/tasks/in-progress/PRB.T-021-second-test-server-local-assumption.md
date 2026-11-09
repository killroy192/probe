---
id: PRB.T-021
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, implement]
created: 2026-11-09
updated: 2026-11-09
---

# Second test server, local-assumption audit and settings sort

## Business Goal

**Problem:** Every terminal-first screen was built while the UI and its server were one thing. The workspace code uses the one server that serves the UI (`usePrimaryEnvironmentId` in `apps/web/src/state/workspaces.ts`), and nothing in the scenario harness can show another server's workspace. Nobody has listed what breaks when the server is not the UI's own, or which Settings pages belong to the person and which to a machine. Building the multi-server list, the connect flow and the settings split without that list means rework in every later story, and every feature built after this point inherits the same blind spot.

**Proposed solution:** The scenario harness can start a second Probe server that shares no folder with the UI's own server, hand it to the UI as a known server without the connect flow (a test-only seam), and seed workspaces on it. With that in place the author runs the UI against it, records every place a screen assumes the UI's own server, and sorts every Settings page into client-owned or server-owned. The findings settle the epic's early assumptions, so stories 2 to 8 start from facts.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 1 UI against a second server, and the settings audit (first story of the epic)
- **Kind:** a spike and enabler story. Its verifiable output is the harness scenario (two servers, seeded workspaces, the seam) plus the reviewed audit; no product behavior changes.
- **Delivers:**
  - FR-4 (the audit half): the sorted list of Settings pages as client-owned or server-owned, with where each keeps its values today (U-6). It fixes the list that story 5 applies.
  - FR-5 (the audit half): the list of places that read the UI machine's files or loopback, or assume one server (A-4, A-9, U-1, U-4). Fixing them belongs to later stories.
  - FR-15 (the https claim only): whether the harness can start an https server on loopback (A-15), and how a typed address is classified (U-5).
  - NFR-3 (the target only): reads the credential storage and the log code, and the pairing-origin check (A-10, A-13, A-14).
  - NFR-2 (the timing only): reads the existing retry timing against the 60 s limit (A-6).
  - NFR-4: the harness extension runs in headless Chromium against a second Linux or macOS server process.
  - NFR-5 (the audit half): each Settings page is sorted, so story 5 can make every page say whether it edits the client or a named server.
- **One deployable outcome:** `vp run test:scenarios` can start the UI's server plus a second, separate Probe server with workspaces on it and show that second server to the UI without the connect flow, and the audit and settings sort are written down and reviewed. No product behavior changes; this opens stories 2 to 8.

## Current Behavior

Verified by reading the code on 2026-11-09 (the code search index was unavailable). Not verified: anything not named below.

- **Harness.** `scripts/scenarios/server.ts` exports `startServer`, which reserves a loopback port, gives the server its own home folder and returns a handle (`home`, `origin`, `pairingUrl`, `restart`, `cli`, shell-host controls). It strips `T3CODE_`, `VITE_` and `PROBE_` variables from the child environment. Unverified: whether two servers can run in one scenario process, and whether a scenario can point the browser at a server other than the one it paired.
- **Scenarios.** `scripts/scenarios/scenarios/` holds the PRB.E-001 scenarios (`boot.ts`, `plus-modal.ts`, `restart.ts`, `worktrees.ts` and others). Each runs against one server.
- **Workspaces on one server.** `useWorkspaces` in `apps/web/src/state/workspaces.ts` reads the saved workspaces of the primary environment only and every action runs against it. The shown workspace and its tabs are keyed by an environment id, and the remembered shown workspace is stored in the browser per environment id (`probe:shown-workspace:`). The shell tree and terminals receive an environment id from the view state (`WorkspaceScreen.tsx`, `WorkspaceSidebar.tsx`).
- **Folder browser.** `AddProjectDialog.tsx` asks the server named by an environment id for folders, but also decides what to show from whether the connection target is the primary one. `serverLocation.ts` guesses whether the server is remote from the server OS and the page host.
- **Contracts.** `packages/contracts/src/workspace.ts` defines `WorkspaceSummary` (a name only) and the `workspace.*` requests; `subscribeWorkspaces` exists in `packages/contracts/src/rpc.ts`. Unverified: what it pushes and whether it covers every change (A-8).
- **Connection code.** `packages/client-runtime/src/connection/` holds the registry, supervisor, routes and `compatibility.ts` (a missing protocol value counts as version 1). `apps/web/src/components/settings/ConnectionsSettings.tsx` (section titled "Environments") and `AddEnvironmentDialog.tsx` already add and manage saved servers. Unverified: whether it works against a terminal-first server with no chat state (A-2).
- **Settings.** `apps/web/src/routes/_chat.settings.*.tsx` has 26 page routes. `settingsScope.ts` can scope a setting to a project or one machine. Unverified: where each page keeps its values (U-6).
- **Docs.** `docs/internals/remote.md` documents the server-side rules for plain http and tokens; a client-side refusal of plain http to a public address is unverified (U-5, A-13).
- **Mobile.** Has its own server list; unaffected here.

## Expected Behavior

- The scenario harness can start a second Probe server alongside the first. It has its own state folder, its own port, and no folder in common with the UI's own server or the UI process. A scenario can seed saved workspaces on it before the UI looks.
- A test-only seam makes the UI know the second server without the connect flow: the harness saves the second server and its credential in the browser's saved-server storage. It adds no product code, and PRB.T-023 replaces it with the connect flow. The workspace screens still use only the default server; showing the second server's workspaces in them is PRB.T-022 (its AC-1).
- The author runs the UI against the second server alongside the default server and writes one audit, kept in `docs/dev` as a finding (the exact place is a plan decision). It has two parts and answers every item below.
  1. **Local assumptions.** A list of every place a screen or service assumes the UI's own server, files, loopback or one environment, each with file path, what breaks, and which later story fixes it (A-1, A-4, A-9, U-1). It includes the scheduled tasks, MCP tools and the `probe` command started inside a shell (U-4).
  2. **Settings sort.** Every Settings page route sorted as client-owned or server-owned, or a question for the author, with where each page keeps its values today (U-6) and how `settingsScope.ts` relates. Pages that exist only for chat stay hidden and are sorted too. The epic's starting guess in "Notes for stories" is checked, not trusted.
- The audit settles or updates these epic rows with a status and evidence: A-1, A-2, A-4, A-7, A-8, A-9, A-13, A-14, A-15, A-16, U-1, U-4, U-5, U-6 (the epic's story 1 settles A-13, A-14, A-15). It reads (without running the connect flow) A-3, A-10, A-11, and reads the retry timing for A-6; the connect-time runs of A-13 and A-14 are for story 3.

### User Flow

1. The author runs a scenario that starts the UI's server and a second server, seeds workspaces on the second, and opens the UI.
2. The UI connects to the second server through the seam; the harness checks the connection and that the credential the UI holds can list the seeded workspaces.
3. The author walks the screens that already take a server (Settings > Environments, the folder browser, Settings pages) against the second server, and reads the code of the workspace screens, which use only the default server until PRB.T-022, and records what works, what reads the wrong server and what fails.
4. The author reads the code for the named assumptions and writes the audit.
5. The author sets each assumption row's status in the epic and lists any new unknown. The reviewer reads the audit.

### Edge Cases

- EC-1: The second server's state folder and working folder are in places the UI's server cannot read, so a screen that wrongly reads the UI machine's files fails visibly instead of passing by luck.
- EC-2: The harness stops a second server it started when the scenario ends or fails, by the process it spawned, and leaves nothing running.
- EC-3: A Settings page that is undecided by the code (labs, beta, about) is listed as a question for the author, not guessed.
- EC-4: Both servers hold a workspace with the same name; the audit records which screens would confuse them.

### Error Handling

- ER-1: If the second server does not become ready in the harness time limit, the scenario fails with the server's log, as the first server does.
- ER-2: If the https claim for the harness cannot be met (A-15), FR-15's automated https claim is dropped and the finding says https is checked by hand.
- ER-3: If an assumption turns out false, the audit says which later story changes and records the change as a note for the author; it does not change scope itself.

## Out Of Scope

- Any fix to what the audit finds: the stories named in the audit do that (PRB.T-022 to PRB.T-028).
- The connect flow, the rename to "Probe servers" and the creation picker: PRB.T-023 and PRB.T-024.
- Applying the settings split: PRB.T-025.
- Reconnect, disconnect and remove: PRB.T-026 and PRB.T-027.
- Running the PRB.E-002 second-server checks: PRB.T-028.
- Containers, installation on a remote: PRB.E-004.
- Desktop and mobile UI.

## Technical Scope

- **Nature:** spike/enabler; the verifiable output is the harness scenario plus the audit review (AC-1 to AC-5 and AC-6 to AC-10).
- **Layers:** scenario harness (`scripts/scenarios`), the browser client's server catalog for the test-only seam, and read-only code reading across web, `packages/client-runtime`, `packages/contracts` and the server. A written finding in `docs/dev`.
- **Docs impact:** none for `docs/user`. The audit is a `docs/dev` finding; the lasting rules go to `docs/internals/` in PRB.T-025 and PRB.T-028. Epic assumption rows are updated through the epic, not here.
- **Mobile impact:** none expected; the harness and the seam are web and scripts only. `vp run check:changed` must still pass.

## Non-functional Requirements and Constraints

- The second server must be a separate process with its own state folder and port, never a second connection to the same server (the epic's risk R-1).
- The second server must not read the UI process's working folder (FR-5, NFR-3 constraint on the harness).
- Stop only a process the harness spawned, by the pid it captured (repo rule 1).
- No test sleeps or polling (repo test rules); the harness waits on readiness the way it does for the first server.
- The seam is test-only and must not ship as a user feature.
- Never touch `~/.t3/userdata` or global agent CLI config.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a scenario that starts two servers, when both are ready, then each has its own origin and its own state folder, and the second server's folder is not inside the first's or the UI process's working folder | auto | FR-5, NFR-4, EC-1 |
| AC-2 | Given workspaces seeded on the second server before the UI looks, when the scenario reads that server directly, then it lists exactly those workspaces and the default server lists none of them | auto | FR-3 (harness), EC-4 |
| AC-3 | Given the seam, when the UI loads, then the browser opens a connection to the second server's origin that the server answers, and with the credential the seam stored, the second server's workspace list returns exactly the seeded workspaces; no connect flow is used. (Listing them in the workspace menu is PRB.T-022 AC-1.) | auto | FR-5 (harness) |
| AC-4 | Given a scenario that ends or fails, when it finishes, then the second server and its shell host started by the harness are stopped by their captured pids | auto | EC-2 |
| AC-5 | Given a second server that never becomes ready, when the scenario waits, then it fails with that server's log | auto | ER-1 |
| AC-6 | Given the audit, when read, then it lists every local assumption with file path, what breaks, and the later story that fixes it, including scheduled tasks, MCP tools and the `probe` command in a shell, and which screens would confuse same-named workspaces on two servers | manual (author) | FR-5, EC-4 |
| AC-7 | Given the audit, when read, then every `_chat.settings.*` page route is sorted client-owned or server-owned or is a named question for the author, with where it keeps its values today | manual (author) | FR-4, NFR-5, EC-3 |
| AC-8 | Given the audit, when read, then it states for each of A-1, A-2, A-4, A-7, A-8, A-9, A-13, A-14, A-15, A-16, U-1, U-4, U-5 and U-6 whether it holds, with evidence | manual (author) | FR-4, FR-5, FR-15, ER-3 |
| AC-9 | Given the code, when read, then the audit records what it found for A-3, A-10, A-11 and the code behind A-13 and A-14 and the retry timing against the 60 s limit (A-6), each as a read result for story 3 or 6 to run | manual (author) | FR-13, FR-12, NFR-2, NFR-3 |
| AC-10 | Given the https question, when the harness is tried, then the audit says whether an https server on loopback can be started; if not, the epic's FR-15 automated https claim is recorded as dropped | manual (author) | FR-15, ER-2 |
| AC-11 | Given the change, when `vp run check:changed` runs, then it passes, including mobile typecheck | auto | NFR-4 |

## Dependencies

Depends on: none inside this epic (first story). It needs the scenario harness from PRB.E-001 to exist, which it does. It does not wait for PRB.E-002 (PRB.T-016 to PRB.T-020): the audit only sorts the Starting scripts page by the settled rule.

Blocks:

- PRB.T-022: needs the second server, the seam and the seeded workspaces, and the audit's local-assumption list.
- PRB.T-023: needs the audit's results for A-2, A-3, A-10, A-11, A-13 to A-15 and U-5 before building the connect flow and the refusal.
- PRB.T-025: needs the sorted page list (FR-4).
- PRB.T-026: needs the retry-timing reading (A-6).
- PRB.T-028: needs the seam and the audit's list for the E-002 second-server checks.

| Depends on | Why | Status |
| --- | --- | --- |
| None | First story of PRB.E-003 | n/a |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | `startServer` can be called twice in one scenario process, each with its own home and port | assumption | verified: R1 runs two `startServer` children in one runner process | Read `scripts/scenarios/server.ts` and `run.ts` at plan time | author |
| SA-2 | A scenario can make the browser use a server other than the one it was paired with, through the existing saved-server storage or a similar seam | assumption | verified: `scripts/scenarios/seam.ts` writes the browser's connection catalog (IndexedDB) and reloads | Read `apps/web/src/connection/catalog.ts` at plan time; this is the test-only seam | author |
| SA-3 | A server with no chat state starts and answers the workspace requests on a fresh home (the harness already does this for the first server) | assumption | verified | PRB.E-001 scenarios pass against it | author |
| SU-1 | Where the audit finding lives in `docs/dev` (a research page or the ticket's own handoff) | unknown | answered: `docs/dev/research/remote-local-assumptions-audit.md` | TBD (author, 2026-11-15) at plan time | author |
| SU-2 | Whether labs, beta, diffs, threads, chat, snapshots, about and the licenses page are client-owned or server-owned | unknown | partly answered: Diffs, Threads, Chat and Snap Shot sorted; Labs, About, licenses and Browser are Q-A to Q-C in the audit | The audit; the author decides what the code does not (TBD author, 2026-11-15) | author |

## Handoff

- **Audit:** [`docs/dev/research/remote-local-assumptions-audit.md`](../../research/remote-local-assumptions-audit.md) holds the local-assumption list, the settings sort and the result for every story-1 row; the epic's assumption table points to it. Open for the author: Q-A to Q-D there, and the epic's new U-8 (where client-owned settings live).
- **Harness:** `startSecondServer()` on the scenario context, `scripts/scenarios/seam.ts` (catalog seam, harness-only, replaced by PRB.T-023), `connectRpc(origin, { bearerToken })`. Scenario R1 (`--only R1`) is the second-server check; self-test T3 (`--selftest --only T3`) runs only when picked.
- **What later stories inherit:** the workspace screens use only the default server (T-022). Settings writes fan out to every connected server, and Sharing & access ignores the scope (T-025). Pairing errors collapse to `invalid_credential` and plain http to a public host is not refused (T-023). Reconnect backoff can exceed 60 s (T-026). Two servers on one host share a label (T-022/T-023).
- **A-15 recipe:** a `node:https` proxy on loopback with an `openssl` self-signed cert, Chromium with `ignoreHTTPSErrors`; it paired and connected over `wss://` in the walk.

