# Sourced by up.sh and down.sh on the host: everything compose.yaml interpolates.
# Expects the checkout root as the working directory.

PROBE_NAME=$(basename "$PWD")
PROBE_WORKSPACE=$PWD
# A linked worktree's .git file points at the main checkout's .git by absolute
# path; compose.yaml mounts that directory at the same path in the container.
PROBE_GIT_COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
PROBE_GIT_NAME=$(git config user.name)
PROBE_GIT_EMAIL=$(git config user.email)
COMPOSE_PROJECT_NAME=probe-dev-$(printf %s "$PROBE_NAME" | tr -c 'a-zA-Z0-9_-' -)
export PROBE_NAME PROBE_WORKSPACE PROBE_GIT_COMMON_DIR PROBE_GIT_NAME PROBE_GIT_EMAIL COMPOSE_PROJECT_NAME
