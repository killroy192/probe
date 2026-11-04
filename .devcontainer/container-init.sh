#!/usr/bin/env bash
# Container entrypoint. Runs as root before anything else, because the
# devcontaineruser has no sudo: root-only setup lives here, not in the
# lifecycle scripts.
set -euo pipefail

# The feature layers can re-add a sudoers entry for the user; nothing in the
# container should be able to regain root, so drop them on every start.
find /etc/sudoers.d -type f ! -name README -delete

# Docker creates volume mount points root-owned unless the image has the
# directory already; node_modules sits inside the workspace bind mount, so the
# image cannot pre-create it.
for dir in /home/devcontaineruser/.cache /home/devcontaineruser/.cache/pnpm /workspaces/*/node_modules; do
  if [ -d "$dir" ]; then
    chown devcontaineruser:devcontaineruser "$dir"
  fi
done

trap 'exit 0' TERM INT
while sleep 1 & wait $!; do :; done
