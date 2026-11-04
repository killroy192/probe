---
name: epic-creation
description: Create a Probe epic in `docs/dev` through an agent-led interview, then write it from epic.template.md with tm. Use when the user wants to add, define, or rework an epic, a business or product goal, or a KPI-driven body of work, before any stories are written.
---

# Create an epic

An epic is a set of stories that together achieve one goal. The goal is a business or product
outcome with an established KPI, and the KPI is not only money: adoption, speed, reliability,
effort saved, or a quality bar all count. An epic sets the expectation, says how we will achieve it
without tech details, and says how we will verify it. Stories (a separate skill) carry the tech.

Output: one file, `epics/backlog/PRB.E-NNN-slug.md`, filled from [epic.template.md](epic.template.md).

## Workflow

1. **Orient.** Before asking anything, search `docs/dev` with the `cocoindex-code` MCP and run
   `vp run tm ls --type epic`. Look for an epic or note that already covers the idea
   (`docs/dev/roadmap.md`, `docs/dev/design/`, `docs/dev/questions.md`). If one exists, propose extending
   it instead of creating a new one. Never ask the user something `docs/dev` already answers.
2. **Interview.** Run the grill-me session below until every template section is answered or
   explicitly parked.
3. **Draft and create.** Fill the template, then create the real file so the reviewer has
   something to read:
   - `vp run tm new epic "<title>" --phase N --labels a,b` (it allocates the ID; never pick an ID or
     touch `ids.json`).
   - Replace the generated body of the file `tm` printed with the full draft. Keep the frontmatter
     exactly as `tm` wrote it.
   - `vp run tm check`.
4. **Automated review loop** (max 3 iterations). See [Review loop](#review-loop).
5. **Human review.** Always required, even when the loop is clean. See [Human review](#human-review).
6. **Hand off.** Only after approval:
   - Copy into `docs/dev/questions.md` only the unverified rows and open questions that more than
     one ticket will depend on, or that outlive the epic, prefixed with the epic ID and row ID. The
     rest stay in the epic's table only; stories cite them as `epic A-n`.
   - Record decisions the user made in the interview that outlive the epic in `docs/dev/roadmap.md`.
   - `vp run tm check`.
   - List the candidate stories from the epic and say the next step is the story skill. Do not
     create stories here. Do not commit unless asked.

## The interview (grill-me)

Rules:

- One topic at a time, one to three questions per turn. Use `AskUserQuestion` when the answer is a
  choice, plain questions otherwise.
- Always bring a recommended answer, based on what you found in `docs/dev`, so the user can say
  "yes" instead of writing from scratch.
- Push back on vague answers. "Better", "faster", "cleaner" and "improve" are not goals. Ask for a
  number, a before and after, or an observable check. If the KPI is truly qualitative, write down
  who judges it and what they look at.
- Keep it product-level. When the user starts on libraries, schemas or file layout, park it under
  "Notes for stories" and return to the topic.
- Number requirements, risks, assumptions and unknowns (FR-n, NFR-n, R-n, A-n, U-n) so stories and
  later notes can cite them.
- Stop a topic when its template section could be written. Stop the interview when every section
  is written or marked `TBD` with an owner and a date, never silently skipped.

Topics, in this order (each maps to a template section):

1. **Goal.** What outcome, for whom, in one sentence. What would the world look like if it worked.
2. **Why and why now.** The problem or opportunity, evidence for it, what happens if we skip it.
3. **KPI.** Metric, baseline (measured or "unknown, measure first"), target, how and where it is
   measured, by when. One primary KPI; at most two guardrails (things that must not get worse).
4. **Users and scenarios.** Who uses it and the two to five concrete scenarios that matter most.
   These become the scenarios we verify.
5. **Scope.** What is in. What is explicitly out, and why. Where it touches `mobile-impact` or
   chat removal, say so.
6. **Functional requirements.** The observable behaviors that make each scenario work, one per
   line, each testable, with must / should / could. Number them FR-1, FR-2 and tie each to a
   scenario. Challenge anything that cannot be checked by looking or measuring.
7. **Non-functional requirements.** Walk every quality row in the template (performance,
   reliability, security and privacy, compatibility, usability and accessibility, observability,
   maintainability and docs) and ask for a measurable limit. "Not applicable" needs a reason. In
   this repo performance is a product value, and `mobile-impact` must be stated.
8. **Approach.** How we get there at product level: the main moves and their order, and the
   alternatives considered. No technology choices.
9. **Candidate stories.** A short list: title, one line of value, rough order. Each should be big
   enough to carry its own plan, implementation and verification.
10. **Verification.** How we know the goal is met: how the KPI is measured, which scenarios are
    covered by automated scenario tests (epic PRB.E-012) and which are checked by hand, who signs off.
11. **Dependencies and sequencing.** Other epics, tools, decisions and people we wait on; the phase
    in `docs/dev/roadmap.md` it belongs to.
12. **Risks.** What could go wrong and how we would limit it.
13. **Assumptions and unknowns.** Finish with a sweep: "What are we taking for granted? What do we
    not know yet that the plan depends on?" Go back over every earlier answer and extract each
    belief stated as fact ("users already have...", "the CLI supports...", "this is cheap"). Put
    each in the table with a status (unverified until shown), how and when to verify it, an owner,
    and what it affects. Try to verify cheap ones yourself in `docs/dev` or the code first and say what
    you found.
14. **Open questions.** Decisions still to make, each with an owner.

## Review loop

The reviewer is a separate read-only subagent defined in
[.agents/agents/epic-reviewer.md](../../agents/epic-reviewer.md) (tools: Read, Grep, Glob,
`mcp__cocoindex-code__search`; no Write, Edit or Bash). It checks the epic against
`epic.template.md` and the rest of `docs/dev` and reports only real problems.

Spawn it with the Agent tool using `subagent_type: "epic-reviewer"`. If that type is not registered
in the current session (project agents load at session start), fall back to
`subagent_type: "Explore"` and pass the full contents of the agent file's instructions as the
prompt. Never use a type that has write tools.

Each iteration:

1. Spawn a FRESH reviewer. Give it only the path of the epic file, the path of `epic.template.md`,
   and the instruction to follow its own checklist. Do not give it your reasoning or
   justification. It must not edit anything.
2. It returns either the single line `NO BLOCKING FINDINGS` (it may still list non-blocking
   findings), or a list of findings, each with `id` (F1, F2...), `severity` (`blocking` |
   `non-blocking`), `section`, `problem`, `evidence`, `suggested fix`. Blocking means a competent
   team could not start work, or would build the wrong thing, or two statements contradict each
   other. Everything else is non-blocking.
3. You, the author, address every blocking finding by editing the epic file, or, if you disagree,
   record a one-line reason for the human. Fix non-blocking findings when cheap, otherwise list
   them. Never edit the reviewer's output and never argue with the reviewer in the next iteration.
4. Run `vp run tm check` after edits.

Stop when an iteration returns NO BLOCKING FINDINGS, or after 3 iterations. If blocking findings
remain after the 3rd iteration, say so plainly and pass them to the human.

## Human review

Before asking for review, give the human a short table: iteration, finding id, severity, what
changed or why it was rejected, and any still-open findings. Do not put the review log inside the
epic file. Point to the epic file path so they can read it.

The human can:

- **Approve.** Go to hand off.
- **Request changes.** Edit the epic. If the change is substantial, run one more reviewer
  iteration; it counts toward a fresh max of 3. Then ask for review again.
- **Reject.** Stop. Tell the user the created epic file remains and ask whether to delete it with `vp run tm rm <ID>`; run it only if they say yes.

## Quality bar before review

Check these before the first reviewer iteration; the reviewer checks them again.

- The goal is one sentence and an outsider can tell whether it was reached.
- The primary KPI has a baseline (or a plan to get one), a target, and a measurement method.
- Verification is defined before any work starts and does not depend on opinions of whoever built it.
- Out of scope is written down.
- The approach contains no tech details; those live in stories.
- Every functional requirement is testable and traces to a scenario; every FR and NFR has a row
  in the verification traceability table.
- All seven non-functional qualities are addressed with a measurable limit or a reason.
- Assumptions and unknowns are listed exhaustively, each with a status, verification and owner. No
  `must` requirement rests on an unverified assumption without a story that verifies it first.
- There are between roughly two and eight candidate stories; fewer means this is a story, more
  means the epic should be split.
- No section is empty; unknowns are `TBD (owner, date)`.
