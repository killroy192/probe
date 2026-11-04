#!/usr/bin/env bash
# Removes this checkout's dev and net containers and its node_modules volume.
# Runs on the host; use it before removing a worktree.
set -euo pipefail

cd "$(dirname "$0")/.."
. .devcontainer/env.sh
# down only matches containers by project; the ports need a value to interpolate.
export PROBE_PORT_OFFSET=0 PROBE_WEB_PORT=0 PROBE_SERVER_PORT=0
exec docker compose -f .devcontainer/compose.yaml down --volumes
