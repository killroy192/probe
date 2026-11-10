---
id: PRB.T-029
type: story
parent: PRB.E-004
phase: 2
labels: [remote, verify]
created: 2026-11-09
updated: 2026-11-10
---


## Goal

Find out, by building and running the server by hand in a stock Ubuntu container, what works, what breaks and what it costs, so PRB.T-030 to PRB.T-032 are planned on evidence. No product code changed.

## Delivered

- A written finding, [research/t-029-container-spike.md](../../research/t-029-container-spike.md) (run 2026-11-09 and 2026-11-10 by the author with an agent, macOS host with Docker Desktop, linux-arm64): the by-hand path with times, the breaks, the status of every epic assumption it touched, and proposed NFR-1 limits.
- Evidence for FR-1, FR-11 to FR-14 and NFR-1 and NFR-4, by hand: Ubuntu 24.04 builds and serves in about 75 s with about 4.5 GB of disk and a 3.7 GiB build peak. An explicit non-loopback bind is reachable through a published port, and pairing from inside works.
- Claude Code started, took input and exited in a shell. Alpine installs and builds but cannot load `node-pty`.
- No break changed the epic's approach; the breaks are gaps in the start command.

## Decisions

- The host-server variant of the second-server check was not run (author decision, ER-2): no install on the host. A Linux Docker host, x64, the smallest build memory and R-9 were also not run; their limits stay `TBD (author, 2026-11-15)`.

## Docs

- [Terminal runtime](../../../internals/terminal-runtime.md): the init, mounted-socket, ownership-lock and musl findings.

## Follow-ups

- Open questions for PRB.T-030 and PRB.T-031 (default agent command, banner address and token in the log, host-server sharing, socket on a mounted folder) are in [questions.md](../../questions.md).
- The spike report stays while PRB.E-004's assumption table and the open stories PRB.T-030 to PRB.T-034 still rely on its numbers and findings.
