#!/usr/bin/env bash
# Creates or removes a linked worktree that opens in its own dev container. Runs
# on the host: a container cannot see the folders next to its checkout.
#   worktree.sh add <branch> [--path <dir>] [--from <ref>]
#   worktree.sh remove <dir>
set -euo pipefail

main=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
usage() {
  sed -n '4,5p' "$0" >&2
  exit 2
}

case "${1:-}" in
  add)
    [ $# -ge 2 ] || usage
    branch=$2
    shift 2
    path=$(dirname "$main")/$(basename "$main")-${branch//\//-}
    from=main
    while [ $# -gt 0 ]; do
      case "$1" in
        --path) path=$2 && shift 2 ;;
        --from) from=$2 && shift 2 ;;
        *) usage ;;
      esac
    done
    if git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then
      target=("$path" "$branch")
    else
      target=(-b "$branch" "$path" "$from")
    fi
    # Relative pointers let the container mount the shared .git at any path. The
    # lock stops a prune in another container, which cannot see this folder,
    # from deleting its metadata.
    git -C "$main" -c core.hooksPath=/dev/null worktree add --relative-paths --lock "${target[@]}"
    # A copy, not a symlink: the container cannot follow a link to a host path.
    if [ -f "$main/.env" ]; then cp "$main/.env" "$path/.env"; fi
    echo "worktree.sh: open $path in Cursor and reopen it in the container" >&2
    ;;
  remove)
    [ $# -eq 2 ] || usage
    path=$(cd "$2" && pwd -P)
    if [ -f "$path/.devcontainer/.env" ]; then
      docker compose -f "$path/.devcontainer/compose.yaml" --env-file "$path/.devcontainer/.env" down --volumes
    fi
    git -C "$main" worktree unlock "$path" 2>/dev/null || true
    git -C "$main" -c core.hooksPath=/dev/null worktree remove "$path"
    ;;
  *) usage ;;
esac
