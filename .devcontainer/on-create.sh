#!/usr/bin/env bash
# One-time container setup, baked into prebuilds. Content-dependent work
# (dependency install, Chromium) lives in update-content.sh.
set -euo pipefail

# The Vite+ CLI is the repo task runner (vp i, vp run dev, vp test run).
# Download to a file first: a curl failure inside $( ) would yield an empty
# script and a false success. VP_NODE_MANAGER=no skips the installer's node
# shims; Node comes from the devcontainer feature. The VP_*_DIR group (set
# together, absolute) pins the install location instead of the installer's
# XDG platform defaults, which moved the binary from ~/.vite-plus/bin to
# ~/.local/share/vite-plus/bin between releases and would break the check
# below either way.
export VP_BIN_DIR="$HOME/.local/share/vite-plus/bin"
export VP_DATA_DIR="$HOME/.local/share/vite-plus"
export VP_CACHE_DIR="$HOME/.cache/vite-plus"
installer=$(mktemp)
curl -fsSL https://vite.plus -o "$installer"
VP_NODE_MANAGER=no bash "$installer"
rm -f "$installer"

# Non-login lifecycle shells never source the profile the installer edits,
# so expose vp on the default PATH. test -x keeps a bad install loud.
test -x "$VP_BIN_DIR/vp"
sudo ln -sf "$VP_BIN_DIR/vp" /usr/local/bin/vp

# The installers below write into these volumes, which docker creates root-owned.
for dir in "$HOME/.claude" "$HOME/.cache" "$HOME/.cache/cocoindex-code"; do
  if [ -d "$dir" ] && [ "$(stat -c %U "$dir")" != "$(id -un)" ]; then
    sudo chown "$(id -un):$(id -gn)" "$dir"
  fi
done

# Claude Code (native installer, self-updating) and ccc for the cocoindex-code
# MCP in .mcp.json. The [full] extra brings local embeddings (torch); on arm64
# Linux PyPI torch is CPU-only, on x86_64 it also pulls CUDA wheels.
curl -fsSL https://claude.ai/install.sh -o "$installer"
bash "$installer"
curl -LsSf https://astral.sh/uv/install.sh -o "$installer"
UV_NO_MODIFY_PATH=1 sh "$installer"
rm -f "$installer"
"$HOME/.local/bin/uv" tool install 'cocoindex-code[full]'
for bin in claude ccc; do
  test -x "$HOME/.local/bin/$bin"
  sudo ln -sf "$HOME/.local/bin/$bin" "/usr/local/bin/$bin"
done

# Same embedding model as the host, so search behaves the same in both places.
mkdir -p "$HOME/.cocoindex_code"
cat >"$HOME/.cocoindex_code/global_settings.yml" <<'EOF'
embedding:
  provider: sentence-transformers
  model: Snowflake/snowflake-arctic-embed-xs
  indexing_params: {}
  query_params:
    prompt_name: query
EOF

# Managed settings outrank project and local ones, so this applies only here:
# no permission prompts, the repo's .mcp.json servers pre-approved, and no
# Claude sandbox (bubblewrap does not run in an unprivileged container).
sudo mkdir -p /etc/claude-code
sudo tee /etc/claude-code/managed-settings.json >/dev/null <<'EOF'
{
  "permissions": { "defaultMode": "bypassPermissions" },
  "enableAllProjectMcpServers": true,
  "sandbox": { "enabled": false }
}
EOF

# First-run terminal notice, rendered by the devcontainers base image.
sudo mkdir -p /usr/local/etc/vscode-dev-containers
sudo tee /usr/local/etc/vscode-dev-containers/first-run-notice.txt >/dev/null <<'EOF'
Probe devcontainer

  claude                Claude Code, no permission prompts (log in once;
                        the login survives rebuilds)
  vp run dev            start server + web, then open the pairing URL it
                        prints (the bare forwarded port will not authenticate)
  cp .env.example .env  optional: enable T3 Connect cloud features
                        (public identifiers, not secrets)

Details: docs/internals/devcontainer.md
EOF
