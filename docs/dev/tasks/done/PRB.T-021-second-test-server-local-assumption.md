---
id: PRB.T-021
type: story
parent: PRB.E-003
phase: 2
labels: [remote, mobile-impact, implement]
created: 2026-11-09
updated: 2026-11-09
---

# Second test server, local-assumption audit and settings sort

## Goal

Find out what breaks when the server is not the one that serves the UI, before the multi-server work
starts. The scenario harness can now run a second Probe server beside the first, and the findings
(local assumptions, Settings sort) are written down for stories 2 to 8 of PRB.E-003.

## Delivered

- `startSecondServer()` on the scenario context: a separate process with its own home and port, seeded
  with workspaces. `scripts/scenarios/seam.ts` is a harness-only seam that writes the second server
  into the browser's connection catalog without the connect flow. Scenario R1 (`--only R1`) checks it.
- The audit, [remote-local-assumptions-audit.md](../../research/remote-local-assumptions-audit.md):
  every local assumption with its owning story, every Settings page sorted client-owned or
  server-owned, and results for the epic's story-1 assumption rows (A-1 to A-16, U-1 to U-6).
- Satisfies the audit halves of FR-4, FR-5, FR-15, NFR-2, NFR-3, NFR-5 and NFR-4.

## Decisions

- The seam is test-only and adds no product code; PRB.T-023 replaces it with the connect flow.
- Wrong-server reads are caught by request origin, not by a failing file read: both harness servers run
  as one user in one container, so no file permission can hide the second server's folders (agreed with
  the author).
- Pages the code does not decide (Labs, About, licenses, Browser) stay as questions Q-A to Q-C in the
  audit for the author.
- An https server on loopback can be started (a `node:https` proxy with a self-signed cert and Chromium
  with `ignoreHTTPSErrors`; it paired and connected over `wss://` in the walk), so the https claim for FR-15 is kept. The proxy is not in the harness yet; PRB.T-023 adds it with the refusal test.

## Docs

- [Remote audit](../../research/remote-local-assumptions-audit.md) stays in `docs/dev/research`:
  PRB.T-022 to PRB.T-028 and PRB.E-003 still link to it.

## Follow-ups

- Workspace screens use only the default server: PRB.T-022. Two servers on one host share a label:
  PRB.T-022 and PRB.T-023.
- Pairing errors collapse to `invalid_credential` and plain http to a public host is not refused:
  PRB.T-023.
- Settings writes fan out to every connected server and Sharing & access ignores the scope: PRB.T-025.
- Reconnect backoff can exceed 60 s: PRB.T-026.
- Open for the author: Q-A to Q-D in the audit, and the epic's U-8 (where client-owned settings live).
