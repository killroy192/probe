---
name: verify-story-implementation
description: >-
  Score a Probe story's implementation against its acceptance criteria and plan
  using fixed verification gates. Use when the user asks to verify a PRB.T-NNN
  story, check that implementation matches the spec/plan, or run the verify
  stage after implement.
---

# Verify story implementation

You only **orchestrate**. Two sequential local `generalPurpose` Task subagents
do the work: one writes the evaluation plan, then one runs it and scores.
Do not map ACs, author the plan, run checks, or score yourself.

## Hard rules

- **Orchestrate only** — resolve inputs, launch subagents, and assemble their
  outputs into the final report. Do not analyze the diff, write the plan, run
  verification commands, or assign scores.
- **Plan then score** — always launch the plan subagent first, then the
  evaluate subagent with that plan. Both use `run_in_background: false`. Stop
  after the plan subagent only if the user explicitly asks for plan-only.
- **No code changes** — you and both subagents: no diffs, patches, fix
  snippets, or “change line X to Y”. Gaps are outcome-level actions only.
- **No product / ticket edits** — do not fix the implementation or edit ticket
  bodies. Use [tickets](../tickets/SKILL.md) only to `tm show` /
  `tm log` if asked.
- **Repo check scope** (evaluate subagent) — prefer focused commands
  (`vp test run <files>`, `vp run check:changed`). No repo-wide `vp check` or
  `vp run -r test` unless the user asks.

## Inputs

Resolve before launching subagents (pass the results into their prompts):

1. **Story** — `vp run tm show <PRB.T-NNN>` (or the ticket the user
   names). Include the full body (or the sections: Business Goal, Expected
   Behavior, Out Of Scope, Acceptance Criteria, Assumptions).
2. **Implementation plan** — plan section/notes from the ticket, or text the
   user pastes. If missing, tell both subagents to score against story ACs only.
3. **Diff** — commit range or working tree the user names. If unclear, ask
   before launching. Pass the range string and how to obtain it (e.g.
   `git diff main...HEAD`), not your own analysis.

Also pass the absolute path to
[references/verification-gates.md](./references/verification-gates.md).

## Workflow

1. **Resolve inputs** (you) — ticket id, story text, implementation plan
   presence, diff range. Nothing else.
2. **Plan subagent** — Task:
   - `description`: `Evaluation plan PRB.T-NNN`
   - `subagent_type`: `generalPurpose`
   - `run_in_background`: `false`
   - Prompt: full story text, implementation plan (or “missing”), diff range,
     gates file path, and: map in-scope ACs / out-of-scope / plan claims;
     produce only the evaluation-plan table (gate, method, commands/tools);
     skip inapplicable gates with a reason; do not run checks, score, edit
     files, or propose code changes; return that markdown as the final message.
3. **Evaluate subagent** (skip if plan-only) — Task:
   - `description`: `Evaluate PRB.T-NNN`
   - `subagent_type`: `generalPurpose`
   - `run_in_background`: `false`
   - Prompt: same story / implementation plan / diff range / gates path; the
     plan subagent’s full evaluation plan; output-format sections for Gate
     scores, Acceptance criteria, and Verdict; and: execute the plan’s checks;
     score each gate **0–2** (0 = fails, 1 = partial, 2 = full) with brief
     reasoning and outcome-level actions to reach 2 when score < 2; mark each
     AC `met` / `partial` / `unmet` / `untested` with evidence; verdict `pass`
     only if every in-scope AC is `met` and no gate scored 0, else `fail` plus
     one sentence; do not edit files or propose code changes; respect focused
     check scope; return those sections as the final message.
4. **Assemble** (you) — paste plan + evaluate outputs into the report template
   below. Do not revise scores or re-run checks. If a subagent failed, report
   that and stop.

## Output format

```markdown
# Verification: PRB.T-NNN — <title>

## Scope

- Diff: <range or working tree>
- Plan: <present | missing>

## Evaluation plan

| Gate | Method | Commands / tools |
| ---- | ------ | ---------------- |
| …    | …      | …                |

## Gate scores

| Gate | Score (0–2) | Reasoning | To reach 2 |
| ---- | ----------- | --------- | ---------- |
| …    | …           | …         | …          |

## Acceptance criteria

| AC   | Status                              | Evidence |
| ---- | ----------------------------------- | -------- |
| AC-1 | met \| partial \| unmet \| untested | …        |

## Verdict

pass | fail — <one sentence>
```

## Related skills

- Story load / labels: [tickets](../tickets/SKILL.md)
- Point the evaluate subagent at [test-t3-app](../test-t3-app/SKILL.md) when a
  planned check needs a real web client (include that path in its prompt).
