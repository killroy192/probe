---
id: PRB.T-045
type: bug
parent: PRB.E-001
phase: 1
labels: []
created: 2026-11-11
updated: 2026-11-11
---

# Create workspace shows late and shifts the Workspaces menu under the pointer

## Goal

Right after a page load, "Create workspace" appeared only once the write permission arrived, inserted
above "Open workspace", so a submenu opened meanwhile shut and the highlight jumped (found in
PRB.T-039's verification). The menu and the start screen no longer move when the permission arrives.

## Delivered

- "Create workspace" holds its place, disabled, in the Workspaces menu and on the start screen until
  the session that decides the permission has arrived; then it is enabled in place, or removed when
  the permission is denied. The permission atom stays the source of truth.
- Browser tests in `WorkspaceSidebar.browser.test.tsx`: "keeps an open submenu open when the write
  permission arrives" (failed before: the submenu shut), "offers no way to create a workspace without
  write permission", "shows both start actions while the write permission is unknown".
- The scenario harness no longer waits for the item before using the menu or the start screen; the
  full check suite passed on the branch (104/104). Merged 2026-11-11.

## Decisions

- 2026-11-11: while the permission is unknown the item is shown disabled rather than hidden, and the
  menu is not held back; a denied permission removes it, which only happens on read-only clients.
  Picked under the user's standing "recommended option" rule.
