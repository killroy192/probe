---
id: PRB.T-054
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-12
updated: 2026-11-12
---

# The Create shell dialog closes by itself when its folder is found deleted

## Goal

Found 2026-11-12 in the closing scenario run of PRB.E-001 (`S2.deleted-folder`: the Cancel button
detached). A start refused because the project's folder was deleted showed "no longer exists" in
the "+" dialog, and the server's 2 s folder check could then mark the project missing and close the
dialog, refusal and all. The dialog now stays open until the user closes it.

## Delivered

- `WorkspaceSidebar.tsx` shows the dialog for its project whether or not the folder is on disk; the
  "+" is still only offered for a folder that exists. Commit `b03b62c33`, merge `7a2490e3e`.
- Test: `WorkspaceSidebar.browser.test.tsx` › "keeps the Create shell dialog open when its folder
  is found deleted meanwhile" (fails on the old code at the second heading check). `S2` set 18/18.
