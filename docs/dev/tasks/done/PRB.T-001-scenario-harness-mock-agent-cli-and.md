---
id: PRB.T-001
type: story
parent: PRB.E-001
phase: 1
labels: [testing]
created: 2026-11-02
updated: 2026-11-03
---

# Scenario harness, mock agent CLI and booting scenario skeleton

## Goal

Give the terminal-first epic (PRB.E-001) one command that runs scenarios against a freshly started Probe on a throwaway data directory in headless Chromium, plus a mock agent CLI that stands in for a Claude-Code-like tool, so later stories add scenarios instead of being checked by hand.

## Delivered

- `vp run test:scenarios` with a booting scenario skeleton, harness self-tests (`--selftest`), and S2 to S8 listed as pending without failing the run; harness failure paths covered by `scripts/scenarios/harness.test.ts` (runs in CI).
- `scripts/mock-agent/mock-agent.ts`: banner, session id, echo, `exit`, `--resume <id>`.
- `server.restart()` on the harness handle (same home and port), used by later restart scenarios.
- Satisfies NFR-3, NFR-4, NFR-5 (part), NFR-7 (part); proves epic assumptions A-3, A-4, A-5, A-7, A-15.
- Commit ea1328b61. Verified 2026-11-03: 16 of 18 acceptance criteria met; AC-2 (checks the home and server pid, not a `~/.t3` snapshot, which is flaky next to a live install) and AC-3 (pointer-only is the compile-time type `PointerPage`, not a runtime check) are partial by design.

## Decisions

- Command name is `vp run test:scenarios` (user).
- Scenarios use Playwright as a library from a Node runner that owns the server, not Vitest browser mode (2026-11-02, author); E-005 may replace the library (roadmap).
- Scenarios run locally only, not in CI (user, 2026-11-02); only the harness tests run in CI.
- Not-yet-built scenarios show as pending and do not fail the run; the KPI counts passing scenarios out of 8 (user).
- The browser is signed in without a human by minting a pairing credential from the server CLI against the throwaway home.
- The original boot check ("Add project" visible) was meant to be replaced when the start screen landed; PRB.T-003 did so.

## Docs

- [Scenario rules](../../../../.agents/rules/scenarios.md)
- [Mock agent](../../../operations/development.md#mock-agent)
- [Roadmap](../../roadmap.md) (Node and pnpm versions, scenario decisions)

## Follow-ups

- What the mock CLI does for an unknown session id, and a way to make a resume fail until a cause is fixed, was left to story 8; the current placeholder prints `mock-agent: no session <id>` and exits 1. Not tracked anywhere today.
