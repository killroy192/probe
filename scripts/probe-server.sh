#!/bin/sh
# Starts, stops and reports the Probe server this script was installed with, and
# prints a pairing token for it. install-server.sh links it as <install root>/probe-server.
#
#   probe-server start  [--port <port>] [--host <bind address>] [--base-dir <state folder>]
#   probe-server status [--base-dir <state folder>]
#   probe-server pair   [--base-dir <state folder>]
#   probe-server stop   [--base-dir <state folder>]
#
# Defaults: bind 127.0.0.1, state folder ~/.probe, and with no port the server
# picks a free one from 3773. The server's output goes to <state folder>/probe-server.log.

READY_SECONDS="${PROBE_SERVER_READY_SECONDS:-30}"
STOP_SECONDS="${PROBE_SERVER_STOP_SECONDS:-30}"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh"

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
${1:-}" 2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

parse_args() {
  COMMAND="${1:-}"
  case "$COMMAND" in
    start | stop | status | pair) shift ;;
    '' | -h | --help | help) usage ;;
    *) usage "Unknown command: $COMMAND" ;;
  esac
  while [ $# -gt 0 ]; do
    option="$1"
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
locate_install() {
  self="$0"
  case "$self" in */*) ;; *) self="$(command -v "$self")" ;; esac
  SELF="$(readlink -f "$self" 2>/dev/null)" || SELF=""
  BUILD="$(dirname "$(dirname "$SELF")")"
  ROOT="$(dirname "$(dirname "$BUILD")")"
  COMMIT="$(cat "$BUILD/.install-complete" 2>/dev/null)"
  have node || die "Node.js is not on PATH; the installed Probe server needs it."
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
'

SERVER_PID=""
SERVER_HOST=""
SERVER_PORT=""
LAUNCH_PID=""
LAUNCH_ROOT=""

inspect() {
  SERVER_PID=""
  SERVER_HOST=""
  SERVER_PORT=""
  LAUNCH_PID=""
  LAUNCH_ROOT=""
  facts="$(node -e "$INSPECT" "$STATE" "$RUNTIME" "$LAUNCH")" || die "Cannot read the server records in $STATE."
  while IFS='=' read -r key value; do
    case "$key" in
      pid) SERVER_PID="$value" ;;
      host) SERVER_HOST="$value" ;;
      port) SERVER_PORT="$value" ;;
      launch_pid) LAUNCH_PID="$value" ;;
      launch_root) LAUNCH_ROOT="$value" ;;
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

status() {
  inspect
  say "$(version_line)"
  say "  Install:      $BUILD"
  if [ -n "$SERVER_PID" ]; then
    say "  Running:      yes (pid $SERVER_PID)"
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

main() {
  parse_args "$@"
  locate_install
  locate_state
  "$COMMAND"
}

# Parsed whole before it runs; nothing reads stdin.
main "$@" </dev/null
