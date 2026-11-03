---
id: PRB.T-003
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first, chat-removal, plan]
created: 2026-11-02
updated: 2026-11-02
---

# Workspaces and the terminal-only shell-tree screen

## Business Goal

**Problem:** Today the browser app is chat-first: opening it lands in a chat thread of the most recent project, and the sidebar is a project > thread tree. There is no workspace concept and no way to open the app without meeting chat. The terminal-first pivot cannot start until the user sees a different product.

**Proposed solution:** The app opens on a terminal-only screen. With no workspace it offers "Open workspace" and "Create workspace"; once a workspace exists it shows that workspace as the root of an (empty) shell tree, a "Workspaces" button at the top left switches, creates, opens and removes workspaces, and chat is hidden: no control or address reaches a chat.

## Epic and Requirements

- **Epic:** PRB.E-001 Terminal-first workspace: shell tree with mock-agent shells
- **Candidate story:** # 3 Workspaces and the terminal-only shell-tree screen
- **Delivers:**
  - FR-1: no visible control or route starts or opens a chat thread; chat screens, chat-related settings pages and the old project > thread sidebar are hidden; an old chat address (a bookmark or typed link to the former chat UI, such as /threads/<id>) lands on the current workspace, or on the start screen when none is shown (scenario S1). Deleting the chat code is a later epic.
  - FR-2: the start screen with "Open workspace" (a scrollable dropdown of the saved workspaces, by name, parsed from the file names in Probe's internal folder) and "Create workspace" (named), and the workspace as root of the tree (S1).
  - FR-24 (part): the "Workspaces" button to switch, create, open and remove workspaces; names are unique; removing the shown workspace returns to the start screen; opening a workspace from the list brings back its layout, and choosing the shown one changes nothing; a removed workspace is deleted with its file; removal never deletes folders on disk (S1). Not here: force-killing the workspace's shells (story 6, S6; no shells exist yet) and which workspace is shown after a browser reload (story 7); the list of saved workspaces already survives a reload here (AC-20).
  - FR-7 (part): the tree and its grouping structure, with the workspace as root. With no folders and no shells yet, only the root is visible; shells appear (within 1 second) from story 4 and the worktree and branch levels from story 5.
  - NFR-3: the S1 scenario uses throwaway data.
  - NFR-4: the scenario runs in Playwright's headless Chromium.
  - NFR-5: every action here is doable with mouse or touchpad.
  - NFR-7: docs describe the terminal-first screen, in the same PR.
- **One deployable outcome:** A user opens the app, creates or opens a workspace, switches between workspaces and removes one, sees an empty shell tree, and cannot reach a chat from any control or address; this makes S1 pass at full scope and puts the new product in front of the user, which is the epic goal's first half.

## Current Behavior

Verified by reading `../probe` (the code index was not used; Grep and Read).

- **Entry route** (`apps/web/src/routes/_chat.index.tsx`): `/` starts a draft thread in the most recent project and navigates to it. With no project it shows `NoProjectsHero` (`apps/web/src/components/NoProjectsHero.tsx`): "What should we work on?", with "Add project" (opens the command palette add-project flow) and "Start without a project" (starts a scratch chat thread).
- **Chat routes**: `_chat.$environmentId.$threadId.tsx`, `_chat.draft.$draftId.tsx`, `_chat.new.tsx`, all under the `_chat` layout (`apps/web/src/routes/_chat.tsx`), which renders `ThreadRouteView` when the URL carries a thread or draft target and redirects to `/pair` when not authenticated. `welcome.tsx` (onboarding wizard) also starts threads through `useNewThreadHandler`. `projects.$projectKey.tsx` redirects to `/settings/projects`.
- **Other routes under `_chat`**: `/pull-requests`, `/usage` and about 25 `/settings/*` pages, including chat-related ones (`settings.chat`, `settings.threads`, `settings.archived`, `settings.providers`, `settings.scheduled-tasks`).
- **Sidebar** (`apps/web/src/components/Sidebar.tsx`, hosted by `AppSidebarLayout.tsx`): a project > thread tree with an "Add project" button that opens the command palette add-project flow.
- **Other chat entry points**: the command palette navigates to thread routes (`CommandPalette.tsx`); keybinding commands `chat.new`, `chat.newLocal`, `chat.newWithoutProject` exist (`packages/contracts/src/keybindings.ts`).
- **No workspace concept**: searching `packages/contracts/src`, `apps/server/src` and `apps/web/src` found no workspace entity; "workspace" there means focus areas (`apps/web/src/lib/workspaceFocus.ts`) and similar. A project is an environment-local record rooted at a directory (`docs/internals/glossary.md`), created by the `project.create` command (`packages/client-runtime/src/operations/projects.ts`).
- **Persistence**: view state is kept in browser localStorage (`apps/web/src/uiStateStore.ts`). No saved-workspace file exists in the code today (unverified: only a name search was done).
- **Unverified**: the complete list of chat entry points (notifications, hover cards, deep links, prompt links, settings links, keybinding handlers); behavior on desktop and mobile (not required, NFR-4).

## Expected Behavior

Once this ships, the browser app shows the terminal-only screen. A workspace is a named collection of folders plus the layout of its shells (epic vocabulary); in this story it holds no folders and no shells yet, so the tree shows only the workspace root. Chat code still exists but is hidden. Each workspace is one file in Probe's internal folder, named after the workspace; creating a workspace writes it, so the "Open workspace" list is read from that folder. Which workspace is shown after a browser reload and the layout inside the file are story 7.

### User Flow

1. The user opens the app with no workspace. The screen shows only "Open workspace" (a dropdown of saved workspaces, empty at first launch) and "Create workspace".
2. The user clicks "Create workspace", enters the name "sparta" and confirms. The screen shows workspace "sparta" as the root of an empty shell tree.
3. From the "Workspaces" button at the top left the user creates a second workspace; it becomes the one shown.
4. From the same button the user switches back to "sparta".
5. From the same button the user removes the second workspace (not the shown one); "sparta" stays shown. No folder on disk is touched.
6. The user opens a saved workspace by choosing its name in the scrollable "Open workspace" list, on the start screen (after step 7) or from the "Workspaces" button while a workspace is shown; that workspace is shown. Choosing the shown workspace changes nothing. No file is picked.
7. The user removes the shown workspace; the app returns to the start screen of step 1.
8. At no point does any visible control show a chat, and an old chat address (a bookmarked or typed link to the former chat UI, for example a thread link, draft or new-thread) lands on the shown workspace, or on the start screen when none is shown.

All steps use mouse or touchpad.

### Edge Cases

- EC-1: A workspace with no folders and no shells shows an empty tree (the workspace root only), not an error.
- EC-2: Removing the shown workspace returns to the start screen, also when other workspaces remain; the user reaches them through "Open workspace", whose list shows the remaining ones.
- EC-3: Opening an old chat address (thread, draft, new-thread, and the other chat addresses) does not show a chat; the user lands on the shown workspace, or on the start screen when none is shown.
- EC-4: Removing a workspace that is not the shown one leaves the shown workspace unchanged.
- EC-5: Choosing the shown workspace in the "Open workspace" list changes nothing and adds no entry.

### Error Handling

- ER-1: An empty workspace name is rejected with a visible reason, and no workspace is created. A name over 64 characters, or one that is not valid as a file name, is rejected the same way (epic FR-24).
- ER-2: A saved workspace whose file cannot be read or is not valid is rejected with a visible reason when chosen (it stays listed); no workspace is created or changed and the user stays on the screen they were on.
- ER-3: If creating, removing or opening a workspace fails (for example the server is unreachable; applies only if these operations go through the server, SU-1), the user sees why and the list of workspaces is unchanged.
- ER-4: A name equal to an existing workspace's name is rejected with a visible message, and no workspace is created.

## Out Of Scope

- Starting shells, the "+" button and modal, the mock CLI in a tab: stories 4 and 5 (FR-3, FR-5, FR-6, FR-21, FR-22).
- Shells in the tree, the 1-second appearance rule, and the worktree and branch levels: stories 4 and 5 (FR-7 beyond the root).
- Removing a workspace force-kills its running shells: story 6 (FR-24, S6). Here there are no shells to end.
- Which workspace is shown after a browser reload, saving and restoring a layout after a restart, reopening a running workspace, unavailable folders: story 7 (FR-24, FR-15, FR-19).
- Rename a shell (FR-16): story 6.
- What a saved workspace file with folders or shells holds and shows: story 7 (FR-15, epic U-6). In this story the file holds the name only and the tree shows only the workspace root; saving the layout on every change is story 7.
- Deleting chat, providers and orchestration code, and cleaning up the hidden pages: later cleanup epic (epic Out).
- Verifying branch tracking (A-11) and add-project flow reuse (A-13): stories 5 and 4.
- Desktop and mobile: not required (NFR-4, epic Out).
- Grouping of folders inside a workspace: the epic keeps it a flat list.

## Technical Scope

- **Layers:** web app main screen and navigation (start screen, Workspaces button, empty tree, hiding chat screens, chat-related settings pages and the project > thread sidebar, redirecting old addresses); creation, switching, removal and opening of workspaces, stored one file per workspace in Probe's internal folder with the name taken from the file name (epic U-8); the file's inner format is decided in the plan (SU-1); the S1 scenario at full scope (the skeleton is story 1).
- **Docs impact:** `docs/` pages describing the chat-first screen are rewritten for the terminal-first screen and workspaces (NFR-7); the scenario command is documented by story 1, and the S1 coverage is added here.
- **Mobile impact:** none required (epic NFR-4, user decision 2026-11-02); mobile need not compile or work.

## Non-functional Requirements and Constraints

- NFR-5: every action (create, switch, remove, open) works with mouse or touchpad only; the scenario drives the UI with pointer actions. Shortcuts may exist but are optional.
- NFR-4: the S1 scenario runs in Playwright's headless Chromium. S1 replaces the boot scenario in `scripts/scenarios/registry.ts` and owns replacing its "Add project" check (PRB.T-001 SU-4), which only holds while the chat-era first screen exists.
- NFR-3: the scenario uses throwaway data and never the real Probe data (harness from story 1).
- NFR-7: docs change in the same PR as the behavior.
- Epic Out: chat code is not deleted here, so the app stays runnable.
- Repo rules (`AGENTS.md`): no continuously repainting animations in the tree area (epic NFR-1 rule); tests follow the repo test rules (no sleeps or polling).

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| --- | --- | --- | --- |
| AC-1 | Given no workspace exists, when the app is opened, then the screen offers "Open workspace" and "Create workspace" and no other way to start work | auto | FR-2 |
| AC-2 | Given the start screen, when the user clicks "Create workspace", enters "sparta" and confirms with the mouse, then workspace "sparta" is shown as the root of an empty shell tree and no error | auto | FR-2, FR-7, EC-1, NFR-5 |
| AC-3 | Given workspace "sparta", when the user creates a second workspace from the "Workspaces" button, then the second workspace is shown and both are listed | auto | FR-24, NFR-5 |
| AC-4 | Given two workspaces, when the user switches back to "sparta" from the "Workspaces" button, then "sparta" is shown | auto | FR-24, NFR-5 |
| AC-5 | Given two workspaces with "sparta" shown, when the user removes the second one from the "Workspaces" button, then it is no longer listed, "sparta" stays shown, and a throwaway directory created by the test beforehand still exists | auto | FR-24, EC-4, NFR-5 |
| AC-6 | Given two workspaces with one shown, when the user removes the shown one, then a start screen with "Open workspace" and "Create workspace" is shown, and the "Open workspace" list contains the remaining workspace | auto | FR-24, FR-2, EC-2 |
| AC-7 | Given a saved workspace "sparta" in Probe's internal folder, when the user opens the "Open workspace" list on the start screen and chooses "sparta" with the mouse, then "sparta" is shown with an empty tree (its content beyond the name is not shown here) | auto | FR-2, EC-1 |
| AC-8 | Given a workspace is shown and another is saved, when the user chooses the other from the "Workspaces" button's open list, then it is shown | auto | FR-24 |
| AC-9 | Given workspace "sparta" is shown, when the user chooses "sparta" in the open list, then "sparta" stays shown and the list has one "sparta" entry | auto | FR-24, EC-5 |
| AC-10 | Given each screen of the app (start screen, workspace, Workspaces menu, every settings page that is still reachable), when every visible control is inspected, then none starts or opens a chat thread, no chat-related settings page is reachable, the old project > thread sidebar is not shown, and the welcome wizard (first-run chat setup) is not shown; the checklist is the entry-point list made in the plan stage (SA-1) | manual (author) | FR-1 |
| AC-11 | Given the app is running, once with a workspace shown and once with none, when the browser visits each old chat address (thread, draft, new-thread and the other chat addresses), then no chat is shown and the shown workspace, or the start screen when none is shown, is displayed | auto | FR-1, EC-3 |
| AC-12 | Given the app, when the command palette is opened and the commands new chat, new local chat and new chat without project are looked for or invoked, then the commands are absent or invoking them creates or opens no chat thread; the same holds for the `chat.new*` keybindings (checked by invoking their commands) | auto | FR-1 |
| AC-13 | Given the start screen or the "Workspaces" button's create action, when the name field is empty and the user confirms, then a visible reason is shown and no workspace is created | auto | ER-1 |
| AC-14 | Given a workspace named "sparta" exists, when the user creates a workspace named "sparta", then a visible message is shown and no second "sparta" is created | auto | ER-4, FR-24 |
| AC-15 | Given a saved workspace file that is unreadable or invalid, when the user chooses it in "Open workspace" (start screen or "Workspaces" button), then a visible reason is shown, no workspace is created and the user stays on the same screen | auto | ER-2, FR-2 |
| AC-16 | Given the operation is made to fail (fault injected by the test; applies if the operation is server-side, SU-1), when the user tries to create a workspace, then the user sees why and the list is unchanged | auto | ER-3 |
| AC-17 | Given the operation is made to fail (same condition), when the user tries to remove or open a workspace, then the user sees why and the list is unchanged | auto | ER-3 |
| AC-18 | Given scenario S1, when `vp run test:scenarios` is run from a clean shell, then S1 passes using pointer actions only in headless Chromium | auto | FR-1, FR-2, FR-24, NFR-3, NFR-4, NFR-5 |
| AC-19 | Given the PR for this story, when its docs diff is reviewed, then the docs describe the terminal-first screen and workspaces | manual (reviewer in the PR) | NFR-7 |
| AC-20 | Given two saved workspaces, when the page is reloaded, then the dropdown of saved workspaces still lists both names | auto | FR-24, SU-2 |

AC-7, AC-8, AC-9 and AC-15 are re-checked after the file format is decided in the plan (SU-1), AC-10 and AC-11 after the plan-stage entry-point list (SA-1).

## Dependencies

| Depends on | Why | Status |
| --- | --- | --- |
| PRB.T-001 | The scenario harness, mock CLI and booting scenario skeleton that S1 extends | done (2026-11-03) |
| PRB.T-002 | Ordering only (epic: story 3 after story 2); this story needs no shell, but the spike result (U-1) may shape the tree area | planned (not started) |

Stories 4 to 8 depend on this one.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| --- | --- | --- | --- | --- | --- |
| SA-1 | Chat can be hidden everywhere without breaking the app (routes, palette, settings links, sidebar); this is epic A-8 | assumption | unverified | Check in this story's plan stage by listing every chat entry point and every chat-related settings page | author |
| SA-2 | The chat routes and code can stay and be hidden, because the epic defers deletion | assumption | verified | Epic Out and Approach state it | author |
| SA-3 | The S1 scenario can drive the "Open workspace" dropdown by pointer and seed saved workspaces into the throwaway Probe folder | assumption | unverified | Prove while building S1; harness is story 1 | author |
| SU-1 | The inner format of a workspace file and whether workspace operations are server-side. Decided: files live in Probe's internal folder, one per workspace, name from the file name, dropdown list, no file picking (epic U-8) | unknown | unverified | Decide the inner format and whether operations are server-side in this story's plan stage; AC-16 and AC-17 apply only if the operation is server-side; storage decided by the user 2026-11-02 | author |
| SU-2 | Decided: the list of saved workspaces persists across a reload already in this story (each is a saved file with its name); which workspace is shown after a reload and its layout are story 7 | unknown | verified | Follows from the user's 2026-11-02 decision that Open workspace lists saved workspace files | author |
| SU-3 | Decided: an old chat address (a bookmarked or typed link to the former chat UI such as /threads/<id>) lands on the shown workspace, or on the start screen when none is shown | unknown | verified | Decided by the user 2026-11-02 (recommendation accepted by default; the user asked what the term meant) | author |
| SU-4 | Decided: which workspace is shown after the shown one is removed | unknown | verified | Decided by the user: none; the app returns to the start screen (FR-24) | author |
| SU-5 | Naming rules: unique, 1 to 64 characters, valid as a file name, with a visible reason on rejection | unknown | verified | Taken from the epic's FR-24 name rule (2026-11-02); the exact set of disallowed characters follows the file system and is fixed in the plan | author |
| SU-6 | What a workspace file holds in this story: the name only (layout comes in story 7, FR-15); the disk-untouched check in AC-5 uses a directory the test creates | unknown | verified | Decided with the user's storage answer 2026-11-02; layout content is story 7 | author |
| SU-7 | Decided: "Open workspace" is how the user reaches existing workspaces; after a removal the start screen lists the remaining ones | unknown | verified | Decided by the user 2026-11-02 | author |
| SU-8 | What FR-7 "the tree and its grouping" can show in this story, given no folders or shells exist yet, and how it is verified | unknown | verified | Decided: in this story the tree shows only the workspace root (no folders or shells exist); grouping is checked in stories 4 and 5 where it first has content (FR-7) | author |
