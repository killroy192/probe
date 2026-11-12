---
id: PRB.T-030
type: story
parent: PRB.E-004
phase: 2
labels: [remote, verify]
created: 2026-11-09
updated: 2026-11-12
---

# Install script: check, build, prove, print

## Business Goal

**Problem:** A user with a container or a Linux machine that already has the build toolchain has no way to get a Probe server onto it except copying a checkout and building by hand. A target that lacks something fails in ways the user must diagnose alone, and a failed build can leave a half-installed server.

**Proposed solution:** One script, run by the user inside the target (copied in or fetched with a one-line `curl`), checks the target against the image contract, gets the source from the repository, builds the server with the target's toolchain, proves it runs, and prints the version, the place and the commands to use next, with placeholders. It refuses root, lists every problem at once, and installs nothing on a failure. Running it again for the same version changes nothing.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 2 Install script: check, build, prove, print
- **Delivers:**
  - FR-1: one script, run as a normal user, builds and installs the server and the services remote use needs.
  - FR-2: works on linux-x64 and linux-arm64 with no architecture flag.
  - FR-3: the contract check lists all failures with fixes; refuses root; installs nothing on failure.
  - FR-4: proves the built server runs on this target before marking the install complete.
  - FR-5: idempotent; an interrupted run is repaired by running again; two runs at once do not corrupt each other.
  - FR-8 (placeholders half): prints version, place and the start, stop and pairing commands as placeholders. The real commands are PRB.T-031.
  - FR-13: a non-essential part that cannot work (secret storage) does not fail the install; the server still starts and says what is unavailable.
  - NFR-1 (script half), NFR-2 (install phases), NFR-3, NFR-5, NFR-6, NFR-7 (docs for the script), and the "unsuitable target" scenario E4-S5 in the script's part.
- **One deployable outcome:** A user on a suitable Linux target runs one command and ends with a built, proven Probe install and the next commands printed; on an unsuitable target they get every problem listed and nothing installed. This puts a server on the other end that PRB.E-003 can connect to, once PRB.T-031 adds the start command.

## Current Behavior

Verified by reading on 2026-11-09 (the code search index was unavailable).

- **No install script for this.** `scripts/install.sh` and `scripts/install.ps1` exist; they are inherited T3 installers. `scripts/install.sh` (read 2026-11-09) is a POSIX `sh` script that downloads a prebuilt T3 Code release archive from GitHub Releases (needs only `sh`, `tar`, a checksum tool and `curl` or `wget`; no Node or compiler), unpacks it into `$T3CODE_HOME/runtime/versions/<version>`, links a `t3` command into `~/.local/bin`, skips the work when an `.install-complete` marker holds the version, and exits on unsupported OS or architecture. It does not build from source, check the toolchain or refuse root. Whether it is a model for this script remains open (SU-3).
- **SSH install code.** `packages/ssh/src/tunnel.ts` generates POSIX `sh` that takes a lock file (around line 448), stages into a `mktemp -d` folder, proves the binary with `--version` (line 512), writes an `.install-complete` marker holding the version (line 515) and checks it before reuse (line 444). It downloads and extracts upstream release archives, which this story does not use. It runs only over SSH from the desktop app.
- **Server.** `apps/server/src/cli/server.ts` has `start` and `serve` commands; `apps/server/src/cli/config.ts` defines `--port`, `--host`, `--base-dir`. `apps/server/package.json` version is `0.1.5`. Whether the server reports its version in a form a script can read and compare, and how that relates to the repository ref built, is unknown (epic U-3).
- **Toolchain definition.** `.devcontainer/Dockerfile`, `.devcontainer/on-create.sh` and `docs/operations/development.md` define what this repo's own container has. The Playwright and Claude Code parts are for developing Probe and are not part of building the server (epic Notes for stories).
- **Native parts and secret storage.** The build needs a compiler for the native terminal library; the keyring module is the non-essential part. Behavior when it is unavailable is unverified until PRB.T-029 (U-4).
- **Guide.** No user docs section for remote install exists; `docs/internals/remote.md` describes how a server gets onto a remote host (its content is unverified for this story).
- **Mobile.** Not touched.

## Expected Behavior

The script is one file run inside the target by the user. It works the same in a container and on a machine and never asks which it is. This story ships together with PRB.T-031: until the start, stop and pairing commands exist, the commands the script prints are placeholders and cannot be used.

- Checks first, changes nothing until all checks pass: not root (the message names a non-root user, and `docker exec -u` in a container); a shell, git, Node, the repo's package manager, build tools, a download tool, the process tools the launch logic needs, a writable home, a supported CPU and libc (Debian-family glibc, x64 and arm64), minimum Node and package-manager versions (U-7), and network reach to the repository and the package registry.
- Gets the source from the repository, builds on the target, proves the built server runs on the target (the proof outcome: the built server reports its version; PRB.T-029 may add more), and only then marks the install complete.
- Installs for the current user into one install folder, builds in a separate build folder, keeps the state folder separate, and does not touch agents' configuration.
- Prints at most 15 lines at the end: version, place, the commands to start, stop and get a pairing token (placeholders for port, bind and state folder), the log path, the elapsed time.
- A log file records the run; any failure prints its path and exits non-zero.

### User Flow

1. The user gets the script into a shell on the target as a non-root user (copied in, or the one-line `curl`).
2. The user runs it. It prints one line per phase: check, fetch, build, prove, switch.
3. It finishes with the version, install place, the next commands and the elapsed time. The user copies the printed commands (their working form is PRB.T-031).
4. The user runs it again with the same version and it says nothing changed.

### Edge Cases

- EC-1: Run again for the same version: nothing changes, the script says so, and finishes within the 5 s limit (epic NFR-1).
- EC-2: Run again after an interrupted run: the incomplete install is repaired and completed; no partial install is ever reported complete.
- EC-3: Two runs at once: one waits or yields, and the end state is one complete install.
- EC-4: The script is piped (`curl ... | sh`): it works and reads no input.
- EC-5: A target with several problems: all are listed together, each with the fix.
- EC-6: Secret storage unavailable: the install completes and the server's later start reports what is unavailable (FR-13).
- EC-7: Arm64 and x64: the same script builds for the target it runs on.

### Error Handling

- ER-1: Run as root: refused before any change, naming a non-root user and `docker exec -u`.
- ER-2: Any missing item of the contract (including unsupported CPU or libc, no write access to home): listed with the fix, nothing installed, non-zero exit.
- ER-3: No network to the repository or registry, or no credentials for the repository: named as such (the repository may be private; epic U-6, R-2), nothing installed.
- ER-4: The build fails, or the built server fails the proof: not marked complete, the previous complete install (if any) still works, the log path printed.
- ER-5: The script is killed at any phase (fetch, build, switch): either the previous complete install or none remains; a re-run completes it.

## Out Of Scope

- Start, stop, status and pairing commands working: PRB.T-031. The script prints them as placeholders.
- Upgrade (new version beside old), uninstall and their notes: PRB.T-032. Version-beside-version layout is decided there, but the install folder layout here must allow it (see Constraints).
- The image contract and topology guide as user documentation: PRB.T-034 (this story documents the script only in its own help and NFR-7 notes).
- Running it on topologies 2 and 3, a remote machine and arm64 from clean images: PRB.T-033. Here the script is exercised on the author's container and against a plain shell.
- Deciding whether the SSH connection code reuses the script's logic: decided in this story's plan (R-7, NFR-7). Changing the SSH install path itself is not in this epic.
- A release package (no toolchain on the target): PRB.T-035.
- Alpine and other distributions, macOS, Windows: Linux glibc Debian-family only (Q-2, A-5).
- Installing agent CLIs or repo toolchains: the user's environment.

## Technical Scope

- **Layers:** an install script and its checks in the repository; the build of the server and the proof; possibly shared logic with `packages/ssh` (decided in plan); tests that run the script against a plain shell with failing fixtures. No change to the wire contract.
- **Docs impact:** `docs/internals/remote.md` where it says how a server gets onto a remote host; the user docs section "Install Probe on a remote machine or devcontainer" starts here and is completed by PRB.T-034; `docs/operations/development.md` if the toolchain definition is shared.
- **Mobile impact:** none; nothing crosses the wire contract.

## Non-functional Requirements and Constraints

- Epic NFR-3: runs as the user, never uses root, writes only the install folder, build folder, state folder and package manager cache (or redirects it into the build folder); never touches `~/.claude` or other agent configuration. The one-line `curl` uses HTTPS.
- Epic NFR-2: kill at each phase leaves the previous complete install or none; a failed upgrade-style rebuild leaves the old version runnable. The install folder layout must allow a second version beside the first; PRB.T-032 verifies that it does.
- Epic NFR-5: final output at most 15 lines, plain text, each command on its own line; every error names cause and fix; no input unless asked; works piped.
- Epic NFR-6: a log file, one line per phase, exit code 0 only when the install is complete.
- Epic NFR-1: the script prints elapsed time; the cold limit is set by the author after PRB.T-029; re-run of the same version at most 5 s; no continuously running work.
- Epic NFR-4: Debian-family glibc on x64 and arm64, including the Ubuntu 24.04 base of this repo's devcontainer.
- Outcome: the checks that run before Node is known to exist work in any POSIX `sh` (unverified requirement; the plan decides the form).
- Do not duplicate the SSH install logic; replace or share it (epic NFR-7).
- Container safety, egress and credentials are not the script's concern.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a suitable non-root target, when the user runs the script, then it builds, proves the server runs, marks the install complete and exits 0 | manual (author, container) | FR-1, FR-4 |
| AC-2 | Given the same target on x64 and on arm64, when the script runs with no architecture option, then it builds for the target's architecture | manual (author; arm64 in PRB.T-033) | FR-2, EC-7 |
| AC-3 | Given a run as root, when the script starts, then it refuses before any change, names a non-root user and `docker exec -u`, and exits non-zero | auto (script test) | FR-3, ER-1 |
| AC-4 | Given a table of targets each missing one contract item (shell, git, Node, package manager, build tools, download tool, process tools, writable home, unsupported CPU or libc, too-old Node or package manager), when the script runs on each, then it names the item and the fix, installs nothing and exits non-zero | auto (script test, items that can be faked) | FR-3, ER-2 |
| AC-5 | Given a target with several missing items, when the script runs, then all are listed in one run | auto | FR-3, EC-5 |
| AC-6 | Given no network to the repository or registry, or no credentials to a private repository, when the script runs, then the cause and fix are named and nothing is installed | manual (author) | FR-3, ER-3 |
| AC-7 | Given a build that fails or a built server that fails the proof, when the script runs, then the install is not marked complete, the log path is printed, the exit code is non-zero, and a previous complete install still runs | auto (failing fixture) | FR-4, ER-4, NFR-2 |
| AC-8 | Given a completed install of the same version, when the script runs again, then nothing changes and it says so | auto | FR-5, EC-1 |
| AC-9 | Given the script killed in each of fetch, build and switch, when it is run again, then the end state is one complete install and the earlier state was the previous complete install or none | auto | FR-5, EC-2, ER-5, NFR-2 |
| AC-10 | Given two runs started at once, when both end, then there is exactly one complete install and no corruption | auto | FR-5, EC-3, NFR-2 |
| AC-11 | Given the secret storage module cannot work on the target, when the script runs, then the install completes and the built server, run directly, reports the missing keyring (the start-time check is PRB.T-031 AC-12) | manual (author) | FR-13, EC-6 |
| AC-12 | Given a completed run, when the final output is read, then it is at most 15 lines of plain text, with the version, place, the start, stop and pairing commands as placeholders each on its own line, the log path and the elapsed time | manual (author) | FR-8, NFR-5, NFR-6, NFR-1 |
| AC-13 | Given the script piped from `curl` and copied in as a file, when each is run, then both work and neither asks for input | manual (author) | FR-1, EC-4, NFR-5 |
| AC-14 | Given a run on any target, when the file system is compared before and after, then writes are only in the install folder, build folder, state folder and package cache, and not in agent configuration | manual (code review of the script and a diff of home) | NFR-3 |
| AC-15 | Given the Ubuntu 24.04 container of this repo's devcontainer on x64, when the script runs, then the cold time and disk used are printed and recorded in the ticket | manual (author) | NFR-1, NFR-4 |
| AC-16 | Given the change, when the PR description is read, then it records the decision whether the SSH code shares the script's logic (R-7, NFR-7) | manual (PR description) | NFR-7 |
| AC-17 | Given a completed run on the Ubuntu 24.04 container, when the install is repeated for the same version, then it finishes within 5 s | manual (author, timed) | NFR-1, EC-1 |
| AC-18 | Given the change, when the docs diff is read, then `docs/internals/remote.md` no longer describes a path that the script replaces | manual (docs diff reviewed in the PR) | NFR-7 |
| AC-19 | Given a failure at a point where the script cannot be faked in a test (for example a missing compiler on a real target), when the script runs there, then it names the item and the fix, installs nothing and exits non-zero | manual (author) | FR-3, ER-2 |
| AC-20 | Given the install, when the folders it created are listed, then the install folder, build folder and state folder are separate folders, and the install folder is named for the version so a second version can sit beside it | manual (author) | NFR-2, NFR-3 |

## Dependencies

Depends on: PRB.T-029 (spike), because the contract, the build steps, the minimum versions and the proof are settled by what the spike found. No dependency on PRB.E-002 (PRB.T-016 to PRB.T-020) or on PRB.E-003.

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-029 | Epic order "after 1": the by-hand build path, times, minimum versions, tools needed and credential behavior | done |

Blocks:

- PRB.T-031: prints placeholders here; the start command needs an installed server.
- PRB.T-032: re-run and upgrade extend this script; they need the install layout and idempotency.
- PRB.T-033 and PRB.T-034: verification runs and the guide use this script.
- PRB.E-003 story PRB.T-028 and the real remote checks: need a server installed this way (via PRB.T-031).

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The script can build the server in the target with the toolchain the contract names (epic A-1) | assumption | verified on Ubuntu 24.04 arm64 by hand (PRB.T-029); x64 in PRB.T-033 | AC-1 | author |
| SA-2 | The SSH install logic (lock, atomic move, proving) can run in plain `sh` in the target (epic A-3) | assumption | verified for the lock, staging, marker and move under dash and busybox (PRB.T-029); a `--version` proof is not enough (Alpine) | AC-7 | author |
| SA-3 | Debian-family glibc images are enough (epic A-5) | assumption | verified: Alpine cannot load `node-pty` (PRB.T-029) | PRB.T-033 | author |
| SA-4 | Tests can run the script against a plain shell with faked missing tools without Docker (the dev container has no Docker socket) | assumption | unverified; the plan fakes tools with a restricted `PATH` and a fake `vp` | First script test | author |
| SU-1 | The minimum Node and package-manager versions the build needs (epic U-7) | unknown | narrowed: Node 22 builds with warnings, 24 and 26 clean; pnpm fixed by vp (PRB.T-029). Decided: Node 24 minimum | PRB.T-033 on x64 | author |
| SU-2 | How the target gets the source (clone at a ref or tarball) and whether it needs credentials; depends on the open repository visibility decision (epic U-6) | unknown | answered: public HTTPS clone, no credentials (PRB.T-029). Decided: `git clone` of a repository and ref the user can override | AC-6 | author |
| SU-3 | Whether `scripts/install.sh` is a model or unrelated to this script | unknown | answered: unrelated (it downloads upstream T3 releases); left unchanged, its marker and versions layout reused as a pattern | Plan, 2026-11-12 | author |
| SU-4 | Whether the server reports its own version in a form a script can read and how it maps to the ref built (epic U-3) | unknown | answered: `--version` prints the package version (`0.1.5`), which does not change per commit. Decided: the install is identified by the commit built | Plan, 2026-11-12 | author |
| SU-5 | Cold install time and disk limits (epic NFR-1) | unknown | proposed by PRB.T-029, adopted 2026-11-12 (user auto-approves recommended options): cold install 5 min on 2 CPUs, 6 GB free disk, 4 GB memory for the build | AC-15 | author |
| SU-6 | Whether the SSH code reuses the script (epic R-7) | unknown | decided 2026-11-12: no, see Plan decisions | AC-16 | author |

## Plan decisions

Made 2026-11-12 from the PRB.T-029 findings; the user auto-approves the recommended options.

- **One new file, `scripts/install-server.sh`**, POSIX `sh`. The inherited `scripts/install.sh`
  (upstream T3 release download) stays as it is.
- **Source:** `git clone --depth 1` of `PROBE_REPO` (default `https://github.com/killroy192/probe.git`)
  at `PROBE_REF` (default `main`). A local path works as `PROBE_REPO`, which covers a copied-in
  checkout and the tests. Only committed state is built.
- **Identity:** the commit built. `git ls-remote` resolves the ref to a commit during the check, so
  a re-run of an installed commit stops there (the 5 s limit) without cloning. The output shows the
  package version and the short commit.
- **Folders** (root `PROBE_INSTALL_DIR`, default `${XDG_DATA_HOME:-~/.local/share}/probe`):
  `build/<staging>` for the clone and build, `versions/<commit>/` for a complete install with an
  `.install-complete` marker, `current` a link swapped atomically, `logs/`. The build is moved into
  `versions/` only after the proof, on the same file system. The state folder is not touched.
- **Contract check**, all items collected before any write: not root (`id -u`); `git`, `node` 24 or
  newer, `vp`, `make`, `g++`, `python3`, `curl` or `wget`, `ps`, `mktemp`, `nohup`; a writable home;
  `x86_64` or `aarch64`; glibc; 6 GB free on the install root's file system; 4 GB memory; the
  repository reachable at the ref; the package registry reachable.
- **Build:** `CI=true vp i --frozen-lockfile`, then `vp run --filter t3 build`, in the staging folder.
- **Proof:** start the built server on a throwaway state folder, `127.0.0.1` and a free port, wait up
  to 30 s for `/.well-known/t3/environment`, then stop it (and any shell host) by captured PID.
  `--version` alone passes where `node-pty` cannot load (PRB.T-029 B-4).
- **Concurrency and kills:** a no-clobber lock file with the owner's PID (the `packages/ssh` pattern);
  a second run waits, then finds the install complete. Staging left by a killed run is removed by the
  next run that holds the lock.
- **Output:** one line per phase (check, fetch, build, prove, switch), a log under `logs/`, and a final
  block of at most 15 lines: version and commit, install folder, start, stop and pairing commands
  with placeholders, the log path and the elapsed time.
- **SSH code (R-7, AC-16):** not shared. `packages/ssh` downloads upstream release archives over SSH
  and the epic leaves that path unchanged; the overlap is the lock and marker, about 40 lines.
  Revisit with the release package (PRB.T-035).
- **Tests:** `scripts/install-server.test.ts`, Linux only, runs the script with a fixture repository,
  a fake `vp` whose build writes a tiny server, and a restricted `PATH` for missing tools.

## Verification notes

Merged 2026-11-12 (`774ec10a6`, `06b8d0588`, merge `c6ec20814`). `scripts/install-server.test.ts`:
19 tests pass (root, eleven contract rows incl. several problems at once, build and proof failure,
kills during fetch, build and switch, two runs at once); `check:changed` green.

Real run in the dev container (linux-arm64, 10 CPUs, 16 GB, pnpm store already warm), piped from
`sh`, `PROBE_REPO=/workspaces/probe PROBE_REF=main`, commit `d45c31b`:

- Cold install 99 s, exit 0, final block 8 lines; install folder 4.0 GB, `build/` removed.
- Re-run: "already installed; nothing changed", under 1 s (AC-8, AC-17).
- The moved install (`current/apps/server/dist/bin.mjs serve`) answered 200 in 1.7 s on a
  throwaway state folder; no process left behind.

Deviations from the plan (subagent, accepted): `PROBE_REF` is a branch or tag, not a bare commit;
a run for an already complete commit skips the disk, memory and registry checks; the memory floor is
3,900,000 kB so a 4 GB machine passes. `docs/internals/remote.md` needed no change (AC-18): it covers
only the desktop SSH path, which stays.

Handoff: still manual — AC-2 and AC-15 on x64 (PRB.T-033), AC-6 (no network), AC-11, AC-13 (a real
`curl` once `main` is pushed: GitHub `main` lags this checkout), AC-14 (home diff), AC-19 (missing
compiler on a real image), AC-16 (the SSH decision, recorded under Plan decisions). The printed
start, stop and pairing commands become real in PRB.T-031.
