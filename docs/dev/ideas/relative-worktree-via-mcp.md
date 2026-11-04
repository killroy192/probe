# Relative worktree creation via Probe MCP

An agent running in a Probe shell asks Probe, through an MCP tool, for a new worktree relative to
where it is now: branched from its current worktree's HEAD and placed next to it. Probe creates the
worktree, starts a shell there, and shows it in the tree under the same folder, so work an agent
splits off stays visible instead of happening in a worktree Probe never saw.

Related: roadmap phase 2 ("probe CLI for worktrees and agents") and the open question of how worktree
creation is enforced (`roadmap.md`, agent tree entries).

## To research

- Which shell is calling: how the MCP server maps a request to its shell, worktree and workspace.
- What "relative" means: base on HEAD, the branch, or uncommitted changes too; location and naming.
- Whether the tool also starts an agent in the new shell, and whether the new node nests under the caller.
- Overlap with the "+" modal's new-worktree flow (PRB.T-004), so both use one service method.
- Cleanup: who removes the worktree, and the reverse action in the UI.
