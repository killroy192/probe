FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Libraries Playwright's headless Chromium needs (scenario tests, Vitest browser
# mode), as Playwright 1.60 reports them missing from this base image, plus fonts
# so text and emoji render. Node arrives in a feature layer later, so Playwright's
# own install-deps cannot run here; it would also pull in xvfb and CJK fonts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libglib2.0-0t64 libnspr4 libnss3 libatk1.0-0t64 libdbus-1-3 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libxcb1 libxkbcommon0 libasound2t64 \
    libatspi2.0-0t64 fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# A new docker volume copies the ownership of the directory it is mounted on.
RUN install -d -o vscode -g vscode /home/vscode/.claude /home/vscode/.cache /home/vscode/.cache/ms-playwright

# vp is installed per user by on-create.sh. Set here, not in devcontainer.json:
# a plain docker exec only sees the image's environment.
ENV PATH=/home/vscode/.local/share/vite-plus/bin:$PATH

COPY port-relay.mjs /usr/local/bin/port-relay.mjs
