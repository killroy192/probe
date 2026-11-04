FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# The base image ships its user as "vscode"; every script, mount and permission
# rule for this repo says devcontaineruser instead. No sudo for it: the entrypoint
# (root) does the privileged setup.
RUN groupmod -n devcontaineruser vscode \
  && usermod -l devcontaineruser -d /home/devcontaineruser -m vscode \
  && rm -f /etc/sudoers.d/vscode

# vp is installed per user by on-create.sh (no sudo to link it into /usr/local/bin).
# Set here, not in devcontainer.json: docker exec only sees the image's environment.
ENV PATH=/home/devcontaineruser/.local/share/vite-plus/bin:$PATH

COPY container-init.sh /usr/local/bin/container-init
RUN chmod 0755 /usr/local/bin/container-init

ENTRYPOINT ["/usr/local/bin/container-init"]
