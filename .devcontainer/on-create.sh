#!/usr/bin/env bash
# One-time container setup, as vscode. Everything here is idempotent.
set -euo pipefail

# Docker creates a volume's mount point root-owned when the image lacks the
# directory; node_modules sits in the workspace bind mount, so the image cannot.
sudo chown vscode:vscode node_modules

# The Vite+ CLI is the repo task runner (vp i, vp run dev, vp test run).
# Download to a file first: a curl failure inside $( ) would yield an empty
# script and a false success. VP_NODE_MANAGER=no skips the installer's node
# shims; Node comes from the devcontainer feature. The VP_*_DIR group (set
# together, absolute) pins the install location instead of the installer's
# XDG platform defaults, which moved the binary from ~/.vite-plus/bin to
# ~/.local/share/vite-plus/bin between releases and would break the check
# below either way. The Dockerfile puts that directory on PATH.
export VP_VERSION=1.5.0
export VP_BIN_DIR="$HOME/.local/share/vite-plus/bin"
export VP_DATA_DIR="$HOME/.local/share/vite-plus"
export VP_CACHE_DIR="$HOME/.cache/vite-plus"
installer=$(mktemp)
curl -fsSL https://vite.plus -o "$installer"
VP_NODE_MANAGER=no bash "$installer"
rm -f "$installer"
test -x "$VP_BIN_DIR/vp"

CI=true vp i
# Repairs electron's path.txt and exec bits after install, same as CI.
vp run --filter @t3tools/desktop ensure:electron
# Pre-warms Vite's dep optimizer (cache is keyed on the absolute path, which
# is stable inside the container).
node apps/web/scripts/warm-dep-cache.ts
