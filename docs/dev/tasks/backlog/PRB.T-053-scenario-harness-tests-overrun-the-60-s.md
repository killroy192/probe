---
id: PRB.T-053
type: bug
parent:
phase: 1
labels: [testing]
created: 2026-11-11
updated: 2026-11-11
---

# Scenario harness tests overrun the 60 s test timeout when sandbox.test.ts and harness.test.ts run together

Found 2026-11-11 while fixing PRB.T-051. Run on its own, `scripts/scenarios/sandbox.test.ts` passes
12/12 (249 s) and `harness.test.ts` passes 44/44 (546 s). Run together, as `vp run check:changed`
does when a scenarios file changes, four tests hit the 60 s test timeout:

- `sandbox.test.ts`: "starts on a throwaway home, prints what to use it with, seeds a fixture and
  stops by its pid", "runs a set and a composed scenario one after another on one server, and only
  on the sandbox it names", "leaves a live sandbox to other cleanups and cleans one killed with
  SIGKILL".
- `harness.test.ts`: "reports each failure by name with its evidence, then judges the perf
  self-tests" (a fifth, "runs fresh-server scenarios beside shared ones on two workers, and stops
  every server", overran once).

Nothing hangs and the machine is not saturated (load under 5 on 10 cores, no clock jump). The work
is simply close to the ceiling and slows about 1.6× beside the other file. Probe timings of the
first sandbox case, alone then together: sandbox start 13 s → 21 s, the second sandbox start
about 20 s, reading the server state over the API 5 s → 8.5 s, `git grep --untracked` for the
pairing token 5 s → 7.5 s; sign-in itself under 1 s.

On 2026-11-12, `check:changed` ran 30 test files (browser tests included) beside these, and eight
tests overran: the five `sandbox.test.ts` cases that start a sandbox, plus `harness.test.ts`
"reports each failure by name…", "fails a scenario whose shared server dies…" and "runs
fresh-server scenarios beside shared ones…". The more that runs beside them, the more overrun.

## Direction

- Make the cases cheaper rather than raising the timeout (no per-test timeouts): find why a
  sandbox start takes 13 s and one API state read 5 s, and narrow the `git grep` to the files a
  sandbox could write.
- Or keep the two heavy files from running at the same time, if the cost is inherent.

## Done when

- `vp run check:changed` with a change under `scripts/scenarios` passes both files.
