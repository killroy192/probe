# Remote audit: local assumptions and the settings sort (PRB.T-021)

Spike report for PRB.E-003 story 1, 2026-11-09. Code read at `prb-t-021` (base `c229f2b3b`) and a
hands-on walk with two harness servers (`scripts/scenarios`, scenario R1 plus a throwaway
Playwright script). It answers the epic's story-1 rows and gives stories 2 to 8 their starting
facts. Fixes are not made here; each row names the story that owns it.

How it was walked: server 1 serves the UI, server 2 is a second `startServer` on its own throwaway
home. Server 2 was paired by hand through Settings > Environments > Add environment, then every
visible Settings page was opened with `?machine=<server 2>`, while the harness recorded which port
each request went to. The two servers run as one user in one container, so no file permission can
hide server 2's folders from server 1. Wrong-server reads are therefore caught by request origin,
not by a failing file read (EC-1, agreed with the author).

## 1. Local assumptions

| Where | Assumes | What breaks with a remote server | Fixed by |
| --- | --- | --- | --- |
| `apps/web/src/state/workspaces.ts` `useWorkspaces` (`usePrimaryEnvironmentId()`) | The workspace list, create, open, remove, add project, start shell, kill and restore all run on the server that served the page | A connected second server's workspaces never appear; every workspace action goes to the default server. Shown, tabs, tree and terminals already carry an environment id, so they follow once the list does | PRB.T-022 (list), PRB.T-024 (create) |
| `apps/web/src/components/workspaces/WorkspaceSidebar.tsx` `WorkspaceItems`, the tree root and the "+" modal title | One server: entries are bare names | Same name on two servers shows twice with nothing to tell them apart (EC-4). Keys are already safe: `probe:shown-workspace:<environmentId>` and tabs key `[environmentId, name]` | PRB.T-022 |
| Server label (descriptor `label`, the host name by default) | One server per machine | Two servers on one machine get the same label (the walk showed both as `c4f2ed03590b`), so a server label alone cannot tell them apart either | PRB.T-022 (entry label), PRB.T-023 (label at connect) |
| `apps/web/src/components/workspaces/serverLocation.ts` `isServerRemote` via `AddProjectDialog.tsx` | The page host tells whether the folder's server is remote | It reads `window.location.hostname`, the default server's host, not the workspace server's. A Linux remote opened from a loopback UI on Linux counts as local. The folder browse itself already goes to the named server (`filesystemEnvironment.browse({ environmentId })`) | PRB.T-024 |
| `AddProjectDialog.tsx` native picker | The desktop's own server is `PrimaryConnectionTarget` | Correct today (native picker only for the desktop's own server); keep it when the picker can target remotes | PRB.T-024 (keep) |
| `apps/web/src/components/settings/ConnectionsSettings.tsx` `view="access"` (Sharing & access) | `usePrimaryEnvironment()` | Ignores the scope picker: with `?machine=<server 2>` it still shows server 1's version, address, network access and authorized clients | PRB.T-025 |
| `apps/web/src/components/settings/useScopedSettings.ts` `planScopedSettingsPatch` (scope `all`, the default) | Writing a setting everywhere is what the user wants | Every server-owned page writes the change to **every connected server** unless a machine is picked. A remote's settings change when the user edits the default server's | PRB.T-025 |
| `apps/web/src/hooks/useSettings.ts` `useUpdateSettingsTarget` + `packages/client-runtime/src/state/sharedSettings.ts` | Shared keys belong on every server | `SHARED_SERVER_SETTING_KEYS` (including `newWorktreesStartFromOrigin`; the rest are chat) are copied to every connected server on each edit | PRB.T-025 |
| `apps/web/src/state/server.ts` `primaryServerKeybindingsAtom` | Shortcuts come from the default server | Correct for the epic (keybindings are client-owned on the default server). But Settings > Keybindings is scope-aware and writes `keybindings.json` of whichever server is scoped, which then has no effect | PRB.T-025 |
| `apps/web/src/hooks/useDefaultTheme.ts` | The default server's `defaultTheme` seeds the theme once per generation | Correct for the epic; the applied theme itself lives in the browser (see section 2) | PRB.T-025 (confirm) |
| `apps/web/src/state/server.ts` `primaryServerConfigAtom`, `primaryServerSettingsAtom` | Config and server settings shown by global UI come from the default server | Fine for client-owned values; any server-owned value read through it (for example the server version in Sharing & access) names the wrong server | PRB.T-025 |
| `apps/web/src/state/assets.ts` `localMediaEnvironment` | Local media through the desktop's own server | Desktop-only; not on the browser path | Desktop phase |
| Connection runtime on every page load | Each saved server is a chat-era environment | Each connected server opens a socket and fetches `/api/orchestration/shell` (a chat snapshot) on every load. One more server costs this on every reload | PRB.T-022 (records NFR-1 bytes) |
| Dev mode CORS (`apps/server/src/http.ts` `layerBrowserApiCors`) | The UI and server are one origin | A server started with a dev URL allows only that Vite origin and the desktop origins. A UI from another dev server cannot reach it. Servers without a dev URL (harness, installed) allow any origin; bearer auth is not cookie-bound | PRB.T-023 (note for dev and E-004) |
| `chat` code paths (`CommandPalette`, `Sidebar`, `ChatView`, `BranchToolbar` and about 40 more files that read the primary environment) | One server | Hidden and frozen (phase 6). Not fixed in this epic | Phase 6 |

Found to be correct on a remote, no change needed:

- **The `probe` command in a shell** (U-4): the server writes `<state>/shell-bin/endpoint` with its own bound address (loopback when bound to every interface) and `PROBE_SHELL_ENDPOINT_FILE` points at it (`apps/server/src/terminal/Shells.ts` `prepareSelfKill`). The shell, the file and the server are on the same machine.
- **MCP tools** (U-4): agents get `http://<bound host or 127.0.0.1>:<port>/mcp` from their own server (`apps/server/src/mcp/McpSessionRegistry.ts`). Same machine as the agent.
- **Scheduled tasks** (U-4): a server-side service in each server's state; the Settings page is hidden as chat-only. Nothing crosses servers.
- **Saved workspaces** (A-4, A-8): `apps/server/src/savedWorkspaces/SavedWorkspaces.ts` keeps them in the server's `userdata/workspaces`. `subscribeWorkspaces` sends the whole list on subscribe and again on any change, including files edited on disk (`fs.watch`, debounced). R1 reads it over a bearer session.
- **Folder browsing** (A-4): `filesystem.browse` is a server RPC on the named environment.

## 2. Settings sort

Three stores exist today, not two:

1. **Client settings** (`ClientSettingsSchema`, `packages/contracts/src/settings.ts`): browser `localStorage` key `t3code:client-settings:v1` (`apps/web/src/clientPersistenceStorage.ts`), or the desktop settings file through `desktopBridge.getClientSettings`. They are per browser profile, not on any server. The theme, appearance mode and fonts are in `localStorage` too (`apps/web/src/hooks/useTheme.ts`).
2. **Server settings** (`ServerSettings`): the settings file of the server the write targets. The scope picker (`settingsScope.ts`, `?machine=`, `?project=`, `?checkout=`) chooses the targets; scope `all` means every connected server.
3. **Shared server keys**: a fixed list copied to every connected server on each edit (section 1).

Keybindings live in each server's `keybindings.json`; the app's shortcuts read the default server's. Saved servers and their credentials live in the browser (IndexedDB) or desktop secure storage.

`settingsScope.ts` relates to the split like this: its machine scope is the mechanism PRB.T-025 can use to make a server-owned page name and edit one server. Its `all` scope is the fan-out that the epic rules out, and its project scope is per server too.

There are 26 page routes (27 `_chat.settings.*` files minus the layout `_chat.settings.tsx`).

| Route | Shown today | Sort | Where its values live today | Notes |
| --- | --- | --- | --- | --- |
| general | yes | client-owned | client settings (browser / desktop file) | All of its rows are client keys; the scope picker has no effect on them |
| appearance | yes | client-owned | client settings and theme keys in `localStorage`; the default server's `defaultTheme` seeds it | Chat-only rows hidden (`HIDDEN_SETTINGS_ROWS`) |
| keybindings | yes | client-owned | each server's `keybindings.json`; shortcuts read the default server's | Must be pinned to the default server (section 1) |
| connections (Environments, to become Probe servers) | yes | client-owned | browser IndexedDB `t3code:connection-runtime` / desktop secure storage | Credentials must stay there, not on the default server (matches the epic) |
| access (Sharing & access) | yes | server-owned | the server's auth store and `environmentIcon` | Ignores the scope today |
| source-control | yes | server-owned | server settings | Scope-aware |
| worktrees | yes | server-owned | server settings (`newWorktreesStartFromOrigin` is a shared key) | Scope-aware |
| maintenance | yes | server-owned | server settings | Scope-aware |
| diagnostics | yes | server-owned | live RPCs to the scoped server | Scope-aware |
| secrets | behind `isSecretsFeatureEnabled` | server-owned | server settings (`secretProviders`) and secret store | Single-server scope |
| labs | yes | **question** | mixed: client keys (boring and legacy sidebar, chat-era) and server keys (guest links, linked environments, simlock hosts) | Q-A below |
| about | yes | **question** | stores nothing; shows the client version, mobile app and legal | Q-B below |
| open-source-licenses | yes | **question** | stores nothing (static) | Q-B below |
| beta | redirect to labs | follows labs | | Old link |
| integrations | redirect to browser | follows browser | | Old link |
| storage | redirect to maintenance | follows maintenance | | Old link |
| browser | hidden (chat) | **question** | mixed: `browser*` client keys and `enableAgentBrowserAccess` server key | Q-C below |
| chat | hidden (chat) | client-owned | client settings | Removed in phase 6 |
| diffs | hidden (chat) | client-owned | client settings | Removed in phase 6 |
| snap-shot | hidden (chat) | client-owned | client settings | Removed in phase 6 |
| threads | hidden (chat) | server-owned | server settings (several shared keys) | Removed in phase 6 |
| archived | hidden (chat) | server-owned | server state (threads) | Removed in phase 6 |
| projects | hidden (chat) | server-owned | server settings, project files | Removed in phase 6 |
| providers | hidden (chat) | server-owned | server settings | Single-server scope |
| scheduled-tasks | hidden (chat) | server-owned | server state | |
| devices | hidden (chat) | server-owned | server settings (device hosts) | |

The epic's starting guess holds for General, Appearance, Keybindings, the Probe servers page,
Worktrees, Source control, Providers, Scheduled tasks, Secrets, Projects, Storage, Maintenance,
Diagnostics, Devices, Sharing & access and Archive. It differs in three places:

- **"Client-owned settings live on the default server, as they do now" is false for most of them.** General, Appearance, Snap Shot, Chat and Diffs keep their values in the browser profile (or the desktop file), not on any server; only keybindings and the default theme come from the default server. See Q-D.
- **Integrations** is not its own page; it redirects to Browser, which is mixed.
- **Starting scripts** has no Settings route yet (PRB.E-002 has not landed it); it is sorted by the settled rule (client-owned, user list on the default server) when it exists.

### Questions for the author

- **Q-A, Labs.**\1 *Deferred by the author (2026-11-09).*
- **Q-B, About and Open-source licenses.**\1 *Deferred by the author (2026-11-09).*
- **Q-C, Browser (hidden).** Client `browser*` preferences plus the server's agent browser access. Split it when it is unhidden, or leave it hidden until chat removal decides?
- **Q-D, where client-owned settings live. Decided (author, 2026-11-09): on the default server, the host server that serves the UI.** Today General, Appearance and the theme are per browser profile (or the desktop file), so PRB.T-025 moves them to the default server; keybindings and the default theme are already there. A remote server's state never overrides them.

## 3. Assumption results

| Row | Result | Evidence | Story |
| --- | --- | --- | --- |
| A-1 | Partly holds | The registry holds the default server and a second server at once: the walk showed both sockets open and server 2 "Connected" in Settings. The workspace screens do not pick a server per workspace; `useWorkspaces` uses the default server only. View state already carries an environment id | T-022 |
| A-2 | Holds | Server 2 (fresh home, no chat state) paired by hand through Add environment with its pairing URL: "Backend added", `/oauth/token` then a socket to server 2, page shows it Connected | T-023 |
| A-3 | Holds (read) | `packages/client-runtime/src/connection/compatibility.ts`: a missing `orchestrationProtocolVersion` counts as 1. Any difference blocks with reason `unsupported` and a message that says which side to update, checked in `resolver.ts` before the session opens. The messages say "T3 Code" | T-023 runs it |
| A-4 | Holds, one exception | Workspace, shell, project and folder operations are server RPCs on a named environment. Exception: `isServerRemote` reads the page host (section 1) | T-024 |
| A-6 | False for NFR-2 as stated | `supervisor.ts`: retry ceiling `min(300 s, 1 s × 2^(n+1))`, jittered between half and full. Backoff resets after 30 s of stable connection, on `network-changed` and when the tab becomes active again (`wakeups.ts`). After about a minute of failures the next try can be 32 to 64 s away, after two minutes 64 to 128 s. A server restart that takes longer than about a minute, with the tab visible and no network change, can miss the 60 s limit | T-026 decides cap or wake-up |
| A-7 | Holds | The server prints `pairingUrl:` at startup when auth is required (stdout only, `serverRuntimeStartup.ts`); `t3 pair` and `t3 auth pairing create` mint more. User-facing names still say T3 | T-023 |
| A-8 | Holds | `subscribeWorkspaces` sends the full list (names only) on subscribe and on every change, including direct file edits. R1 reads it in one request | T-022 |
| A-9 | Holds | The workspace screens get their server only from `useWorkspaces`; Sharing & access reads the default server; other Settings pages take the scoped server | T-022, T-025 |
| A-10 | Holds (read) | `driver.ts` checks the public descriptor before sending a credential; a different `environmentId` makes the route "silent", so the token is not sent. Pairing checks it before redeeming (`onboarding.ts`). It is per saved entry, so several servers do not interfere. A wrong identity reads as unreachable, not "different server" | T-023 runs it |
| A-11 | False | The server has distinct internal errors (unknown, expired, revoked, proof-key mismatch). An already used token is reported as unknown (`PairingGrantStore.ts`), and over HTTP every one becomes `invalid_credential` (`EnvironmentAuth.serverAuthCredentialReason`). The UI cannot tell wrong, expired and used apart | T-023 (server reason + UI) |
| A-13 | Half holds | A token paired over https, loopback or the tailnet is never sent to a learned plain-http route (`routes.ts` `tokenAllowsPlainHttp`, `sendsTokenInClear`). The UI does **not** refuse pairing over plain http to a public address: a plain-http pairing to a public host is accepted, and its token may then use other plain-http routes | T-023 builds the refusal |
| A-14 | Holds, with notes | Browser: IndexedDB `t3code:connection-runtime` store `catalog` (readable by any script on the UI origin, like any web storage). Desktop: secure storage through the desktop bridge. No client log or span carries a token (logs name the environment id only). Server logs during the walk held only the startup pairing URL on stdout, which is by design. WebSocket URLs carry a short-lived `wsTicket` | T-023 confirms at connect time |
| A-15 | Holds via a proxy | The server has no TLS option. A harness-side `node:https` proxy (self-signed cert from `openssl` at run time, Chromium `ignoreHTTPSErrors`) in front of server 2 paired and connected over `wss://` in the walk. About 50 lines; not added to the harness yet because no scenario needs it | T-023 adds it with the refusal test |
| A-16 | Partly false | Keybindings and the default theme come from the default server and are applied whichever server is shown. Other client settings come from the browser, not the default server. Server settings writes fan out to every connected server in scope `all`, and shared keys always fan out, so a remote's settings follow edits made against the default server (the reverse of the epic's direction) | T-025, Q-D |
| U-1 | Answered | Section 1: the workspace screens (all data on the default server), Sharing & access, scope `all` writes, shared keys, `isServerRemote`. Diagnostics, Source control, Worktrees, Maintenance and Secrets follow the scope picker | T-022, T-024, T-025 |
| U-4 | Answered | The `probe` command, MCP and scheduled tasks are per server and correct on a remote (section 1). The per-load chat snapshot from every server is the one cross-server cost | T-022 |
| U-5 | Answered | `packages/shared/src/hostClassification.ts` via `routes.ts` `connectionRouteKind`, by host name text only, with no DNS lookup: loopback (`localhost`, `::1`, `127/8`); tailnet (`*.ts.net`, `fd7a:115c:a1e0::/48`, or a route learned as Tailscale); `vpn` (`100.64/10`); LAN (RFC 1918, link-local, ULA, `.local`, `.localhost`, `home.arpa`, single-label names); everything else public. A DNS name that resolves to a private IP is public. No client-side refusal of plain http exists (A-13) | T-023 |
| U-6 | Answered | Section 2 | T-025 |

New unknown for the epic: **U-8**, where client-owned settings live (Q-D). It changes PRB.T-025's size and FR-4's wording.

## 4. Harness facts for later stories

- `ScenarioContext.startSecondServer()` starts a second server on its own throwaway home and port; the runner stops both by captured pid when the scenario ends, fails or is interrupted (`harness.test.ts`).
- `scripts/scenarios/seam.ts` saves a server in the browser's connection catalog with a bearer token from `t3 auth session issue --token-only`, then reloads. PRB.T-023 replaces it with the connect flow. PRB.T-022's AC-10 ("seam switched off") is a catalog entry removed the same way.
- `connectRpc(origin, { bearerToken })` drives a server that has no page session.
- An https route for the refusal test: a TLS proxy as described under A-15.
