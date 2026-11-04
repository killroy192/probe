#!/usr/bin/env sh
# Runs on the host (initializeCommand). Writes the author identity that git in
# the container uses, so the container needs neither your gitconfig nor any
# credentials.
set -eu
name=$(git config user.name)
email=$(git config user.email)
printf 'GIT_AUTHOR_NAME=%s\nGIT_AUTHOR_EMAIL=%s\nGIT_COMMITTER_NAME=%s\nGIT_COMMITTER_EMAIL=%s\n' \
  "$name" "$email" "$name" "$email" >"$(dirname "$0")/git-identity.env"
