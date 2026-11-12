# Install Probe on a remote machine or devcontainer

`scripts/install-server.sh` builds the Probe server from source inside a Linux machine or container
and checks that it starts there. Run it inside the target, as the user who will run the server.

The commands that start and stop the installed server and pair a browser with it are not available
yet. The script prints them as placeholders.

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
switch), then the version and commit, the install folder, the placeholder commands, the path of its
log and how long it took. On a failure it prints the log path and exits non-zero; a failed or
interrupted run leaves the previous install in use.

The install folder holds one folder per commit under `versions/`, a `current` link to the one in
use, and `logs/`. It does not hold the server's state; the server's state folder is separate.

## Run it again

Running it again for a commit that is already installed changes nothing and says so. Running it
after an interrupted run finishes the install. Two runs at once are safe: the second waits for the
first.
