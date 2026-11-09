---
id: PRB.T-026
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# When a server is unreachable

## Business Goal

**Problem:** A remote server will stop, restart or lose its network. If its workspaces vanish, or the tree shows stale shells, or one dead server slows the others, the user cannot tell a dead server from a slow one and fears lost work.

**Proposed solution:** An unreachable server stays in the list as one unavailable entry with the reason and a reconnect action (the remove action arrives in PRB.T-027), and no workspace or shell names. Open screens of that server say "disconnected" and name it; the "+" modal and server-owned Settings say why they cannot work. Other servers and client settings are untouched. When the server returns, the UI reconnects on its own and shows the server's current state.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 6 When a server is unreachable
- **Delivers:**
  - FR-6: reload returns to the same workspace on the same server; if that server is down the start screen offers the other workspaces and shows the server as unavailable with the reason.
  - FR-7: one unavailable entry per unreachable server, with reason and reconnect (the remove half is PRB.T-027); no workspace or shell names; never hidden; other servers unaffected.
  - FR-8: "disconnected" tree naming the server, "+" modal unable to start a shell and saying why, server-owned Settings pages saying they cannot load.
  - FR-9: automatic reconnect without reload or new pairing; current state shown, shells that survived and shells that ended.
  - FR-13 (the reconnect half): a lost connection is retried and restored without re-pairing, and the saved server and credential stay.
  - FR-16 (unreachable and reconnecting states): one place per server shows connecting, reconnecting, unreachable.
  - NFR-2: reconnect within 60 s of the server being reachable (proposed, Q-2); a lost connection never loses the saved server or credential; reconnect never starts or kills a shell; one server down never delays or empties the others.
  - NFR-4: headless Chromium; mobile compiles.
  - NFR-1 (limits): the author sets the list-ready and bytes limits after this story (Q-2).
  - NFR-6: the state names the failed step.
- **One deployable outcome:** A user whose remote server stops sees exactly what is lost, keeps working on other servers, and gets the remote back without reloading when it returns; this is scenario E3-S3 and is the reverse state of connecting.

## Current Behavior

Partly verified by reading code on 2026-11-09 (the code search index was unavailable).

- **Supervisor.** `packages/client-runtime/src/connection/supervisor.ts` retries a lost connection with a backoff capped at `RETRY_MAX_DELAY_MS = 300_000` (five minutes), resets the backoff after a connection stayed up `BACKOFF_RESET_AFTER_MS = 30_000`, and has a `backoff` phase and wake-ups (`wakeups.ts`, for example on network change). Whether the worst case meets 60 s is the NFR-2 question (epic A-6): unverified, read by PRB.T-021.
- **State model.** `packages/client-runtime/src/connection/model.ts` holds a per-connection phase and `presentation.ts`/`diagnosis.ts` turn it into text; whether the text names the failed step as NFR-6 needs is unverified.
- **Saved server.** `registry.ts` removes a saved server only through explicit `remove`/`removeRoute`; whether a lost connection ever drops a saved server or its credential is unverified (a test is AC-8).
- **Terminal-first screens.** `apps/web/src/components/workspaces/WorkspaceScreen.tsx` takes an environment id in its view state and uses `useShells(view.environmentId)`. What the tree, "+" modal, start screen and Settings show while that connection is down is unverified.
- **Remembered workspace.** The shown workspace is remembered per browser; whether it records its server is PRB.T-022's work (unverified here).
- **Shells.** The server owns shells; they survive the client and a server restart through the shell host (`docs/internals/terminal-runtime.md`). Verified by that doc only.
- **Mobile.** Mobile has its own server list and is not touched.

## Expected Behavior

- **Workspace list:** a server that is unreachable or disconnected-by-loss appears as one entry marked unavailable, with the reason and a "Reconnect now" action; the remove control is not in this story (PRB.T-027 adds it). Its workspace names are not shown (the UI keeps no copy). Other servers' workspaces stay listed and usable, and the list is ready without waiting for the dead server.
- **Open workspace of that server:** the shell tree shows "disconnected" naming the server, and no shell names. The terminals show disconnected. The "+" modal's Start is unavailable and says why. Server-owned Settings pages for that server say they cannot load and why. Client settings and other servers' workspaces are unaffected.
- **Start screen after reload while down:** it offers the other servers' workspaces, shows the server unavailable with the reason, and does not offer the remembered workspace of that server as openable.
- **Return:** the UI reconnects on its own (and "Reconnect now" forces a try) without a reload or new pairing; the server's workspaces return to the list; the tree and terminals show the server's current state, including shells that kept running and shells that ended.
- **Connection state:** shown per server in one place: connecting, reconnecting, unreachable, with the failed step (address unreachable, credential refused, version mismatch).
- No shell is started or killed by reconnecting.

### User Flow

1. The user is in a workspace of remote server R. R stops or the network drops.
2. The tree shows "disconnected" naming R; the "+" modal cannot start a shell and says why; the list shows R as one unavailable entry.
3. The user switches to a workspace of another server and works there.
4. The user reloads. The start screen lists other servers' workspaces and R as unavailable with the reason.
5. R returns. Without any action the entry becomes connected, its workspaces return and the tree shows its current shells.
6. Alternatively the user clicks "Reconnect now" on the entry. (Removing the server arrives in PRB.T-027.)

### Edge Cases

- EC-1: The server returns with a different set of shells (some ended, some kept running): the tree shows the current set; ended shells appear as ended with Restore or remove as in PRB.E-001.
- EC-2: Two servers are down at once: two unavailable entries, each with its own reason.
- EC-3: The server is slow, not dead: the state says reconnecting or connecting, not unreachable (FR-16).
- EC-4: The server comes back with another protocol version: refused as in PRB.T-023, with the version message, not "unreachable".
- EC-5: The network of the UI machine drops: every remote shows unreachable; the default server's workspaces stay usable only if the default server is reachable. TBD (author, 2026-11-15) for a remote default server.
- EC-6: The server is down for longer than the retry cap: it stays listed until reachable or removed.
- EC-7: The server was restarted while a terminal was open: the terminal shows disconnected, then the current state; no scrollback from before is invented.

### Error Handling

- ER-1: A workspace-level action (start shell, Add project, folder browser) is refused while the server is down with a reason naming the server.
- ER-2: The reconnect keeps failing because the credential was revoked: the state says refused and offers to pair again, which reuses the PRB.T-023 connect flow (FR-16, FR-12). Nothing is deleted.
- ER-3: The reason cannot be determined: the state says unreachable with the last error, never a blank.

## Out Of Scope

- Disconnect and remove actions, their confirmation and the remove control on the entry: PRB.T-027 (this story's entry shows a reason and a reconnect action only).
- A client-side cache of workspace or shell names (settled: none, U-2).
- Reconnection of the default server: it serves the UI; its loss is the browser's loss of the page.
- Setting the NFR-1 and NFR-2 limits: the author, after this story (Q-2).
- Mobile UI, desktop checks, relay and SSH kinds.

## Technical Scope

- **Layers:** web (start screen, workspace list entry, tree, "+" modal, server-owned Settings pages, terminal view), client-runtime (connection state per server, reconnect timing, wake-ups, a "Reconnect now" trigger), server (nothing new; the harness can stop and start a second server), scenario harness (stop and restart the second server), docs.
- **Docs impact:** user section "Connect to a Probe server" (what happens when a server is unreachable); `docs/internals/` connection pages only if the timing rule changes; update when the retry cap is changed.
- **Mobile impact:** contracts may change; mobile must compile; no mobile UI.

## Non-functional Requirements and Constraints

- NFR-2: reconnect within 60 s of the server being reachable (proposed; if the five-minute cap does not meet it, change the timing in this story).
- NFR-1: no continuously repainting animation for connection states; one server's state costs no more than its own session.
- NFR-5: every action by mouse or touchpad; every error names the server and the next step.
- NFR-6: the state names the failed step.
- Reconnecting never starts or kills a shell; the saved server and credential are never dropped by a loss.
- The UI keeps no copy of workspace or shell names.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a workspace of the second server is open, when the harness stops that server, then the list shows one unavailable entry with a reason and a reconnect action (no remove control), and no workspace names of that server | auto | FR-7 |
| AC-2 | Given AC-1, when the user reads the tree, then it says "disconnected" naming the server and shows no shell names | auto | FR-8 |
| AC-3 | Given AC-1, when the user opens the "+" modal, then Start is unavailable and a message names the server and why | auto | FR-8, ER-1 |
| AC-4 | Given AC-1, when the user opens a server-owned Settings page for that server, then it says it cannot load, why, and names the server | auto | FR-8 |
| AC-5 | Given AC-1, when the user works in a workspace of another server and reads client settings, then both are unaffected and the list stays ready | auto | FR-7, NFR-2 |
| AC-6 | Given the server is down, when the UI is reloaded, then the start screen offers the other workspaces and shows the server as unavailable with the reason | auto | FR-6 |
| AC-7 | Given the server is down, when the harness restarts it, then without reload or new pairing the entry becomes connected, its workspaces return and the tree shows the current shells | auto | FR-9 |
| AC-8 | Given a stopped and restarted server, when the saved servers are read, then the server and its credential are still saved and no shell was started or killed by the reconnect | auto | NFR-2 |
| AC-9 | Given a restart, when the reconnect is observed, then a reconnect event arrives within the scenario's bound (no wall-clock delta is asserted); the 60 s reading itself is taken by the author until Q-2 sets the limit | auto | NFR-2 |
| AC-10 | Given shells of which one ended and one kept running during the outage, when the server returns, then the tree shows both as they are now | auto | FR-9, EC-1 |
| AC-11 | Given the state of a connection, when it is connecting, reconnecting, unreachable or refused, then one place per server names the state and the failed step | auto | FR-16, NFR-6, EC-3, ER-3 |
| AC-12 | Given two servers down, when the list is read, then there are two entries, each with its own reason | auto | EC-2 |
| AC-13 | Given a down server returns with a different protocol version, when it is reached, then it is refused with the version message and none of its workspaces enter the list | auto | EC-4 |
| AC-14 | Given a revoked credential, when the reconnect fails, then the state says refused and offers pairing again through the PRB.T-023 connect flow; nothing is deleted | auto | FR-16, FR-12, ER-2 |
| AC-15 | Given the list-ready time and one session's bytes, when the story is done, then both are recorded for the author to set the NFR-1 limits (Q-2) | manual (author) | NFR-1 |
| AC-16 | Given the state UI, when reviewed, then no continuously repainting animation is used and every action works with the pointer | manual (reviewer) | NFR-1, NFR-5 |
| AC-17 | Given the change, when `vp run check:changed` runs, then mobile and dependents type-check | auto | NFR-4 |
| AC-18 | Given the docs diff, when read, then the user docs describe what happens when a server is unreachable | manual (reviewer) | NFR-7 |
| AC-19 | Given a server down longer than the retry cap, when the list is read, then its entry is still listed until it is reachable | auto | EC-6 |
| AC-20 | Given a terminal of the second server is open, when the harness restarts that server, then the terminal shows disconnected and then the current state, and no earlier scrollback is invented | auto | EC-7 |
| AC-21 | Given the server is down, when the user clicks "Reconnect now", then a connection attempt is made at once (an observed reconnect event) | auto | FR-9 |
| AC-22 | Given the server is down, when the user tries Add project or the folder browser, then it is refused with a reason naming the server | auto | ER-1 |
| AC-23 | Given a failure whose reason cannot be determined, when the state is shown, then it says unreachable with the last error and is never blank | auto | ER-3 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-025 | Server-owned Settings pages must exist under their server before their unreachable state is shown (epic order: after 5) | backlog |
| PRB.T-023 | The connect flow, saved servers and the connection state line | backlog |
| PRB.T-022 | The list as the union over servers and the remembered workspace carrying its server | backlog |
| PRB.T-021 | The harness second server (stop and restart) and the reading of the retry timing (A-6) | backlog |
| PRB.E-001 (in progress) | The tree, Restore and ended-shell states this story reuses; the needed behaviour is done in PRB.T-003..T-008 | in progress |
| PRB.T-023 (connect flow) | "Pair again" on a refused credential (ER-2) reuses the PRB.T-023 connect flow; no new pairing UI here | backlog |

Blocks: PRB.T-027 (it needs the unavailable entry and unreachable state; remove of a workspace is refused while down), PRB.T-028, and E3-S3. Also gates the author's Q-2 numbers. No cycles.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | Reconnect after a restart or network drop works without new pairing (epic A-6) | assumption | unverified | AC-7, AC-8 | author |
| SA-2 | The five-minute backoff cap can meet 60 s, or the timing is changed in this story | assumption | unverified | PRB.T-021 reads it; AC-9 | author |
| SA-3 | A shell kept by the shell host survives the second server's restart and the tree can show it again | assumption | unverified | AC-10 | author |
| SA-4 | The existing connection state carries enough to name the failed step | assumption | unverified | AC-11 | author |
| SA-5 | The PRB.T-023 connect flow can be opened for an existing saved server to pair again without dropping its saved entry | assumption | unverified | Plan stage; AC-14 | author |
| SU-1 | The numbers for reconnect, list-ready and bytes (Q-2) | unknown | unverified | TBD (author, 2026-11-15), after this story | author |
| SU-2 | What to show if the default server is a remote and unreachable (EC-5) | unknown | unverified | TBD (author, 2026-11-15) | author |
