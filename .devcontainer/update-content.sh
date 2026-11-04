#!/usr/bin/env bash
# Runs at creation and on every prebuild content refresh, so codespaces start
# with deps installed and caches warm. Everything here is idempotent.
set -euo pipefail

CI=true vp i
# Repairs electron's path.txt and exec bits after install, same as CI.
vp run --filter @t3tools/desktop ensure:electron
# Pre-warms Vite's dep optimizer (cache is keyed on the absolute path, which
# is stable inside the container).
node apps/web/scripts/warm-dep-cache.ts
