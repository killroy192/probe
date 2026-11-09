---
id: PRB.T-025
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Settings follow the client and server ownership split

## Business Goal

**Problem:** Once the UI is connected to several servers, a user cannot tell whether a Settings page edits them or one machine, and a setting about the person (theme, key bindings, general settings, the starting-scripts list) could change or be lost depending on which server's workspace is shown. Today every Settings page is written for the one server that serves the UI.

**Proposed solution:** Apply the split decided in PRB.T-021's audit. Client-owned pages (theme, key bindings, general settings, the user starting-scripts list) are held by the default server and show the same values whichever server's workspace is shown or just connected. Server-owned pages are shown under the server they edit and name it. The docs say which is which.

## Epic and Requirements

- **Epic:** PRB.E-003 Connect Probe to a remote server and open its workspaces
- **Candidate story:** # 5 Settings follow the ownership split
- **Delivers:**
  - FR-4: client-owned settings have the same values whichever server's workspace is shown, are in effect for a server just connected, and are never overridden or changed by a remote server or by connecting or removing one.
  - FR-5 (Settings half): every server-owned Settings page is shown under the server it edits and names it; it reads and writes only that server.
  - NFR-5 (Settings half): on every Settings page the user can tell whether it edits the client app or a named server.
  - NFR-7 (the settings-split docs half): `docs/internals/` records the split and the Settings docs say which pages are which.
  - NFR-4: mobile still compiles after any contract change.
- **One deployable outcome:** A user changes the theme or a key binding while one server's workspace is shown and sees the same values with any other server's workspace, and every server-owned Settings page says which server it edits; this completes the settings part of scenario E3-S2.

## Current Behavior

Partly verified by listing files on 2026-11-09 (the code search index was unavailable); the rest is unverified and is what PRB.T-021 settles.

- **Pages.** Settings sections are routes `apps/web/src/routes/_chat.settings.<section>.tsx`: about, access, appearance, archived, beta, browser, chat, connections, devices, diagnostics, diffs, general, integrations, keybindings, labs, maintenance, open-source-licenses, projects, providers, scheduled-tasks, secrets, snap-shot, source-control, storage, threads, worktrees. The nav and search are in `apps/web/src/components/settings/settingsSearch.ts`; chat-only pages are hidden through `HIDDEN_SETTINGS_PATHS` (PRB.T-003). There is no "Starting scripts" route yet (PRB.T-018 adds it).
- **Scoping.** `settingsScope.ts` can scope settings to a project or one machine; how that relates to the split is unverified (epic Notes for stories).
- **Where values live.** Which pages keep their values in the browser and which in a server's settings file is unverified (epic U-6, settled by PRB.T-021's audit). The epic's starting guess is in its Notes for stories and is not a fact.
- **Server in use.** Whether a Settings page reads and writes the server that serves the UI or can be pointed at another connected server is unverified (epic A-1, A-9, U-1).
- **Servers section.** `/settings/connections` still reads "Environments" until PRB.T-023 renames it.
- **Mobile.** Mobile has its own settings and server list and is not touched by this story; it must still compile.

## Expected Behavior

Settings pages are of two kinds, and the UI says which. Client-owned pages are the same wherever the user is; server-owned pages belong to one named server.

- **Client-owned pages** (the PRB.T-021 audit fixes the list; the starting guess is General, Appearance, Keybindings, the Probe servers page, and the Starting scripts page's user list): read from and saved on the default server, applied to the UI whichever server's workspace is shown. Opening, connecting, disconnecting or removing a remote server changes none of their values.
- **Server-owned pages** (the audit's list; the starting guess includes Worktrees, Source control, Providers, Scheduled tasks, Secrets, Projects, Storage, Maintenance, Diagnostics, Browser, Devices, Integrations, Sharing and access, Archive): shown under the server they edit, with the server's name on the page, in the sidebar grouping, and in settings search results. With several servers connected the user picks the server and sees that server's values.
- **Pages the audit leaves undecided** (Labs, Beta, Diffs, Threads, Chat, SnapShots, About, Open-source licenses) are sorted as the author decides before the plan; none is guessed.
- **Starting scripts rule.** The Starting scripts page holds only the user list on the default server. A workspace's own and disabled scripts live in the dialog opened from the Workspaces menu, on the workspace's server, and never appear in Settings.
- **Docs.** The Settings docs mark each page as client or server, and `docs/internals/` records the rule.

### User Flow

1. The user opens Settings. Each page is labelled as the client app's, or as belonging to a named server.
2. The user changes the theme and a key binding while a workspace of server A is shown.
3. The user opens a workspace of server B. The theme and key binding are the same.
4. The user opens a server-owned page and picks server B. The page names B and shows B's values; editing it changes only B.
5. The user connects a new server C. The theme, key bindings and general settings are unchanged and apply to C's workspaces at once.

### Edge Cases

- EC-1: A page the audit marks both ways (a setting that exists on the client and per project or per machine, `settingsScope.ts`): the client-owned part and the server-owned part are shown as separate, labelled sections. TBD (author, 2026-11-15) for which pages this applies to.
- EC-2: A freshly connected server has its own settings file with other theme or key values: the UI ignores them; the default server's values apply.
- EC-3: Only the default server is connected: client-owned pages look as today; server-owned pages name the default server.
- EC-4: Chat-only pages stay hidden (PRB.T-003); they are not sorted or labelled.
- EC-5: A server-owned page for a server that is currently unreachable: shown as unavailable by PRB.T-026, not here.

### Error Handling

- ER-1: A client-owned page cannot load or save because the default server cannot be reached: the page says so and keeps showing the last values the UI has applied this session. TBD (author, 2026-11-15) whether the UI keeps a local copy across a reload while the default server is down; that server serves the UI, so this is rare.
- ER-2: Saving a server-owned page to its server fails: the error names the server and the page; client-owned values are unaffected.
- ER-3: A server's settings file holds a client-owned key (an older or hand-edited file): ignored, not an error.

## Out Of Scope

- Moving client-owned settings off the default server (per-device storage or sync): not decided in this epic (epic Out).
- The unreachable display of server pages: PRB.T-026.
- The Probe servers page itself (connect, rename, state): PRB.T-023; its disconnect and remove actions: PRB.T-027.
- The Starting scripts page and the workspace scripts dialog behaviour: PRB.E-002 (PRB.T-018, PRB.T-019); this story only fixes where they sit in the split.
- Roles, permissions and per-user access: the epic adds none.
- Chat settings, mobile settings UI, desktop-only verification.
- Renaming "environment" in code or the glossary: epic Q-4.

## Technical Scope

- **Layers:** web Settings (nav, search, page headers, server picker for server pages), client-runtime (reading and writing client-owned settings through the default server, choosing the server for a server-owned page), server settings (default server holds the client-owned values), contracts (only if the audit finds a setting that cannot move without a schema change), docs.
- **Docs impact:** user Settings docs (which page is client or server; `docs/user/remote-access.md` if it names pages); `docs/internals/` (the client-versus-server split, where a maintainer would get it wrong); the glossary entry only if a term is needed.
- **Mobile impact:** contracts may change; mobile must still compile (`vp run check:changed`); no mobile UI.

## Non-functional Requirements and Constraints

- NFR-5: every action works with the mouse or touchpad alone.
- NFR-4: mobile compiles; the browser is the target; desktop shares the Settings and must not break.
- Do not assume the UI can read a server's files; settings of a server travel over the connection.
- Client-owned settings live on the default server, as today (settled 2026-11-09); do not add per-device storage or sync here.
- No credential is stored with settings (epic NFR-3).
- No continuously repainting animation (AGENTS.md).

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given the default server and a second harness server are connected, when the user changes the theme and a key binding with a workspace of one server shown and then opens a workspace of the other, then both values are the same | auto | FR-4 |
| AC-2 | Given the change of AC-1, when the UI is reloaded and a second server is connected, then the values are unchanged and are read from the default server (removal is checked in PRB.T-027's scenario) | auto | FR-4 |
| AC-3 | Given a second server whose own settings hold a different theme, when it is connected, then the UI keeps the default server's theme | auto | FR-4, EC-2, ER-3 |
| AC-4 | Given two servers connected, when the user opens a server-owned page and picks the second server, then the page names that server and shows its values (which differ from the first server's) | auto | FR-5 |
| AC-5 | Given the page of AC-4, when the user edits a value and saves, then only the second server's setting changes | auto | FR-5, NFR-5 |
| AC-6 | Given any Settings page, when the user reads its header and the sidebar and settings search, then it states "client app" or names one server | auto | NFR-5 |
| AC-7 | Given only the default server is connected, when the user opens client and server pages, then client pages look as before and server pages name the default server | auto | EC-3 |
| AC-8 | Given the audit of PRB.T-021, when the Settings route list is compared with the sorted list, then every non-hidden page is sorted and the undecided ones carry the author's decision | manual (author) | FR-4, FR-5 |
| AC-9 | Given a page with both client and per-machine settings, when it is opened, then each part is a labelled section of its owner | manual (author) | EC-1 |
| AC-10 | Given chat-only pages, when Settings opens, then they stay hidden | auto | EC-4 |
| AC-11 | Given saving a server-owned page fails, when the user saves, then the error names the server and page and client values are unchanged | auto | ER-2 |
| AC-12 | Given the default server cannot be reached, when a client-owned page is opened, then it says so and the UI keeps its applied values | manual (author) | ER-1 |
| AC-13 | Given the change, when `vp run check:changed` runs, then mobile and the contract dependents type-check | auto | NFR-4 |
| AC-14 | Given the docs diff, when read, then the Settings docs mark each page as client or server and `docs/internals/` records the split | manual (reviewer) | NFR-7 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-021 | The audit sorts every page; this story applies its list | backlog |
| PRB.T-023 | Server pages hang under the Probe servers list | backlog |
| PRB.T-022 | The UI must already serve a workspace from its own server | backlog |
| PRB.T-018 (soft, PRB.E-002) | The Starting scripts page it places in the split; if not built, that page is placed when it ships | backlog |
| Author's decision (pre-plan) | The sorting of the undecided pages (Labs, Beta, Diffs, Threads, Chat, SnapShots, About, Open-source licenses, SU-2) must be recorded before the plan is written; none is guessed | open |

Blocks: PRB.T-026 (the server-owned pages must exist before their unreachable state is shown), PRB.T-028 (PRB.E-003 NFR-7 docs), and the E3-S2 scenario completion. Not blocked by or blocking PRB.T-024, which is independent of it. No cycles.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The UI can read and save client-owned settings on the default server and apply them while a remote server's workspace is shown (epic A-16) | assumption | unverified | PRB.T-021 reads the loading; AC-1 proves it | author |
| SA-2 | Each server-owned page can be pointed at a chosen connected server (epic A-1, A-9) | assumption | unverified | PRB.T-021 audit; AC-4 | author |
| SU-1 | Where each page keeps its values today (epic U-6). Some values are held in the browser today; if PRB.T-021's U-6 result shows that, this story gains a migration of those values to the default server, and the author re-scopes the story (size, ACs) before the plan | unknown | unverified | PRB.T-021 audit, before this story is planned | author |
| SU-2 | The sorting of the undecided pages (Labs, Beta, Diffs, Threads, Chat, SnapShots, About, Open-source licenses) | unknown | unverified | TBD (author, 2026-11-15), AC-8 | author |
| SU-3 | Whether the UI keeps client values across a reload while the default server is down (ER-1) | unknown | unverified | TBD (author, 2026-11-15) | author |
