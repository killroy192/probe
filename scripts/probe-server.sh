#!/bin/sh
# Starts, stops and reports the Probe server this script was installed with, and
# prints a pairing token for it. install-server.sh links it as <install root>/probe-server.
#
#   probe-server start  [--port <port>] [--host <bind address>] [--base-dir <state folder>]
#   probe-server status [--base-dir <state folder>]
#   probe-server pair   [--base-dir <state folder>]
#   probe-server stop   [--base-dir <state folder>]
#   probe-server uninstall [--remove-data] [--base-dir <state folder>]
#
# Defaults: bind 127.0.0.1, state folder ~/.probe, and with no port the server
# picks a free one from 3773. The server's output goes to <state folder>/probe-server.log.
# uninstall removes the install this file lives in or, run from elsewhere, the one in
# PROBE_INSTALL_DIR (default ${XDG_DATA_HOME:-~/.local/share}/probe); it exits 0 when
# nothing is installed.

READY_SECONDS="${PROBE_SERVER_READY_SECONDS:-30}"
STOP_SECONDS="${PROBE_SERVER_STOP_SECONDS:-30}"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh"
COMMAND_SCRIPT_URL="https://raw.githubusercontent.com/killroy192/probe/main/scripts/probe-server.sh"

COMMAND=""
PORT=""
HOST=""
HOST_GIVEN=""
STATE=""
SELF=""
BUILD=""
ROOT=""
COMMIT=""
VERSION=""
LOG=""
LAUNCH=""
RUNTIME=""
REMOVE_DATA=""

say() {
  printf '%s\n' "$*"
}

die() {
  say "$1" >&2
  exit "${2:-1}"
}

usage() {
  die "Usage: $0 start [--port <port>] [--host <bind address>] [--base-dir <state folder>]
       $0 status|pair|stop [--base-dir <state folder>]
       $0 uninstall [--remove-data] [--base-dir <state folder>]
${1:-}" 2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

parse_args() {
  COMMAND="${1:-}"
  case "$COMMAND" in
    start | stop | status | pair | uninstall) shift ;;
    '' | -h | --help | help) usage ;;
    *) usage "Unknown command: $COMMAND" ;;
  esac
  while [ $# -gt 0 ]; do
    option="$1"
    if [ "$option" = --remove-data ]; then
      [ "$COMMAND" = uninstall ] || usage "--remove-data only applies to uninstall."
      REMOVE_DATA=1
      shift
      continue
    fi
    case "$option" in
      --*=*)
        value="${option#*=}"
        option="${option%%=*}"
        shift
        ;;
      *)
        [ $# -ge 2 ] || usage "Unknown option or missing value: $option"
        value="$2"
        shift 2
        ;;
    esac
    case "$option" in
      --base-dir)
        [ -n "$value" ] || usage "--base-dir needs a folder."
        STATE="$value"
        ;;
      --port)
        [ "$COMMAND" = start ] || usage "--port only applies to start."
        case "$value" in '' | *[!0-9]*) usage "--port takes a number from 1 to 65535." ;; esac
        [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || usage "--port takes a number from 1 to 65535."
        PORT="$value"
        ;;
      --host)
        [ "$COMMAND" = start ] || usage "--host only applies to start."
        [ -n "$value" ] || usage "--host needs a bind address."
        HOST="$value"
        ;;
      *) usage "Unknown option: $option" ;;
    esac
  done
  HOST_GIVEN="$HOST"
  HOST="${HOST:-127.0.0.1}"
}

# The install is the build this file lives in, also when it runs through the link.
locate_self() {
  self="$0"
  case "$self" in */*) ;; *) self="$(command -v "$self")" ;; esac
  SELF="$(readlink -f "$self" 2>/dev/null)" || SELF=""
  BUILD="$(dirname "$(dirname "$SELF")")"
  ROOT="$(dirname "$(dirname "$BUILD")")"
  have node || die "Node.js is not on PATH; the installed Probe server needs it."
}

locate_install() {
  locate_self
  COMMIT="$(cat "$BUILD/.install-complete" 2>/dev/null)"
  if [ -z "$SELF" ] || [ -z "$COMMIT" ] || [ "$(basename "$BUILD")" != "$COMMIT" ] ||
    [ ! -f "$BUILD/apps/server/dist/bin.mjs" ]; then
    say "The Probe server is not installed, or its install is incomplete (looked in ${BUILD:-$0})." >&2
    say "Install it with the install script, then run this command again:" >&2
    die "  curl -fsSL $INSTALL_SCRIPT_URL | sh"
  fi
  VERSION="$(node -p "require(process.argv[1]).version" "$BUILD/apps/server/package.json" 2>/dev/null)"
  VERSION="${VERSION:-unknown}"
}

locate_state() {
  if [ -z "$STATE" ]; then
    [ -n "${HOME:-}" ] || die "HOME is not set; pass --base-dir <state folder>."
    STATE="$HOME/.probe"
  fi
  STATE="$(node -p "require('node:path').resolve(process.argv[1])" "$STATE")" ||
    die "Cannot read the state folder path $STATE."
  LOG="$STATE/probe-server.log"
  LAUNCH="$STATE/probe-server.launch"
  RUNTIME="$STATE/userdata/server-runtime.json"
}

# Reads the server's runtime record and this command's launch record. A pid counts
# as running only when /proc shows our bin.mjs serving this state folder, so a pid
# reused after a container restart is not taken for the server.
INSPECT='
const fs = require("node:fs");
const path = require("node:path");
const [state, runtimePath, launchPath] = process.argv.slice(1);
const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
let runtime = {};
try { runtime = JSON.parse(read(runtimePath)); } catch {}
const launch = Object.fromEntries(
  read(launchPath).split("\n").filter((line) => line.includes("=")).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }),
);
const serves = (pid) => {
  if (!/^[1-9][0-9]*$/.test(String(pid ?? ""))) return false;
  if (/^\d+ \(.*\) [ZX]/s.test(read(`/proc/${pid}/stat`))) return false;
  const args = read(`/proc/${pid}/cmdline`).split("\0");
  const entry = args.findIndex((arg) => path.basename(arg) === "bin.mjs");
  if (entry < 0 || !["serve", "start"].includes(args[entry + 1])) return false;
  for (let index = entry + 2; index < args.length; index += 1) {
    const arg = args[index];
    const value = arg === "--base-dir" ? args[index + 1] : arg.startsWith("--base-dir=") ? arg.slice(11) : undefined;
    if (value !== undefined && path.resolve(value) === state) return true;
  }
  return false;
};
const pid = [runtime.pid, launch.pid].find(serves);
const fromRuntime = pid !== undefined && String(runtime.pid) === String(pid);
const print = (key, value) => console.log(`${key}=${value ?? ""}`);
print("pid", pid);
print("host", fromRuntime ? (runtime.host ?? "") : launch.host);
print("port", fromRuntime ? runtime.port : launch.port);
print("launch_pid", launch.pid);
print("launch_root", launch.root);
// The build that runs: the launch record names it; for a server started otherwise, its bin.mjs does.
let build = "";
if (pid !== undefined && String(launch.pid) === String(pid) && launch.build) build = launch.build;
else if (pid !== undefined) {
  const bin = read(`/proc/${pid}/cmdline`).split("\0").find((arg) => path.basename(arg) === "bin.mjs");
  build = path.resolve(bin, "../../../..");
}
print("build", build);
'

SERVER_PID=""
SERVER_HOST=""
SERVER_PORT=""
LAUNCH_PID=""
LAUNCH_ROOT=""
RUNNING_BUILD=""

inspect() {
  SERVER_PID=""
  SERVER_HOST=""
  SERVER_PORT=""
  LAUNCH_PID=""
  LAUNCH_ROOT=""
  RUNNING_BUILD=""
  facts="$(node -e "$INSPECT" "$STATE" "$RUNTIME" "$LAUNCH")" || die "Cannot read the server records in $STATE."
  while IFS='=' read -r key value; do
    case "$key" in
      pid) SERVER_PID="$value" ;;
      host) SERVER_HOST="$value" ;;
      port) SERVER_PORT="$value" ;;
      launch_pid) LAUNCH_PID="$value" ;;
      launch_root) LAUNCH_ROOT="$value" ;;
      build) RUNNING_BUILD="$value" ;;
    esac
  done <<EOF
$facts
EOF
}

is_wildcard() {
  case "$1" in '' | 0.0.0.0 | :: | '[::]') return 0 ;; esac
  return 1
}

is_loopback() {
  case "$1" in localhost | 127.* | ::1 | '[::1]') return 0 ;; esac
  return 1
}

url_host() {
  case "$1" in
    \[*) printf '%s' "$1" ;;
    *:*) printf '[%s]' "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The address a client uses; a wildcard bind has no single one.
address() {
  if is_wildcard "$1"; then
    printf 'http://<address you reach this server at>:%s' "$2"
  else
    printf 'http://%s:%s' "$(url_host "$1")" "$2"
  fi
}

# Where this machine itself reaches the server, for the readiness check.
local_host() {
  case "$1" in
    '' | 0.0.0.0) printf '127.0.0.1' ;;
    :: | '[::]') printf '[::1]' ;;
    *) url_host "$1" ;;
  esac
}

print_details() {
  host="$1"
  port="$2"
  say "  Address:      $(address "$host" "$port")"
  say "  Port:         $port"
  say "  Bind:         ${host:-all interfaces}"
  say "  State folder: $STATE"
  say "  Log:          $LOG"
  if ! is_loopback "$host"; then
    say "  Note: clients use the address they reach this machine at, such as a container's published port on its host."
  fi
}

version_line() {
  printf 'Probe server %s (%.7s)' "$VERSION" "$COMMIT"
}

# Waits for the pid to exit; exit 1 when it is still running after the limit.
WAIT_EXIT='
const [pid, seconds] = process.argv.slice(1);
const fs = require("node:fs");
const deadline = Date.now() + Number(seconds) * 1000;
const alive = () => {
  try { return !/^\d+ \(.*\) [ZX]/s.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); }
  catch { return false; }
};
const check = () => {
  if (!alive()) process.exit(0);
  if (Date.now() > deadline) process.exit(1);
  setTimeout(check, 100);
};
check();
'

wait_exit() {
  node -e "$WAIT_EXIT" "$1" "$2"
}

# Waits for the started server's runtime record and a 200 from its readiness path,
# then prints its port. Exit 1: it exited; exit 2: not ready in time.
WAIT_READY='
const [pid, runtimePath, bindHost, seconds] = process.argv.slice(1);
const fs = require("node:fs");
const deadline = Date.now() + Number(seconds) * 1000;
const alive = () => {
  try { return !/^\d+ \(.*\) [ZX]/s.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); }
  catch { return false; }
};
const attempt = async () => {
  if (!alive()) process.exit(1);
  if (Date.now() > deadline) process.exit(2);
  let runtime;
  try { runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")); } catch {}
  if (runtime && String(runtime.pid) === pid) {
    try {
      const url = `http://${bindHost}:${runtime.port}/.well-known/t3/environment`;
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        console.log(runtime.port);
        process.exit(0);
      }
    } catch {}
  }
  setTimeout(attempt, 200);
};
attempt();
'

PORT_FREE='
const [port, host] = process.argv.slice(1);
const server = require("node:net").createServer();
server.once("error", (error) => { console.log(error.code); process.exit(1); });
server.listen(Number(port), host, () => server.close(() => process.exit(0)));
'

start() {
  inspect
  if [ -n "$SERVER_PID" ]; then
    say "$(version_line): a server already runs for this state folder (pid $SERVER_PID); reusing it."
    print_details "$SERVER_HOST" "$SERVER_PORT"
    if { [ -n "$PORT" ] && [ "$PORT" != "$SERVER_PORT" ]; } ||
      { [ -n "$HOST_GIVEN" ] && [ "$HOST_GIVEN" != "$SERVER_HOST" ]; }; then
      say "  It does not use the port or bind address you asked for; stop it and start again to change them."
    fi
    print_next
    exit 0
  fi
  if [ -n "$PORT" ]; then
    check_host="$HOST"
    case "$check_host" in \[*\]) check_host="${check_host#\[}" && check_host="${check_host%\]}" ;; esac
    if ! reason="$(node -e "$PORT_FREE" "$PORT" "$check_host" 2>&1)"; then
      case "$reason" in
        EADDRINUSE) die "Port $PORT on $HOST is already in use. Pick another --port, or stop what uses it." ;;
        *) die "Cannot listen on port $PORT on $HOST (${reason:-unknown error}). Pick another --port or --host." ;;
      esac
    fi
  fi
  mkdir -p "$STATE" || die "Cannot create the state folder $STATE."
  printf '\n%s probe-server start: %s, bind %s, port %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" \
    "$(version_line)" "$HOST" "${PORT:-chosen by the server}" >>"$LOG" ||
    die "Cannot write the log $LOG."
  launcher=""
  if have setsid; then launcher=setsid; fi
  cd "${HOME:-$STATE}" 2>/dev/null || cd "$STATE" || die "Cannot enter $STATE."
  # The server's own startup token would land in the log; `pair` prints one instead.
  if [ -n "$PORT" ]; then
    T3CODE_NO_BROWSER=1 PROBE_STARTUP_PAIRING=0 $launcher nohup node "$BUILD/apps/server/dist/bin.mjs" \
      serve --host "$HOST" --port "$PORT" --base-dir "$STATE" </dev/null >>"$LOG" 2>&1 &
  else
    T3CODE_NO_BROWSER=1 PROBE_STARTUP_PAIRING=0 $launcher nohup node "$BUILD/apps/server/dist/bin.mjs" \
      serve --host "$HOST" --base-dir "$STATE" </dev/null >>"$LOG" 2>&1 &
  fi
  pid=$!
  printf 'pid=%s\nroot=%s\nbuild=%s\nhost=%s\nport=%s\n' "$pid" "$ROOT" "$BUILD" "$HOST" "$PORT" >"$LAUNCH.$$" &&
    mv -f "$LAUNCH.$$" "$LAUNCH" || say "Warning: cannot write $LAUNCH; stop will not know this server." >&2
  port="$(node -e "$WAIT_READY" "$pid" "$RUNTIME" "$(local_host "$HOST")" "$READY_SECONDS")"
  case $? in
    0) ;;
    1) failed_start "$pid" "The server exited during start." ;;
    *) failed_start "$pid" "The server did not answer within $READY_SECONDS s." ;;
  esac
  say "Started $(version_line) (pid $pid)."
  print_details "$HOST" "$port"
  print_next
}

failed_start() {
  kill "$1" 2>/dev/null
  if ! wait_exit "$1" 10; then kill -9 "$1" 2>/dev/null && wait_exit "$1" 5; fi
  rm -f "$LAUNCH"
  say "$2 Nothing is left running." >&2
  die "Log: $LOG"
}

print_next() {
  say "  Pairing:      $0 pair --base-dir $STATE"
  say "  Stop:         $0 stop --base-dir $STATE"
}

# Labels the complete versions under the install root, newest first, and the
# current and running builds as "<version> (<commit>)".
VERSIONS='
const fs = require("node:fs");
const path = require("node:path");
const [root, running] = process.argv.slice(1);
const label = (dir) => {
  let version = "unknown";
  try { version = JSON.parse(fs.readFileSync(path.join(dir, "apps/server/package.json"), "utf8")).version ?? version; } catch {}
  return `${version} (${path.basename(dir).slice(0, 7)})`;
};
let current = "";
try { current = path.resolve(root, fs.readlinkSync(path.join(root, "current"))); } catch {}
let names = [];
try { names = fs.readdirSync(path.join(root, "versions")); } catch {}
const installed = names
  .map((name) => path.join(root, "versions", name))
  .flatMap((dir) => {
    try {
      const marker = path.join(dir, ".install-complete");
      return fs.readFileSync(marker, "utf8").trim() === path.basename(dir) ? [[dir, fs.statSync(marker).mtimeMs]] : [];
    } catch { return []; }
  })
  .sort((a, b) => b[1] - a[1])
  .map(([dir]) => {
    const tags = [dir === current && "current", running && dir === path.resolve(running) && "running"].filter(Boolean);
    return tags.length === 0 ? label(dir) : label(dir).replace(/\)$/, `, ${tags.join(", ")})`);
  });
console.log(`current=${current ? label(current) : ""}`);
console.log(`current_dir=${current}`);
console.log(`running=${running ? label(running) : ""}`);
console.log(`installed=${installed.join(", ")}`);
'

CURRENT_LABEL=""
CURRENT_DIR=""
RUNNING_LABEL=""
INSTALLED=""

versions() {
  CURRENT_LABEL=""
  CURRENT_DIR=""
  RUNNING_LABEL=""
  INSTALLED=""
  facts="$(node -e "$VERSIONS" "$ROOT" "${1:-}")" || return 0
  while IFS='=' read -r key value; do
    case "$key" in
      current) CURRENT_LABEL="$value" ;;
      current_dir) CURRENT_DIR="$value" ;;
      running) RUNNING_LABEL="$value" ;;
      installed) INSTALLED="$value" ;;
    esac
  done <<EOF
$facts
EOF
}

status() {
  inspect
  versions "$RUNNING_BUILD"
  say "$(version_line)"
  say "  Install:      $BUILD"
  say "  Installed:    ${INSTALLED:-none}"
  if [ -n "$SERVER_PID" ]; then
    say "  Running:      yes (pid $SERVER_PID)"
    if [ "$RUNNING_BUILD" != "$CURRENT_DIR" ]; then
      say "  Note: the server runs $RUNNING_LABEL, not the installed current ${CURRENT_LABEL:-version}; stop and start it to switch."
    fi
    print_details "$SERVER_HOST" "$SERVER_PORT"
    exit 0
  fi
  say "  Running:      no"
  say "  Port:         none"
  say "  Bind:         none"
  say "  State folder: $STATE"
  say "  Log:          $LOG"
  say "  Start:        $0 start --base-dir $STATE"
  exit 3
}

stop() {
  inspect
  if [ -z "$SERVER_PID" ]; then
    die "No Probe server runs for $STATE; nothing to stop."
  fi
  if [ "$SERVER_PID" != "$LAUNCH_PID" ] || [ "$LAUNCH_ROOT" != "$ROOT" ]; then
    say "A Probe server runs for $STATE (pid $SERVER_PID), but this install did not start it; it keeps running." >&2
    die "Stop it with the tool that started it."
  fi
  kill -TERM "$SERVER_PID" 2>/dev/null || die "Cannot signal the server (pid $SERVER_PID)."
  if ! wait_exit "$SERVER_PID" "$STOP_SECONDS"; then
    say "The server (pid $SERVER_PID) is still shutting down after $STOP_SECONDS s; check again with status." >&2
    die "Log: $LOG"
  fi
  rm -f "$LAUNCH"
  say "Stopped the Probe server for $STATE (pid $SERVER_PID)."
  say "Shells keep running in the shell host; the next start reconnects to them."
}

pair() {
  inspect
  if [ -z "$SERVER_PID" ]; then
    say "No Probe server runs for $STATE. Start it first:" >&2
    die "  $0 start --base-dir $STATE"
  fi
  output="$(node "$BUILD/apps/server/dist/bin.mjs" pair --base-dir "$STATE" </dev/null 2>&1)" || {
    say "$output" >&2
    die "Creating a pairing token failed."
  }
  token=""
  expires=""
  while IFS= read -r line; do
    case "$line" in
      "Token: "*) token="${line#Token: }" ;;
      "Expires: "*) expires="${line#Expires: }" ;;
    esac
  done <<EOF
$output
EOF
  [ -n "$token" ] || {
    say "$output" >&2
    die "The pair command printed no token."
  }
  say "Token:        $token"
  say "Pairing URL:  $(address "$SERVER_HOST" "$SERVER_PORT")/pair#token=$token"
  if [ -n "$expires" ]; then say "Expires:      $expires (one use)"; fi
  if is_wildcard "$SERVER_HOST"; then
    say "Note: put the address you reach this machine at in the URL, such as a container's published port on its host."
  fi
}

# What stands in the way of removing the install and the state folder, read from
# /proc only (never to signal anything): server processes and shell hosts running
# a bin.mjs from this install, a running install, the state folder's shell host,
# and mount points at or inside the state folder.
UNINSTALL_FACTS='
const fs = require("node:fs");
const path = require("node:path");
const [root, given] = process.argv.slice(1);
const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const alive = (pid) => /^[1-9][0-9]*$/.test(pid) && read(`/proc/${pid}/stat`) !== "" && !/^\d+ \(.*\) [ZX]/s.test(read(`/proc/${pid}/stat`));
const args = (pid) => read(`/proc/${pid}/cmdline`).split("\0");
const ours = [path.join(root, "versions") + path.sep, path.join(root, "build") + path.sep];
for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
  if (pid === String(process.pid) || !alive(pid)) continue;
  const argv = args(pid);
  const entry = argv.findIndex((arg) => path.basename(arg) === "bin.mjs" && ours.some((dir) => arg.startsWith(dir)));
  if (entry < 0) continue;
  const command = argv[entry + 1];
  if (command === "__shell-host") console.log(`host=${pid} ${argv[entry + 2] ?? ""}`);
  if (command !== "serve" && command !== "start") continue;
  let baseDir = "";
  for (let index = entry + 2; index < argv.length; index += 1) {
    if (argv[index] === "--base-dir") baseDir = argv[index + 1] ?? "";
    else if (argv[index].startsWith("--base-dir=")) baseDir = argv[index].slice(11);
  }
  console.log(`server=${pid} ${baseDir}`);
}
const installer = read(path.join(root, "install.lock")).trim();
if (alive(installer)) console.log(`installer=${installer}`);
if (given) {
  const state = fs.existsSync(given) ? fs.realpathSync(given) : given;
  const userdata = path.join(state, "userdata");
  let pidFiles = [];
  try { pidFiles = fs.readdirSync(userdata).filter((name) => /^shell-host-v\d+\.pid$/.test(name)); } catch {}
  for (const file of pidFiles) {
    const pid = read(path.join(userdata, file)).trim();
    if (alive(pid) && args(pid).includes("__shell-host")) console.log(`state_host=${pid}`);
  }
  const unescape = (field) => field.replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)));
  for (const line of read("/proc/self/mountinfo").split("\n")) {
    const point = line.split(" ")[4];
    if (point === undefined) continue;
    const mounted = unescape(point);
    if (mounted === state) console.log("state_mounted=1");
    if (mounted === state || mounted.startsWith(state + path.sep)) console.log(`mount=${mounted}`);
  }
}
'

REMOVED=""
FAILED=""

# Removes one path the install made and records the outcome.
remove() {
  [ -e "$1" ] || [ -L "$1" ] || return 0
  if reason="$(rm -rf -- "$1" 2>&1)" && [ ! -e "$1" ] && [ ! -L "$1" ]; then
    REMOVED="$REMOVED  Removed: $1${2:+ ($2)}
"
  else
    reason="$(printf '%s\n' "$reason" | head -n 1)"
    FAILED="$FAILED  Could not remove $1: ${reason:-it is still there}
    Fix: chmod -R u+w '$1' && rm -rf '$1' (with sudo if another user owns it).
"
  fi
}

# Empties a mount point: the folder itself belongs to the mount and stays.
remove_contents() {
  for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    remove "$entry"
  done
}

uninstall() {
  locate_self
  if [ "$(basename "$(dirname "$BUILD")")" != versions ]; then
    ROOT="${PROBE_INSTALL_DIR:-${XDG_DATA_HOME:-${HOME:-}/.local/share}/probe}"
    ROOT="$(node -p "const fs = require('node:fs'); const p = require('node:path').resolve(process.argv[1]); fs.existsSync(p) ? fs.realpathSync(p) : p" "$ROOT")" ||
      die "Cannot read the install folder path $ROOT."
  fi
  case "$ROOT" in /?*) ;; *) die "The install folder ${ROOT:-(none)} is not an absolute path; set PROBE_INSTALL_DIR." ;; esac
  data=""
  if [ -n "$REMOVE_DATA" ]; then
    locate_state
    data="$STATE"
  fi

  servers=""
  hosts=""
  installer=""
  state_host=""
  mounts=""
  state_mounted=""
  facts="$(node -e "$UNINSTALL_FACTS" "$ROOT" "$data")" || die "Cannot read the running processes from /proc."
  while IFS='=' read -r key value; do
    case "$key" in
      server) servers="$servers $value
" ;;
      host) hosts="$hosts${hosts:+, }pid ${value%% *}" ;;
      installer) installer="$value" ;;
      state_host) state_host="$value" ;;
      mount) mounts="$mounts$value
" ;;
      state_mounted) state_mounted=1 ;;
    esac
  done <<EOF
$facts
EOF

  if [ -n "$installer" ]; then
    die "An install into $ROOT is running (pid $installer). Nothing was removed; run uninstall again when it has finished."
  fi
  if [ -n "$servers" ]; then
    say "A Probe server from $ROOT is still running. Nothing was removed. Stop it first, then run uninstall again:" >&2
    while read -r pid base; do
      [ -n "$pid" ] || continue
      say "  pid $pid: $ROOT/probe-server stop${base:+ --base-dir $base}" >&2
    done <<EOF
$servers
EOF
    exit 1
  fi
  if [ -n "$data" ]; then
    inspect
    if [ -n "$SERVER_PID" ]; then
      die "A Probe server runs for $STATE (pid $SERVER_PID). Nothing was removed; stop it first, then run uninstall again."
    fi
    if [ -n "$state_host" ]; then
      say "The shell host of $STATE still runs (pid $state_host) with its shells. Nothing was removed." >&2
      die "End those shells, or stop the host with: kill $state_host (this ends its shells); then run uninstall again."
    fi
  fi

  versions ""
  nothing=1
  for entry in versions build logs current probe-server; do
    if [ -e "$ROOT/$entry" ] || [ -L "$ROOT/$entry" ]; then nothing=""; fi
  done
  if [ -n "$nothing" ]; then
    say "Nothing is installed in $ROOT; nothing to remove there."
  else
    # The command link goes first, so a partial uninstall cannot start a half-removed build.
    remove "$ROOT/probe-server"
    remove "$ROOT/current"
    remove "$ROOT/build"
    remove "$ROOT/versions" "$INSTALLED"
    remove "$ROOT/logs"
    for leftover in "$ROOT/install.lock" "$ROOT"/.current.* "$ROOT"/.probe-server.*; do
      remove "$leftover"
    done
    if rmdir "$ROOT" 2>/dev/null; then
      REMOVED="$REMOVED  Removed: $ROOT (it was empty)
"
    elif [ -z "$FAILED" ]; then
      REMOVED="$REMOVED  Kept:    $ROOT (it holds files the install did not make)
"
    fi
  fi

  if [ -n "$data" ] && [ -d "$STATE" ]; then
    if [ -n "$mounts" ]; then
      while IFS= read -r mount; do
        [ -n "$mount" ] || continue
        say "Note: $mount is a mount point; it may be a folder of the host machine, and its contents are removed there too."
      done <<EOF
$mounts
EOF
    fi
    if [ -n "$state_mounted" ]; then
      remove_contents "$STATE"
      REMOVED="$REMOVED  Emptied: $STATE (the mount point itself stays)
"
    else
      remove "$STATE" "state folder"
    fi
  fi

  [ -z "$nothing" ] && say "Uninstalled the Probe server from $ROOT."
  printf '%s' "$REMOVED"
  if [ -z "$data" ]; then
    say "  Kept:    state folders such as ~/.probe (workspaces, database, shell data). To remove one too:"
    say "           curl -fsSL $COMMAND_SCRIPT_URL | sh -s uninstall --remove-data --base-dir <state folder>"
  fi
  say "  Kept:    Node.js, Vite+ and its package cache."
  if [ -n "$hosts" ]; then
    say "  Note: a shell host from this install still runs ($hosts); its shells keep running until they end."
  fi
  if [ -n "$FAILED" ]; then
    printf '%s' "$FAILED" >&2
    exit 1
  fi
  exit 0
}

main() {
  parse_args "$@"
  # uninstall deletes this file; it runs from functions read in full before main starts.
  if [ "$COMMAND" = uninstall ]; then uninstall; fi
  locate_install
  locate_state
  "$COMMAND"
}

# Parsed whole before it runs; nothing reads stdin.
main "$@" </dev/null
