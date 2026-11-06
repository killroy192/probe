---
id: PRB.T-009
type: story
parent: PRB.E-001
phase: 1
labels: [tech-debt]
created: 2026-11-06
updated: 2026-11-06
---

# Rename workspace folders to projects in code and storage

Decided 2026-11-06 during PRB.T-005: what a workspace holds is called a **project** in the product (one project, many worktrees), and the UI and user docs say "project". The code and the saved data still say "folder", kept to avoid churn while T-005 was in flight.

Rename the remaining "folder" names to "project" where they mean a workspace's project:

- Contracts in `packages/contracts/src/workspace.ts`: `WorkspaceFolder`, `WorkspaceDetail.folders`, `WorkspaceAddFolderInput`/`Result`, `WorkspaceFolderGit*`, `WorkspaceFolderError`, the `folder` fields of `WorkspaceStartShellInput`, `WorkspaceLastStart` and `ShellSummary`, and the RPC names `workspace.addFolder` and `workspace.folderGit`.
- Server: `SavedWorkspaces` (method names, messages) and the saved workspace file's `folders` field, with a read path for files that still use `folders`.
- Clients: `apps/web/src/state/workspaces.ts`, `apps/web/src/components/workspaces/*`, `packages/client-runtime/src/state/workspaces.ts`.
- Scenarios (`scripts/scenarios`), `docs/internals/glossary.md` ("Folder").

Keep "folder" where it means a directory on disk (the folder browser, worktree folders).

## Done when

- No contract, RPC, saved-file field or UI string calls a workspace's project a "folder".
- A workspace file written before the rename still opens with its projects and last start.
- Scenarios S1 to S3 pass.
