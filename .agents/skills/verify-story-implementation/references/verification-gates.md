# Verification gates

- **Specification compliance** — Every in-scope acceptance criterion is met.
  Out-of-scope items must not be treated as missing work. Plan claims that the
  story deferred or rejected do not count as unmet ACs.
- **Scope control** — The diff does only what the story and plan asked for. No
  unrelated refactors, drive-by cleanups, or extra surfaces.
- **Test quality** — Tests (unit, scenario, or manual check named in the AC
  table) would fail if the behavior were wrong. Prefer extending an existing
  case over a new mirror test. Respect repo rules: no sleeps, polling loops,
  per-test timeouts, retries, or wall-clock deltas (`AGENTS.md`,
  `docs/internals/testing.md`).
- **Risk** — Security, performance, reliability, data integrity, or rollout
  issues introduced by the change (including `~/.t3` / live-state contact,
  origin baking, or process-kill-by-pattern).
- **Maintainability** — A developer new to this area can follow the change
  without hidden coupling or unexplained complexity at the wrong layer.
- **Evidence** — A reviewer can confirm the result from named tests, command
  transcripts, screenshots, or scenario output without re-deriving the whole
  implementation.
