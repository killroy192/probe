#!/usr/bin/env bash
# devcontainer.json's initializeCommand: Cursor, VS Code and the devcontainer CLI
# run it on the host before every start. It writes .devcontainer/.env, which
# compose.yaml reads, so opening the folder is all a start needs.
set -euo pipefail

cd "$(dirname "$0")/.."
name=$(basename "$PWD")
project=probe-dev-$(printf %s "$name" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9_-' -)
base_web=5733
base_server=13773

# The container rewrites .vite-hooks and its git-config turns hooks on there;
# the host must never run them. Linked worktrees share this setting.
if [ "$(git config --get core.hooksPath || true)" != /dev/null ]; then
  git config core.hooksPath /dev/null
  echo "init-env: set core.hooksPath=/dev/null for this repository on the host" >&2
fi

# Collapses . and .. without touching the filesystem (macOS has no realpath -m).
normalize() {
  local out="" part rest="$1/"
  while [ -n "$rest" ]; do
    part=${rest%%/*}
    rest=${rest#*/}
    case "$part" in
      "" | .) ;;
      ..) out=${out%/*} ;;
      *) out="$out/$part" ;;
    esac
  done
  printf '%s\n' "${out:-/}"
}

# A linked worktree keeps its history in the main checkout's .git. Mount that
# directory where the worktree's relative pointer expects it inside.
if [ -d .git ]; then
  git_source=$PWD/.git
  git_target=/workspaces/$name/.git
else
  gitdir=$(sed -n 's/^gitdir: //p' .git)
  case "$gitdir" in
    /*)
      echo "init-env: $PWD/.git points at an absolute path; run 'git worktree repair --relative-paths' here, or recreate the worktree with .devcontainer/worktree.sh" >&2
      exit 1
      ;;
  esac
  rel=${gitdir%/worktrees/*}
  git_source=$(cd "$rel" && pwd -P)
  git_target=$(normalize "/workspaces/$name/$rel")
fi

# Same ports inside and out, so the URL the dev runner prints works on the host.
# A rebuilt container keeps its offset, so its own ports are not taken for a clash.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
offset=$(docker inspect "$project" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null |
  sed -n 's/^T3CODE_PORT_OFFSET=//p' || true)
if [ -z "$offset" ]; then
  offset=$(($(printf %s "$PWD" | cksum | cut -d' ' -f1) % 900 + 1))
  while port_in_use $((base_web + offset)) || port_in_use $((base_server + offset)); do
    offset=$((offset + 1))
  done
fi

quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}
{
  echo "PROBE_PROJECT=$project"
  echo "PROBE_NAME=$(quote "$name")"
  echo "PROBE_WORKSPACE=$(quote "$PWD")"
  echo "PROBE_GIT_SOURCE=$(quote "$git_source")"
  echo "PROBE_GIT_TARGET=$(quote "$git_target")"
  echo "PROBE_PORT_OFFSET=$offset"
  echo "PROBE_WEB_PORT=$((base_web + offset))"
  echo "PROBE_SERVER_PORT=$((base_server + offset))"
  echo "PROBE_GIT_NAME=$(quote "$(git config user.name || true)")"
  echo "PROBE_GIT_EMAIL=$(quote "$(git config user.email || true)")"
} >.devcontainer/.env
echo "init-env: $project, web http://localhost:$((base_web + offset)), server port $((base_server + offset))" >&2
