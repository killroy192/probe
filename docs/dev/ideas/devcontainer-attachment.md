# Devcontainer attachment

Let a Probe shell run inside a folder's devcontainer instead of on the host: Probe attaches to the
container (or starts it) and opens the shell there, so agents run in the container's sandbox while
Probe stays on the host. This repo's own workflow, with Claude and every command in
`probe-dev-<dir>`, is the motivating case.

## To research

- Discovery: read `.devcontainer/devcontainer.json`, use the `devcontainer` CLI, or attach to a named
  running container only.
- Starting and rebuilding: whether Probe drives the `devcontainer` CLI (which runs the project's
  `initializeCommand`, like this repo's `.devcontainer/init-env.sh`) or leaves the lifecycle to the user.
- Path mapping between host and container, for worktrees, checkpoints and file links.
- One container per worktree or shared, and how a new worktree gets one.
- How the tree and the "+" modal show that a shell is inside a container, and how a dead container
  is shown on restore.
- Remote and tunnel connections: the container runs where the server runs.
