---
id: PRB.T-035
type: story
parent: PRB.E-004
phase: 2
labels: [remote]
created: 2026-11-09
updated: 2026-11-09
---

# Later: Linux release package

## Business Goal

**Problem:** The install script builds Probe inside the target, so every target needs the build toolchain, a reachable repository and registry, and the time and memory a build takes (epic R-1). Small machines and minimal images cannot install Probe, and every install repeats the same build. This story is deferred: build-in-target was settled by the user on 2026-11-09 as enough for now.

**Proposed solution:** Publish, for each Probe version, a Linux server package for x64 and arm64 with checksums at one address, so a target needs no toolchain and the script can install it instead of building. A later SSH install story may use the same package. Everything below is a placeholder until the story is scheduled; it is not part of the epic's Done when.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 7 Later, deferred: Linux release package
- **Delivers:** none of the epic's FR or NFR. The epic marks it as not part of its Done when. It would relax the image contract (FR-3, FR-16) and shorten the cold install (NFR-1) once scheduled, and needs the epic's Q-1 settled first. Requirement rows for it: TBD (author, at scheduling).
- **One deployable outcome:** A user on a target with no build toolchain installs a published Linux package of the current version with the same script and the same output, and reaches a server that pairs. Deferred; not shipped with this epic.

## Current Behavior

Unverified in code for this story; read from the epic and docs only.

- The script of this epic builds from the repository inside the target (epic, settled 2026-11-09). No Linux server package of Probe is published.
- The release workflow described in `docs/operations/release.md` (`.github/workflows/release.yml`) is the inherited T3 desktop and CLI release; whether it can or should produce a Probe Linux server package is unverified.
- The existing SSH install code in `packages/ssh/src/tunnel.ts` downloads upstream T3 releases and unpacks them; this epic leaves it unchanged (epic Out and Notes for stories).
- No arm64 build machine for Probe is known (epic Q-1: who builds the arm64 one is open).

## Expected Behavior

When scheduled: each released version has a Linux x64 package and a Linux arm64 package with checksums at one stable address; the install script can use the package when the target has no toolchain (and falls back to, or is told, otherwise), verifies the checksum, installs it with the same layout, start, stop, status, pairing, upgrade and uninstall as a built install, and prints the same output. The image contract then lists the toolchain as needed only for the build path. Detail: TBD (author, at scheduling).

### User Flow

1. TBD (author, at scheduling). Expected shape: the user runs the same script on a bare target; it fetches the package for the target's architecture, verifies it and reaches the same final output as a built install.

### Edge Cases

- EC-1: The package for the target's architecture or libc does not exist: the script says so and names the build-in-target path as the alternative.
- EC-2: The checksum does not match: nothing is installed. Others: TBD (author, at scheduling).

### Error Handling

- ER-1: The package address is unreachable: the script says what failed and the fix, and leaves nothing half-installed, as for the built path.
- ER-2: A failed upgrade leaves the old version runnable, as in epic NFR-2. Others: TBD (author, at scheduling).

## Out Of Scope

- Everything in this story for the current epic: it is deferred and does not block closing PRB.E-004.
- Changing the SSH connection code: a later SSH story may use the package; not this one.
- macOS and Windows packages, Alpine (musl) packages: out as in the epic.
- Starting containers or choosing images: a later helper epic.
- Choosing the hosting place and the arm64 build machine: a decision (epic Q-1), not part of the build work.
- An automatic updater for installed targets: a later epic.

## Technical Scope

- **Layers:** release pipeline (build and publish x64 and arm64 server packages with checksums), the install script (a package path beside the build path), the image contract text, and docs. Names areas only; design is TBD (author, at scheduling).
- **Docs impact:** the guide of PRB.T-034 (the contract and delivery text), `docs/operations/release.md` (how the package is built and published), `docs/internals/remote.md`.
- **Mobile impact:** none expected; no contract change.

## Non-functional Requirements and Constraints

- Epic NFR-2, NFR-3, NFR-5 and NFR-6 apply unchanged to the package path (atomic install, no root, one command, logs and exit codes).
- Packages need checksums, and the script verifies them; signing is TBD (author, at scheduling).
- Debian-family glibc images on x64 and arm64 stay the supported set unless widened by decision.
- Reproducibility and the hosting address are constraints that wait on epic Q-1.
- No work starts before Q-1 is settled and a person schedules this story.

## Acceptance Criteria

Placeholders to be refined when scheduled; each is independently checkable but requirements to cover are TBD (author, at scheduling).

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given a released version, when the package address is read, then a x64 and an arm64 Linux package with checksums are present for it | manual (author) | EC-1 |
| AC-2 | Given a bare Debian-family target with no build toolchain, when the script runs, then it installs from the package and prints the same final output as a built install | manual (author) | epic FR-1, FR-8 (to be confirmed) |
| AC-3 | Given a corrupted package, when the script runs, then it refuses, installs nothing and says why | auto (script test) | EC-2 |
| AC-4 | Given an unreachable package address, when the script runs, then it fails with the cause and the fix and nothing is half-installed | auto (script test) | ER-1 |
| AC-5 | Given a package install, when the server is upgraded to a newer package, then the old version stays runnable on failure and shells keep running across the restart | manual (author) | ER-2, epic FR-6 |
| AC-6 | Given the guide, when read, then the contract names the toolchain as needed only for the build path | manual (reviewer) | epic FR-16 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-034 | Epic order: after 6; the guide it updates must exist | backlog |
| PRB.T-030 | The script the package path extends | backlog |
| PRB.T-032 | Upgrade and uninstall must work for a package install the same way | backlog |
| Epic Q-1 | Where packages are hosted and who builds arm64 must be settled first | open |

Blocks: nothing in this epic or in PRB.E-003; PRB.E-004 closes without it. It would be used by the later SSH install story (not yet written) and could shorten the helper epic that starts containers. No dependency on PRB.T-016 to PRB.T-028.

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | The server runs from a package built elsewhere on a glibc Debian-family target without the toolchain (the native terminal parts are prebuilt) | assumption | unverified | Spike when scheduled | author |
| SA-2 | The existing release pipeline can be extended or paralleled for Linux server packages | assumption | unverified | Read `docs/operations/release.md` at scheduling | author |
| SU-1 | Where packages are hosted, and who builds arm64 (epic Q-1) | unknown | unverified | TBD (user, 2026-11-15) | user |
| SU-2 | Whether the repository will be public by then, affecting hosting (open visibility decision in `docs/dev/questions.md`) | unknown | unverified | Decision pending | user |
| SU-3 | Package signing and the retention of old versions | unknown | unverified | TBD (author, at scheduling) | author |
