---
id: PRB.T-002
type: story
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-02
updated: 2026-11-04
---

# Standalone shells without chat threads or tabs

## Goal

A shell had to exist without a chat thread or an open tab, since every later story of PRB.E-001
builds on it. Delivered as an enabling story, not a user-visible screen (accepted by the user,
2026-11-02).

## Delivered

Standalone shells over their own `shell.*` RPCs, a shell list for clients, and a thread-free
terminal view; thread terminals unchanged. Proved by scenario T-002 and the `Shells` tests. The
manual pass (2026-11-04) kept output across leaving and reopening the page, and the second
verify-story-implementation run met every AC.

## Decisions

- Identity (U-1): separate `shell.*` RPCs, a server-allocated id, and a `shell:<id>` owner key
  inside the terminal manager. Rejected: a tagged `kind` field and an optional `threadId`, which
  ripple into mobile, MCP and storage cleanup.
- A shell survives a browser reload (A-6 true) but not a server stop (A-14 false). The spike only
  recorded this; surviving a restart was left to story 7 (user, 2026-11-02).
- The AGENTS.md and `.gitignore` policy edits ship in this PR (user, 2026-11-04).

## Docs

- `docs/internals/terminal-runtime.md` (Shells and thread terminals), `docs/internals/glossary.md`

## Follow-ups

None.
