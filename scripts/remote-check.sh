#!/bin/sh
# Checks from outside a target that an installed Probe server answers a client:
# the readiness request, then the exchange of a pairing token for a browser
# session. Prints the HTTP code of each and PASS or FAIL; never prints the token.
#
#   sh remote-check.sh <origin> [token]
#   probe-server pair ... | sed -n 's/^Token: *//p' | sh remote-check.sh <origin>
#
# <origin> is the address this machine reaches the server at, such as
# http://127.0.0.1:3773 for a published or forwarded port. With no token argument
# the token is read from stdin, which keeps it out of the process list and the
# shell history. A token is single use: the exchange spends it, so pair again
# for a browser. Needs only sh and curl. Exit 0 on PASS, 1 on FAIL, 2 on misuse.

usage() {
  printf '%s\n' "Usage: $0 <origin> [token]   (no token: read it from stdin)" >&2
  exit 2
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage
origin="${1%/}"
case "$origin" in http://?* | https://?*) ;; *) usage ;; esac
command -v curl >/dev/null 2>&1 || {
  printf '%s\n' "curl is not on PATH." >&2
  exit 2
}
if [ $# -eq 2 ]; then
  token="$2"
else
  IFS= read -r token || [ -n "$token" ] || token=""
fi
case "$token" in
  '') printf '%s\n' "No token given." >&2 && exit 2 ;;
  *[\"\\]* | *[[:space:]]*) printf '%s\n' "The token has characters a pairing token never has." >&2 && exit 2 ;;
esac

# Prints the HTTP status, or 000 when nothing answered.
status() {
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@")"
  printf '%s' "${code:-000}"
}

ready="$(status "$origin/.well-known/t3/environment")"
printf 'readiness  GET  %s/.well-known/t3/environment -> %s\n' "$origin" "$ready"
if [ "$ready" != 200 ]; then
  printf 'pairing    POST %s/api/auth/browser-session -> skipped (token not spent)\n' "$origin"
  printf 'FAIL %s (not ready)\n' "$origin"
  exit 1
fi

# printf is a builtin, so the token reaches curl on stdin, not in its arguments.
paired="$(printf '{"credential":"%s"}' "$token" |
  status -X POST -H 'Content-Type: application/json' --data-binary @- \
    "$origin/api/auth/browser-session")"
printf 'pairing    POST %s/api/auth/browser-session -> %s\n' "$origin" "$paired"
if [ "$paired" != 200 ]; then
  printf 'FAIL %s (token refused or spent)\n' "$origin"
  exit 1
fi
printf 'PASS %s\n' "$origin"
