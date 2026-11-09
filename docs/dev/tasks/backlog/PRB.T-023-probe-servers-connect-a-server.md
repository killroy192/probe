---
id: PRB.T-023
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Probe servers: connect a server

## Business Goal

**Problem:** The UI can connect to other servers only through the inherited "Environments" Settings section, named for the chat era, offering connection kinds Probe will not support yet, and not tied to the terminal-first workspace list. After PRB.T-022 a connected server's workspaces show in the list, but only the harness can connect one. A user cannot reach a server they started themselves, and a wrong token, an expired one, an older server or a plain http address to the public internet is not refused in terms of this product.

**Proposed solution:** The Settings section is renamed "Probe servers". The user adds a server by its direct address (https, or http on a LAN, tailnet or loopback address) and its pairing token or URL, sees its connection state, and its workspaces enter the list. Wrong, expired and already used pairings, a mismatched protocol version and plain http to a public address are each refused with a message that says which, and nothing is saved. This replaces the test-only seam.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 3 Probe servers: connect a server
- **Delivers:**
  - FR-2 (the connect half): connecting needs the server's address and a pairing credential; its existing workspaces enter the list.
  - FR-12: a wrong, expired or already used pairing is refused with a message that says which; nothing is saved; the credential is never shown again after entry.
  - FR-13: a server whose protocol version differs is refused before any of its workspaces open or enter the list, with a message that says whether the UI or the server must be updated.
  - FR-15: the connect flow offers direct address only; the protocol is identical for all kinds; plain http to a public address is refused.
  - FR-16: a connection shows its state (connecting, connected, reconnecting, unreachable, refused) in one place per server.
  - FR-18 (the list and add half): the section is named "Probe servers" wherever the UI names it (sidebar, page title, settings search) and in the user docs; it lists the default server and every saved remote with its state and offers "add a server". Disconnect, reconnect and remove actions are PRB.T-027 and PRB.T-026.
  - NFR-3 (connect half): credentials are kept only in the client's browser profile and are never logged or shown; the UI never sends a credential to an address that does not answer as the saved server; plain http only on LAN, tailnet or loopback; a token paired over https is never sent over http.
  - NFR-5: connecting works with the pointer alone, every error names the server and what to do next.
  - NFR-6: the connection state and the failed step are shown; the server logs each pairing and each refused version with the server label.
  - NFR-7 (docs half): the user docs gain "Connect to a Probe server" and every "Settings > Environments" reference for web and desktop reads "Probe servers".
  - NFR-4: scenarios in headless Chromium; mobile keeps its own labels and compiles.
- **One deployable outcome:** A user adds a server they started by its address and pairing token in Settings > Probe servers, sees it connect, and its workspaces appear in the list; bad tokens, a version mismatch and a public http address are refused with a clear reason. No harness seam is needed.

## Current Behavior

Verified by reading the code on 2026-11-09 (the code search index was unavailable). Detailed findings for pairing, the origin check and the credential storage come from the PRB.T-021 audit and are unverified here.

- **Section.** `apps/web/src/components/settings/ConnectionsSettings.tsx` titles the section "Environments" (around line 1482), with `AddEnvironmentDialog.tsx`, `EnvironmentRow.tsx` and `EnvironmentRoutesList.tsx`; `settingsSearch.ts` has the label `"/settings/connections": "Environments"` and an "Environments" search entry. It also holds pairing links, T3 Connect relay rows, linked environments and load-balancing settings.
- **Docs.** `docs/user/remote-access.md` (and `faq.md`, `outside-agents.md`, `t3-connect-troubleshooting.md`) says "Settings > Environments".
- **Connection code.** `packages/client-runtime/src/connection/` has the registry, supervisor, routes and `compatibility.ts`; the check compares one integer, with a missing value counting as version 1. `docs/internals/remote.md` documents a server-side rule for plain http and that a token paired over https never travels over http. A client-side refusal of plain http to a public address, and how a typed address is classified, are unverified (epic U-5, A-13).
- **Credentials.** Unverified: stored in the saved-server storage of the browser profile and not logged (epic A-14).
- **Refusal reasons.** Unverified: distinct reasons for wrong, expired and used pairing and whether the UI shows which (epic A-11); and the server-side logs of pairing and refused versions (A-12).
- **Workspace list.** After PRB.T-022 it is the union over connected servers; here the harness can connect a server only through the test-only seam of PRB.T-021.
- **Mobile.** Has its own "Environments" settings and server list; left as it is.

## Expected Behavior

- The Settings section reads "Probe servers" in the sidebar, the page title, settings search and the user docs, on web and desktop. Mobile keeps its labels.
- The section lists the default server and every saved remote, each with its connection state in one place. The default server shows but is not disconnectable or removable (Q-3).
- "Add a server" asks for the direct address and a pairing token or URL, and offers no SSH forward or T3 Connect relay option. Direct address covers a LAN address, a tailnet address and a container port published on 127.0.0.1; they are one kind. Connecting a server brings all of its workspaces into the list with no per-workspace step.
- A wrong, expired and already used token are each refused with a message saying which; nothing is saved. The token is not shown again after entry.
- A server whose protocol integer differs is refused before any of its workspaces open or enter the list; the message says whether the UI or the server must be updated.
- Plain http is allowed only for LAN, tailnet or loopback addresses and refused for a public address, on the client side; a token paired over https is never sent over http.
- The saved server and its credential survive a reload. The diagnosis names the failed step (address unreachable, refused credential, version mismatch).
- Where connecting a new server is also offered from the create-workspace flow is PRB.T-024 (Q-1).
- The section's existing T3 Connect relay rows, linked environments, pairing links and load-balancing settings are left as they are and are not part of this story (out of scope); only the add flow is constrained (no SSH forward or relay option, AC-8).

### User Flow

1. The user opens Settings > Probe servers and chooses "Add a server".
2. They type the address of the server they started and its pairing token or URL, and confirm.
3. The state moves through connecting to connected; the server's workspaces appear in the workspace list, labelled with it.
4. With a wrong or expired token they see which, and nothing is saved; they try again with a good one.
5. They reload and the server is still connected without pairing again.

### Edge Cases

- EC-1: An address with a trailing path or no scheme is normalized or refused with a message; no half-saved server.
- EC-2: The same server added twice is recognized by its identity, not duplicated.
- EC-3: An http address that resolves to a public IP (for example a DNS name) is classified by the rule settled in the PRB.T-021 audit (U-5), and is refused when public.
- EC-4: A pairing URL carrying the token is pasted instead of a token; it works and the token is not shown again.
- EC-5: The address answers as a different server than the one saved (a changed identity); the credential is not sent.
- EC-6: A server with no workspaces connects and contributes nothing to the list.
- EC-7: The address works over http on loopback in the harness and over https where the harness can start one (A-15); LAN, tailnet and published ports are checked by hand.

### Error Handling

- ER-1: Wrong, expired and already used token: three distinct messages, each naming the server address and what to do next; nothing saved.
- ER-2: Protocol version differs: refused, message says which side to update; none of its workspaces enter the list.
- ER-3: Address unreachable, or a server that answers as something else: the failed step is named; nothing saved.
- ER-4: Plain http to a public address: refused client-side with a message; no credential is sent.
- ER-5: The server logs each pairing and each refused version with the server label and never the credential or pairing URL; the UI never logs them either.

## Out Of Scope

- Choosing a server when creating a workspace, and offering connect from that flow: PRB.T-024.
- Settings pages under their owner and the client-owned values: PRB.T-025.
- Reconnect, unreachable displays: PRB.T-026. Disconnect and remove, the confirmation: PRB.T-027.
- SSH forward and T3 Connect relay as connection kinds (deferred, same protocol, FR-15).
- Renaming "environment" in code, contracts or the glossary (Q-4); the glossary note is a docs update here only if cheap.
- Installing Probe on the remote: PRB.E-004.
- Any roles or permission changes; this epic adds none.
- The existing T3 Connect relay rows, linked environments, pairing links and load-balancing settings in the section: left as they are.
- Mobile UI and desktop-specific flows.

## Technical Scope

- **Layers:** web Settings (section, add dialog, state display, settings search), `packages/client-runtime` connection code for the address classification and refusals, server pairing logs, scenario harness (a harness server with another protocol integer, bad and expired tokens), `docs/user`.
- **Docs impact:** every `docs/user` page that says "Settings > Environments" (`remote-access.md`, `faq.md`, `outside-agents.md`, `t3-connect-troubleshooting.md`, `updating.md` around lines 5, 29 and 164, `source-control.md` around line 186) renames "Environments" to "Probe servers" for web and desktop; mobile-specific mentions (such as "Environments on mobile", and the phone steps in `updating.md`) stay and gain a "Connect to a Probe server" section; `docs/internals/remote.md` updated if the client-side http rule is new. Same PR.
- **Mobile impact:** none to the UI; contracts or client-runtime changes must still compile on mobile (`vp run check:changed`).

## Non-functional Requirements and Constraints

- Credentials and session tokens only in the client's browser profile, never on the default server, never logged or shown after entry (NFR-3).
- The UI never sends a credential to an address that does not answer as the saved server; a token paired over https never goes over http.
- The protocol is the existing one; the only compatibility rule is the integer check (roadmap).
- Every action works with the pointer; Enter is a shortcut only (scope decision 8).
- No continuously repainting animation for connection states.
- The harness does not require containers.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given a harness second server and its pairing token, when the user adds it in Settings > Probe servers by loopback address, then its state reaches connected and its workspaces appear in the list with no import step, without the test-only seam | auto | FR-2, FR-15, FR-16 |
| AC-2 | Given a wrong token, when the user adds the server, then the message says the token is wrong, names the server, and nothing is saved | auto | FR-12, ER-1 |
| AC-3 | Given an expired token, when the user adds the server, then the message says it expired and nothing is saved | auto | FR-12, ER-1 |
| AC-4 | Given an already used token, when the user adds the server, then the message says it was already used and nothing is saved | auto | FR-12, ER-1 |
| AC-5 | Given a token was entered, when the dialog closes and Settings and the page are read afterwards, then the credential is not shown anywhere | auto | FR-12 |
| AC-6 | Given a harness server started with another protocol integer, when the user adds it, then it is refused with a message saying whether the UI or the server must be updated and none of its workspaces enter the list | auto | FR-13, ER-2 |
| AC-7 | Given Settings, when the section is opened by the sidebar and by settings search, then it is named "Probe servers" and no "Environments" text remains for web and desktop | auto | FR-18 |
| AC-8 | Given the add flow, when it is opened, then it offers a direct address only and no SSH forward or T3 Connect relay | auto | FR-15 |
| AC-9 | Given the section, when it is read with a connected remote, then the default server and the remote are listed, each with its state, and the default server offers no disconnect or remove | auto | FR-18, FR-16 |
| AC-10 | Given a connected server, when the page is reloaded, then it is still connected without a new pairing | auto | FR-2, NFR-3 |
| AC-11 | Given the same server added twice, when the second add completes, then there is one entry | auto | EC-2 |
| AC-12 | Given a plain http address that classifies as public, when the user adds it, then it is refused client-side with a message and no credential is sent | auto | FR-15, NFR-3, EC-3, ER-4 |
| AC-13 | Given a server saved over https, when a route over plain http is offered, then the token is not sent over http | auto | NFR-3 |
| AC-14 | Given an address that answers as a different server than the saved one, when the user adds it (add time only), then the credential is not sent and the failed step is named; the reconnect variant is covered in PRB.T-026 | auto | NFR-3, EC-5, ER-3 |
| AC-15 | Given an unreachable address, when the user adds it, then the failed step "address unreachable" is shown and nothing is saved | auto | NFR-6, ER-3 |
| AC-16 | Given the server log, when a pairing and a refused version happened, then each is logged with the server label and no line holds the credential or pairing URL | auto | NFR-3, NFR-6, ER-5 |
| AC-17 | Given a pasted pairing URL, when added, then it connects and the token is not shown again | auto | EC-4, FR-12 |
| AC-18 | Given a server with no workspaces, when connected, then it is connected and adds nothing to the list | auto | EC-6 |
| AC-19 | Given a LAN address, a tailnet address and a container port published on 127.0.0.1, when the author connects to a real server, then each connects | manual (author) | FR-15, EC-7 |
| AC-20 | Given a loopback https server (if the harness can start one, A-15), when added, then it connects | auto | FR-15, EC-7 |
| AC-21 | Given the change, when `vp run check:changed` runs, then it passes, including the mobile typecheck, and mobile still reads "Environments" | auto | NFR-4 |
| AC-22 | Given the docs diff, when read, then no `docs/user` page says "Settings > Environments" for web or desktop, and mobile-specific mentions are unchanged | manual (author) | NFR-7 |
| AC-23 | Given an https loopback server cannot be started by the harness (A-15), when the author connects to an https server by hand, then it connects | manual (author) | FR-15, EC-7 |
| AC-24 | Given the scenarios of this story, when they run, then none uses the test-only seam of PRB.T-021 (AC-1 is the check: it connects by the add flow alone) and the seam is removed or replaced | auto | FR-2 |

## Dependencies

Depends on:

- PRB.T-022: the list must already show a connected server's workspaces.
- PRB.T-021: the harness second server, the audit results on pairing, the origin check, credential storage and address classification (A-2, A-3, A-10, A-11, A-13 to A-15, U-5).
- Decisions Q-1 (where to connect) and Q-3 (default server not removable), both owned by the author, before this story. The Q-3 default (the default server is not removable) stands unless the author vetoes it before planning.

Blocks:

- PRB.T-024 (the picker can only offer connected servers and the connect from that flow).
- PRB.T-025 (needs the server list to hang server pages under).
- PRB.T-026, PRB.T-027 (reverse states of a connection that exists).
- PRB.T-028 (replays against a connected server).
- PRB.T-033 (soft: it uses this flow for the pairing check when it exists, otherwise a plain HTTP check; not required to start).

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-022 | List shows a connected server's workspaces | backlog |
| PRB.T-021 | Harness, audit of pairing and address rules | backlog |
| Q-1, Q-3 (epic) | Where to connect, default server rule | proposed default, author to confirm |

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | The existing pairing and route code works for a terminal-first server (epic A-2) | assumption | unverified | PRB.T-021 pairs by hand; AC-1 | author |
| SA-2 | The server gives distinct refusal reasons for wrong, expired and used pairing and the UI can show which (epic A-11) | assumption | unverified | PRB.T-021 reads; AC-2 to AC-4 | author |
| SA-3 | The protocol check blocks a mismatched server in this app (epic A-3) | assumption | unverified | AC-6 | author |
| SA-4 | The server already logs each pairing and each refused version with enough to carry the server label (epic A-12) | assumption | unverified | AC-16 | author |
| SA-5 | The credential lives only in the browser profile's saved-server storage and is not logged (epic A-14) | assumption | unverified | PRB.T-021 reads; AC-5, AC-16 | author |
| SA-6 | The harness can start an https loopback server (epic A-15) | assumption | unverified | PRB.T-021 | author |
| SU-1 | How a typed address is classified (DNS name resolving to private IP) and whether a client-side http-public refusal exists (epic U-5) | unknown | unverified | PRB.T-021 settles; this story builds it if missing | author |
| SU-2 | Q-1 and Q-3 outcomes (where to connect; default server rule) | unknown | unverified | TBD (author, 2026-11-15), before this story | author |
