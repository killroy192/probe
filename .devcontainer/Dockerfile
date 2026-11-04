FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# The base image ships its user as "vscode"; every script, mount and permission
# rule for this repo says devcontaineruser instead.
RUN groupmod -n devcontaineruser vscode \
  && usermod -l devcontaineruser -d /home/devcontaineruser -m vscode \
  && mv /etc/sudoers.d/vscode /etc/sudoers.d/devcontaineruser \
  && sed -i 's/vscode/devcontaineruser/g' /etc/sudoers.d/devcontaineruser
