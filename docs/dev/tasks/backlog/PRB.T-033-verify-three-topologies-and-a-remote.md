---
id: PRB.T-033
type: story
parent: PRB.E-004
phase: 2
labels: [remote, plan]
created: 2026-11-09
updated: 2026-11-09
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
