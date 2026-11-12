# Install Probe on a remote machine or devcontainer

`scripts/install-server.sh` builds the Probe server from source inside a Linux machine or container
and checks that it starts there. Run it inside the target, as the user who will run the server.
`<install folder>/probe-server` then starts, stops and reports that server, prints pairing
tokens for it, and uninstalls it.

To Probe a container and a remote machine are the same: the same script, the same output and the
same connection. You set up the container or machine, its mounts and credentials, and your agent
CLIs and their logins; Probe does not.

## What the target needs

The script checks every item below before it changes anything, lists all the problems it finds,
each with the fix shown here, and installs nothing until they are fixed.

| Item                     | Needed                                                                | Fix the script prints                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User                     | not root                                                              | run it as a non-root user, for example `su - <user> -c 'sh install-server.sh'`; in a container `docker exec -u <user> <container> sh install-server.sh` |
| `git`                    | on `PATH`                                                             | install git (Debian/Ubuntu: `sudo apt-get install git`)                                                                                                 |
| Node.js                  | 24 or newer                                                           | install Node.js 24 or newer (https://nodejs.org or your version manager)                                                                                |
| Vite+ (`vp`)             | installed for this user                                               | `curl -fsSL https://vite.plus \| bash`, then open a new shell                                                                                           |
| `make`, `g++`, `python3` | on `PATH`, to build native modules                                    | `sudo apt-get install build-essential python3`                                                                                                          |
| `curl` or `wget`         | on `PATH`                                                             | `sudo apt-get install curl`                                                                                                                             |
| `ps`                     | on `PATH`                                                             | `sudo apt-get install procps`                                                                                                                           |
| `mktemp`, `nohup`        | on `PATH`                                                             | `sudo apt-get install coreutils`                                                                                                                        |
| Home folder              | set and writable; the build keeps its package cache there             | run as a user with a writable home folder                                                                                                               |
| Install folder           | writable                                                              | set `PROBE_INSTALL_DIR` to a folder this user can write                                                                                                 |
| CPU                      | x86_64 or aarch64 (arm64)                                             | use a Linux machine or container on x86_64 or aarch64                                                                                                   |
| System                   | Linux                                                                 | use Linux (Debian or Ubuntu)                                                                                                                            |
| C library                | glibc; Alpine and other musl systems cannot load the terminal library | use a Debian- or Ubuntu-based image                                                                                                                     |
| Disk                     | 6 GB free where it installs                                           | free up space or set `PROBE_INSTALL_DIR` to a larger disk                                                                                               |
| Memory                   | 4 GB for the build                                                    | give the machine or container at least 4 GB of memory                                                                                                   |
| Package registry         | reachable                                                             | check the network and any proxy settings (`HTTPS_PROXY`)                                                                                                |
| Repository               | reachable, with the branch or tag to build                            | check the network or set up git credentials for this user; `PROBE_REPO` and `PROBE_REF` choose another                                                  |

Disk, memory and the registry are checked only when there is something to build.

A container also needs an init process, which the script cannot check: start it with
`docker run --init` (or `init: true` in Compose). Probe's shells run in a helper process that is
detached from the server; without an init, ended processes are never reaped.

### An example image

A Debian-family image with the toolchain only, Node.js from nodejs.org and Vite+ installed for a
non-root user `dev` (uid 1000):

```dockerfile
ARG BASE=ubuntu:24.04
FROM ${BASE}
ARG NODE_VERSION=26.12.1
ARG VP_VERSION=1.5.0

# openssh-client is only for cloning over SSH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git make g++ python3 procps xz-utils openssh-client \
  && rm -rf /var/lib/apt/lists/*

RUN case "$(dpkg --print-architecture)" in \
      amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "unsupported CPU" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --no-same-owner

# Ubuntu images ship a user "ubuntu" with uid 1000; Debian images have none.
RUN (userdel -r ubuntu 2>/dev/null || true) && useradd -m -s /bin/bash -u 1000 dev

USER dev
WORKDIR /home/dev
ENV PATH=/home/dev/.local/share/vite-plus/bin:/home/dev/.local/bin:$PATH
RUN curl -fsSL https://vite.plus -o /tmp/vp-install.sh \
  && VP_VERSION=${VP_VERSION} VP_NODE_MANAGER=no \
    VP_BIN_DIR=/home/dev/.local/share/vite-plus/bin \
    VP_DATA_DIR=/home/dev/.local/share/vite-plus \
    VP_CACHE_DIR=/home/dev/.cache/vite-plus \
    bash /tmp/vp-install.sh \
  && rm /tmp/vp-install.sh \
  && vp --version
```

```bash
docker build -t probe-target .
```

For Debian 12, build the same file with `--build-arg BASE=debian:12`. Add what your repositories
and agent CLIs need on top; the server needs nothing more.

## Get the script in and run it

Inside the target, as the non-root user:

```bash
curl -fsSL https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh | sh
```

or copy the file in and run `sh install-server.sh`. From a container's host, either works through
`docker exec -u`; a plain `docker exec` into an image whose user is root runs as root, which the
script refuses:

```bash
docker exec -u dev <container> sh -c 'curl -fsSL https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh | sh'
docker cp install-server.sh <container>:/tmp/install-server.sh
docker exec -u dev <container> sh /tmp/install-server.sh
```

It asks no questions.

| Variable            | Default                                  | Meaning                                                   |
| ------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `PROBE_REPO`        | the public Probe repository              | repository to build; a path to a local checkout works too |
| `PROBE_REF`         | `main`                                   | branch or tag to build                                    |
| `PROBE_INSTALL_DIR` | `${XDG_DATA_HOME:-~/.local/share}/probe` | install folder                                            |
| `PROBE_REGISTRY`    | `https://registry.npmjs.org/`            | package registry the check must reach                     |

Only committed state is built. The script prints one line per step (check, fetch, build, prove,
switch), then the version and commit, the install folder, the server commands, the path of its log
and how long it took. On a failure it prints the log path and exits non-zero; a failed or
interrupted run leaves the previous install in use.

The install folder holds one folder per commit under `versions/`, a `current` link to the one in
use, the `probe-server` command, and `logs/`. It does not hold the server's state; the server's
state folder is separate.

## Containers: what to mount

Probe works with whatever your container mounts and never asks which setup it is in. Three common
setups:

| Setup             | Mount from the host                                           | State folder                | Shared with the host                                                       |
| ----------------- | ------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| 1. Fully mounted  | your repositories, each at its host path, and a state folder  | the mounted folder          | the repositories and their worktrees, workspaces, the database, shell data |
| 2. Working folder | the one folder that holds your repositories, at its host path | `~/.probe` in the container | the repositories only                                                      |
| 3. Isolated       | nothing                                                       | `~/.probe` in the container | nothing                                                                    |

In every setup you install and log in your agent CLIs inside the container, and whatever your
repositories need to build. The Probe install itself always lives in the container.

**1. Fully mounted.** For example
`-v /Users/me/code:/Users/me/code -v /Users/me/probe-state:/probe-state`, then start with
`--base-dir /probe-state`. The state folder on the host holds what the server writes. Whether git
can push from the container, and whether a code-host CLI works there, depends on the credentials
your container setup passes in. Everything under
[Repositories the host can also see](#repositories-the-host-can-also-see) applies. On a Linux host
the container user's uid must own the mounted folders; Docker Desktop on macOS maps ownership for
you.

**2. Working folder only.** For example `-v /Users/me/code:/Users/me/code`. The state folder stays
in the container: it survives a container restart but not removing the container, and the host
does not see your workspaces or shell data. Credentials are as in setup 1, and the section on
repositories the host can also see applies.

**3. Isolated.** Nothing from the host is mounted. Clone inside the container with git over SSH or
a code-host CLI, with credentials you put in the container; everything stays in it, and the section
below does not apply.

Publish the server's port to the host in every setup, for example
`docker run -d --init -p 127.0.0.1:3773:3773 ...`, and start the server with `--host 0.0.0.0`
(see [Start, pair and stop the server](#start-pair-and-stop-the-server)). Publishing on the host's
`127.0.0.1` keeps the port off your network.

### Repositories the host can also see

When the container and the host both see a repository (setups 1 and 2):

- **Mount it at the same path.** A worktree's `.git` file, and the repository's record of each
  worktree, hold absolute paths. Mounted at another path, git on one side cannot find worktrees
  made on the other.
- **Lock worktrees the host cannot see.** A `git worktree prune` on the host, by you or by a tool,
  deletes the record of every worktree whose folder it cannot find, such as one that exists only in
  the container; git then no longer works in that worktree. Probe makes the worktrees it forks in
  the `worktrees` folder of the server's home, which is in the container unless you mount it, and
  it does not lock them. Lock each one yourself, in the container:
  `git worktree lock --reason "container only" <worktree folder>`, or create your own with
  `git worktree add --lock`. Unlock it with `git worktree unlock <worktree folder>` before you
  remove it.
- **Git hooks run on the host.** Hooks are files in the repository (`.git/hooks`, or the folder
  `core.hooksPath` names). A hook that an agent in the container writes or changes runs on the host
  the next time you run git there, as your host user.

### Sharing a state folder

Run one server per state folder. A second server started on a folder that a server already uses,
from another container that mounts it, is refused by the folder's ownership lock. A server on the
host started on a folder that a container's server uses has not been tested; do not do it.

The helper process that owns the shells listens on a socket in the state folder, and anything that
mounts the folder can connect to it and drive those shells. The folder also holds the server's
keys. Treat the state folder as you treat the shells themselves.

## Run it again and upgrade

Running it again for a commit that is already installed changes nothing and says so, and leaves a
running server alone. Running it after an interrupted run finishes the install. Two runs at once
are safe: the second waits for the first.

Running it when the branch or tag has moved installs the new commit beside the old one and makes it
current. The script never stops a server: one that is running keeps its version until you run
`stop`, then `start`, and the output says so. Shells keep running across that restart. If the new
build fails, the old version stays current. Old versions stay in `versions/` until you uninstall;
`status` lists them, marks the current one and the one that runs, and says when the running server
is not the current version.

Going back is not supported: a newer server may migrate the database in the state folder, and an older one started on it afterwards refuses to start, leaves the database unchanged and says to start the newer version.

## Start, pair and stop the server

The install script ends with these commands, with the install folder it used:

```text
<install folder>/probe-server start --port <port> --host <bind address> --base-dir <state folder>
<install folder>/probe-server status --base-dir <state folder>
<install folder>/probe-server pair --base-dir <state folder>
<install folder>/probe-server stop --base-dir <state folder>
```

For example, in a container whose port 3773 is published:

```bash
~/.local/share/probe/probe-server start --port 3773 --host 0.0.0.0 --base-dir ~/.probe
~/.local/share/probe/probe-server pair --base-dir ~/.probe
~/.local/share/probe/probe-server status --base-dir ~/.probe
~/.local/share/probe/probe-server stop --base-dir ~/.probe
```

Use the install folder the install script printed if you set `PROBE_INSTALL_DIR`. When you run
them from a container's host with `docker exec`, write the paths out in full (`/home/dev/...`):
your host's shell would turn `~` into your home on the host.

| Option       | Default                       | Meaning                                                  |
| ------------ | ----------------------------- | -------------------------------------------------------- |
| `--port`     | the first free port from 3773 | port to listen on; a port in use is refused, not changed |
| `--host`     | `127.0.0.1`                   | address to bind; `0.0.0.0` listens on every interface    |
| `--base-dir` | `~/.probe`                    | state folder: workspaces, database, shells and the log   |

Pass the same `--base-dir` to every command. Only `start` takes `--port` and `--host`.

- **start** runs the server in the background, so it keeps running after you log out or close the
  `docker exec` session. It waits up to 30 seconds for the server to answer, then prints the
  version, address, port, bind address, state folder and the server's log
  (`<state folder>/probe-server.log`). If a server already runs for that state folder, it is used
  and the output says so. If the server does not answer in time, start stops it, prints the log
  path and fails.
- **The bind address decides who can reach the server.** With the default `127.0.0.1` only the
  target itself can. A port that a container publishes arrives on the container's own network
  interface, not on its loopback, so a server bound to `127.0.0.1` there never answers it: start
  with `--host 0.0.0.0`, and connect through the address and port the host publishes (for example
  `http://127.0.0.1:<published port>` on that host). The server cannot know that address, so
  start, status and pair show `<address you reach this server at>` in its place. Status prints the
  bind address, which is the first thing to check when a published port does not answer.
- **On a remote machine over SSH**, keep the default `127.0.0.1` and forward the port from your
  computer with `ssh -N -L <port>:127.0.0.1:<port> <user>@<machine>`, then connect to
  `http://127.0.0.1:<port>`. Nothing is exposed on the machine's network.
- **pair** prints a one-time token and a pairing URL. Open the URL in a browser, with the address
  you reach the server at in place of the placeholder. The token is printed only by this command;
  the server does not write one to its log.
- **status** prints the version, the installed versions, whether the server runs, and its port,
  bind address, state folder and log. It exits 0 when the server runs and 3 when it does not.
- **stop** ends a server that `probe-server start` started. Shells keep running, and the next start
  reconnects to them. A server started some other way for the same state folder is left running.

A container restart ends the server and every shell. Run the same start command again: the server
comes back with its workspaces and database, and shells that were running are listed as ended, to
restore or remove.

## Uninstall

```bash
~/.local/share/probe/probe-server uninstall
```

It removes what the install script made: `versions/`, `build/`, `logs/`, the `current` link and
the `probe-server` command, then the install folder if nothing else is in it. It lists what it
removed and what it kept. State folders (workspaces, database, shell data) are kept, as are
Node.js, Vite+ and its package cache.

- While a server from this install runs, it refuses, names the stop command for each, and removes
  nothing. A shell host left running is not stopped; its shells keep running until they end.
- `--remove-data --base-dir <state folder>` also removes that state folder (default `~/.probe`).
  It refuses while a server or the shell host of that folder runs. If the folder is a mount point,
  for example a host folder mounted into a container, it says so, removes its contents and keeps
  the empty folder.
- With the install gone, run it from the published script:
  `curl -fsSL https://raw.githubusercontent.com/killroy192/probe/main/scripts/probe-server.sh | sh -s uninstall --remove-data --base-dir <state folder>`.
  It uses `PROBE_INSTALL_DIR` like the install script.
- When nothing is installed it says so and exits 0. When something cannot be removed it names it
  and the fix and exits non-zero.
