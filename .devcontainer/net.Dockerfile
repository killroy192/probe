FROM ubuntu:24.04

# nodejs only runs port-relay.mjs (node:net, any LTS will do).
RUN apt-get update \
  && apt-get install -y --no-install-recommends iptables ipset nodejs \
  && rm -rf /var/lib/apt/lists/*
COPY allowed-domains.txt /etc/probe/allowed-domains.txt
COPY port-relay.mjs /usr/local/bin/port-relay.mjs
COPY net-init.sh /usr/local/bin/net-init
RUN chmod 0755 /usr/local/bin/net-init

ENTRYPOINT ["/usr/local/bin/net-init"]
