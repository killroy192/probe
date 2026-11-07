---
name: debug-issue
description: Hypothesis-driven runtime debugging of a bug, flaky test, or wrong behavior using temporary instrumentation and captured logs instead of guessing. Use when the user reports an issue to debug, a fix attempt did not work, the cause is not obvious from reading code, or the user says "debug", "why does this happen", or "it still fails".
---

# Debug

Find the cause from runtime evidence, not from reading code and guessing. Do not write a fix until
logs confirm which hypothesis is true. Stack traces and code reading produce hypotheses; only logs
from a real run confirm them.

## Rules

1. **No fix without evidence.** A fix comes only after a run whose logs confirm one hypothesis and
   reject the others. Say which log lines prove it.
2. **Several hypotheses, not one.** Write 3-5 distinct, falsifiable causes before touching code.
   Think wide (state, ordering, data shape, environment, config, a different layer), not only the
   first suspect.
3. **Instrument, do not patch.** Temporary logging is the only code change before the fix. Never
   change behavior "to see if it helps".
4. **Never remove logs before a verified fix.** If a run does not reproduce or settle it, add more
   logs and run again. Do not fall back to guessing.
5. **Fixes need proof.** Re-run with the same logging and show before/after logs. Only then clean up.
6. **Main session only.** Do not delegate instrumentation to subagents, and give any subagent
   read-only instructions.
7. **Do not guess at a repro you cannot run.** If you cannot reproduce it yourself, ask the user for
   exact steps and run it for them or have them do it (see step 4).

Repo hazards still apply: never `pkill -f` or kill by name (kill only a PID you captured), never
touch `~/.t3/userdata`, never set `VITE_HTTP_URL`/`VITE_WS_URL`. Use `vp test run <files>` and
`vp run dev` as in AGENTS.md; no repo-wide checks.

## Workflow

### 1. Understand and state the symptom

Restate expected vs. actual behavior in two lines. Collect what exists: error text, ticket
(`PRB.T-NNN`), recent commits (`git log -5`, `git diff`), failing test names. Ask the user only for
what you cannot find (repro steps, which surface: web, desktop, mobile, server, provider). Skip
questions you can answer with a command.

### 2. Hypothesize

List hypotheses as a numbered table: what would be true, and what log line would prove or reject
it. Read only enough code to make them concrete. Show the list to the user in a few lines; do not
wait for approval unless the repro needs their action.

### 3. Instrument

Set up one log sink per session, in the gitignored `.logs/`:

```
.logs/debug/<slug>.ndjson      # one JSON object per line
```

Truncate it before every run (`: > .logs/debug/<slug>.ndjson`) so each run is clean.

Add probes at the points that separate the hypotheses: function entry/exit with arguments and
results, branch taken, state before/after a mutation, event ordering, timing as sequence numbers
(not wall-clock). 3-8 probes is typical; each tags the hypothesis it tests (`h: "H2"`).

Wrap every probe in a marker pair so cleanup is exact and greppable:

```ts
// #region debug:<slug>
debugLog("H2", "applyEvent:before", { seq, status });
// #endregion
```

Pick the sink for the code's runtime:

- **Node / server / scripts / tests** (`apps/server`, `packages/*`, vitest): append with
  `fs.appendFileSync(path, JSON.stringify({ h, msg, data, seq }) + "\n")`. Use an absolute path from
  `process.env.DEBUG_LOG ?? "/workspaces/probe/.logs/debug/<slug>.ndjson"`. In Effect code use
  `Effect.sync` around it, or `Effect.logDebug` when the server's log output is already captured.
- **Browser / web / desktop renderer / React Native**: no filesystem. Either `console.log` with a
  unique prefix (`[dbg:<slug>]`) and collect it through the browser tool (see `test-t3-app`,
  `test-t3-mobile`), or `fetch` a tiny local collector you start for the session:
  `node -e` HTTP server on a free port that appends bodies to the ndjson file. Capture its PID at
  spawn and kill that PID only. Never put an absolute origin in app code that ships; the probe is
  temporary and removed in step 7.
- **Subprocess / provider CLI**: log at the adapter boundary (what you send, what you receive), not
  inside the CLI.

Do not log secrets, tokens, or pairing URLs. Keep payloads small; log shapes and ids over bodies.

Keep a list of every file you instrumented in your working notes so cleanup cannot miss one.

### 4. Reproduce

Terminal agents can usually run the repro themselves; prefer that, in this order:

1. An existing failing test: `vp test run <file> -t "<name>"`.
2. A script or command that triggers it (`node -e` from the owning package).
3. The dev server plus a real client (`test-t3-app`, `test-t3-mobile`), using the free
   `Replay (dev)` provider instead of a paid one when the provider is not the subject.
4. Only if it needs a human (real device, specific account, visual judgment): give the user a
   numbered, minimal repro list, tell them the sink path, and wait. End your turn with
   "Reply `done` once you have reproduced it" and do not continue until they reply.

Run in the foreground when it ends on its own. For a long-lived process, start it in the background
and note its PID. Do not poll with sleeps; wait on the process, the test result, or a log line.

### 5. Analyze

Read the log file whole (it is small). For each hypothesis, mark **confirmed**, **rejected**, or
**inconclusive** and cite the line numbers. Write that verdict down in the reply.

- One confirmed, others rejected: go to step 6.
- Inconclusive, or nothing logged (probe never reached): that is information. Add or move probes to
  split the remaining space and reproduce again. Say what you changed and why.
- All rejected: form new hypotheses from what the logs showed; do not repeat the old list.
- Repro did not fail: the bug depends on something you did not reproduce (data, timing, config,
  environment). Add probes around that difference or ask the user what differs.

Loop 3-5 until a hypothesis is confirmed. If after several rounds you are stuck, summarize what is
known and ask the user for a new angle rather than guessing a fix.

### 6. Fix and verify

Make the smallest fix for the confirmed cause, with the probes still in place. Truncate the log and
reproduce again. Show the after-log that contradicts the before-log. If it still fails, the
diagnosis was wrong or incomplete: return to step 5.

Then give the fix its proof, per AGENTS.md: logic, data, state, and protocol bugs get a regression
test that fails on the unfixed code (write it in the main session; do not temporarily break product
code to demonstrate it). Visual bugs get before/after captures instead.

### 7. Clean up

Only after verified success:

- Remove every `#region debug:<slug>` block, any debug-only imports, and the collector process (by
  its captured PID).
- Verify: `git grep -n "debug:<slug>\|dbg:<slug>"` returns nothing, and `git diff` contains only the
  fix and its test.
- Delete `.logs/debug/<slug>.ndjson` (gitignored, but remove it anyway).
- Run `vp run check:changed`.

### 8. Report

Short, in this shape:

- **Cause:** one sentence, with the evidence (log lines) that confirmed it.
- **Fix:** what changed and where (`file:line`).
- **Proof:** the regression test or the before/after logs.
- **Rejected:** hypotheses ruled out, only if the user may wonder about them.

If the bug exposed a cross-component trap a maintainer would get wrong again, record it per the
AGENTS.md documentation rules (ticket handoff or `docs/internals/`), not here.
