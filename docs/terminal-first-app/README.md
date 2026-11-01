# Terminal-first app (probe)

A fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT) that is becoming a terminal-first
workspace for CLI coding agents. The fork does **not** track upstream: it deviates into a separate
product. Fork base: `2f4da5de4` (`feat(server): traces name what grew the heap, for ~0.3µs per span (#27104)`).

## What belongs here

This folder documents what **exists in this repo**. Plans, drafts, research, open questions and
tickets live in the separate `probe-vault` repo and are promoted here when the work merges.

| Document | Contents |
| --- | --- |
| [decisions/0001-fork-t3code.md](decisions/0001-fork-t3code.md) | Why we forked T3 Code |
| [t3code-analysis.md](t3code-analysis.md) | Architecture of the code we forked, and where changes land |

## Rule for contributors and agents

A PR that establishes or changes behavior updates the docs in the same PR. When a story is done,
distill the related vault notes into this folder and set the ticket to `done` (see `CLAUDE.md`).
Docs inherited from T3 Code under `docs/` that describe removed features (chat, web mode) are
rewritten or deleted in the PR that removes the feature.
