---
id: PRB.T-029
type: story
parent: PRB.E-004
phase: 2
labels: [remote, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Spike: build and run the server in a container by hand

## Business Goal

**Problem:** Nothing says a Probe server built from the repository inside a stock Linux container works. Shell persistence, the `probe` command inside shells, the bind address, a mounted state folder and pairing are all unproven on a target, and the epic's baseline, time and disk limits are unknown. Every later story in PRB.E-004 would be planned on beliefs.

**Proposed solution:** The author builds the server by hand from the repository in a container made like this repo's devcontainer, runs it with a mounted state folder and a published port, and writes down every success and every break, with measured times. The written finding is the output; no product code changes. It gates PRB.T-030, PRB.T-031 and PRB.T-032.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 1 Spike: build and run the server in a container by hand (first story of the epic)
- **Delivers:**
  - Evidence for FR-1, FR-11, FR-12, FR-13, FR-14 by hand: build and run, state folder placement, shells working, a non-essential part (secret storage) failing softly, an explicit bind and port reached through a published port. Only the first by-hand try; the shipped behavior is PRB.T-030 and PRB.T-031.
  - NFR-1: the by-hand build time, disk use and time to ready that the epic's limits are set from.
  - NFR-4: Ubuntu 24.04 once, Alpine once (A-5), Claude Code started by hand in a shell.
  - Settles or narrows epic A-1, A-2, A-3, A-5 to A-10 and U-1, U-2, U-4, U-6, U-7.
- **Spike exemption:** This story is a spike and is exempt from the deployable-outcome rule; its output is the written finding, not shipped behavior.
- **One deployable outcome:** A written finding in this ticket's handoff that says what works, what breaks and what it costs to run Probe's server in a container built from the repository. It ships no product behavior; it contributes to the epic by removing the unknowns that the install script's design depends on.

## Current Behavior

Verified by reading on 2026-11-09 (the code search index was unavailable).

- **Today's way to a server on another machine.** There is none in the product. The author copies a checkout and builds by hand, as `.devcontainer/` does for this repo (`.devcontainer/Dockerfile`, `.devcontainer/on-create.sh`, `docs/operations/development.md`). Whether a container built that way can build and run the server with no further setup is unverified (epic A-1).
- **Server command line.** `apps/server/src/cli/config.ts` defines `--port`, `--host` and `--base-dir` flags. A second server on the same state folder is refused with a message (`config.ts`, around line 348). Whether the bind to a non-loopback address is reachable through a published port is unverified (A-7).
- **SSH install logic.** `packages/ssh/src/tunnel.ts` builds POSIX `sh` scripts that use a lock, `mktemp`, a staging folder, `--version` proving, an `.install-complete` marker, `ps`, `kill` and `nohup`. It downloads upstream release archives. That it can run inside a target under plain `sh` is unverified (A-3).
- **Shells.** The shell host is a detached process per state folder with a unix socket (`apps/server/src/terminal/shellHost/`); the `probe` wrapper and its endpoint file are in `apps/server/src/terminal/shellEnv.ts`. Their behavior on a mounted state folder or inside a container is unverified (A-2, A-9).
- **Secret storage.** The server uses an OS keyring module for secrets (`@napi-rs/keyring`, per `docs/dev/research/devcontainer-attach.md`). What the server does when it is unavailable is unverified (U-4).
- **Release path.** The repository has no published Linux server release; the existing archives come from upstream T3 (`docs/dev/research/devcontainer-attach.md`).
- **Mobile.** Not touched.

## Expected Behavior

The author runs the following by hand and records the result of each in the ticket. Nothing is shipped to users.

### User Flow

1. The author starts a container from an image made like this repo's devcontainer (Ubuntu 24.04, Node, build tools, the repo's package manager) as the typical non-root user, with a host folder mounted for the state folder (topology 1) and a published port.
2. The author gets the Probe source into the container (clone or copy) with and without credentials, installs dependencies, builds the server and times each step, noting disk use and peak memory.
3. The author lists the tools the SSH launch logic relies on (`ps`, `mktemp`, `kill`, `nohup`) and checks each is present, then runs the pieces of that logic by hand under plain `sh`.
4. The author starts the server with an explicit bind address, port and state folder; reaches it from the host through the published port; repeats with a loopback bind to see it fail; and does the pairing from inside the container and uses the token from the host.
5. The author opens a shell, types, resizes, runs `probe kill` in it, restarts the server and checks the shell survives.
6. The author checks the unix socket and database on the mounted state folder, and tries a second server on the same folder from a second container that mounts it (default; no install on the host). A second server on the host itself is not run (ER-2) unless the author chooses a throwaway scratch build there (SU-3).
7. The author starts the server with the keyring unavailable, with a bare user that has no writable home, with the oldest Node and package-manager versions that build, and once on Alpine, and starts Claude Code in a shell.
8. The author writes the finding: a table of each epic assumption or unknown touched, result, evidence, and the by-hand path and times.

### Edge Cases

- EC-1: The build fails or exceeds memory on a small container. Record the failure, the memory used and the smallest size that works.
- EC-2: A mounted state folder is not writable by the container user, or ownership differs. Record what the container needed (A-8).
- EC-3: The host is macOS or Linux. The finding names the host operating system(s) the mounted-folder checks were run on (AC-14); the other is `TBD (author, 2026-11-15)` for story 5.
- EC-4: Alpine (musl) fails to build. That is the expected outcome and is recorded as the reason Alpine is out (A-5).

### Error Handling

- ER-1: Anything that breaks is recorded with the command, the output and the suspected cause, not worked around silently. A break that makes the epic's approach unworkable (for example the build cannot run in a container at all) is escalated to the author before the dependent stories are planned.
- ER-2: A check that cannot be run (no second host, no Docker on the author's machine) is recorded as not run, with the assumption left unverified.

## Out Of Scope

- Writing the install script, the start command or any product code: PRB.T-030 and PRB.T-031.
- Deciding the script's structure, the version scheme or whether the SSH code reuses the script: PRB.T-030's plan.
- Choosing the cold-install limit: the author sets it after this story from the measured time (epic KPI, NFR-1).
- The image contract and topology guide as user docs: PRB.T-034 (an outline may start after this story).
- Topology 2 and 3, a remote machine and arm64: PRB.T-033.
- Worktree locking, hooks and same-path mount behavior in the guide: PRB.T-034. The same-path failure (R-9) is shown once here if cheap.

## Technical Scope

- **Layers:** none changed. The work is manual commands in a container and a written finding. If a break needs a code fix, that is a separate ticket.
- **Docs impact:** the finding goes in this ticket's handoff; durable rows move to `docs/dev/questions.md` or, once built, `docs/internals/`. No user docs.
- **Mobile impact:** none.

## Non-functional Requirements and Constraints

- Run in a throwaway container with a throwaway state folder; never touch `~/.t3/userdata` or agent CLI global configuration (`AGENTS.md`).
- Do not install anything on the host. The host-server variant of the second-server check is therefore recorded as not run (ER-2) unless the author decides otherwise (SU-3).
- Claude Code, if started, uses the cheapest model; a real run costs money (`AGENTS.md`).
- Epic NFR-3: the finding records any write outside the expected folders, not only the result.
- Epic NFR-1: times are wall-clock from a warm network; record the machine and image.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a container built like this repo's devcontainer, when the author builds the server from the repository, then the finding states whether it built with no extra setup, the steps used, wall-clock time per step, disk used and peak memory (A-1, U-2) | manual (author) | FR-1, NFR-1, EC-1 |
| AC-2 | Given the built server, when the author starts it with an explicit state folder, bind and port and reaches it from the host through a published port, then the finding states that it worked, and what a published port needs; and that a loopback-bound server is not reachable (A-7) | manual (author) | FR-14, FR-11 |
| AC-3 | Given a running server, when the author opens a shell, types, resizes and runs `probe kill` in it, then the finding states each result; and after a server restart whether the shell survived (A-2) | manual (author) | FR-12 |
| AC-4 | Given topology 1 with a mounted state folder, when the author opens a shell, restarts, and tries a second server on the same folder from a second container mounting it, then the finding states how the socket and database behaved and whether sharing the folder is safe (A-8, A-9) | manual (author) | FR-11, FR-12, EC-2 |
| AC-5 | Given the server started with the keyring unavailable, when the author starts it, then the finding states whether it starts and what it reports (U-4) | manual (author) | FR-13 |
| AC-6 | Given the SSH launch logic's required tools, when the author checks them and runs the pieces by hand under plain `sh`, then the finding lists each tool, whether present, and which pieces ran unchanged (A-3) | manual (author) | FR-1 |
| AC-7 | Given a target with no credentials and with the usual devcontainer ones, when the author fetches the source and runs the install of dependencies, then the finding states what each needed (U-6) and the oldest Node and package-manager versions that build (U-7) | manual (author) | FR-1, ER-2 |
| AC-8 | Given the typical devcontainer user and a bare user, when the author builds and starts, then the finding states whether a writable home was needed (U-1) | manual (author) | FR-3 |
| AC-9 | Given pairing run from inside the container, when the author uses the token from the host, then the finding states whether it worked (A-6) | manual (author) | FR-8 |
| AC-10 | Given Alpine, when the author tries the build once, then the finding records the result (A-5) | manual (author) | NFR-4, EC-4 |
| AC-11 | Given the finding, when it is read, then every epic assumption and unknown listed under Delivers is marked verified, false or still unknown with the evidence, and anything that breaks is listed with command and output | manual (author) | ER-1, ER-2 |
| AC-12 | Given the finding, when the author reads it, then the epic's cold-install and disk limits can be set from it; the author records the proposed values, or `TBD (author, 2026-11-15)` | manual (author) | NFR-1 |
| AC-13 | Given Claude Code started in a shell on the Ubuntu container, when the author starts it, types input and exits it, then the finding states whether it started, took input and exited, and what differs from a local Probe shell; "works" means all three (NFR-4) | manual (author) | NFR-4 |
| AC-14 | Given the mounted-folder checks (AC-4), when the finding is read, then it names the host operating system(s) they were run on and marks any other as `TBD (author, 2026-11-15)` (SU-1) | manual (author) | EC-3 |

## Dependencies

Depends on: none. First story of PRB.E-004.

| Depends on | Why | Status |
| ---------- | --- | ------ |
| None | First story. The containers and the toolchain are the author's own setup; no E-002 or E-003 story is needed | |

Blocks:

- PRB.T-030 (install script): its design rests on this finding (epic: "gates every later story").
- PRB.T-031 and PRB.T-032 (start/stop/pair; upgrade/uninstall): same gate, through PRB.T-030.
- PRB.T-033 and PRB.T-034: the guide outline and the verification runs use the measured path.

No dependency on PRB.E-002 (PRB.T-016 to PRB.T-020) or on PRB.E-003.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The author has a host with Docker and a container made like this repo's devcontainer can be started there (the dev container itself has no Docker socket) | assumption | unverified | Before starting | author |
| SA-2 | The epic's assumptions A-1, A-2, A-3, A-5 to A-10 and unknowns U-1, U-2, U-4, U-6, U-7 are answered only by running; reading cannot settle them | assumption | unverified | AC-1 to AC-10 | author |
| SA-3 | The Probe repository is reachable from the container with the author's credentials; the unauthenticated case may fail while the repository is private (`docs/dev/questions.md` visibility decision) | assumption | unverified | AC-7 | author |
| SU-1 | Which host operating systems the author will test for the mounted state folder (Docker Desktop on macOS, Linux, or both) (epic A-8) | unknown | unverified | `TBD (author, 2026-11-15)` | author |
| SU-2 | Whether the spike finds a break that changes the epic's approach (for example the build cannot run in a container) | unknown | unverified | AC-11; escalate per ER-1 | author |
| SU-3 | Decision for the author: whether to run the host-server variant of the second-server check as a throwaway scratch build on the host (default: no, record as not run under ER-2; the check runs in a second container instead) | unknown | unverified | `TBD (author, 2026-11-15)` | author |
