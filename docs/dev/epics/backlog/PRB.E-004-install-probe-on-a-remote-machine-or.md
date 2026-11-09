---
id: PRB.E-004
type: epic
parent:
phase: 2
labels: [remote]
created: 2026-11-09
updated: 2026-11-09
---

# Install Probe on a remote machine or devcontainer

## Goal

A Probe user runs one installation script inside a Linux container or on a remote Linux machine they set up themselves, the target already having the toolchain to build Probe, and gets a Probe server there (with the shell persistence and the `probe` command inside shells that remote use needs) that Probe's connect flow (PRB.E-003) can reach.

## Why and why now

- Roadmap scope decisions 9 and 10 make the UI a client of a remote server that runs everything, and a devcontainer is just such a remote. PRB.E-003 builds the connect side; nothing yet puts a server on the other end. Today the only way is to copy a source checkout and build it by hand, as this repo's own `.devcontainer/` does.
- Settled (user, 2026-11-09): the server is built inside the target from the Probe repository, with the toolchain the target already has. This repo's devcontainer and its scripts are enough for now, because Probe will be developed inside such a container, so everything is installed there. A release package we publish is not on the critical path (story 7, deferred).
- Settled (user, 2026-11-09): a container is a remote server. The protocol and the install are identical for a devcontainer and a remote machine. The user sets up the container or machine and logs in the agent CLIs themselves.
- The repository already has the closest piece: the SSH connection code installs a server on a remote host, proves the binary runs, picks a port, starts the server and mints a pairing token. It downloads upstream T3 releases and only runs over SSH from the desktop app, so this epic reuses its logic rather than its package source.
- Phase 2 starts with a spike that runs the server in a container by hand (`research/devcontainer-attach.md`); that spike is also how Probe gets developed with Probe. Nothing after it is known to work until it is done.
- If skipped: PRB.E-003 has nothing to connect to except the author's hand-built setup, phase 2 cannot close, and phase 3 (agents in Probe shells) stays tied to a local machine.

## KPI

Proposed by the author, not yet agreed (no human interview was possible): the metric, target and dates below need the user's yes.

| Metric | Kind | Baseline | Target | Measured how and where | By when |
| --- | --- | --- | --- | --- | --- |
| Runs, out of 5, where a user goes from a target that has the build toolchain (the image contract) to a Probe server that answers a pairing request from outside the target, using only the install script and the commands it prints. The five runs, each counted once: (1) topology 1 on linux-x64, (2) topology 2 on linux-x64, (3) topology 3 on linux-x64, (4) one remote machine on linux-x64, (5) topology 3 on linux-arm64 | primary (proposed) | 0 of 5. Story 1 records by hand how far a container with this repo's toolchain gets today and what breaks | 5 of 5 | Story 5 runs each of the five from a clean image or machine on the author's machine and records the transcript in the ticket. "Answers a pairing request" is the readiness request and token exchange done from the host. Not run in CI (no Docker in the dev container, no CI) | when this epic closes; TBD (author, 2026-11-15) for a date |
| Time from running the script on a target with the toolchain and a warm network to a ready server, and time of a re-run of the same version | guardrail (proposed) | unknown, measured first in story 1 (by hand, built in the container from the repository) and story 2 (by script) | TBD (author, 2026-11-15) after story 1: a build is slow, so the cold limit is set from the by-hand time; re-run of the same version at most 5 s | The script prints the elapsed time; story 5 records it per run | every story from story 2 |

## Users and scenarios

Users: the author first, then a small team of peers who run agents in devcontainers or on a rented or home Linux machine. They know Docker or SSH, set up the container or machine themselves, and install and log in their agent CLIs themselves.

Vocabulary: the **target** is the container or remote machine; to Probe they are the same thing. The **install script** runs inside the target and builds Probe there from the Probe repository. The three **topologies** are ways a container can be configured; Probe supports what the configuration gives and does not choose between them. **State folder** is Probe's own folder for workspaces, shell data and the database (`.t3` today).

| Topology | Mounted from the host | Consequences the user sees |
| --- | --- | --- |
| 1. System fully mounted | The workspace folders and the state folder | A new repo is cloned into a mounted folder or cloned remotely. Whether git credentials or a code-host CLI are needed depends on the container configuration (A-10). Worktrees and workspaces are visible on the host |
| 2. Only the working folder mounted | The one folder that holds the repos | The state folder is not synced and worktrees are not synced. Whether git credentials or a code-host CLI are needed depends on the container configuration (A-10) |
| 3. Isolated volume | Nothing | The user needs git over SSH or a code-host CLI to clone and push |

In all three, the user also installs and logs in the agent CLIs and whatever each repo needs. Safety, isolation, egress and credentials belong to the container configuration, not to Probe (roadmap, 2026-11-08). The script reaches the target in one of two ways, equal for the product: a file the user copies in, or a one-line `curl` of the script itself from the repository.

1. **E4-S1, topology 1.** As a user with a container that mounts my workspace folders and Probe's state folder, I get the install script into a shell in the container (copied in, fetched with the one-line `curl`, or run with `docker exec -u <non-root user>`; plain `docker exec` runs as root and the script refuses), and it finishes with the version installed, the command that starts the server (with the port and bind address I choose) and the command that gives a pairing token. I run both. PRB.E-003's connect flow, or until it exists a plain HTTP check from the host, reaches the server with that token through a port I published. The state folder on the host holds what the server wrote. The guide I followed says that worktrees need locking against a host `git worktree prune`, that git hooks in a bind-mounted repo run on the host, and that a repo must be mounted at the same path as on the host. If the machine's secret storage is unavailable, the server still starts and tells me what is unavailable.
2. **E4-S2, topologies 2 and 3.** As a user whose container mounts only the working folder, and as a user whose container is an isolated volume, I run the identical script and get the identical output and connection. In topology 2 the state folder lives in the container; in topology 3 I clone a repo inside with git over SSH and everything stays in the volume. Nothing in the script asked which topology I am in, and the guide has a section for each topology saying what to mount and what is shared with the host.
3. **E4-S3, remote machine.** As a user with a rented or home Linux machine I reach over SSH, I run the same script there, with no container involved, and connect the same way.
4. **E4-S4, run again, upgrade, uninstall.** As a user, I run the script again and nothing changes and it says so. I run a newer script and the new version is installed beside the old, with a clear note that the server must be restarted to use it; shells that were running before keep running. I uninstall and the installed Probe is gone from the target, while my workspaces and data stay unless I explicitly ask to remove them too.
5. **E4-S5, an unsuitable target.** As a user on an image that lacks something (git, Node, the package manager, build tools, a download tool, root user, an unsupported CPU or libc, no network, no access to the repository, a read-only home), I run the script and it lists every problem it found, in plain words with the fix, and leaves nothing half-installed. The guide's image contract lists the same items, so I can fix the image before running.

## Scope

**In:**

- An installation script that builds and installs the Probe server and the Probe services remote use needs on a Linux target (container or machine) from the Probe repository, for linux-x64 and linux-arm64, as a non-root user (it refuses root). It is delivered as a file copied in or by a one-line `curl` of the script from the repository.
- A way to start and stop the installed server in the target, with an explicit port, bind address and state folder, and a printed way to get a pairing token, so PRB.E-003 can connect.
- Upgrade, re-run and uninstall of what the script installed.
- The image contract (what a target must have to build Probe) and a guide for each of the three container topologies, each verified by hand once.
- The manual spike first: the server built and run by hand in a container with this repo's toolchain, with what breaks recorded.
- The consequences the roadmap carries, as guide text only: worktrees in a repo that a host can also see need locking against a host `git worktree prune` (made by hand or by whatever creates them), git hooks in a bind-mounted repo run on the host, and a repo must be mounted at the same path as on the host. Implementing worktree locking is not in this epic (Q-3).

**Out (non-goals, with a reason):**

- A Linux release package (x64 and arm64, checksums, published releases): deferred to story 7. Build-in-target is settled (user, 2026-11-09); the existing SSH install path is left unchanged.
- Starting or managing containers, choosing or building images, and the Docker or devcontainer commands: a later helper epic (roadmap phase 2; user, 2026-11-08). The user sets the container up.
- Installing or logging in agent CLIs such as Claude Code, and repo-specific toolchains: the user's environment (user, 2026-11-08).
- The connect UI, pairing in the UI, saved remote servers and workspaces served by a remote: PRB.E-003.
- Container safety, egress policy, credentials, mounts and isolation: the devcontainer configuration's business (scope decision 9).
- Implementing worktree locking: guide text only here (Q-3).
- A supervisor that restarts the server when the container restarts: the user starts it again with the printed command; automatic start is a later epic. A service manager inside containers is not assumed.
- macOS and Windows targets: Linux only (Q-2, settled as proposed).
- Installing or updating the Probe UI on the user's machine, and desktop and mobile UI: browser first (scope decision 2). `mobile-impact`: none; nothing here crosses the wire contract.
- Chat removal: not touched.

## Functional requirements

| ID | Requirement | Priority | Scenario |
| --- | --- | --- | --- |
| FR-1 | One script, run inside the target by the user (copied in, or fetched with a one-line `curl` of the script from the repository), builds and installs the Probe server and the Probe services remote use needs (shell persistence and the `probe` command inside shells) for the current user, without root, using the toolchain the target already has | must | 1, 2, 3 |
| FR-2 | The script works on linux-x64 and linux-arm64 and builds for the target it runs on, without being told | must | 1, 2, 3 |
| FR-3 | Before changing anything the script checks the target against the image contract (shell, git, Node, the repo's package manager, build tools, a download tool, the process tools the launch logic needs, a writable home, a supported CPU and libc, not root, network reach to the repository and to the package registry, and a minimum Node and package-manager version (U-7)) and lists all failures at once, each with the fix; on any failure nothing is installed. It refuses to run as root and says to use a non-root user (with `docker exec -u` in a container) | must | 5 |
| FR-4 | The script proves the built server runs on this target before it marks the install as complete | must | 1, 5 |
| FR-5 | The script is idempotent: running it again for the same version changes nothing and says so; an interrupted run is repaired by running it again; two runs at once do not corrupt each other | must | 4 |
| FR-6 | The installed version is exact and visible: the script prints it and the server reports it. A newer script installs the new version beside the old one and tells the user the server must be restarted to use it; shells running before the restart keep running | must | 4 |
| FR-7 | An uninstall removes everything the script installed and tells the user what it kept. It does not delete the state folder (workspaces, shell data, the database) unless the user explicitly asks, and it says when a server is still running | must | 4 |
| FR-8 | At the end the script prints, copy-ready: the installed version and place, and the commands to start the server, stop it and get a pairing token for PRB.E-003, shown with defaults or placeholders for port, bind address and state folder (for example a start with a non-loopback bind for a published port); the actual port and address are printed when the server starts (FR-14) | must | 1, 2, 3 |
| FR-9 | The start command starts the server detached so it keeps running after the user's session ends, reuses a server that already runs, and stops with the stop command. After a container restart the user starts it again with the same command | must | 1, 2, 3, 4 |
| FR-10 | A container and a remote machine are treated identically: the same script, the same output, the same connection. Nothing in the script or its output depends on detecting a container | must | 2, 3 |
| FR-11 | The state folder can be placed where the user wants (for example a mounted folder or a container-local one) and the start command accepts it; the server runs against whichever it is given; the default is one place in the user's home, and the output says where | must | 1, 2 |
| FR-12 | A shell started by the installed server opens, takes input, resizes and ends cleanly, and `probe kill` run inside such a shell ends it | must | 1, 2, 3 |
| FR-13 | If a part that is not essential cannot work on the target (the machine's secret storage is the known case), the server still starts and says what is unavailable, rather than failing to install | should | 1, 5 |
| FR-14 | The start command accepts an explicit port and bind address (a published container port cannot reach a loopback-bound server), uses a free-port scan only as the default when no port is given, and prints the port and address it is using | must | 1, 2, 3 |
| FR-15 | Worktree locking is not implemented here. The guide says that worktrees in a repository the host can also see must be locked against a host `git worktree prune`, and how (Q-3) | should | 1, 2 |
| FR-16 | A guide states the image contract (including the build toolchain) and, for each of the three topologies, what to mount, what the user must set up, what is and is not shared with the host, that git hooks in a bind-mounted repo run on the host, and that a repo must be mounted at the same path as on the host because a worktree's `.git` file holds an absolute path | must | 1, 2, 5 |

## Non-functional requirements

| ID | Quality | Requirement with a measurable limit | Not applicable because |
| --- | --- | --- | --- |
| NFR-1 | Performance | Cold install and start: limit TBD (author, 2026-11-15) from the by-hand build time measured in story 1, since a build replaces a download; re-run of the same version at most 5 s; install adds at most a disk size TBD (author, 2026-11-15) after story 1 (all proposed). The installed server's own start-to-ready adds at most 30 s. No continuously running work from the script itself | |
| NFR-2 | Reliability and recovery | Killing the script at any point (tested at each phase: fetch, build, switch) leaves either the previous complete install or none, never a partial one, and a re-run completes it. A failed upgrade leaves the old version runnable. Two concurrent runs end with one complete install | |
| NFR-3 | Security and privacy | The script runs as the user, never asks for or uses root, writes only to the install folder, the build folder, the state folder and the package manager's cache (allowed, or redirected into the build folder), and never touches agents' own configuration (for example `~/.claude`; roadmap, 2026-11-08). The start command sets the bind address; the default is the target's loopback and exposing the server is a choice the user makes with the bind and the container's published ports. The one-line `curl` fetches the script over HTTPS from the repository. The pairing token is printed only by the pairing command, not stored in logs. Container safety and egress are out of scope | |
| NFR-4 | Compatibility (OS, browsers, agent CLIs, mobile impact) | Debian-family and Ubuntu images on linux-x64 and linux-arm64 (glibc), including the Ubuntu 24.04 base this repo's devcontainer uses. Alpine (musl) and other distributions are out (Q-2 and A-5). Agent CLIs: whatever the user installs; Claude Code started in a shell on the target works as in a local Probe shell (manual check). Mobile: unaffected, no contract change | |
| NFR-5 | Usability and accessibility | One command to install. The final output is at most 15 lines, plain text, with each command on its own line and nothing to scroll back for. Every error names the cause and the fix. The script reads no input unless the user asks it to; it works when piped. The UI is not touched, so accessibility of the UI is not applicable here | |
| NFR-6 | Observability (logs, status, how we tell it broke) | The script writes a log file and prints its path on any failure; each phase prints one line, and the exit code is 0 only when the install is complete. The server log location is printed. A status command (or the start command) prints the installed version, whether the server runs, and its port and bind address | |
| NFR-7 | Maintainability and docs | The user docs gain an "Install Probe on a remote machine or devcontainer" section (the three topologies, the contract, start, pair, upgrade, uninstall). `docs/internals/remote.md` is updated where it describes how a server gets onto a remote host. The script's launch and pairing parts replace, not duplicate, the logic the SSH connection code carries today (decided in story 2). Same PR as the behavior | |

## Approach

1. Prove it by hand first. In a container made like this repo's devcontainer, build the server from the repository and run it, with a mounted state folder and a published port, and write down every thing that breaks: shell persistence, the `probe` command inside shells, the bind address, shell and database data on a mounted folder, pairing. Everything else is shaped by the answer.
2. Build the install script on what the SSH connection code already does (lock, prove it runs, install atomically, start and adopt a server, mint a pairing token), made to run inside the target without SSH or any Probe UI, to get the source from the repository and build it with the target's toolchain, and to print what the user needs next.
3. Give the start command an explicit port, bind address and state folder, and the stop, status and pairing commands.
4. Add the reverse states and the repeat paths: re-run, upgrade, uninstall, stop.
5. Verify each of the three container topologies and one remote machine (and arm64) from a clean image, and write the image contract and the topology guide from what was actually seen.
6. Later and not in this epic's Done when: a Linux release package so a target needs no toolchain (story 7).

Alternatives considered: a published Linux server package with no toolchain on the target (moved to story 7: needs a place to host it and an arm64 build machine, and the user decided build-in-target is enough for now); copying the host's build into the container (rejected: a macOS host cannot produce a Linux build, and the host's architecture may differ); preinstalling Probe in an image we ship (rejected: user decision, a container cannot be preinstalled with what each repo needs, and choosing images is out); one script per topology (rejected: roadmap decisions 9 and 10 say the install and the connection are identical); installing by connecting from the UI over SSH or `docker exec` (rejected for this epic: the user feeds the script, and the helper that starts containers is a later epic; the script could still be reused by it).

## Stories (candidates)

| # | Title | Value in one line | Order / depends on |
| --- | --- | --- | --- |
| 1 | Spike: build and run the server in a container by hand | Built in the container from the repository with this repo's toolchain; records what breaks and the by-hand path and time; tests topology 1 with a mounted state folder, what a published port needs, the tools the launch logic relies on (`ps`, `mktemp`, `kill`, `nohup`) and a host server sharing the folder; gates every later story (U-1, U-2, U-4, U-6, U-7, A-1 to A-3, A-5 to A-10) | first |
| 2 | Install script: check, build, prove, print | The script checks the contract, gets the source, builds, proves it runs and prints the next commands with placeholders, idempotently; refuses root (FR-1 to FR-5, FR-8 placeholders, FR-13, E4-S1 and E4-S5 core) | after 1 |
| 3 | Start, stop, status and pairing token | The printed commands exist and work: detached start with explicit port, bind and state folder, reuse, stop, token for PRB.E-003; the printed commands become real, with the actual port and address printed at start (FR-8, FR-9, FR-11, FR-14) | after 2 |
| 4 | Upgrade, re-run and uninstall | The reverse states: new version beside old, a restart note, uninstall that keeps data (FR-6, FR-7, E4-S4) | after 3 (needs a running server to test upgrade) |
| 5 | Verify the three topologies and a remote machine | Runs the five KPI runs from clean images and a machine, records transcripts and fixes what breaks (FR-10, KPI) | after 4; for connection after PRB.E-003 (or a plain HTTP check until then). E-003 closes after this story |
| 6 | Image contract and topology guide | User documentation: contract, three topologies, hooks, same-path mount and prune consequences, upgrade and uninstall (FR-15, FR-16, NFR-7) | after 5 (written from what was seen); an outline can start after 1 |
| 7 | Later, deferred: Linux release package | x64 and arm64 packages with checksums at one address, per version, so a target needs no toolchain; a later SSH story may then use it. Not part of this epic's Done when | after 6; needs Q-1 settled |

## Verification

- **Traceability:** every FR and NFR appears in one row.

| Requirement | Verified by (scenario test / measurement / manual check) | Owner |
| --- | --- | --- |
| FR-1 | Manual: E4-S1 to E4-S3 on clean images and a machine, getting the script by copy and by the one-line `curl`; no root, nothing beyond the image contract installed by hand | story 5 |
| FR-2 | Manual: install on linux-x64 (all setups) and linux-arm64 (topology 3); no flag chooses the architecture | story 2 and story 5 |
| FR-3 | Manual and scripted: E4-S5 on images missing each item in turn (a table of images and expected messages), and a run as root; nothing installed after | story 2 |
| FR-4 | Scripted: a build that fails, or a server that cannot run on the target, is refused and not marked complete | story 2 |
| FR-5 | Scripted: run twice (no change, says so), kill mid-run and re-run, two at once | story 2 |
| FR-6 | Manual: E4-S4 upgrade with a shell running before and after the restart | story 4 |
| FR-7 | Manual: E4-S4 uninstall, check what stays and what goes, with and without the data flag | story 4 |
| FR-8 | Manual: read the output in every setup (placeholders in story 2, real commands and the printed port and address in story 3); copy each printed command and run it | story 2 and story 3 |
| FR-9 | Manual: start, close the session, check it runs; start again (reused); stop; restart the container and start again | story 3 |
| FR-10 | Manual: diff the transcripts of E4-S1 to E4-S3 for differences that depend on the kind of target | story 5 |
| FR-11 | Manual: topology 1 (state on the host, mounted) and topology 2 (state in the container); first tried by hand in story 1; the start command's state-folder option in story 3 | story 1, story 3 and story 5 |
| FR-12 | Manual: open a shell through the installed server in each setup, type, resize, `probe kill`; first tried in story 1 | story 1 and story 5 |
| FR-13 | Scripted: server started with the keyring unavailable still starts and reports it | story 2 |
| FR-14 | Manual: start with an explicit port and bind address in a container, reach it from the host through a published port; start with none and see the scan and the printed values | story 1 and story 3 |
| FR-15 | Docs diff reviewed in the PR (guide text only; nothing implemented) | story 6 |
| FR-16 | Docs diff reviewed in the PR; the author follows the guide on a clean image, including a same-path repo mount | story 6 |
| NFR-1 | Measurement: the script prints elapsed times; recorded per setup; disk use read after install | story 2, story 5 |
| NFR-2 | Scripted: kill the script at each phase and re-run; failed upgrade leaves the old version running | story 2, story 4 |
| NFR-3 | Code review of the script (no root, no writes outside its folders, no agent config); the bind address is set by the start command | story 2, story 3 |
| NFR-4 | Manual: Ubuntu 24.04 on both architectures; Debian 12 on linux-x64; Claude Code started by hand in a shell on the target | story 1, story 5 |
| NFR-5 | Manual: read the output of each setup against the 15-line limit; piped run works | story 2 |
| NFR-6 | Manual: force each failure of E4-S5 and check the log path and exit code | story 2 |
| NFR-7 | Docs diff reviewed in the PR | story 6 and each story |

- **KPI measurement:** from clean images and a clean machine, run the five listed runs as written (E4-S1, E4-S2 for topologies 2 and 3, E4-S3, and topology 3 on arm64); list each run in the ticket with its transcript and whether the server answered a pairing request from the host; the count is the number that did, out of 5. Read the elapsed times the script prints.
- **Automated scenarios** (the scenario harness from PRB.E-001): none are planned. The harness is not known to drive Docker and the dev container has no Docker socket, so E4-S1 to E4-S3 are manual on the author's host. E4-S4 and E4-S5 have parts that can be scripted against a plain shell (FR-3, FR-4, FR-5, NFR-2); those are tests inside stories 2 and 4. TBD (author, 2026-11-15) whether a scripted Docker run is worth adding once the script is stable.
- **Manual checks:** the author runs E4-S1 to E4-S5 as above, once on an arm64 machine for topology 3, and starts Claude Code in a shell on the target.
- **Sign-off:** the author.

## Dependencies and sequencing

- Phase 2 of `roadmap.md` (remote server and devcontainer; scope decisions 9 and 10).
- PRB.E-003 (Connect Probe to a remote server) is the consumer: it needs a server to connect to. Story 5's connection check uses its connect flow when it exists, otherwise a plain HTTP readiness request and token exchange from the host. PRB.E-003 closes after this epic's story 5 (the verification story); until then neither epic waits for the other. SSH forward is deferred in E-003, so the SSH install path matters only for that later SSH story and the later Linux release story; this epic leaves it unchanged.
- The pairing and the client-server protocol check already exist; this epic reuses them and changes neither.
- Builds on the existing SSH remote install code in `packages/ssh` (lock, prove, launch, adopt, pairing) and this repo's own `.devcontainer/` and `docs/operations/development.md` as the definition of the toolchain.
- The later devcontainer helper epic (starting containers) is expected to reuse this script; it is not required here.
- Blocks nothing in phase 1; phase 3 (agents in Probe shells on a remote) uses a server installed this way.

## Risks

| ID | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R-1 | The build in the target fails or is very slow (the native terminal parts need a compiler, the repo needs its package manager, memory is small), so installs take too long or fail on small machines | medium / high | Story 1 builds by hand first and records time and memory; the contract names the toolchain; the release package (story 7) is the later way out |
| R-2 | The repository or the package registry is not reachable from the target (the repository is private until the open visibility decision in `docs/dev/questions.md` is settled; no credentials in a container) | medium / high | Story 1 records it (U-6, U-7); the script's check names the fix; while the repository is private, delivering the script as a file copy (and the source another way) is the fallback; credentials are the user's setup (container configuration) |
| R-3 | Host `git worktree prune` removes the metadata of worktrees that exist only in the container, and the user loses work in a mounted repo | medium / high | No story implements locking (Q-3); the guide says worktrees must be locked and how (FR-15) |
| R-4 | Git hooks in a bind-mounted repo, written by an agent in the container, run on the host | medium / high | Out of Probe's control by decision (scope decision 9); the guide says it plainly for topologies 1 and 2 (FR-16) |
| R-5 | The server is stopped by a container restart and the user does not notice, so the UI shows a dead server | high / medium | The start command is short and printed; PRB.E-003 shows a dead server; an automatic start is a later epic (out) |
| R-6 | An upgrade with a running server loses or breaks shells, or the database migrates in a way an older install cannot read, so no rollback | medium / high | FR-6 keeps the old version beside the new one and shells outlive the server; story 4 tests an upgrade with a running shell; the existing database migration policy applies (A-4) |
| R-7 | Two copies of install logic (the SSH connection code and this script) drift apart | medium / medium | Story 2 decides whether the SSH code reuses the script (NFR-7) |
| R-8 | A user runs the script as root in a container (common default, and plain `docker exec`) and it is refused, so they stop | medium / medium | FR-3's message names the fix (a non-root user, `docker exec -u`); the guide leads with it |
| R-9 | A repo is mounted at a different path than on the host, so a worktree's `.git` file points to a path that does not exist on one side and git breaks there | medium / high | The guide requires a same-path mount (FR-16); story 1 shows the failure once |
| R-10 | A published container port cannot reach a server bound to loopback, so the connection looks broken | high / medium | The start command takes an explicit bind and port (FR-14); the guide shows the pairing with a published port |

## Assumptions and unknowns

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner | Affects (FR / NFR / story) |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | A container made like this repo's devcontainer (Ubuntu 24.04, Node, build tools, the repo's package manager) builds the server from the repository and runs it with no further setup; the native pty library builds there because the toolchain is present | assumption | unverified | Story 1: build and run by hand in a container from the repo's devcontainer definition | author | FR-1, FR-12, R-1 |
| A-2 | The built server runs on the target that built it, with the shell host and the `probe` wrapper working (the shell host is a detached process spawned from the server; the wrapper is written beside the state folder) | assumption | unverified | Story 1: open a shell, restart the server, check the shell survives, run `probe kill` | author | FR-12, FR-6 |
| A-3 | The existing SSH install and launch logic (lock, atomic move, adopt, pairing token) can run unchanged inside the target without SSH, in plain `sh`, given `ps`, `mktemp`, `kill` and `nohup` | assumption | unverified | Story 1 lists the tools it needs and runs the pieces by hand; story 2 plan reads the scripts | author | FR-1, FR-5, FR-9, R-7 |
| A-4 | Installing a newer server beside an older one over the same state folder is safe: a newer server migrates the database, and the shell host stays compatible across versions | assumption | unverified | Story 4 plan: read the database migration and shell-host protocol policy; test an upgrade with a running shell | author | FR-6, R-6 |
| A-5 | Debian-family glibc images (Ubuntu, Debian) are enough for users now; Alpine (musl) is unsupported | assumption | unverified | Story 1: try Alpine once and record the result | author | NFR-4 |
| A-6 | Pairing can be done from inside the target (`pair` command) and the resulting token works from a host through a port that the user published or forwarded | assumption | unverified | Story 1 and story 3: read the pairing command's output; try it from the host | author | FR-8, E4-S1 |
| A-7 | A server started with an explicit bind address and port in a container is reachable from the host through a published port, and one bound to loopback is not; the start command therefore sets the bind (FR-14) | assumption | unverified | Story 1: try both with a published port and note what a published port needs; story 3 implements; story 6 documents | author | FR-14, FR-16, NFR-3 |
| A-8 | Mounted host folders are writable by the non-root user in the container for the state folder (topology 1), with the right ownership | assumption | unverified | Story 1 and story 5, topology 1 on the host(s) the author tests (TBD (author, 2026-11-15): Docker Desktop on macOS, Linux, or both) | author | FR-11 |
| A-9 | The unix socket of the shell host and the database (SQLite) work on a mounted state folder (topology 1) on the host(s) the author tests; and a server running on the host can share the same state folder without corrupting it, or must not (then the guide says so) | assumption | unverified | Story 1: topology 1 with a mounted state folder: open a shell, restart, check the socket and database; try a second server on the host on the same folder | author | FR-11, FR-12, R-3 |
| A-10 | Whether git credentials or a code-host CLI are available in topologies 1 and 2 depends on how the container is configured (mounts or forwarded credentials), not on Probe | assumption | unverified | Story 1 (topology 1) and story 5 (topology 2): clone a private repo in each and record what the container needed | author | FR-16, E4-S1, E4-S2 |
| U-1 | Whether the install works with the user's choice of home (some containers have no writable home for the non-root user, or no home at all) | unknown | unverified | Story 1: try with the typical devcontainer user and with a bare user | author | FR-3, FR-11 |
| U-2 | How long a cold build-and-install takes, how much disk and memory it needs, and the time to ready | unknown | unverified | Story 1 by hand, story 2 by script | author | NFR-1, KPI |
| U-3 | Whether the current server reports its own version in a form a script can read and compare, and how the version relates to the repository ref the script builds | unknown | unverified | Story 2 plan | author | FR-6 |
| U-4 | Whether the keyring module is needed for anything Probe keeps in a remote (secrets) and what the server does without it | unknown | unverified | Story 1: start with the keyring unavailable | author | FR-13 |
| U-5 | Whether the start command conflicts with the state of a server another tool already started in the same home | unknown | unverified | Story 3 plan: the SSH code's adopt logic is the model | author | FR-9 |
| U-6 | How the target gets the Probe source (a clone of the repository at a ref, a tarball) and whether it needs credentials, since the one-line `curl` of the script also comes from the repository; depends on the open repo-visibility decision in `docs/dev/questions.md`, and while the repository is private, file-copy delivery is the fallback | unknown | unverified | Story 1: fetch from a target with no credentials and with the usual devcontainer ones | author | FR-1, FR-3, R-2 |
| U-7 | The minimum Node and package-manager versions the build needs, and whether registry access is needed at install time | unknown | unverified | Story 1: build with the oldest versions that work; story 2 encodes them in the contract check | author | FR-3, R-2 |

## Open questions

- Q-1: Where do Linux release packages come from, and who builds the arm64 one? Moved to deferred story 7; not needed for Done when. Owner: user, TBD (user, 2026-11-15).
- Q-2: Is a remote Mac (or Windows) machine ever a target? Settled as proposed: Linux only (this epic).
- Q-3: Who implements worktree locking (the worktree-creation code, PRB.E-003, or a later ticket)? Outside this epic's Done when; here it is guide text only (FR-15). Owner: author. TBD (author, 2026-11-15).
- Q-4: Is the proposed KPI (5 runs of 5, plus the time guardrail) what the user wants to be held to, and by when? Owner: user. TBD (user, 2026-11-15).

Settled (user, 2026-11-09): the install script refuses to run as root (`docker exec` needs `-u` to the non-root user); the script is delivered as a file copied in or by a one-line `curl` of the script from the repository; the server is built inside the target; a container is a remote server and the user sets up the container or machine and agent logins.

## Notes for stories

- Existing parts to read first: `packages/ssh/src/tunnel.ts` builds the POSIX `sh` runner (a no-clobber lock file, staging folder, proving the binary runs with `--version`, `.install-complete` marker, versioned runtime folder), the launch script (adopt a running server, pick a port, `nohup` start, readiness probe, a managed or external marker; it uses `ps`, `mktemp`, `kill` and `nohup`) and the pairing script (`auth pairing create`). Its download and archive parts are for upstream releases and are not the model here; build-in-target replaces them.
- The server command line already takes `--port`, `--host` and `--base-dir` (`apps/server/src/cli/config.ts`); the start command passes them through.
- Secret storage: the OS keyring module is the non-essential part FR-13 refers to; U-4 settles what the server does without it.
- Shell host: `apps/server/src/terminal/shellHost/` (a detached process per state folder with a unix socket); the `probe` wrapper and `PROBE_SHELL_ENDPOINT_FILE` live in `apps/server/src/terminal/shellEnv.ts`.
- This repo's `.devcontainer/` (Ubuntu 24.04 base, Node feature, build tools, Rust, a compose file that bind-mounts a worktree) and `docs/operations/development.md` define the toolchain the image contract names; the Playwright and Claude Code parts are for developing Probe, not for building the server, and the spike separates them.
- `.devcontainer/worktree.sh` creates relative worktrees and locks them; that is the model for the locking guide text.
- `docs/internals/server-updates.md` describes the service launcher update path for installed services; whether the installed target reuses it or has a simpler replace-and-restart is a story 4 decision.
- Idea from the user, parked: a later helper epic starts the container and runs this script in it.

## Done when

- [ ] The KPI target holds: 5 of 5 listed runs (topology 1, 2 and 3 on linux-x64, a remote machine on linux-x64, topology 3 on linux-arm64) go from a target with the toolchain to a server that answers a pairing request from the host, each run listed with its transcript in the ticket.
- [ ] The guardrail holds: cold install and start within the limit the author sets after story 1, re-run at most 5 s.
- [ ] Re-run, upgrade and uninstall each work as E4-S4 says, and an unsuitable target (including root) gets the messages of E4-S5 with nothing half-installed.
- [ ] The start command takes an explicit port, bind address and state folder, and a server in a container is reached through a published port.
- [ ] The image contract and the three topology guides (with the same-path mount, hooks and worktree locking text) are in the user docs, and the author followed them on a clean image.
- [ ] The author starts Claude Code in a shell on an installed target and signs off.
