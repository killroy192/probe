---
id: PRB.T-032
type: story
parent: PRB.E-004
phase: 2
labels: [remote, verify]
created: 2026-11-09
updated: 2026-11-12
---

# Upgrade, re-run and uninstall

## Business Goal

**Problem:** An install without a way back or forward is a one-way door. A user cannot tell whether running the script again is safe, a newer version must not break shells that are running, and removing Probe from a target must not delete their workspaces and data.

**Proposed solution:** Running the script again for the same version changes nothing and says so. Running a newer script installs the new version beside the old one and tells the user the server must be restarted to use it; shells that were running keep running. An uninstall removes what the script installed, says what it kept, and deletes the state folder only if the user explicitly asks.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 4 Upgrade, re-run and uninstall
- **Delivers:**
  - FR-5 (re-run half beyond PRB.T-030): re-run for the same version changes nothing and says so, tested with a server running.
  - FR-6: the installed version is exact and visible; a newer version installs beside the old; the restart note; shells survive the restart.
  - FR-7: uninstall removes what the script installed, tells what it kept, keeps the state folder unless explicitly asked, and refuses while a server is still running unless the user stops it first or confirms.
  - NFR-2 (upgrade half): a failed upgrade leaves the old version runnable.
  - NFR-6 (version visible in status after upgrade).
  - Scenario E4-S4.
- **One deployable outcome:** A user can run the script again, upgrade to a newer version without losing their running shells, and uninstall without losing their data. This closes the reverse states of the install.

## Current Behavior

Verified by reading on 2026-11-09 (the code search index was unavailable).

- **SSH install code.** `packages/ssh/src/tunnel.ts` keeps versioned runtime folders and an `.install-complete` marker holding the version, and checks the marker before reuse (around lines 444 to 515). It has no uninstall. Use of this layout inside a target is unverified (epic A-3).
- **Installed-service update path.** `docs/internals/server-updates.md` describes the service launcher update path for installed services. `apps/server/src/cli/update.ts`, `service.ts` and `uninstall.ts` exist. Whether the target reuses them or has a simpler replace-and-restart is a decision of this story (epic Notes for stories); their behavior is unverified for this story.
- **Shell host.** A detached process per state folder owns the PTYs, so shells run while the server is stopped and the next server reattaches (`docs/internals/terminal-runtime.md`; `apps/server/src/terminal/shellHost/`). Whether a newer server can reattach to a shell host started by an older one is unverified (epic A-4).
- **Database.** The server migrates its database on start; whether a newer server migrates data an older one wrote, and whether the old one then breaks, is unverified (epic A-4, R-6).
- **PRB.T-030 and PRB.T-031.** Not built yet; this story extends their script and commands.
- **Mobile.** Not touched.

## Expected Behavior

- **Re-run, same version:** nothing changes; the output says the version is already installed; it finishes within 5 s.
- **Upgrade:** running a newer script builds and proves the new version, installs it beside the old one, and says that the server must be restarted to use it. A running server is not stopped by the script. After the user restarts with the start command, shells that were running before keep running and reattach. Status (or the script output) lists the installed versions and shows the version that runs. Old versions stay installed; the user sees which exist.
- **Failed upgrade:** the old version stays installed and runnable.
- **Uninstall:** removes the installed versions, the links of the commands the script made available and the build folder the script made; says what it kept. With a server running it refuses and tells the user to stop it first (or to confirm), and removes nothing until then. The state folder (workspaces, shell data, the database) is kept unless the user passes an explicit option to remove it too.

### User Flow

1. The user runs the script again with the same version: "already installed", nothing changed.
2. The user later runs a newer script. It prints the new version installed beside the old one and that a restart is needed.
3. The user runs stop, then start; the new version runs. Shells that were open before are still there and still run.
4. The user runs the uninstall. It lists what it removed and what it kept (the state folder) and has refused first if a server was running.
5. To remove data too, the user runs the uninstall with the explicit option.

### Edge Cases

- EC-1: Re-run while a server is running: nothing changes, the server keeps running.
- EC-2: Upgrade while a server is running: the script does not stop it and says so.
- EC-3: Upgrade then no restart: the old version keeps running; status shows installed and running versions differ.
- EC-4: Uninstall while a server is running: it refuses, says the server is still running and to stop it first (or confirm), and removes nothing.
- EC-5: Uninstall twice: the second says nothing is installed.
- EC-6: Uninstall with the data option: the state folder is removed only after the user's explicit option; a mounted state folder (topology 1) is a host folder and the output says so before removal.
- EC-7: Old version remains beside the new: old versions stay and the user can see which exist; the script never removes them (only uninstall does).

### Error Handling

- ER-1: The upgrade build or proof fails: the old version is untouched and runnable, the log path is printed, exit code non-zero.
- ER-2: The script is killed mid-upgrade (build or switch): either the old complete install or the new complete install remains; a re-run completes it (epic NFR-2).
- ER-3: A newer server cannot read data written by an older one, or the reverse: the failure is reported with what to do; no silent corruption (epic A-4, R-6).
- ER-4: Uninstall cannot remove something: names it and the fix, and exits non-zero.

## Out Of Scope

- Start, stop, status and pairing token: PRB.T-031 (used here, not changed).
- Install checks and first install: PRB.T-030.
- Automatic updates or an update channel; the installed-service update flow in `docs/internals/server-updates.md` unless the plan reuses it.
- Removing old versions automatically: old versions stay beside the new one.
- Rollback to an older version after a data migration (R-6): this story reports a problem; a migration policy change is not made here.
- Verification on all topologies and arm64: PRB.T-033.
- User guide pages: PRB.T-034 (this story keeps the section started in PRB.T-030 accurate).
- Windows, macOS and Alpine targets.

## Technical Scope

- **Layers:** the install script's re-run and upgrade paths, the install folder layout with versions beside each other, the uninstall command, and the version report by the server and status; tests that run against a plain shell and one with a running shell host. Possibly the server's migration and shell-host compatibility rules (read, not necessarily changed). No wire contract change.
- **Docs impact:** the user docs section started in PRB.T-030 (upgrade, uninstall, what is kept); `docs/internals/remote.md`; `docs/internals/server-updates.md` if the plan reuses or contrasts it.
- **Mobile impact:** none.

## Non-functional Requirements and Constraints

- Epic NFR-2: killing at fetch, build or switch leaves the previous or the new complete install; a failed upgrade leaves the old version runnable; two runs at once end with one complete install.
- Epic NFR-3: only the install, build and state folders and the package cache are written; agent configuration is never touched; uninstall never deletes the state folder without an explicit option and never removes under a running server.
- Epic NFR-1: re-run of the same version at most 5 s.
- Epic NFR-5 and NFR-6: output at most 15 lines; each error names cause and fix; a log path on failure.
- Never kill by pattern (`AGENTS.md`); any stop uses the recorded PID.
- Shells outlive the server (roadmap); an upgrade must preserve that.
- Container and machine are treated identically (FR-10).

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a complete install of the same version, when the script runs again, then nothing changes and the output says so | auto (files unchanged) | FR-5 |
| AC-2 | Given a running server, when the script is run again for the same version, then the server keeps running and nothing changes | auto | FR-5, EC-1 |
| AC-3 | Given a newer version, when the script runs, then the new version is installed beside the old one, the output says the server must be restarted, and a running server is not stopped | auto | FR-6, EC-2 |
| AC-4 | Given the upgrade without a restart, when status runs, then the running and installed versions are shown and differ | auto | FR-6, EC-3 |
| AC-5 | Given a shell running before the upgrade, when the user stops and starts the server, then the shell is still there and takes input | manual (author) | FR-6 |
| AC-6 | Given an upgrade whose build or proof fails, when the script ends, then the old version is untouched and runnable, the log path is printed, exit code non-zero | auto (failing fixture) | NFR-2, ER-1 |
| AC-7 | Given the script killed at build and at switch during an upgrade, when it is run again, then the end state is one complete install and before the re-run the old complete install ran | auto | NFR-2, ER-2 |
| AC-8 | Given an install, when the user runs the uninstall, then everything the script installed (versions, command links, build folder) is gone, the output lists what was removed and what was kept, and the state folder is untouched | auto (file listing) | FR-7 |
| AC-9 | Given a running server, when the user runs the uninstall without stopping it, then it refuses, the output says a server is still running and to stop it first, and nothing is removed | auto | FR-7, EC-4 |
| AC-10 | Given the uninstall with the explicit data option, when it runs, then the state folder is removed, and without the option nothing in it is removed | auto | FR-7, EC-6 |
| AC-11 | Given nothing installed, when the uninstall runs, then it says so | auto | EC-5 |
| AC-12 | Given a new version whose database migration an older version cannot read, when the user starts the older version, then the failure is reported with what to do and no data is silently lost: the state folder contents before and after the failed start are identical (A-4, R-6) | manual (author) | ER-3 |
| AC-13 | Given a removal that cannot complete, when the uninstall runs, then it names what and the fix and exits non-zero | auto | ER-4 |
| AC-14 | Given the docs, when read, then upgrade, uninstall and what is kept are described accurately and the choice between reusing the installed-service update path and replace-and-restart is recorded | manual (docs diff reviewed in the PR) | NFR-7 |
| AC-15 | Given a complete install of the same version, when the script runs again, then it finishes within 5 s | manual (time) | NFR-1 |
| AC-16 | Given a mounted state folder (topology 1) and the uninstall with the explicit data option, when it runs, then the output says the folder is a host folder before removing it | manual (mounted) | EC-6 |
| AC-17 | Given an upgrade, when status runs, then the installed versions (old and new) are listed | auto | FR-6, EC-7 |

## Dependencies

Depends on: PRB.T-031 (a running server to test upgrade; the start, stop and status commands), through it PRB.T-030 (the install and its layout) and PRB.T-029 (findings on shell-host and database compatibility). No dependency on PRB.E-002 (PRB.T-016 to PRB.T-020) or on PRB.E-003.

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-031 | Epic order "after 3": upgrade is tested with a running server and a running shell | backlog |
| PRB.T-030 | The install and layout this story extends | backlog |

Blocks:

- PRB.T-033: verification runs include re-run, upgrade and uninstall.
- PRB.T-034: the guide describes upgrade and uninstall.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | Installing a newer server beside an older one over the same state folder is safe: the database migrates and the shell host stays compatible across versions (epic A-4) | assumption | unverified | Plan: read the migration and shell-host protocol policy; AC-5, AC-12 | author |
| SA-2 | Shells outlive a server stop and reattach on the next start of a different version | assumption | unverified | AC-5 | author |
| SA-3 | The `.install-complete` marker and versioned folders of the SSH code can be the layout here (epic A-3) | assumption | unverified | Plan; PRB.T-029 | author |
| SU-1 | Whether the installed target reuses the service launcher update path (`docs/internals/server-updates.md`) or has a simpler replace-and-restart | unknown | unverified | Plan stage (epic Notes for stories) | author |
| SU-2 | Old versions stay beside the new one and only uninstall removes them | assumption | unverified | AC-17, AC-8 | author |
| SU-3 | How the version relates to the repository ref the script builds (epic U-3) so that "same version" is decidable | unknown | unverified | PRB.T-030 plan | author |

## Plan decisions

Made 2026-11-12; the user auto-approves the recommended options. PRB.T-030 already gives re-run
("nothing changed"), versions side by side, a failed build leaving the old version current, and
kill-safety at each phase; this story adds what is missing and tests the upgrade cases.

- **Upgrade note:** when the switch replaces an earlier `current`, the install script prints that a
  running server keeps the old version until it is stopped and started again. It never stops a
  server and cannot know which state folders are in use, so the note is unconditional.
- **Status:** shows the build the running server was started from (the launch record) beside the
  installed `current`, says when they differ, and lists the installed versions.
- **Replace-and-restart, not the service update path** (`docs/internals/server-updates.md`): the
  installed target has no service manager and the user restarts with the printed command.
- **Uninstall is `probe-server uninstall [--remove-data] [--base-dir <state folder>]`.** It refuses,
  removing nothing, while any server process runs from this install root (found by reading
  `/proc/*/cmdline` for `<root>/versions/`, read-only, never to kill). A shell host left running
  is not a reason to refuse: its shells keep running until they end, and the output says so. It
  removes `versions/`, `build/`, `logs/`, `current` and the `probe-server` link, then the root if
  empty, and lists what it removed and kept. `--remove-data` also removes the state folder (default
  `~/.probe`), refusing while that folder's shell host is alive; if the folder is a mount point it
  says it may be a host folder before removing it. A second uninstall says nothing is installed.
- **Migration (AC-12):** read the server's migration rules and record what an older server does with
  a newer database; no policy change here.

## Verification notes

- **AC-12 (read, 2026-11-12):** an older `serve` does not refuse a database a newer build migrated:
  `runMigrations` (`apps/server/src/persistence/Migrations.ts`) skips ids up to the highest recorded,
  logs "Database migration history diverges from this build" for the unknown ones and runs on the
  newer schema; nothing is rolled back, but the old build may fail on or write against it. Only the
  service preflight (`apps/server/src/cloud/servicePreflight.ts`) refuses, and the target does not
  use it; so AC-12's "reported failure" is not met, and the guide says going back is unsupported.
- **AC-16:** mount detection was checked read-only against the container's bind mount
  `/workspaces/probe` (`state_mounted` and nested mounts reported); removing a mounted state folder
  was not run, since this container cannot mount a scratch folder.

Real run in the dev container, 2026-11-12 (merge `027756241`): a server started from build `8ef79f6`; the
branch build `c653457` installed in 66 s with the restart note and the server left running; status
listed the three versions, marked current and running, and said they differ; uninstall refused with
the stop command and removed nothing. After stop and start the new build ran. A same-commit re-run
took 80 ms (AC-15). `uninstall --remove-data` removed the versions, links, logs, the empty root and
the state folder; a second uninstall said nothing is installed. No process left behind. AC-5 (a
shell kept across the version switch) needs a client and stays for PRB.T-033.
