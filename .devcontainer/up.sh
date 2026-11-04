#!/usr/bin/env bash
# Starts (or recreates, with --remove-existing-container) this checkout's dev
# container. Runs on the host. It picks a free port offset for the checkout, so
# the dev server's ports are the same inside the container and on the host's
# loopback, and the URL the dev runner prints works as printed.
set -euo pipefail

cd "$(dirname "$0")/.."
. .devcontainer/env.sh
base_web=5733
base_server=13773

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# An existing container keeps its offset (also when it is being recreated), so
# its own published ports are not mistaken for a clash.
offset=$(docker inspect "probe-dev-$PROBE_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null |
  sed -n 's/^T3CODE_PORT_OFFSET=//p' || true)
if [ -z "$offset" ]; then
  offset=$(($(printf %s "$PWD" | cksum | cut -d' ' -f1) % 900 + 1))
  while port_in_use $((base_web + offset)) || port_in_use $((base_server + offset)); do
    offset=$((offset + 1))
  done
fi

export PROBE_PORT_OFFSET="$offset"
export PROBE_WEB_PORT=$((base_web + offset))
export PROBE_SERVER_PORT=$((base_server + offset))
echo "devcontainer: probe-dev-$PROBE_NAME, web http://localhost:$PROBE_WEB_PORT, server port $PROBE_SERVER_PORT" >&2

exec npx -y @devcontainers/cli@0.89.0 up --workspace-folder . "$@"
