---
id: PRB.T-034
type: story
parent: PRB.E-004
phase: 2
labels: [remote, verify]
created: 2026-11-09
updated: 2026-11-12
---

# Image contract and topology guide

## Business Goal

**Problem:** The install script (PRB.T-030 to PRB.T-032) refuses targets that lack something, and the three container setups differ in what to mount and what is shared with the host, but none of this is written down for a user. A user who does not know the image contract finds out one failure at a time; a user who mounts a repo at a different path, or lets a host prune a worktree, or runs git hooks written in a container on the host, loses work with no warning.

**Proposed solution:** One user-facing section, "Install Probe on a remote machine or devcontainer", states the image contract, then a part for each of the three topologies (what to mount, what the user sets up, what is and is not shared with the host), the consequences the roadmap carries, and the day-to-day paths: start, pair, upgrade, uninstall. It is written from what the verification story actually saw, and the author follows it once on a clean image.

## Epic and Requirements

- **Epic:** PRB.E-004 Install Probe on a remote machine or devcontainer
- **Candidate story:** # 6 Image contract and topology guide
- **Delivers:**
  - FR-16: the guide states the image contract (including the build toolchain) and, for each of the three topologies, what to mount, what the user must set up, what is and is not shared with the host, that git hooks in a bind-mounted repo run on the host, and that a repo must be mounted at the same path as on the host because a worktree's `.git` file holds an absolute path.
  - FR-15: the guide says that worktrees in a repository the host can also see must be locked against a host `git worktree prune`, and how. Nothing is implemented.
  - NFR-7: the user docs gain the section (the three topologies, the contract, start, pair, upgrade, uninstall); `docs/internals/remote.md` is updated where it describes how a server gets onto a remote host.
- **One deployable outcome:** A user reads one page and can prepare an image or machine, choose what to mount, run the script and get connected, knowing the consequences for their repos; this is how the epic's KPI is repeatable by someone other than the author.

## Current Behavior

Verified by listing and reading the docs on 2026-11-09 (the code search index was unavailable); the script is not built, so the guide cannot yet be written from behaviour.

- `docs/user/` has no page for installing a server on a remote target. `docs/user/remote-access.md` describes serving with `t3 serve`, pairing links, Tailscale and the desktop-managed SSH install (section "Desktop-managed SSH"), all inherited from T3 Code. Its text is not read in full for this story; whether it still matches Probe is unverified.
- `docs/internals/remote.md` (line 162 on) says SSH can launch a server as well as forward a port, with desktop main owning that lifecycle, and refers to `packages/ssh/src/tunnel.ts` for cleanup. Whether it should also describe an in-target install is the NFR-7 update.
- `docs/internals/devcontainer.md` and `docs/operations/development.md#dev-container` describe this repository's own development container (Ubuntu 24.04, Node 26, pnpm, Rust, `vp`, Claude Code, the checkout and shared `.git` mounted, no Docker socket). They are for maintainers and are the definition of the toolchain the contract names; the Playwright and Claude Code parts are not needed to build the server.
- `.devcontainer/worktree.sh` creates relative worktrees and locks them (epic Notes for stories); it is the model for the locking text. Not re-read here.
- The image contract, the topologies' consequences and the same-path rule are today only in the epic and `docs/dev/roadmap.md`, which are planning documents and not user docs.

## Expected Behavior

A new user-docs section, in the shipped product's voice and without contributor tooling, covers:

- **Image contract:** what a target must have to build Probe (shell, git, Node and the package manager at the minimum versions PRB.T-029 found, build tools, a download tool, the process tools the launch logic needs, a writable home, a supported CPU and libc, a non-root user, network reach to the repository and the package registry), matching the script's checks one to one, and that Debian-family glibc images on x64 and arm64 are supported and Alpine is not.
- **Getting the script onto the target:** by file copy or the one-line `curl`, run as a non-root user (`docker exec -u` in a container; plain `docker exec` is root and the script refuses).
- **Topology 1, 2, 3:** what to mount; what the user sets up (git credentials or a code-host CLI where needed; agent CLIs and their logins); what is and is not shared with the host; where the state folder lives.
- **Consequences:** worktrees visible to the host must be locked against a host `git worktree prune`, and how; git hooks in a bind-mounted repo run on the host; a repo must be mounted at the same path as on the host.
- **Day-to-day:** start (explicit port, bind address and state folder, and why a published port needs a non-loopback bind), pairing token, stop, status, re-run, upgrade (restart needed, shells keep running) and uninstall (data kept unless asked).
- **Internals:** `docs/internals/remote.md` states where an in-target install exists beside the SSH path and which logic they share, replacing text that is no longer true rather than adding to it.

### User Flow

1. The user opens the section and checks their image against the contract.
2. The user picks the topology that matches their container configuration and sets up the mounts and credentials the guide names.
3. The user gets the script onto the target and runs it as a non-root user.
4. The user starts the server with the printed command, publishes or forwards the port, gets a pairing token and connects.
5. Later the user re-runs, upgrades or uninstalls from the same section.

### Edge Cases

- EC-1: A user on an unsupported image (Alpine, root only, no git): the contract and the script's messages name the same items and fixes.
- EC-2: A user who mounts a repo at another path than on the host: the guide says why git then breaks on one side.
- EC-3: A user who runs a host server on the same state folder as a container server: the guide says what PRB.T-029 found (A-9) about sharing the folder.
- EC-4: The repository is private (epic U-6): the guide's delivery text matches what is true when it ships (file copy only, or the `curl` too).

### Error Handling

- ER-1: A contract item in the guide that the script does not check, or the reverse: a defect to fix in the guide or recorded as a finding for the script.
- ER-2: A guide step the author cannot follow on a clean image: the step is rewritten from what was seen and followed again.

## Out Of Scope

- Implementing worktree locking, a hook sandbox or any mitigation: the guide states consequences only (epic Q-3, FR-15).
- Container safety, egress, credentials and isolation advice beyond what each topology needs: the container configuration's business.
- Starting or choosing containers and images, and the Docker or devcontainer commands themselves: a later helper epic.
- Installing and logging in agent CLIs: the user's environment.
- Maintainer docs for this repository's devcontainer: unchanged except where they quote contract items.
- The Linux release package page: PRB.T-035.
- The connect UI guide (PRB.E-003); this page links to it when it exists.

## Technical Scope

- **Layers:** documentation only.
- **Docs impact:** a new section in `docs/user/` (a page or a section of an existing page, chosen in the plan; `docs/user/remote-access.md` is the nearest existing page) and an update of `docs/internals/remote.md`. Any inherited T3 text that contradicts it (for example, if `remote-access.md` implies the only remote install is the desktop SSH one) is rewritten, not appended to. `docs/operations/development.md` is changed only if it duplicates the contract.
- **Mobile impact:** none.

## Non-functional Requirements and Constraints

- Docs rules from `AGENTS.md`: user docs describe what exists, in the shipped product's voice, without implementation details or contributor tooling; internals only record what a maintainer would get wrong without them.
- The guide is written only after PRB.T-033, from what was seen; an outline may start after PRB.T-029.
- The contract in the guide and the script's checks list the same items (epic FR-3 and FR-16).
- No secrets, tokens or real hostnames in examples.
- Commands in the guide are copy-ready and match the script's printed output exactly.

## Acceptance Criteria

| ID | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given the guide, when read against the script's contract checks, then every item appears in both with the same fix and no item appears in only one | manual (reviewer) | FR-16, EC-1, ER-1 |
| AC-2 | Given the guide, when read, then it has a part for each of the three topologies saying what to mount, what the user sets up, what is and is not shared with the host | manual (reviewer) | FR-16 |
| AC-3 | Given the guide, when read, then it states that git hooks in a bind-mounted repo run on the host and that a repo must be mounted at the same path as on the host, with the reason | manual (reviewer) | FR-16, EC-2 |
| AC-4 | Given the guide, when read, then it says worktrees visible to the host must be locked against a host `git worktree prune` and how, and that Probe does not do it | manual (reviewer) | FR-15 |
| AC-5 | Given the guide, when read, then it states what the recorded PRB.T-029 outcome found about a host server and a container server on the same state folder, and that outcome is cited (a guide that states a finding PRB.T-029 did not record fails) | manual (reviewer) | EC-3 |
| AC-6 | Given the guide, when read, then it covers start with explicit port, bind address and state folder, the pairing token, stop, status, re-run, upgrade and uninstall, with each command matching the script's printed output | manual (reviewer) | NFR-7 |
| AC-7 | Given a clean image, when the author follows the guide only (including a same-path repo mount), then they reach a server that answers a pairing request; steps that failed are rewritten | manual (author) | FR-16, ER-2 |
| AC-8 | Given the delivery text, when the repository's visibility is known, then the guide says copy only or `curl` accordingly, matching the delivery outcome recorded in PRB.T-033 AC-6 (the `curl` run done or recorded "not run") | manual (reviewer) | EC-4 |
| AC-9 | Given `docs/internals/remote.md`, when read after the change, then it describes how a server gets onto a remote host without contradicting the new section and without an appended duplicate account | manual (reviewer) | NFR-7 |
| AC-10 | Given the docs diff, when `vp run check:changed` runs, then format and link checks pass | auto | NFR-7 |

## Dependencies

Depends on:

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-033 | The guide is written from what was seen in the five runs (epic order: after 5) | backlog |
| PRB.T-029 | Contract versions, findings on sharing, hooks, same-path and prune; an outline can start after it | backlog |
| PRB.T-030 | The contract checks and printed commands the guide must match | backlog |
| PRB.T-031 | Start, stop, status and pairing commands the guide quotes | backlog |
| PRB.T-032 | Upgrade, re-run and uninstall behaviour the guide describes | backlog |

Blocks:

| Blocks | Why | Status |
| ------ | --- | ------ |
| Closing PRB.E-004 | The epic's Done when requires the guides in the user docs and followed once on a clean image | backlog |
| PRB.T-035 | The later release package updates this guide (epic order: after 6) | backlog |

Cross-epic: it does not depend on PRB.E-002 stories (PRB.T-016 to PRB.T-020) or on PRB.T-028; it links to the PRB.E-003 connect flow guide when that exists (PRB.T-023).

## Assumptions

| ID | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 | `docs/user/remote-access.md` can take or point to the new section without a rewrite of inherited T3 text | assumption | unverified | Read the page in the plan | author |
| SA-2 | The consequences (hooks, same-path, prune) behave as the roadmap says | assumption | unverified | PRB.T-029 shows the failures once (epic R-9) | author |
| SU-1 | Where the section lives (new page or existing) | unknown | unverified | Decided in the plan | author |
| SU-2 | Whether the repository is public when the guide ships (epic U-6), deciding the `curl` text | unknown | unverified | Open decision in `docs/dev/questions.md` | user |
| SU-3 | Whether git credentials or a code-host CLI are needed in topologies 1 and 2 (epic A-10) | unknown | unverified | PRB.T-029 and PRB.T-033 record what each container needed | author |
