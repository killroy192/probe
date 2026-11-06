# Development

## First checkout

Install `vp` using the [root README](../../README.md#install-vp). It provides the Node version
pinned in `package.json` (Node 26), so no separate Node install is needed. From the repository root:

```sh
vp i
vp run dev
```

Open the pairing URL printed by the dev runner. The bare origin does not authenticate
a new browser.

Working with an agent? Run it in the [dev container](#dev-container) instead.

## Dev container

A Linux container (Ubuntu 24.04, Node 26, Rust, `vp`, Claude Code) for the agent and everything it
runs, so mistakes stay off your machine. It sees only the checkout. Why it is built this way:
[Dev container](../internals/devcontainer.md). It needs Docker Desktop.

- **Cursor or VS Code:** open the checkout and run _Dev Containers: Reopen in Container_.
- **Terminal:** see [From a terminal](#from-a-terminal).

Both start the same container, `probe-dev-<folder>`, with the checkout at `/workspaces/<folder>`. Before
each start, `.devcontainer/init-env.sh` runs on your machine by itself: it disables git hooks on the
host, finds the repository's shared `.git` and picks the ports. The first start runs `vp i` and installs
the rest, including Playwright's headless Chromium for the scenario and web browser tests;
`node_modules`, the browser and Claude Code's login live in volumes and survive rebuilds. Rebuild after
changing `.devcontainer/`.

- **Claude Code:** run `claude` in the container and log in once. Its status line is
  [glint](https://github.com/oleg-koval/glint), installed on first start without gauges; rerun its
  installer with `--bars` to add them.
- **Git and push:** commit and push from the container; hooks run only there. Push uses your SSH agent,
  forwarded by Docker Desktop (and by Cursor in an attached window), so your key must be loaded in it:
  `ssh-add -l` on your Mac lists it. Add `AddKeysToAgent yes` and `UseKeychain yes` to `~/.ssh/config`
  if it is empty after a restart.
- **Ports:** the web and backend ports are the dev runner's defaults plus an offset per checkout, published
  on `127.0.0.1` and the same inside and out, so the pairing URL the dev runner prints works on your
  machine. Cursor also forwards them itself.
- **Reusable dev credential:** copy the main checkout's `.env` into the checkout; `worktree.sh` does it for
  you.

### From a terminal

From the checkout on your machine:

```sh
npx @devcontainers/cli@0.89.0 up --workspace-folder .            # start, or reuse a running one
npx @devcontainers/cli@0.89.0 exec --workspace-folder . claude   # Claude Code, in /workspaces/<folder>
npx @devcontainers/cli@0.89.0 exec --workspace-folder . claude --dangerously-skip-permissions
npx @devcontainers/cli@0.89.0 exec --workspace-folder . bash     # a shell instead
docker stop probe-dev-<folder>                                   # stop; the next `up` starts it again
```

`up` reuses a container that Cursor started, and Cursor reuses one that `up` started. The first
`claude` asks you to log in: open the URL it prints on your machine and paste the code back.
`--dangerously-skip-permissions` runs Claude Code without permission prompts; the flag overrides the
checkout's settings, and the container is what limits the damage. It works here because the container
user is not root. Prefer
`exec` over `docker exec -it -u vscode -w /workspaces/<folder> probe-dev-<folder> claude`: it applies
the container's environment the way Cursor does. To skip the `npx` download, install the CLI once with
`npm i -g @devcontainers/cli@0.89.0` and run `devcontainer up` and `devcontainer exec`. For a worktree,
pass its folder: `--workspace-folder ../<repo>-<branch>`.

### Worktrees

Each worktree opens in its own container. Create and remove them on your machine; the container cannot
see the folders next to its checkout:

```sh
.devcontainer/worktree.sh add <branch>                  # ../<repo>-<branch>, new branch from main
.devcontainer/worktree.sh add <branch> --path <dir> --from <ref>
.devcontainer/worktree.sh remove <dir>                  # container, volumes and worktree
```

Then open the new folder and reopen it in the container. `worktree.sh` creates worktrees with relative
paths, so the container can mount the main checkout's `.git` without its files, and locks them, so a
prune run from another container keeps them. Relative worktrees need git 2.48 or newer for every tool
that opens the repository. Remove a worktree's branch yourself once it is merged.

## GitCafe mirror (optional)

GitHub is the source of truth. [git.cafe/pingdotgg/t3code](https://git.cafe/pingdotgg/t3code) is a
two-way synced mirror with much higher API rate limits, which helps when many agents work at once.
You never need it to contribute.

Pushes, PRs, comments, reviews, labels, and issue edits made on GitCafe sync to GitHub within
about a minute, and PR and issue numbers match. CI runs on GitHub, and its checks show up on
GitCafe.

```sh
git remote set-url origin https://git.cafe/pingdotgg/t3code.git
git remote add github https://github.com/pingdotgg/t3code.git
gh repo set-default pingdotgg/t3code   # `gh` is still used for merging
bun install -g @gitcafe/cli@latest   # `cafe` needs Bun 1.2 or newer
cafe auth login && cafe auth http setup
cafe skills install --global  # optional: cafe-* skills for coding agents
```

With `origin` on git.cafe, work through GitCafe and leave GitHub's API alone:

- Push to `origin`, open PRs with `cafe pr create` (`--head owner/repo:branch` from a fork) or
  `cafe stack submit`, and use `cafe` for everything after that. Link the git.cafe PR URL, not the
  github.com one, wherever a tool tracks the PR, so polling stays on GitCafe.
- Read checks with `cafe pr status <n>`, and GitHub Actions logs with `cafe ci logs <run>` (run ids
  from `cafe ci list --pr <n>`). `cafe ci rerun <run>` reruns one. These need `cafe` 0.11 or newer.
- Write closing references as `Fixes pingdotgg/t3code#<n>`. GitCafe turns a bare `#<n>` in text it
  syncs to GitHub into a git.cafe link, and GitHub does not close issues from those.
- Merge with `gh pr merge <n> --match-head-commit <sha>`, because `cafe pr merge` cannot pin the
  commit you reviewed.
- `cafe` commands differ from `gh`: `cafe issue comments <n>` not `--comments`, `cafe pr status`
  not `pr checks`.

## Choosing a dev process

Use `vp run dev` for server and web, or `vp run dev:desktop` for the Electron client.
`dev:server` and `dev:web` start those processes separately.
See the [mobile README](../../apps/mobile/README.md) for native builds and Metro.

Flags go directly after the task name, for example `vp run dev --home-dir /tmp/t3code-dev`.
Add `--browser` to open a browser automatically.

### State and ports

Linked worktrees default to their own `.t3/userdata`, even when `T3CODE_HOME` is set.
The main checkout defaults to `~/.t3/dev`. An explicit `--home-dir` wins in both cases.
The first start in a worktree seeds its empty database from a read-only copy of
`~/.t3/userdata/statev2.sqlite` if the source is at most 500 MiB. Larger sources warn
and dev starts with an empty database. `--no-seed` or `T3CODE_DEV_SEED=0` skips seeding.
To copy a larger source, run `vp run migrate-dev-db` with dev stopped. It may use
substantial disk space before pruning.
Never run a development server against the live `~/.t3/userdata`.
See [test data](../../AGENTS.md#test-data) for copying a consistent database snapshot.

Stopping a dev server leaves its shells running in that state folder's shell host
(`<state dir>/shell-host-v1.pid`), and the next start takes them back. End them from the
UI, or stop the host by the pid in that file, which ends every shell it holds. Never look
the host up by its command line: every checkout's host runs the same command.

Read ports from the `[dev-runner]` output. Worktrees derive stable preferences from their paths,
but occupied ports can shift them. `T3CODE_PORT_OFFSET` or `T3CODE_DEV_INSTANCE` can select a
different preference when needed.

### Replay provider

`vp run dev` registers `Replay (dev)`, a local ACP agent at
[dev-replay-agent.ts](../../apps/server/scripts/dev-replay-agent.ts). It plays recorded
ACP transcripts with simulated streaming, so the real adapter, orchestration, and UI run
without a paid model. Each scenario is a model, and each prompt plays the next recorded turn.
Bundled servers, including desktop dev, skip it because they have no agent script.
Dev servers add it back on start, so turn it off in Settings instead of removing it.
To add a scenario, point a `SCENARIOS` entry at a generic ACP replay fixture
(`registry_transcript.ndjson`) or a file in [dev-replay](../../apps/server/scripts/dev-replay).
The agent replays session updates, permission requests, and questions. It drops session setup
and vendor frames, so Grok and fx recordings lose their vendor-only behavior.

### Sharing and remote debugging

`vp run dev --share` publishes the web port over the machine's tailnet and prints a pairing URL
for that origin. Give the tester the complete URL, including its token. The dev runner removes
its mapping on exit.

Leave `VITE_HTTP_URL` and `VITE_WS_URL` unset. Vite proxies the backend through the browser's
origin so the same build works over localhost and remote connections.

Shared runs enable bundled dev to avoid a network round trip for each import level.
`T3CODE_BUNDLED_DEV=0` opts out when debugging bundler differences. Two reload traps matter
when changing this setup:

- The web entry must dynamically import the app so React refresh initializes before application
  chunks. Static imports can work on first load and fail after a route split.
- Bundled dev rebuilds Tailwind through watched files. Its ordinary Vite hot-update hook expects
  a server/module graph that Rolldown does not provide.
- The app and its routes are lazy chunks, built on first request. A plugin pre-bundles the
  startup chain when the server starts. Renaming or moving a startup route or the app entry
  silently drops it from that list.

The workarounds live in the [web entry](../../apps/web/src/bootstrap.ts),
[Tailwind plugin](../../apps/web/vite/tailwind.ts), and
[startup warmup](../../apps/web/vite/warmBundledDev.ts).

`vp run dev --share --built` skips the Vite dev server. It runs `vp build --watch` for the web
app, and the backend serves `apps/web/dist` on the same tailnet URL and pairing flow. Use it when
someone tests over a slow link or only needs to use the app: loads are production size, and the
first load does not wait for dev bundling. There is no HMR. After an edit, wait for the
`built in` line (about 6 s), then reload. Until the first build exists, the URL shows a page that
reloads by itself. The license manifest is not generated in this mode. `--built` requires
`--share` and the `dev` mode.

#### Reusable dev credential

Use this only on a hostname where you trust every service. Browsers send cookies to all ports
on that hostname. Any service you visit there can receive the reusable admin credential,
including services unrelated to T3 Code. If you run untrusted services on that hostname, keep
normal per-environment pairing instead.

To use one browser profile across web dev worktrees on the same hostname, generate one fixed
value once:

```sh
openssl rand -hex 32
```

Put that value in the main checkout's gitignored `.env`:

```dotenv
T3CODE_DEV_AUTH_TOKEN=<the value generated above>
```

Copy that file to each worktree's `.env`; a symlink to the main checkout does not resolve inside the
dev container. The dev runner reads repository env files at startup. `.env.local` and inherited process
environment values override `.env`.

Do not generate a new value at startup. Start or restart `vp run dev --share` after configuration,
then open its printed startup pairing URL once per browser profile on that hostname. Later web dev
servers on the same hostname accept the shared cookie across ports. The cookie expires after 30
days. Reload an old tab if its URL now serves a replacement environment.

The token and startup pairing URLs are reusable administrative secrets. Never put them in a
commit, pull request, or public output. Every server still seeds its own auth database record at
startup and keeps its own SQLite data, signing key, and revocation state. Desktop and non-dev
servers ignore the value. See [environment authentication](../internals/environment-auth.md#reusable-dev-credential)
for the security model.

## Checks

`vp run check:changed` runs CI's fast checks for your branch's changes: format and lint of the
changed files, `knip:check` when code or a manifest changes, the generated GraphQL checks, typecheck
of the affected packages and their dependents, and the test files beside the changed files. It also
runs the checks that read other files: the agent context budget when the server is affected, and
React Compiler coverage for only the changed web and mobile files. It maps
files to packages with [ci-changes.cjs](../../.github/scripts/ci-changes.cjs), as CI does. It
compares against the merge base with `origin/main`, or with a ref you pass. CI still runs the full
test suites and the jobs the summary lists, so a local pass does not promise a green CI run.

The steps run side by side, so a run takes about as long as its slowest step, usually knip's
exports pass at about 10 s. When the files are exactly those of the last passing run, it prints that
run's summary instead of running again. Any change to a file, the install, or a generated file runs
the checks again.

While you iterate, run single checks:

```sh
vp test run <files>
vp lint <files>
vp run --filter <package> typecheck
```

In `apps/web`, a test that renders React or touches the DOM is named `*.browser.test.{ts,tsx}`
and runs in headless Chromium with the React Compiler on, like the app. There is no jsdom; other
`*.test.ts` files run in Node.

TypeScript workspaces typecheck with `tsc`. The `typescript` catalog entry is
`@tsc-rs/typescript`, the tsc-rs drop-in, with Effect diagnostics, quick fixes, and
refactors built in. VS Code uses it through `js/ts.tsdk.path` in `.vscode/settings.json`.

Use `vp run lint:mobile` for native mobile changes. CI owns the full suite; see
[ci.yml](../../.github/workflows/ci.yml) for its current jobs.
The [manual Windows lane](../../.github/workflows/windows-tests.yml) is available for focused
Windows investigation while that suite is not a required gate.

### Unused code

`vp run knip:check` checks unused files and dependencies across the repo, then
unused runtime exports in `apps/server`, `apps/desktop`, `apps/web`, and every internal package under
`packages/`. CI enforces both checks.
Exported types and Effect schemas are allowed without consumers. The schema preprocessor
recognizes schema types, including aliases and schema classes; functions that create or decode
schemas remain checked. Canonical Effect service construction APIs stay exported with an explicit
`@public` annotation, which Knip recognizes. Completely unused files remain checked too.
Named exports in web UI component modules are kept as complete component sets. Knip ignores
unused exports in `apps/web/src/components/ui/*.tsx`, while still reporting an entire unused file.
Use `vp run knip --workspace apps/web` to audit one workspace, including exports,
or `vp run knip:production --workspace apps/web` to find code kept alive only by tests.
The full export audit still has findings and is not a repo-wide CI gate. Extend the
export check's workspace selectors as more workspaces become clean. Review callers before
deleting code; production mode can also report development scripts and test fixtures.
Runtime-discovered entrypoints and dependency exceptions belong in [knip.jsonc](../../knip.jsonc).

### Scenario tests

`vp run test:scenarios` starts Probe on a throwaway data directory, drives it in headless Chromium, and prints each scenario as `PASS`, `FAIL` or `PENDING` plus how many of the 8 pass. It exits non-zero when a scenario fails. It uses the same Playwright Chromium as the web browser tests (install it once with `node scripts/node_modules/playwright-core/cli.js install --only-shell chromium`, or pass `--browser <path>`) and builds the web bundle if `apps/web/dist` is missing; pass `--rebuild` after web changes. It never touches `~/.t3` and does not disturb a running dev server. Each scenario stops its server's shell host, by the pid in its throwaway home, before deleting that home. Scenarios themselves are not a CI gate.

`vp run test:scenarios -- --only S1` runs a single scenario by id. `vp run test:scenarios -- --selftest` runs the harness self-tests (restart persistence and a deliberate failure, so it exits non-zero by design). See [Testing](../internals/testing.md#scenario-tests).

The mock agent CLI stands in for a Claude-Code-like tool:

```sh
node scripts/mock-agent/mock-agent.ts                  # prints a banner and "session: mock-xxxxxxxx"
node scripts/mock-agent/mock-agent.ts --resume <id>    # replays that conversation, then continues it
```

It echoes each line as `echo: <line>` and exits 0 on `exit`. Sessions are stored in
`$MOCK_AGENT_HOME` (default: a `probe-mock-agent` folder in the system temp directory).

`vp run dev` sets `PROBE_AGENT_COMMAND` to this mock CLI unless your environment already sets it,
so shells started from a workspace run it. The scenario runner does the same per scenario. S2
prints the time from the start click to the CLI banner as `start-to-banner ms=…`; it is reported,
not enforced.

## Desktop artifacts

Local artifact builds are unsigned by default and write to `release/`:

```sh
vp run dist:desktop:dmg
vp run dist:desktop:linux
vp run dist:desktop:win
```

DMGs default to the host architecture. Use `--arch` to choose another target and `--keep-stage`
to retain packaging files for inspection. Run `vp run dist:desktop:artifact --help` for other
options.

### Linux AppImage prerequisites

Build on Linux because the browser-secret helper links against the host's libsecret. Install
Rust, C/C++ build tools, libsecret development headers, pkg-config, and ImageMagick.

Ubuntu and Debian:

```sh
sudo apt-get update
sudo apt-get install cargo rustc build-essential libsecret-1-dev pkg-config imagemagick
```

Fedora:

```sh
sudo dnf install rust cargo gcc gcc-c++ make libsecret-devel pkgconf-pkg-config ImageMagick
```

Arch Linux:

```sh
sudo pacman -S rust base-devel libsecret pkgconf imagemagick
```

The C toolchain, pkg-config, and libsecret headers are also needed for Linux desktop development.

### macOS DMG prerequisites

Install the Xcode Command Line Tools with `xcode-select --install` and install Rust.
For a cross-architecture or universal build, add the requested Rust targets:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### Windows installer prerequisites

Install Rust, Python 3, and Visual Studio Build Tools with **Desktop development with C++**.
Include the Windows SDK and the MSVC build tools and Spectre-mitigated libraries for the target
architecture. Add its Rust target:

```powershell
rustup target add x86_64-pc-windows-msvc
# For an ARM64 installer:
rustup target add aarch64-pc-windows-msvc
```

NSIS is downloaded by electron-builder. WSL support additionally needs the Linux CLI archive
passed as `--wsl-runtime`; see the
[release runbook](./release.md#windows-payload-topology-and-update-validation).

### Signing and passkeys

Add `--signed` after configuring the platform credentials in the
[release runbook](./release.md). macOS passkeys need a signed, provisioned app; follow the
[Connect setup](./connect-setup.md#desktop-passkeys) for local signing and renderer HMR.
