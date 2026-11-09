---
id: PRB.T-031
type: story
parent: PRB.E-004
phase: 2
labels: [remote, plan]
created: 2026-11-09
updated: 2026-11-09
---

# Start, stop, status and pairing token

## Business Goal

**Problem:** After the install script finishes, the user has a built server but only placeholder commands. A container publishes a port that a loopback-bound server cannot reach, a session that ends can take the server with it, and PRB.E-003's connect flow has no pairing token to use.

**Proposed solution:** The commands the script printed become real. A start command runs the installed server detached with an explicit port, bind address and state folder, reuses a server that already runs, and prints the port and address it uses. A stop command ends it, a status command says what is installed and running, and a pairing command prints a token for PRB.E-003 to connect with.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 3 Start, stop, status and pairing token
- **Delivers:**
  - FR-8 (the real half): the printed commands exist and work; the actual port and address are printed at start.
  - FR-9: detached start that survives the session, reuse of a running server, a stop command, and the same start command after a container restart brings the server back on the on-disk state (workspaces, database, restorable shell records); running processes do not survive a restart.
  - FR-11: the state folder can be placed where the user wants; the default is one place in the user's home and the output says where.
  - FR-12 (smoke check only): a shell started by the installed server opens, takes input, resizes and ends; `probe kill` in it ends it. Full verification is PRB.T-033.
  - FR-14: explicit port and bind; a free-port scan only as the default when no port is given; prints the port and address.
  - NFR-3 (bind half): the default bind is the target's loopback; exposing is the user's choice; the token is printed only by the pairing command, not stored in logs.
  - NFR-6: the status command (or start) prints version, whether the server runs, port and bind; the server log location is printed.
  - NFR-1 (installed server's start-to-ready at most 30 s).
- **One deployable outcome:** A user starts the installed server with a port and bind of their choice, reaches it from outside the target through a published port with a pairing token, and stops it. Together with PRB.T-030 this is the server PRB.E-003 connects to.

## Current Behavior

Verified by reading on 2026-11-09 (the code search index was unavailable).

- **Server flags.** `apps/server/src/cli/config.ts` defines `--port`, `--host` and `--base-dir`. `apps/server/src/cli/server.ts` has `start` and `serve` commands. A server already running for a state folder is refused with "already running ... Connect to that server, stop it ... or use a different --base-dir" (`config.ts`, around line 348).
- **Pairing.** `apps/server/src/cli/auth.ts` has `pairing create`, `list` and `revoke` ("Issue a new client pairing token"); `apps/server/src/cli/pair.ts` has a `pair` command that prints a pairing URL and, for a terminal, a QR code (line 186 onward). Whether `pair` from inside a target gives a token usable from a host through a published port is unverified (epic A-6).
- **SSH launch logic.** `packages/ssh/src/tunnel.ts` carries the model: adopt a running server, scan for a free port, start with `nohup ... serve --host 127.0.0.1 --port ... --base-dir ...` (line 704), probe readiness, a managed/external marker, and a pairing script. It uses `ps`, `mktemp`, `kill`, `nohup`. Use inside a target without SSH is unverified (epic A-3, U-5).
- **Port.** Without `--port` the dev runner and server scan for a free port; the exact default scan behavior of the installed server is unverified.
- **Shells.** The shell host is a detached process per state folder, so shells outlive the server (`docs/internals/terminal-runtime.md`; `apps/server/src/terminal/shellHost/`). The `probe` wrapper and endpoint file are written beside the state folder (`apps/server/src/terminal/shellEnv.ts`).
- **No start command exists** that wraps these for an installed target; PRB.T-030 only prints placeholders.
- **Mobile.** Not touched; no contract change.

## Expected Behavior

- **Start:** detaches so the server keeps running after the user's session ends; takes an explicit port, bind address and state folder; with no port it scans for a free one; with a running server for the same state folder it reuses it and says so; prints the version, the port and address actually used, the state folder and the log location. The default bind is loopback; a non-loopback bind (for a published container port) is the user's explicit choice.
- **Stop:** ends the server this install started; for a server started elsewhere (another tool or another install) it refuses and says so. Shells owned by the shell host keep running (PRB.E-001), and the output says so.
- **Status:** prints the installed version, whether the server runs, its port and bind address.
- **Pairing:** prints a pairing token for PRB.E-003, usable from outside the target. The token is printed by this command only and is not written to logs.
- **State folder:** configurable per start; the default is one place in the user's home, and the output says where.
- A container restart ends every process: the server, the shell host and the shells' processes. Only on-disk state survives. The user runs the same start command again; the server returns with its workspaces and database, and the shells that were running are listed as ended ("lost") and can be restored by the user, which starts a new process in the same folder and drops the old output (`docs/internals/terminal-runtime.md`).

### User Flow

1. The user runs the printed start command, with the bind and port that match the container's published port.
2. It prints version, address, port, state folder and log path, and returns the prompt.
3. The user runs the pairing command and copies the token.
4. From the host (PRB.E-003's connect flow, or until it exists a plain HTTP readiness request and token exchange) the user reaches the server.
5. The user closes their session; the server still runs. Later the user runs status, then stop.
6. After a container restart the user runs the same start command, reconnects, and restores any shell listed as ended that they want back.

### Edge Cases

- EC-1: Start when a server for the same state folder already runs: it is reused and the output says so, and prints its port and address.
- EC-2: No port given: a free port is chosen and printed.
- EC-3: A given port is busy: the start fails naming the port (it does not silently pick another).
- EC-4: State folder on a mounted folder (topology 1) and in the container (topology 2): both work.
- EC-5: A server started by another tool in the same home or state folder (epic U-5): start reuses or refuses with a clear message; it never starts a second server on the same state folder.
- EC-6: Stop when no server runs: says so, exit code reflects it.
- EC-7: A stale marker after a container restart (the process no longer exists): status reports not running, then start starts a new server.
- EC-8: The installed Probe is mid-upgrade: out of scope here, PRB.T-032.

### Error Handling

- ER-1: The server does not become ready within 30 s (epic NFR-1): the start fails with the log path and does not leave a half-running server; the exit code is non-zero.
- ER-2: A loopback-bound server is asked to be reached from a published port: status prints the bind so the user can see the cause (no automatic change).
- ER-3: The secret storage is unavailable: the server starts and reports what is unavailable (FR-13, the server's side).
- ER-4: Not installed (or install incomplete): start, status and pairing say so and point at the install script.
- ER-5: Pairing when the server is not running: says so and names the start command.

## Out Of Scope

- A supervisor that restarts the server on container restart: later epic; the user runs start again.
- Connect UI, saved servers and pairing in the UI: PRB.E-003 (PRB.T-023).
- Upgrade, re-run and uninstall behavior and the restart note: PRB.T-032.
- Worktree locking, same-path mounts and hooks guidance: PRB.T-034.
- Verifying the three topologies, a remote machine and arm64: PRB.T-033.
- Changing the pairing protocol or the client-server version check (reused unchanged).
- Permission scopes of the token beyond what the existing pairing gives.
- Making the server run as a service manager unit.

## Technical Scope

- **Layers:** the installed command surface (start, stop, status, pairing), the way it launches `serve`/`start` detached, adoption of a running server, port selection and readiness check; possibly shared with `packages/ssh` launch logic (decided in the plan, epic R-7). Server CLI flags already exist; the server may need to report its version and bind. No wire contract change expected.
- **Docs impact:** the user docs section started in PRB.T-030 (start, pair); `docs/internals/remote.md` for the launch and pairing description. The topology guide is PRB.T-034.
- **Mobile impact:** none.

## Non-functional Requirements and Constraints

- Epic NFR-3: default bind is loopback; the token appears only from the pairing command and is not stored in logs; no root; writes only to the install, state and log folders.
- Epic NFR-1: the installed server's start-to-ready adds at most 30 s; no continuously running work from the commands themselves.
- Epic NFR-5: each command prints plain text with each follow-up command on its own line; every error names the cause and fix.
- Epic NFR-6: version, running state, port, bind and log location are printed.
- Container and machine are treated identically (FR-10): nothing detects a container.
- Outcome: stop never kills an unrelated process (`AGENTS.md`, never kill by pattern); the plan decides the mechanism.
- Reuse, do not duplicate, the SSH launch logic (epic R-7, NFR-7).

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given an installed target, when the user runs the start command with an explicit port, bind and state folder, then the server runs on exactly those and the output prints version, address, port, state folder and log path | auto (against a plain shell) | FR-8, FR-11, FR-14, NFR-6 |
| AC-2 | Given a container with a published port and a server started with a non-loopback bind, when the host requests readiness through the published port, then it answers; and a loopback-bound server does not | manual (author, host with Docker) | FR-14, ER-2 |
| AC-3 | Given a started server, when the user's session ends, then the server still runs | auto (a detached process outlives its parent shell) | FR-9 |
| AC-4 | Given a running server, when the user runs the start command again for the same state folder, then it is reused, says so and prints its port and address | auto | FR-9, EC-1, EC-5 |
| AC-5 | Given no port, when the user starts, then a free port is chosen and printed; given a busy port, then start fails naming it | auto | FR-14, EC-2, EC-3 |
| AC-6 | Given a running server, when the user runs stop, then the server ends, the output says shells keep running, and a second stop says nothing runs | auto | FR-9, EC-6 |
| AC-7 | Given a stale marker whose process no longer exists, when the user runs status and then start, then status reports not running and start starts a new server | auto | FR-9, EC-7 |
| AC-8 | Given a running server, when the user runs the pairing command, then it prints a token, and the token is not in the server log | auto (log check) | NFR-3 |
| AC-9 | Given the token and a published port, when the host does the readiness request and token exchange, then it succeeds (PRB.E-003's connect flow when it exists) | manual (author) | FR-8, A-6 |
| AC-10 | Given the state folder mounted from the host (topology 1) and in the container (topology 2), when the server starts on each, then it runs against the folder given and the output says where | manual (author) | FR-11, EC-4 |
| AC-11 | Smoke check (full verification in PRB.T-033): given a started server, when the user opens a shell, types, resizes and runs `probe kill`, then each works; and after stop and start of the server the earlier shell is still there | manual (author) | FR-12 |
| AC-12 | Given a server started with secret storage unavailable, when it starts, then it starts and reports what is unavailable | auto | ER-3 |
| AC-13 | Given the install is missing or incomplete, when start, status or pairing run, then each says so and points at the install script | auto | ER-4 |
| AC-14 | Given a server that does not become ready in time, when start runs, then it fails with the log path, leaves no running server and exits non-zero | auto | ER-1 |
| AC-15 | Given no server running, when the user runs pairing, then it says so and names the start command | auto | ER-5 |
| AC-16 | Given status, when run on a running and a stopped server, then it prints version, running or not, port and bind | auto | NFR-6 |
| AC-17 | Given the start-to-ready time, when measured on the author's container, then it is at most 30 s | manual (author) | NFR-1 |
| AC-18 | Given the container restarted, when the user runs the same start command, then the server starts with its earlier workspaces and database, and the shells that were running are listed as ended and can be restored (no process survives the restart) | manual (author) | FR-9 |
| AC-19 | Given the docs, when read, then the start and pairing text matches the commands and the SSH launch logic is replaced or shared, not duplicated | manual (docs diff reviewed in the PR) | NFR-7 |
| AC-20 | Given a server started with a loopback bind, when the user runs status, then it prints the bind address so the cause of an unreachable published port is visible | auto | ER-2, NFR-6 |
| AC-21 | Given a server started by another tool or install, when the user runs stop, then it refuses, says the server was not started by this install, and leaves it running | auto | FR-9, EC-5 |
| AC-22 | Given any start-to-ready run, when the server is not ready within 30 s, then start fails (see AC-14); the 30 s limit is the epic NFR-1 value | auto | NFR-1, ER-1 |

## Dependencies

Depends on: PRB.T-030 (an installed, proven server and the installed layout); PRB.T-029 indirectly (published-port and mounted-state findings, A-6, A-7, A-9). No dependency on PRB.E-002 (PRB.T-016 to PRB.T-020).

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-030 | Epic order "after 2": the commands are the real form of what that script prints | backlog |
| PRB.T-029 | Findings on pairing, bind and mounted state | backlog |

Blocks:

- PRB.T-032: needs a running server to test upgrade with a running shell.
- PRB.T-033: verification runs use these commands.
- PRB.E-003: PRB.T-023 (connect a server) and PRB.T-028 (everything works on a second server) use a server started this way for real remote checks; not a dependency of this story, which has a plain HTTP check until PRB.T-023 exists.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | Pairing can be done from inside the target and the token works from the host through a published port (epic A-6) | assumption | unverified | PRB.T-029, AC-9 | author |
| SA-2 | An explicit bind and port in a container is reachable from the host through a published port; loopback is not (epic A-7) | assumption | unverified | PRB.T-029, AC-2 | author |
| SA-3 | The SSH launch logic (adopt, port scan, `nohup`, readiness) works in the target under plain `sh` with `ps`, `mktemp`, `kill`, `nohup` (epic A-3) | assumption | unverified | PRB.T-029; plan | author |
| SA-4 | The shell host and its socket work on a mounted state folder (epic A-9) | assumption | unverified | PRB.T-029, AC-10 | author |
| SU-1 | Whether start conflicts with a server another tool started in the same home (epic U-5) | unknown | unverified | Plan: the SSH adopt logic is the model; AC-4 | author |
| SU-2 | Whether `pair` or `auth pairing create` is the right command to print, and its default scopes (the token carries standard scopes; admin scopes are for Connections settings) | unknown | unverified | Plan stage | author |
| SU-3 | The bind address a published container port needs on the author's hosts (macOS Docker Desktop, Linux) (epic A-7) | unknown | unverified | `TBD (author, 2026-11-15)` | author |
| SU-4 | The installed server's default port behavior when no port is given: whether it scans for a free port or uses a fixed default (the dev runner scans; the installed server is unverified) | unknown | unverified | Plan stage; AC-5 | author |
