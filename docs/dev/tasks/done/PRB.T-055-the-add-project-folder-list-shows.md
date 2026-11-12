---
id: PRB.T-055
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-12
updated: 2026-11-12
---

# The Add project folder list shows folders deleted since it was last listed

## Goal

Found in manual testing (2026-11-12): "Import existing folder" in the Add project dialog kept
listing a folder deleted on disk, because the server's folder listing was cached. The list now
reads the folder again whenever it is shown.

## Delivered

- `AddProjectDialog.tsx` (`FolderPathField`) lists the folder again each time the list opens, and
  each time the open list moves to another folder (walking in, `..`, or typing a path); the last
  listing stays on screen until the new one arrives. One request per opening or folder change, no
  polling. Commits `aa0252f5b`, `00d7673e9`.
- Tests: `AddProjectDialog.browser.test.tsx` › "lists the folder again each time the folder list
  opens" and "lists a folder again when the open list walks back into it" (each failed before).

## Decisions

- Focus alone and opening the dialog do not refresh: neither shows the list, and focus plus the
  click that opens it would send two requests.
- The shared browse query's cache time stays as is, so the command palette and mobile are unchanged.
