---
id: PRB.T-009
type: story
parent: PRB.E-001
phase: 1
labels: [tech-debt]
created: 2026-11-06
updated: 2026-11-07
---

# Rename workspace folders to projects in code and storage

## Goal

The product calls what a workspace holds a project, but contracts, RPC names, saved files and clients still said "folder". Every workspace-project name now says "project", and files saved before the rename still open.

## Delivered

- Contracts, RPC names (`workspace.addProject`, `workspace.removeProject`, `workspace.projectGit`), `SavedWorkspaces`, the web and client-runtime workspace state, workspace components, test selectors and scenarios use "project".
- Workspace files with `folders`, `lastStart.folder` or `lastFolder`, and shell registries with `folder`, are read and rewritten in the new shape.
- "Folder" remains only where it means a directory on disk (the folder browser, worktree folders, the state folder, the Add dialog's "Import existing folder" and "Create new folder").
- Scenarios S1 to S3 pass.

## Decisions

- 2026-11-06, during [PRB.T-005](PRB.T-005-start-a-shell-in-a-new-or-existing.md): a workspace's umbrella (main checkout plus worktrees) is a project; the code rename was deferred to avoid churn while T-005 was in flight.
- No wire shim: server, web and client-runtime ship together.
- No version bump on the saved file, so a file saved by this server is not readable by an older one.
- The inherited glossary row "Project" (a thread's project) is kept and qualified; "Workspace project" is the new row.

## Docs

- [Glossary](../../../internals/glossary.md): "Workspace project" row.
- [Terminal runtime](../../../internals/terminal-runtime.md): the legacy `folder` and `folders` names that are still read.
