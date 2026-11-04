#!/usr/bin/env bash
# Entrypoint of the dev container. Runs as root before anything else, because
# devcontaineruser has no sudo. The firewall is not here: it lives in the net
# container (net-init.sh), whose network namespace this one joins. If any step
# fails the container stops.
set -euo pipefail

# Hooks are writable from here, so the host must never run them (see git-config).
if [ "$(git config -f /etc/probe/host-git-config --get core.hooksPath || true)" != /dev/null ]; then
  echo "container-init: run 'git config core.hooksPath /dev/null' in the host checkout first" >&2
  exit 1
fi

# The feature layers can re-add a sudoers entry for the user; nothing in the
# container should be able to regain root, so drop them on every start.
find /etc/sudoers.d -type f ! -name README -delete

# Docker creates a volume mount point root-owned when the image lacks the
# directory; node_modules sits inside the workspace bind mount, so the image
# cannot pre-create it.
chown devcontaineruser:devcontaineruser "$PROBE_WORKSPACE/node_modules"

trap 'exit 0' TERM INT
sleep infinity &
wait
