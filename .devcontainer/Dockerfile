FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# A new docker volume copies the ownership of the directory it is mounted on.
RUN install -d -o vscode -g vscode /home/vscode/.claude

# vp is installed per user by on-create.sh. Set here, not in devcontainer.json:
# a plain docker exec only sees the image's environment.
ENV PATH=/home/vscode/.local/share/vite-plus/bin:$PATH

COPY port-relay.mjs /usr/local/bin/port-relay.mjs
