#!/usr/bin/env bash
# Container entrypoint. Runs as root before anything else, because the
# devcontaineruser has no sudo and no NET_ADMIN effect: root-only setup and the
# firewall live here, not in the lifecycle scripts. If any step fails the
# container stops, so it never runs without its restrictions.
set -euo pipefail

# The feature layers can re-add a sudoers entry for the user; nothing in the
# container should be able to regain root, so drop them on every start.
find /etc/sudoers.d -type f ! -name README -delete

# Docker creates volume mount points root-owned unless the image has the
# directory already; node_modules sits inside the workspace bind mount, so the
# image cannot pre-create it.
for dir in /home/devcontaineruser/.cache /home/devcontaineruser/.cache/pnpm /workspaces/*/node_modules; do
  if [ -d "$dir" ]; then
    chown devcontaineruser:devcontaineruser "$dir"
  fi
done

# --- Firewall: outbound only to the hosts in allowed-domains.txt and DNS.
# Inbound only on loopback and the published dev server ports.
allowed_domains=/etc/probe/allowed-domains.txt
# Same offset the dev runner applies to its base ports (see devcontainer.json).
published_ports="$((5733 + ${T3CODE_PORT_OFFSET:-0})),$((13773 + ${T3CODE_PORT_OFFSET:-0}))"

ipset destroy allowed-hosts 2>/dev/null || true
ipset create allowed-hosts hash:net

resolve_allowed() {
  local domain ip
  while read -r domain; do
    case "$domain" in '' | \#*) continue ;; esac
    local found=0
    for ip in $(getent ahostsv4 "$domain" | awk '{print $1}' | sort -u); do
      ipset add -exist allowed-hosts "$ip"
      found=1
    done
    [ "$found" = 1 ] || echo "container-init: could not resolve $domain" >&2
  done <"$allowed_domains"
}

iptables -F
iptables -X
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports "$published_ports" -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for ns in $(awk '/^nameserver/ && $2 !~ /:/ {print $2}' /etc/resolv.conf); do
  iptables -A OUTPUT -d "$ns" -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -d "$ns" -p tcp --dport 53 -j ACCEPT
done
iptables -A OUTPUT -m set --match-set allowed-hosts dst -j ACCEPT
# REJECT, not DROP: a blocked connection fails at once instead of timing out.
iptables -A OUTPUT -j REJECT --reject-with icmp-port-unreachable
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# IPv6 is not allowlisted at all.
if [ -e /proc/net/if_inet6 ]; then
  ip6tables -F
  ip6tables -A INPUT -i lo -j ACCEPT
  ip6tables -A OUTPUT -o lo -j ACCEPT
  ip6tables -P INPUT DROP
  ip6tables -P FORWARD DROP
  ip6tables -P OUTPUT DROP
fi

resolve_allowed

# Docker's published ports reach the container's own address; the dev server
# listens on loopback. The relay (unprivileged) bridges the two published ports.
container_ip=$(hostname -i | awk '{print $1}')
runuser -u devcontaineruser -- node /usr/local/bin/port-relay.mjs "$container_ip" \
  "$((5733 + ${T3CODE_PORT_OFFSET:-0}))" "$((13773 + ${T3CODE_PORT_OFFSET:-0}))" &

trap 'exit 0' TERM INT
seconds=0
while sleep 1 & wait $!; do
  seconds=$((seconds + 1))
  if [ "$seconds" -ge 300 ]; then
    seconds=0
    # CDN-backed hosts rotate addresses; only add, never remove.
    resolve_allowed || true
  fi
done
