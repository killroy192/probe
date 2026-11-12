# Install Probe on a remote machine or devcontainer

`scripts/install-server.sh` builds the Probe server from source inside a Linux machine or container
and checks that it starts there. Run it inside the target, as the user who will run the server.
`<install folder>/probe-server` then starts, stops and reports that server, prints pairing
tokens for it, and uninstalls it.

## What the target needs

- Linux with glibc (Debian or Ubuntu) on x86_64 or aarch64. Alpine and other musl systems are not
  supported.
- A normal user with a writable home folder. The script refuses to run as root; in a container use
  `docker exec -u <user>`.
- `git`, Node.js 24 or newer, [Vite+](https://vite.plus) (`vp`) installed for that user, `make`,
  `g++`, `python3`, `curl` or `wget`, `ps`, `mktemp` and `nohup`.
- At least 6 GB of free disk where it installs and 4 GB of memory for the build.
- Network access to the repository and to the npm registry.

The script checks all of this first and lists every problem with its fix before it changes
anything.

## Run it

```bash
curl -fsSL https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh | sh
```

or copy the file in and run `sh install-server.sh`. It asks no questions.

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

Going back is not supported: a newer server may migrate the database in the state folder, and an
older one started on it afterwards runs without refusing, which is not safe.

## Start, pair and stop the server

```bash
~/.local/share/probe/probe-server start --port 3773 --host 0.0.0.0 --base-dir ~/.probe
~/.local/share/probe/probe-server pair --base-dir ~/.probe
~/.local/share/probe/probe-server status --base-dir ~/.probe
~/.local/share/probe/probe-server stop --base-dir ~/.probe
```

Use the install folder the install script printed if you set `PROBE_INSTALL_DIR`.

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
  target itself can. In a container whose port is published to its host, start with
  `--host 0.0.0.0`, and connect through the address and port the host publishes (for example
  `http://127.0.0.1:<published port>` on that host); the server cannot know that address, so
  start, status and pair show `<address you reach this server at>` in its place. Status prints
  the bind address, which is the first thing to check when a published port does not answer.
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
