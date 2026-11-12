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

Found in manual testing (2026-11-12). In the Add project dialog, "Import existing folder" lists the
server's folders under the path field. After a folder is deleted on disk, it is still listed there.
The list is a cached `filesystem.browse` query (`FolderPathField` in
`apps/web/src/components/workspaces/AddProjectDialog.tsx`), so a folder listed once keeps its old
entries.

## Direction

- List the folder again whenever the list opens or the field gets focus (and when the dialog opens),
  instead of serving a cached listing; keep showing the last listing until the new one arrives so
  the list does not flash empty.
- Picking a folder that vanished between the listing and the pick is already refused by the server;
  keep that.

## Done when

- A folder deleted on disk is gone from the list the next time the list opens.
- A test fails before the fix and passes after.
