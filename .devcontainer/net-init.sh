#!/usr/bin/env bash
# Entrypoint of the net container, which owns the network namespace the dev
# container joins. Outbound only to the hosts in allowed-domains.txt and DNS;
# inbound only on loopback and the published dev server ports. If any step
# fails the container stops, its healthcheck never passes, and dev never starts.
set -euo pipefail

allowed_domains=/etc/probe/allowed-domains.txt
read -r -a ports <<<"$PROBE_PORTS"

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
    [ "$found" = 1 ] || echo "net-init: could not resolve $domain" >&2
  done <"$allowed_domains"
}

iptables -F
iptables -X
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports "$(IFS=,; echo "${ports[*]}")" -j ACCEPT
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

# Docker's published ports reach the namespace's own address; the dev server
# listens on loopback. The relay (unprivileged) bridges the two.
setpriv --reuid=nobody --regid=nogroup --clear-groups -- node /usr/local/bin/port-relay.mjs "${ports[@]}" &
touch /run/probe-firewall-ready

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
