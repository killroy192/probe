---
id: PRB.T-033
type: story
parent: PRB.E-004
phase: 2
labels: [remote, verify]
created: 2026-11-09
updated: 2026-11-12
---

# Verify three topologies and a remote machine

## Business Goal

**Problem:** The install script and the start, stop, status and pairing commands (PRB.T-030 to PRB.T-032) are built and tried one piece at a time, mostly in a plain shell. Nothing yet shows that a user starting from a clean container or machine reaches a server that a client can pair with, in each of the three container topologies, on a remote machine and on arm64. Until that is shown the epic's KPI is unmeasured, and PRB.E-003 has no proven server to close against.

**Proposed solution:** The author runs the five KPI runs from clean images and a clean machine, following only the script and the commands it prints, and records each transcript and result in the ticket. Defects the runs reveal are fixed in the script, the start commands or the printed output as part of this story, and the run is repeated; a larger change becomes a new ticket and the run is recorded as short with that ticket's ID. The story also records the elapsed times the script prints, checks that the three container setups behave identically, and starts Claude Code in a shell on an installed target.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 5 Verify the three topologies and a remote machine
- **Delivers:**
  - FR-10: a container and a remote machine are treated identically; the transcripts of topology 1, 2, 3 and the remote machine are compared for differences that depend on the kind of target.
  - FR-1, FR-2: confirmed from clean images, with the script obtained by copy and by the one-line `curl`, no root, nothing beyond the image contract installed by hand, on linux-x64 and (topology 3) linux-arm64, with no flag choosing the architecture.
  - FR-11, FR-12, FR-14: confirmed in the setups where they apply (state folder on the host in topology 1 and in the container in topology 2; a shell opens, takes input, resizes, ends and `probe kill` ends it; the server is reached through a published port).
  - NFR-1: cold install and start time, re-run time and disk use are read from the script's own output and recorded per run.
  - NFR-4: Ubuntu 24.04 on both architectures and Debian 12 on linux-x64; Claude Code started by hand in a shell on the target.
  - The epic KPI: the count of the five listed runs, out of 5, that end at a server answering a pairing request from outside the target.
- **One deployable outcome:** A user can follow the install script and its printed commands from a clean image of any of the three topologies, or from a remote Linux machine, and reach a server that pairs, with the evidence recorded; this is the proof that the epic's goal holds and what lets PRB.E-003 close.

## Current Behavior

Unverified: PRB.T-029 to PRB.T-032 are not built yet, so there is nothing to run. What the epic and the repository say today:

- No install script, start command or pairing command for a target exists. The only way onto a target today is to copy a source checkout and build it by hand, as `.devcontainer/` does (epic, Why and why now; unverified here, read from the epic).
- The SSH connection code in `packages/ssh/src/tunnel.ts` installs a server on a remote host from upstream T3 releases and runs only over SSH from the desktop app (epic Notes for stories; not read for this story).
- The scenario harness (`scripts/scenarios`) drives a headless browser against a server on a throwaway home; it is not known to drive Docker, and the dev container has no Docker socket (epic Verification). No part of this story is therefore automated by the existing harness.
- The connect flow of PRB.E-003 (PRB.T-023) does not exist yet. Until it does, the check from the host is a plain HTTP readiness request and a token exchange.
- No transcript of any of the five runs exists; the KPI baseline is 0 of 5 (epic KPI).

## Expected Behavior

For each of the five runs, a clean image or machine takes the user from "the target has the toolchain" to "the host's pairing request is answered", using only the script and the commands it prints. The author records, per run: the setup, the architecture, how the script was obtained, the transcript, the elapsed times and disk use the script prints, and whether the pairing request was answered. A run that fails is not counted; its cause is fixed (in the script, the start commands or their output, within this story) and the run is repeated from a clean image. The count at the end is the KPI number.

The five runs, each counted once: (1) topology 1 on linux-x64 with Ubuntu 24.04, (2) topology 2 on linux-x64 with Ubuntu 24.04, (3) topology 3 on linux-x64 with Debian 12, (4) one remote machine on linux-x64 running Ubuntu 24.04, (5) topology 3 on linux-arm64 with Ubuntu 24.04. This puts Ubuntu 24.04 on both architectures and Debian 12 on linux-x64.

### User Flow

1. The author prepares a clean target for run N from the image contract (the toolchain only) and, for a container, the mounts of its topology; a remote machine is reached over SSH.
2. The author gets the script onto the target by a file copy in some runs and by the one-line `curl` in others (while the repository is private, by copy only; see SU-1), and runs it as a non-root user (`docker exec -u` in a container).
3. The author reads the final output, then runs the printed start command with an explicit port, bind address and state folder, and the printed pairing-token command.
4. From the host (for the remote machine, from a different machine than the remote) the author makes the pairing request through the published or forwarded port: through the PRB.E-003 connect flow if it exists, otherwise a plain HTTP readiness request and token exchange.
5. The author opens a shell through the server, types, resizes, ends it, and runs `probe kill` in another.
6. In run 2 (topology 2, linux-x64, Ubuntu 24.04), the author starts Claude Code in a shell on the target and uses it briefly (cheapest model, per `AGENTS.md`).
7. The author records the result and transcript in the ticket, then compares the transcripts of runs 1 to 4 for differences that depend on the kind of target.

### Edge Cases

- EC-1: The script is fetched with the one-line `curl` in one run and copied in another; both must reach the same output.
- EC-2: In topology 1 the state folder is on the host: the host folder holds what the server wrote, and a restart of the server keeps a shell running with its socket and database intact on the mounted folder.
- EC-3: In topology 2 the state folder is in the container; in topology 3 nothing is mounted and a repo is cloned inside with git over SSH.
- EC-4: A server bound to loopback is not reached through a published port; one started with the printed bind address and port is.
- EC-5: A run fails at some step: the cause is recorded, fixed, and the run repeated from a clean image; the failed attempt stays in the ticket.
- EC-6: The remote machine has no container: the script, the output and the connection are the same as in the container runs.
- EC-7: The arm64 run builds for the target it runs on without being told.

### Error Handling

- ER-1: A run cannot reach the repository or the package registry from the target: this is recorded as a finding (the contract check should have named it), not as a pass.
- ER-2: A run ends with the server not answering the pairing request: the run does not count toward the KPI and the cause is fixed or the KPI result is recorded as short of 5 with the reason.
- ER-3: A difference between runs that depends on the kind of target (FR-10) is a defect in the script or its output and is fixed here, or recorded as a finding with an owner if it cannot be.

## Out Of Scope

- Writing the user guide and image contract text: PRB.T-034 (this story only supplies what was seen).
- Building the script and the start, stop, status, pairing, upgrade and uninstall features: PRB.T-030 to PRB.T-032. This story fixes defects those reveal; it adds no new feature.
- Upgrade, re-run and uninstall checks beyond what a run happens to show: PRB.T-032 owns them.
- Scripted Docker runs in CI: no Docker in the dev container and no CI for this; TBD (author, 2026-11-15) whether worth adding later.
- Second-server UI behaviour of the earlier phases (starting scripts, settings, workspaces on a remote): PRB.T-028.
- Installing or logging in agent CLIs, container safety, credentials and egress: the user's container setup.
- Alpine and other distributions, macOS, Windows: out of the epic.
- Worktree locking: guide text only (PRB.T-034).

## Technical Scope

- **Layers:** the install script and the start, stop, status and pairing commands (fixes only), manual runs on the author's host(s) and an arm64 machine, and the ticket record. No contract, wire or UI change planned.
- **Docs impact:** none planned here beyond corrections to existing text the runs show to be wrong; the guide is PRB.T-034 (epic NFR-7: each story updates docs in its PR where behaviour changes, so a fix that changes printed output also updates the text that quotes it).
- **Mobile impact:** none; no contract change.

## Non-functional Requirements and Constraints

- NFR-1 (epic): each run records the script's elapsed times and the disk use after install. The cold limit and the disk limit are TBD (author, 2026-11-15) from PRB.T-029; this story records now and compares once the limits exist. Re-run of the same version at most 5 s.
- NFR-3 (epic): no run uses root or edits agents' own configuration; this is checked by reading the transcript.
- NFR-4 (epic): Debian-family glibc images only; Ubuntu 24.04 on both architectures and Debian 12 on linux-x64.
- The runs are manual, on the author's machine, from a clean image or machine each time; the real Claude Code is run only for the one manual check, on its cheapest model.
- The pairing token is never pasted into the ticket or a transcript that is committed.
- No part of the verification depends on the PRB.E-003 connect flow existing; if it exists, it is used.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a clean image with the toolchain and the topology 1 mounts (workspace folders and state folder), when the author follows the script and its printed commands as a non-root user, then the server answers a pairing request from the host through a published port, and the host state folder holds what the server wrote | manual (author) | FR-1, FR-11, FR-14, EC-2, EC-4 |
| AC-2 | Given a clean image with only the working folder mounted (topology 2), when the author runs the same script, then the same output and connection result, with the state folder in the container | manual (author) | FR-10, FR-11, EC-3 |
| AC-3 | Given a clean image with nothing mounted (topology 3), when the author runs the same script and clones a repo with git over SSH, then the same output and connection result, and everything stays in the volume | manual (author) | FR-10, EC-3 |
| AC-4 | Given a remote Linux machine reached over SSH with the toolchain, when the author runs the script there, then the same output and connection result as AC-1 to AC-3 with no container involved | manual (author) | FR-10, EC-6 |
| AC-5 | Given an arm64 target for topology 3, when the author runs the script with no architecture flag, then it builds for arm64 and the pairing request is answered | manual (author) | FR-2, EC-7 |
| AC-6 | Given the script obtained in one run by copy and in another by the one-line `curl`, when both run, then both reach the same output; while the repository is private the `curl` comparison is recorded as "not run" with that reason | manual (author) | FR-1, EC-1 |
| AC-7 | Given a server in each run, when the author opens a shell, types, resizes, ends it, and runs `probe kill` in another shell, then each behaves and ends cleanly | manual (author) | FR-12 |
| AC-8 | Given the server in topology 1 running a shell, when it is restarted, then the shell keeps running and the socket and database work on the mounted folder | manual (author) | FR-11, FR-12, EC-2 |
| AC-9 | Given a server started bound to loopback and one started with the printed bind and port, when reached through a published port, then only the second answers | manual (author) | FR-14, EC-4 |
| AC-10 | Given the transcripts of runs 1 to 4, when compared, then no output or step differs because of the kind of target; any difference is fixed or recorded with an owner | manual (author) | FR-10, ER-3 |
| AC-11 | Given each run, when its script output is read, then the elapsed times and disk use are recorded in the ticket now; they are compared against the limits once PRB.T-029 sets them | manual (author) | NFR-1 |
| AC-12 | Given runs 1, 2, 4 and 5 on Ubuntu 24.04 (x64, x64, x64, arm64) and run 3 on Debian 12 (x64), when the runs are done, then each passes on its assigned image | manual (author) | NFR-4 |
| AC-13 | Given the installed target of run 2 (topology 2, linux-x64, Ubuntu 24.04), when the author starts Claude Code in a shell on it, then its TUI takes input, resizes and exits back to the prompt | manual (author) | NFR-4 |
| AC-14 | Given a run that fails, when its cause is fixed and the run is repeated from a clean image, then the failed attempt and the passing one are both in the ticket | manual (author) | EC-5, ER-1, ER-2 |
| AC-15 | Given all runs, when the ticket is read, then it lists the five runs each with transcript and whether the pairing request was answered, and the count out of 5 matches the KPI; no token appears in it | manual (author) | KPI, NFR-3 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-032 | The full script, start, stop, status, pairing, upgrade and uninstall must exist (epic order: after 4) | backlog |
| PRB.T-031 | The printed start and token commands are what each run follows | backlog |
| PRB.T-030 | The script itself | backlog |
| PRB.T-029 | By-hand findings, build time and the limits NFR-1 is checked against | backlog |
| PRB.T-023 | Optional: the connect flow is used for the pairing check if it exists, otherwise a plain HTTP check; not required to start | backlog |

Blocks:

| Blocks | Why | Status |
| ------ | --- | ------ |
| PRB.T-034 | The guide is written from what was seen here (epic order: after 5) | backlog |
| Closing PRB.E-003 | The epic says PRB.E-003 closes after this story, with a proven server to connect to | backlog |
| Closing PRB.E-004 | Its KPI and Done when are measured here | backlog |

No dependency on PRB.T-016 to PRB.T-020 (single-server E-002 behaviour) and none on PRB.T-028; this story does not replay earlier-phase features.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The author has an arm64 machine or arm64 container host and a remote Linux machine to use for runs 4 and 5 | assumption | unverified | Ask before the plan; TBD (author, 2026-11-15) | author |
| SA-2 | The pairing check from the host works through a published port (epic A-6, A-7) | assumption | unverified | PRB.T-029 and PRB.T-031 | author |
| SA-3 | A mounted state folder works for the socket and database on the host(s) tested (epic A-8, A-9) | assumption | unverified | PRB.T-029, then topology 1 run | author |
| SU-1 | Whether the one-line `curl` run is possible, which depends on the repository being reachable without credentials (epic U-6; open visibility decision in `docs/dev/questions.md`) | unknown | unverified | Settled before this story; otherwise copy only and AC-6 is recorded as not run | user |
| SU-2 | Which hosts the author tests topology 1 on (Docker Desktop on macOS, Linux, or both; epic A-8) | unknown | unverified | TBD (author, 2026-11-15) | author |
| SU-3 | Whether a failed run's fix may touch the SSH connection code (it should not; the epic leaves it unchanged) | unknown | unverified | Settled in the PRB.T-030 plan (epic R-7) | author |

## Run instructions

Prepared 2026-11-12 for the author's Mac (Apple silicon, Docker Desktop). Every command runs on the
Mac unless it says otherwise. Run 1 follows only the user guide (`docs/user/remote-install.md`):
that is PRB.T-034 AC-7, so note any guide step that did not work as written. Paste back what each
step marks **paste**, into [Run results](#run-results). Never paste the output of `pair`; the
helpers below keep the token off the screen.

Suggested order: 5 (native arm64, the quickest shakedown), 1, 2, 3, 4, then the extras.

### 0. Before the first run

1. **Push `main` to GitHub.** On 2026-11-12 `raw.githubusercontent.com/.../main/scripts/install-server.sh`
   answers 404: GitHub `main` (`0698905`) is behind the local `main` that has the scripts. Every
   `curl` step needs them there.
2. **Tag an older commit for the upgrade extra** (needs a branch or tag, not a commit):
   `git tag t033-base c6534570b && git push origin t033-base` (the PRB.T-032 commit; it has the
   scripts). Delete the tag after the runs if you like.
3. **Docker Desktop:** Settings > Resources > Memory at least 8 GB (the build peaks near 3.7 GiB).
   Settings > General > "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" on.
4. **x64 on this Mac.** Runs 1 to 3 are linux-x64 and run under Rosetta with `--platform
   linux/amd64`. The arm64 install took 53 to 99 s natively (PRB.T-030 to PRB.T-032); expect a few
   times that emulated. Rosetta runs Node and the native modules; QEMU (Rosetta off) is far slower
   and not worth trying. Times from emulated runs are recorded as "emulated" and do not count for
   the 5-minute guardrail; run 4 (a real 2-vCPU x64 machine) is the guardrail measurement. If an
   emulated build fails or takes over about 15 minutes, do runs 1 to 3 on an x64 cloud VM with
   Docker instead: the same commands without `--platform`, reached through
   `ssh -N -L 388N:127.0.0.1:388N <user>@<vm>` for the check and the browser, and with the host
   folders owned by uid 1000 (`sudo chown -R 1000:1000 "$RUNS/r1"`), which also answers epic A-8 for
   a Linux host.
5. **Shell setup** (zsh, in a Probe checkout at the pushed `main`):

   ```sh
   export PROBE_SRC=$PWD                       # this checkout
   export RUNS=$HOME/probe-runs && mkdir -p "$RUNS"
   awk '/^```dockerfile$/{f=1;next} /^```$/{f=0} f' docs/user/remote-install.md > "$RUNS/Dockerfile"
   INSTALL_URL=https://raw.githubusercontent.com/killroy192/probe/main/scripts/install-server.sh
   P=/home/dev/.local/share/probe/probe-server
   # <container> <state folder> <port>: a fresh token, exchanged by the check script, never shown.
   pair_check() { docker exec -u dev "$1" "$P" pair --base-dir "$2" | sed -n 's/^Token: *//p' | sh "$PROBE_SRC/scripts/remote-check.sh" "http://127.0.0.1:$3"; }
   # <container> <state folder> <port>: opens the browser on a fresh pairing URL.
   pair_open() { open "$(docker exec -u dev "$1" "$P" pair --base-dir "$2" | sed -n "s|^Pairing URL: *http://<address you reach this server at>:|http://127.0.0.1:|p")"; }
   ```

   A token is single use and lives 5 minutes, so the check and the browser each get their own.

6. **Images** (the guide's Dockerfile, unchanged):

   ```sh
   docker build --platform linux/amd64 -t probe-target:ubuntu-amd64 "$RUNS"
   docker build --platform linux/amd64 --build-arg BASE=debian:12 -t probe-target:debian12-amd64 "$RUNS"
   docker build --platform linux/arm64 -t probe-target:ubuntu-arm64 "$RUNS"
   for i in ubuntu-amd64 debian12-amd64 ubuntu-arm64; do docker run --rm probe-target:$i sh -c 'echo "$(uname -m) node $(node -v) vp $(vp --version | head -1) $(git --version)"'; done
   ```

   **Paste:** the last command's three lines, and whether each build passed (and its time).

### Browser shell checks (B1 to B5)

Used by every run. In the browser tab `pair_open` opened: **Create workspace** (name it after the
run), **Add project** > **Import existing folder** (or **Create new folder**) with the run's
project folder, then **+** on the project row > **Create shell** (Plain shell, Existing, primary).

- B1: shell A opens at a prompt.
- B2: `echo hello; echo $$; stty size` prints; note the pid.
- B3: resize the browser window; `stty size` prints a different size.
- B4: open shell B the same way; type `probe kill` in it: B ends and leaves the tree.
- B5: in shell A type `exit` (unless the run keeps it for a later step): A ends cleanly.

**Paste:** yes/no for B1 to B5, with a word on anything odd.

### Run 1: topology 1, linux-x64, Ubuntu 24.04, script by `curl`

Covers AC-1, AC-6 (curl half), AC-7, AC-8, AC-11, AC-12; PRB.T-030 AC-2, AC-13, AC-15; PRB.T-031
AC-10 (mounted); PRB.T-032 AC-15, AC-16; PRB.T-034 AC-7.

```sh
mkdir -p "$RUNS/r1/code" "$RUNS/r1/state"
git init -q -b main "$RUNS/r1/code/demo" && git -C "$RUNS/r1/code/demo" commit -q --allow-empty -m init
docker run -d --init --platform linux/amd64 --name probe-r1 -p 127.0.0.1:3881:3881 \
  -v "$RUNS/r1/code:$RUNS/r1/code" -v "$RUNS/r1/state:/probe-state" \
  probe-target:ubuntu-amd64 sleep infinity
docker exec -u dev probe-r1 sh -c "curl -fsSL $INSTALL_URL | sh"                       # paste (whole output)
docker exec -u dev probe-r1 sh -c "curl -fsSL $INSTALL_URL | sh" | tail -1             # paste (re-run "Took")
docker exec -u dev probe-r1 sh -c 'du -sh ~/.local/share/probe ~; df -h ~ | tail -1'   # paste
docker exec -u dev probe-r1 "$P" start --port 3881 --host 0.0.0.0 --base-dir /probe-state   # paste
pair_check probe-r1 /probe-state 3881                                                 # paste
ls "$RUNS/r1/state" "$RUNS/r1/state/userdata"                                          # paste (host holds the server's files)
pair_open probe-r1 /probe-state 3881
```

Browser: B1 to B4 with project folder `$RUNS/r1/code/demo` (type the full Mac path, for example
`/Users/<you>/probe-runs/r1/code/demo`; it is the same path in the container). Keep shell A open.

Server restart keeps the shell (AC-8):

```sh
docker exec -u dev probe-r1 "$P" stop --base-dir /probe-state                            # paste
docker exec -u dev probe-r1 "$P" start --port 3881 --host 0.0.0.0 --base-dir /probe-state
```

Reload the browser. **Paste:** yes/no: shell A is still there with its output, and `echo $$` in
it prints the same pid and takes input.

Same path and the worktree lock (guide, PRB.T-034 AC-7):

1. In shell A: `git worktree add ../demo-same -b same`. On the Mac:
   `git -C "$RUNS/r1/code/demo-same" status`. **Paste:** its first line (git works on the host in
   a worktree the container made, because the path is the same).
2. In the browser: **+** on the project > **Fork** from `main`. A shell opens in
   `/home/dev/worktrees/demo/probe-worktree-…`, which the Mac cannot see. On the Mac:
   `git -C "$RUNS/r1/code/demo" worktree prune --dry-run -v`. **Paste:** its output (a prune
   would drop that worktree).
3. In the forked shell: `git worktree lock --reason "container only" "$PWD"`. On the Mac, the same
   dry run again. **Paste:** its output (expected: nothing about the locked worktree).

If git in the container says "dubious ownership", run
`git config --global --add safe.directory '*'` in the shell and note it: that is container setup,
not Probe.

Cleanup, with removal of a mounted state folder (PRB.T-032 AC-16): end every shell (hover > **×**),
then:

```sh
docker exec -u dev probe-r1 "$P" stop --base-dir /probe-state
docker exec -u dev probe-r1 "$P" uninstall --remove-data --base-dir /probe-state       # paste
ls -A "$RUNS/r1/state"                                                                 # paste (expected: empty)
docker rm -f probe-r1
```

If uninstall refuses because the shell host still runs, paste that too, wait for the last shell to
end and run it again.

### Run 2: topology 2, linux-x64, Ubuntu 24.04, script copied in; Claude Code

Covers AC-2, AC-6 (copy half), AC-7, AC-11, AC-12, AC-13; PRB.T-030 AC-13; PRB.T-031 AC-10 (state in
the container); PRB.T-032 AC-8, AC-11 (uninstall twice); epic sign-off (Claude Code).

```sh
mkdir -p "$RUNS/r2/code"
git init -q -b main "$RUNS/r2/code/demo" && git -C "$RUNS/r2/code/demo" commit -q --allow-empty -m init
docker run -d --init --platform linux/amd64 --name probe-r2 -p 127.0.0.1:3882:3882 \
  -v "$RUNS/r2/code:$RUNS/r2/code" probe-target:ubuntu-amd64 sleep infinity
docker cp "$PROBE_SRC/scripts/install-server.sh" probe-r2:/tmp/install-server.sh
docker exec -u dev probe-r2 sh /tmp/install-server.sh                                  # paste
docker exec -u dev probe-r2 sh /tmp/install-server.sh | tail -1                        # paste
docker exec -u dev probe-r2 sh -c 'du -sh ~/.local/share/probe ~; df -h ~ | tail -1'   # paste
docker exec -u dev probe-r2 "$P" start --port 3882 --host 0.0.0.0 --base-dir /home/dev/.probe   # paste
pair_check probe-r2 /home/dev/.probe 3882                                             # paste
docker exec -u dev probe-r2 bash -c 'curl -fsSL https://claude.ai/install.sh | bash'  # Claude Code for user dev
pair_open probe-r2 /home/dev/.probe 3882
```

Browser: B1 to B5 with project folder `$RUNS/r2/code/demo`. Then Claude Code (AC-13), in a new
shell: `claude --model haiku`, log in, send one short prompt, resize the window while it shows,
then `/exit`. **Paste:** yes/no: C1 the TUI started, C2 took input, C3 redrew on resize, C4 exited
back to the shell prompt; and anything that differs from Claude Code in a local Probe shell.

Cleanup: end the shells, then

```sh
docker exec -u dev probe-r2 "$P" stop --base-dir /home/dev/.probe
docker exec -u dev probe-r2 "$P" uninstall                                              # paste
docker exec -u dev probe-r2 sh -c 'curl -fsSL https://raw.githubusercontent.com/killroy192/probe/main/scripts/probe-server.sh | sh -s uninstall'   # paste (nothing installed)
docker rm -f probe-r2
```

### Run 3: topology 3, linux-x64, Debian 12, script by `curl`; clone over SSH

Covers AC-3, AC-7, AC-11, AC-12 (Debian); PRB.T-030 AC-14 (writes only where expected).

```sh
docker run -d --init --platform linux/amd64 --name probe-r3 -p 127.0.0.1:3883:3883 \
  probe-target:debian12-amd64 sleep infinity
docker exec -u dev probe-r3 touch /tmp/probe-marker
docker exec -u dev probe-r3 sh -c "curl -fsSL $INSTALL_URL | sh"                       # paste
docker exec -u dev probe-r3 sh -c "curl -fsSL $INSTALL_URL | sh" | tail -1             # paste
docker exec -u dev probe-r3 sh -c 'du -sh ~/.local/share/probe ~; df -h ~ | tail -1'   # paste
docker exec -u dev probe-r3 "$P" start --port 3883 --host 0.0.0.0 --base-dir /home/dev/.probe   # paste
pair_check probe-r3 /home/dev/.probe 3883                                             # paste
docker exec -u dev probe-r3 sh -c 'find ~ -newer /tmp/probe-marker -type f | sed "s|^$HOME/||" | cut -d/ -f1-3 | sort -u'   # paste (expected: the install, the package cache, .probe; nothing under .claude)
```

Clone over SSH (credentials are yours to put in the container): make a key and add the public half
to GitHub (Settings > SSH and GPG keys > New SSH key, title `probe-r3`), then clone.

```sh
docker exec -u dev probe-r3 sh -c 'mkdir -p -m 700 ~/.ssh && ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub'
docker exec -u dev probe-r3 sh -c 'ssh -o StrictHostKeyChecking=accept-new -T git@github.com; git clone --depth 1 git@github.com:killroy192/probe.git ~/probe-src'   # paste the last line
pair_open probe-r3 /home/dev/.probe 3883
```

Browser: B1 to B5 with project folder `/home/dev/probe-src`. Remove the GitHub key afterwards.

Cleanup: end the shells, `stop`, `uninstall` as in run 2 (paste the uninstall), `docker rm -f probe-r3`.

### Run 4: a remote Linux machine, linux-x64, Ubuntu 24.04, script copied in

Covers AC-4, AC-11 (the NFR-1 guardrail on a 2-CPU machine), AC-12. Pick a machine with 2 vCPU,
4 to 8 GB of memory and 10 GB free; a "4 GB" VM may report a little under the 4 GB floor, and if the
check refuses it, paste that and use 8 GB. Replace `<user>@<machine>` throughout.

Toolchain only, in an SSH session as a sudo-capable user (the image contract):

```sh
sudo apt-get update && sudo apt-get install -y --no-install-recommends ca-certificates curl git make g++ python3 procps xz-utils
curl -fsSL https://nodejs.org/dist/v26.12.1/node-v26.12.1-linux-x64.tar.xz | sudo tar -xJ -C /usr/local --strip-components=1 --no-same-owner
curl -fsSL https://vite.plus -o /tmp/vp-install.sh && VP_VERSION=1.5.0 VP_NODE_MANAGER=no bash /tmp/vp-install.sh && rm /tmp/vp-install.sh
exec "$SHELL" -l
echo "$(uname -m) $(nproc) CPUs node $(node -v) vp $(vp --version | head -1)"; free -m | sed -n 2p   # paste
```

On the Mac: `scp "$PROBE_SRC/scripts/install-server.sh" <user>@<machine>:install-server.sh`. Then
in the SSH session, as the normal (non-root) user:

```sh
sh install-server.sh                                                     # paste
sh install-server.sh | tail -1                                           # paste
du -sh ~/.local/share/probe ~; df -h ~ | tail -1                         # paste
~/.local/share/probe/probe-server start --port 3884 --host 127.0.0.1 --base-dir ~/.probe   # paste
```

On the Mac, in a second terminal: `ssh -N -L 3884:127.0.0.1:3884 <user>@<machine>`. Then:

```sh
ssh <user>@<machine> '~/.local/share/probe/probe-server pair --base-dir ~/.probe' | sed -n 's/^Token: *//p' | sh "$PROBE_SRC/scripts/remote-check.sh" http://127.0.0.1:3884   # paste
open "$(ssh <user>@<machine> '~/.local/share/probe/probe-server pair --base-dir ~/.probe' | sed -n 's/^Pairing URL: *//p')"
```

Browser: B1 to B5, with **Create new folder** `~/demo`. Cleanup in the SSH session: end the shells,
`~/.local/share/probe/probe-server stop --base-dir ~/.probe`, then
`~/.local/share/probe/probe-server uninstall --remove-data --base-dir ~/.probe` (paste); delete the
machine if it was a throwaway.

### Run 5: topology 3, linux-arm64, Ubuntu 24.04, script by `curl`; bind, restart and refusals

Covers AC-5, AC-9, AC-11, AC-12; PRB.T-030 AC-2 (arm64), AC-3 (root, real), AC-6, AC-19; PRB.T-031
AC-2, AC-18.

```sh
docker run -d --init --platform linux/arm64 --name probe-r5 \
  -p 127.0.0.1:3885:3885 -p 127.0.0.1:3886:3886 probe-target:ubuntu-arm64 sleep infinity
docker exec -u root probe-r5 sh -c "curl -fsSL $INSTALL_URL | sh"                      # paste (refused as root, nothing installed)
docker exec -u dev probe-r5 sh -c "curl -fsSL $INSTALL_URL | sh"                       # paste
docker exec -u dev probe-r5 sh -c "curl -fsSL $INSTALL_URL | sh" | tail -1             # paste
docker exec -u dev probe-r5 sh -c 'du -sh ~/.local/share/probe ~; df -h ~ | tail -1'   # paste
docker exec -u dev probe-r5 "$P" start --port 3885 --host 0.0.0.0 --base-dir /home/dev/.probe   # paste
pair_check probe-r5 /home/dev/.probe 3885                                             # paste (expected PASS)
```

Loopback against the printed bind (AC-9, PRB.T-031 AC-2): a second server, bound to loopback, on its
own state folder and the second published port.

```sh
docker exec -u dev probe-r5 "$P" start --port 3886 --host 127.0.0.1 --base-dir /home/dev/.probe-loopback
pair_check probe-r5 /home/dev/.probe-loopback 3886                                    # paste (expected FAIL, readiness 000)
docker exec -u dev probe-r5 "$P" status --base-dir /home/dev/.probe-loopback | grep Bind   # paste
docker exec -u dev probe-r5 "$P" stop --base-dir /home/dev/.probe-loopback
```

Browser: `pair_open probe-r5 /home/dev/.probe 3885`, B1 to B4 with **Create new folder** `~/demo`;
keep shell A. Container restart (PRB.T-031 AC-18):

```sh
docker restart probe-r5
docker exec -u dev probe-r5 "$P" status --base-dir /home/dev/.probe                    # paste (Running: no)
docker exec -u dev probe-r5 "$P" start --port 3885 --host 0.0.0.0 --base-dir /home/dev/.probe
```

Reload the browser. **Paste:** yes/no: the workspace is back, shell A is marked ended, and
**Restore** opens a working shell in the same folder.

Unsuitable targets (E4-S5; PRB.T-030 AC-6, AC-19), from a bare image and with no network:

```sh
docker run --rm -i --platform linux/arm64 -u 1000 ubuntu:24.04 sh -s < "$PROBE_SRC/scripts/install-server.sh"           # paste (lists git, node, vp, make, g++, python3, curl or wget, ps)
docker run --rm -i --platform linux/arm64 --network none probe-target:ubuntu-arm64 sh -s < "$PROBE_SRC/scripts/install-server.sh"   # paste (repository and registry unreachable)
```

Cleanup: end the shells, `stop`, `uninstall --remove-data --base-dir /home/dev/.probe`, `docker rm -f probe-r5`.

### Extra U: upgrade with a running shell (PRB.T-032 AC-5)

Not a KPI run. Native arm64, older tag first, then `main`.

```sh
docker run -d --init --platform linux/arm64 --name probe-up -p 127.0.0.1:3887:3887 probe-target:ubuntu-arm64 sleep infinity
docker exec -u dev probe-up sh -c "curl -fsSL $INSTALL_URL | PROBE_REF=t033-base sh" | tail -1
docker exec -u dev probe-up "$P" start --port 3887 --host 0.0.0.0 --base-dir /home/dev/.probe
pair_open probe-up /home/dev/.probe 3887
```

Browser: open shell A (**Create new folder** `~/demo`), `echo $$`. Then:

```sh
docker exec -u dev probe-up sh -c "curl -fsSL $INSTALL_URL | sh"                       # paste (the Restart line)
docker exec -u dev probe-up "$P" status --base-dir /home/dev/.probe                    # paste (running and current differ)
docker exec -u dev probe-up "$P" stop --base-dir /home/dev/.probe
docker exec -u dev probe-up "$P" start --port 3887 --host 0.0.0.0 --base-dir /home/dev/.probe   # paste
```

Reload. **Paste:** yes/no: shell A is still there, `echo $$` prints the same pid and it takes input.
Cleanup as in run 5, then `docker rmi` the three images if you want the disk back.

### Not run here, with the reason

- Host-server variant of a shared state folder (epic A-9): the guide says it is untested and not to
  do it; trying it risks the run's data and adds nothing the guide relies on.
- PRB.T-030 AC-11 and PRB.T-031 AC-12 (secret storage): not applicable; Probe keeps its secrets in
  files and needs no keyring (PRB.T-029). Every container run has no secret service and is the
  evidence that the install and start do not need one.
- PRB.T-032 AC-12 (older build on a newer database): recorded by reading in PRB.T-032; the guide
  says going back is unsupported. No run.

## Run results

Fill one row per attempt; a failed attempt stays (AC-14). "Emulated" marks Rosetta times. No token
anywhere in this ticket.

| Run | Setup | Arch, image | Script by | Attempt | Install took | Re-run took | Install folder / home (du) | Check (codes, PASS/FAIL) | B1-B5 | Extras | Counts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | topology 1 | x64 (emulated), Ubuntu 24.04 | curl | 1 | | | | | | AC-8: ; same path: ; lock: ; AC-16: | |
| 2 | topology 2 | x64 (emulated), Ubuntu 24.04 | copy | 1 | | | | | | C1-C4: ; uninstall twice: | |
| 3 | topology 3 | x64 (emulated), Debian 12 | curl | 1 | | | | | | home diff: ; SSH clone: | |
| 4 | remote machine | x64, Ubuntu 24.04, 2 vCPU | copy | 1 | | | | | | | |
| 5 | topology 3 | arm64, Ubuntu 24.04 | curl | 1 | | | | | | root: ; AC-9: ; restart: ; bare image: ; no network: | |
| U | upgrade | arm64, Ubuntu 24.04 | curl | 1 | | | | | | restart line: ; status: ; shell kept: | n/a |

KPI: _ of 5. Images built: (paste). AC-10 comparison of runs 1 to 4: (filled after the pastes).
Guide steps that did not work as written (PRB.T-034 AC-7): (none yet).

Per-run pastes go below, one `### Run N, attempt M` heading each, in plain code blocks.
