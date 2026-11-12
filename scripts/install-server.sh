#!/bin/sh
# Builds and installs the Probe server for the current user on a Linux machine
# or container that has the build toolchain. Run it as a normal user:
#
#   curl -fsSL https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh | sh
#   sh install-server.sh
#
# Environment:
#   PROBE_REPO         git repository to build (default: the public Probe
#                      repository; a local checkout path works too)
#   PROBE_REF          branch or tag to build (default: main)
#   PROBE_INSTALL_DIR  install root (default: ${XDG_DATA_HOME:-~/.local/share}/probe)
#   PROBE_REGISTRY     package registry the check must reach
#                      (default: https://registry.npmjs.org/)
#
# Layout under the install root: build/ (staging, removed on success or by the
# next run), versions/<commit>/ (a complete install, with .install-complete),
# current (a link swapped atomically), logs/.

PROBE_REPO="${PROBE_REPO:-https://github.com/killroy192/probe.git}"
PROBE_REF="${PROBE_REF:-main}"
PROBE_REGISTRY="${PROBE_REGISTRY:-https://registry.npmjs.org/}"
MIN_NODE_MAJOR=24
# Tests lower these; 6 GiB of disk, and memory a 4 GB machine reports after the kernel's share.
MIN_DISK_KB="${PROBE_MIN_DISK_KB:-6291456}"
MIN_MEM_KB="${PROBE_MIN_MEM_KB:-3900000}"
PROOF_WAIT_SECONDS=30

ROOT=""
LOG=/dev/null
LOCK=""
LOCK_HELD=0
STAGING=""
PROOF_DIR=""
SERVER_PID=""
STARTED_AT=0
PROBLEMS=""

say() {
  printf '%s\n' "$*"
  printf '%s\n' "$*" >>"$LOG" 2>/dev/null
}

note() {
  printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >>"$LOG" 2>/dev/null
}

problem() {
  PROBLEMS="${PROBLEMS}  - $1: $2
    Fix: $3
"
}

fail() {
  say "$1"
  if [ "$LOG" != /dev/null ]; then say "Log: $LOG"; fi
  exit 1
}

# Runs a command with its output in the log only.
quiet() {
  note "\$ $*"
  "$@" >>"$LOG" 2>&1
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  waited=0
  while kill -0 "$SERVER_PID" 2>/dev/null; do
    case "$(ps -o stat= -p "$SERVER_PID" 2>/dev/null)" in Z* | "") break ;; esac
    if [ "$waited" -ge 10 ]; then kill -9 "$SERVER_PID" 2>/dev/null; fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
  # A shell host is detached from the server; its pid file is the only handle.
  if [ -n "$PROOF_DIR" ] && [ -d "$PROOF_DIR" ]; then
    for pid_file in "$PROOF_DIR"/state/shell-host-v*.pid "$PROOF_DIR"/state/*/shell-host-v*.pid; do
      [ -f "$pid_file" ] || continue
      host_pid="$(cat "$pid_file" 2>/dev/null)"
      case "$host_pid" in '' | *[!0-9]*) continue ;; esac
      kill "$host_pid" 2>/dev/null
    done
  fi
}

cleanup() {
  stop_server
  if [ -n "$PROOF_DIR" ]; then rm -rf "$PROOF_DIR"; fi
  if [ -n "$STAGING" ]; then rm -rf "$STAGING"; fi
  if [ "$LOCK_HELD" = 1 ]; then
    rmdir "$ROOT/build" 2>/dev/null
    rm -f "$LOCK"
  fi
}

elapsed() {
  printf '%s s' "$(($(date +%s) - STARTED_AT))"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

nearest_existing_dir() {
  dir="$1"
  while [ ! -d "$dir" ]; do dir="$(dirname "$dir")"; done
  printf '%s\n' "$dir"
}

memory_kb() {
  mem=""
  while read -r key value _; do
    if [ "$key" = "MemTotal:" ]; then mem="$value"; fi
  done </proc/meminfo
  for limit_file in /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do
    [ -r "$limit_file" ] || continue
    limit="$(cat "$limit_file")"
    case "$limit" in '' | *[!0-9]*) continue ;; esac
    limit=$((limit / 1024))
    if [ -z "$mem" ] || [ "$limit" -lt "$mem" ]; then mem="$limit"; fi
  done
  printf '%s\n' "${mem:-0}"
}

# Prints the commit PROBE_REF names in PROBE_REPO; exit 2 when the ref is missing.
resolve_ref() {
  refs="$(GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}" \
    git ls-remote "$PROBE_REPO" "refs/heads/$PROBE_REF" "refs/tags/$PROBE_REF" \
    "refs/tags/$PROBE_REF^{}" 2>>"$LOG")" || return 1
  head_sha=""
  peeled_sha=""
  tag_sha=""
  while read -r sha name; do
    case "$name" in
      "refs/heads/$PROBE_REF") head_sha="$sha" ;;
      "refs/tags/$PROBE_REF^{}") peeled_sha="$sha" ;;
      "refs/tags/$PROBE_REF") tag_sha="$sha" ;;
    esac
  done <<EOF
$refs
EOF
  sha="${head_sha:-${peeled_sha:-$tag_sha}}"
  [ -n "$sha" ] || return 2
  printf '%s\n' "$sha"
}

is_complete() {
  [ "$(cat "$ROOT/versions/$1/.install-complete" 2>/dev/null)" = "$1" ]
}

is_current() {
  [ "$(readlink "$ROOT/current" 2>/dev/null)" = "versions/$1" ]
}

package_version() {
  node -p "require(process.argv[1]).version" "$1/apps/server/package.json" 2>/dev/null || printf 'unknown'
}

check_tools() {
  have git || problem git "not found" "install git (Debian/Ubuntu: sudo apt-get install git)."
  if have node; then
    node_version="$(node -p process.versions.node 2>/dev/null)"
    node_major="${node_version%%.*}"
    case "$node_major" in
      '' | *[!0-9]*) problem node "cannot read the Node.js version" "reinstall Node.js $MIN_NODE_MAJOR or newer." ;;
      *)
        if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
          problem node "version $node_version is too old" "install Node.js $MIN_NODE_MAJOR or newer (https://nodejs.org or your version manager)."
        fi
        ;;
    esac
  else
    problem node "not found" "install Node.js $MIN_NODE_MAJOR or newer (https://nodejs.org or your version manager)."
  fi
  have vp || problem vp "not found" "install Vite+ for this user: curl -fsSL https://vite.plus | bash, then open a new shell."
  for tool in make g++ python3; do
    have "$tool" || problem "$tool" "not found (build tools for native modules)" "sudo apt-get install build-essential python3."
  done
  have curl || have wget || problem "curl or wget" "not found" "sudo apt-get install curl."
  have ps || problem ps "not found" "sudo apt-get install procps."
  for tool in mktemp nohup; do
    have "$tool" || problem "$tool" "not found" "sudo apt-get install coreutils."
  done
}

check_machine() {
  if [ -z "${HOME:-}" ] || [ ! -d "$HOME" ] || [ ! -w "$HOME" ]; then
    problem "home folder" "${HOME:-HOME is not set} is not a writable folder" "run as a user with a writable home folder; the build keeps its package cache there."
  fi
  if [ ! -w "$(nearest_existing_dir "$ROOT")" ]; then
    problem "install folder" "cannot create $ROOT" "set PROBE_INSTALL_DIR to a folder this user can write."
  fi
  arch="$(uname -m 2>/dev/null)"
  case "$arch" in
    x86_64 | aarch64) ;;
    *) problem "CPU" "${arch:-unknown} is not supported" "use a Linux machine or container on x86_64 or aarch64 (arm64)." ;;
  esac
  if [ "$(uname -s 2>/dev/null)" != Linux ]; then
    problem "system" "$(uname -s 2>/dev/null) is not supported" "use Linux (Debian or Ubuntu)."
  elif ! getconf GNU_LIBC_VERSION 2>/dev/null | grep -q glibc; then
    problem "libc" "this system does not use glibc (Alpine and other musl systems cannot load the terminal library)" "use a Debian- or Ubuntu-based image."
  fi
}

check_resources() {
  disk_dir="$(nearest_existing_dir "$ROOT")"
  free_kb="$(df -Pk "$disk_dir" 2>/dev/null | {
    read -r _
    read -r _ _ _ avail _
    printf '%s' "$avail"
  })"
  case "$free_kb" in
    '' | *[!0-9]*) problem "disk space" "cannot read free space on $disk_dir" "make sure df works and at least 6 GB is free there." ;;
    *)
      if [ "$free_kb" -lt "$MIN_DISK_KB" ]; then
        problem "disk space" "$((free_kb / 1024)) MB free on $disk_dir, the build needs $((MIN_DISK_KB / 1024)) MB" "free up space or set PROBE_INSTALL_DIR to a larger disk."
      fi
      ;;
  esac
  mem_kb="$(memory_kb)"
  if [ "$mem_kb" -lt "$MIN_MEM_KB" ]; then
    problem "memory" "$((mem_kb / 1024)) MB, the build needs about 4 GB" "give the machine or container at least 4 GB of memory."
  fi
  if have curl; then
    quiet curl -fsS -o /dev/null --max-time 20 "$PROBE_REGISTRY"
  elif have wget; then
    quiet wget -q -O /dev/null -T 20 "$PROBE_REGISTRY"
  else
    return 0
  fi || problem "package registry" "cannot reach $PROBE_REGISTRY" "check the network and any proxy settings (HTTPS_PROXY)."
}

take_lock() {
  LOCK="$ROOT/install.lock"
  unowned=0
  told=0
  # mkdir can report success on EEXIST on some systems, so use noclobber.
  while ! (set -C && printf '%s\n' "$$" >"$LOCK") 2>/dev/null; do
    owner="$(cat "$LOCK" 2>/dev/null)"
    if [ -n "$owner" ]; then
      unowned=0
      if ! kill -0 "$owner" 2>/dev/null; then
        note "removing the lock of stopped install $owner"
        rm -f "$LOCK"
        continue
      fi
      if [ "$told" = 0 ]; then
        say "Waiting for another install (pid $owner) to finish."
        told=1
      fi
    else
      # The owner writes its PID right after creating the file; give it a moment.
      unowned=$((unowned + 1))
      if [ "$unowned" -ge 5 ]; then
        rm -f "$LOCK"
        continue
      fi
    fi
    sleep 1
  done
  LOCK_HELD=1
  # Leftovers of a killed run; only the lock holder builds, so all of it is stale.
  rm -rf "$ROOT/build" "$ROOT"/.current.*
}

print_summary() {
  say "$1"
  say "  Folder:  $ROOT/versions/$2"
  say "  The commands below are placeholders and are not available yet:"
  say "  Start:   probe-server start --port <port> --host <bind address> --base-dir <state folder>"
  say "  Stop:    probe-server stop --base-dir <state folder>"
  say "  Pairing: probe-server pair --base-dir <state folder>"
  say "  Log:     $LOG"
  say "  Took $(elapsed)."
}

nothing_changed() {
  print_summary "Probe server $(package_version "$ROOT/versions/$1") ($(printf '%.7s' "$1")) is already installed; nothing changed." "$1"
  exit 0
}

switch_to() {
  link="$ROOT/.current.$$"
  ln -s "versions/$1" "$link" && mv -T "$link" "$ROOT/current"
}

prove() {
  PROOF_DIR="$(mktemp -d "$ROOT/build/proof-XXXXXX")" || return 1
  port="$(node -e '
    const server = require("node:net").createServer();
    server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });
  ')" || return 1
  note "proof: serve on 127.0.0.1:$port with state in $PROOF_DIR/state"
  T3CODE_NO_BROWSER=1 nohup node "$STAGING/apps/server/dist/bin.mjs" serve --host 127.0.0.1 \
    --port "$port" --base-dir "$PROOF_DIR/state" >>"$LOG" 2>&1 &
  SERVER_PID=$!
  node -e '
    const [url, pid, seconds] = process.argv.slice(1);
    const fs = require("node:fs");
    const deadline = Date.now() + Number(seconds) * 1000;
    const alive = () => {
      try { return !/^\d+ \(.*\) Z/s.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); }
      catch { return false; }
    };
    const attempt = async () => {
      if (!alive()) { console.error("proof: the server exited"); process.exit(1); }
      if (Date.now() > deadline) { console.error(`proof: no answer in ${seconds} s`); process.exit(1); }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) process.exit(0);
      } catch {}
      setTimeout(attempt, 250);
    };
    attempt();
  ' "http://127.0.0.1:$port/.well-known/t3/environment" "$SERVER_PID" "$PROOF_WAIT_SECONDS" >>"$LOG" 2>&1
  proved=$?
  stop_server
  rm -rf "$PROOF_DIR"
  PROOF_DIR=""
  return "$proved"
}

main() {
  STARTED_AT="$(date +%s)"
  if [ "$(id -u)" = 0 ]; then
    say "Probe installs for a normal user and refuses to run as root; nothing was changed."
    say "Run it as a non-root user, for example: su - <user> -c 'sh install-server.sh'"
    say "In a container: docker exec -u <user> <container> sh install-server.sh"
    exit 1
  fi
  ROOT="${PROBE_INSTALL_DIR:-${XDG_DATA_HOME:-${HOME:-}/.local/share}/probe}"
  case "$ROOT" in /*) ;; *) ROOT="$(pwd)/$ROOT" ;; esac
  if mkdir -p "$ROOT/logs" 2>/dev/null; then
    LOG="$ROOT/logs/install-$(date '+%Y%m%d-%H%M%S')-$$.log"
    : >"$LOG" 2>/dev/null || LOG=/dev/null
  fi
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  note "repo $PROBE_REPO ref $PROBE_REF root $ROOT"

  say "[1/5] check: this machine, $PROBE_REPO at $PROBE_REF"
  check_tools
  check_machine
  commit=""
  if have git; then
    commit="$(resolve_ref)"
    case $? in
      0) ;;
      2) problem repository "no branch or tag $PROBE_REF in $PROBE_REPO" "set PROBE_REF to an existing branch or tag." ;;
      *) problem repository "cannot reach $PROBE_REPO (network, or no credentials for a private repository)" "check the network, or set up git credentials for this user; PROBE_REPO sets another repository." ;;
    esac
  fi
  # Free space, memory and the registry only matter for a build; an installed commit must not fail on them.
  if [ -z "$PROBLEMS" ] && is_complete "$commit"; then
    if is_current "$commit"; then nothing_changed "$commit"; fi
  else
    check_resources
  fi
  if [ -n "$PROBLEMS" ]; then
    say "This machine cannot build Probe yet. Nothing was installed. Fix these and run again:"
    printf '%s' "$PROBLEMS"
    printf '%s' "$PROBLEMS" >>"$LOG" 2>/dev/null
    fail "No changes were made."
  fi

  mkdir -p "$ROOT/versions" || fail "Cannot create $ROOT/versions."
  take_lock
  if is_complete "$commit" && is_current "$commit"; then nothing_changed "$commit"; fi
  if ! is_complete "$commit"; then
    say "[2/5] fetch: $(printf '%.7s' "$commit")"
    mkdir -p "$ROOT/build" || fail "Cannot create $ROOT/build."
    STAGING="$(mktemp -d "$ROOT/build/stage-XXXXXX")" || fail "Cannot create a staging folder in $ROOT/build."
    quiet env GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}" \
      git clone --depth 1 --branch "$PROBE_REF" "$PROBE_REPO" "$STAGING" ||
      fail "Fetching $PROBE_REPO at $PROBE_REF failed; nothing was installed."
    commit="$(git -C "$STAGING" rev-parse HEAD)" || fail "The fetched source has no commit; nothing was installed."

    say "[3/5] build: dependencies and server (several minutes on a cold machine)"
    (cd "$STAGING" && quiet env CI=true vp i --frozen-lockfile && quiet vp run --filter t3 build) ||
      fail "The build failed; nothing was installed."

    say "[4/5] prove: start the built server and wait for it to answer"
    prove || fail "The built server did not start on this machine; nothing was installed."

    say "[5/5] switch: make this build current"
    if is_complete "$commit"; then
      rm -rf "$STAGING"
    else
      printf '%s\n' "$commit" >"$STAGING/.install-complete" &&
        rm -rf "$ROOT/versions/$commit" &&
        mv "$STAGING" "$ROOT/versions/$commit" ||
        fail "Cannot move the build into $ROOT/versions/$commit."
    fi
    STAGING=""
  else
    say "[5/5] switch: $(printf '%.7s' "$commit") is built already; make it current"
  fi
  switch_to "$commit" || fail "Cannot point $ROOT/current at versions/$commit."
  print_summary "Installed Probe server $(package_version "$ROOT/versions/$commit") ($(printf '%.7s' "$commit"))." "$commit"
}

# The whole script is parsed before main runs, so a cut-off download runs nothing
# and no command can read the rest of a piped script from stdin.
main "$@" </dev/null
