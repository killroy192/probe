---
name: story-creation
description: Create a Probe story (one testable, deployable outcome under an epic) in `docs/dev` through an agent-led interview, an automated review loop, and human approval, written from story.template.md with tm. Use when the user wants to add, define, or rework a story or user story for an existing epic, before any plan or code exists.
---

# Create a story

A story is one testable outcome that can ship to production on its own and contributes to one epic.
It says what changes for the user, how we will know (acceptance criteria), and what is out of scope.
It is implementation-agnostic: how to build it is decided later, in the plan stage.

Output: one file, `tasks/backlog/PRB.T-NNN-slug.md`, filled from [story.template.md](story.template.md).

## Hard rules

- **Do not propose code changes.** No diffs, snippets, pseudocode patches, or "change line X to Y".
- **Do not write an implementation plan.** No step-by-step coding tasks, file edit sequences, PR
  breakdowns, or design decisions.
- **Clarify, don't build.** Inventory behavior, scope, risks, and verification so a later agent can
  plan safely.
- Never invent an ID or touch `ids.json`. IDs come only from `vp run tm new`.
- Do not change code. Read it only.

## Inputs

- **Epic ID** (`PRB.E-NNN`), required. Run `vp run tm show <ID>` and read the epic file. If the epic
  does not exist, stop and tell the user; do not create one (use the epic skill).
- The user's idea for the story, in any form.

## Section titles

The story body uses exactly these titles, in this order (the reviewer checks them):

1. `Business Goal`
2. `Epic and Requirements`
3. `Current Behavior`
4. `Expected Behavior`, with `User Flow`, `Edge Cases`, `Error Handling` below it
5. `Out Of Scope`
6. `Technical Scope`
7. `Non-functional Requirements and Constraints`
8. `Acceptance Criteria`
9. `Dependencies`
10. `Assumptions`

## Workflow

1. **Orient.** Before asking anything:
   - Read the parent epic: goal, scope, Out, FR/NFR table, candidate stories, assumptions and
     unknowns, notes for stories. Say which candidate story this is, or that it is not on the list.
   - Run `vp run tm ls --parent <EPIC>` to find stories that overlap. If one covers the idea, propose
     extending it instead of creating a new one.
   - Search `docs/dev` with `mcp__cocoindex-code__search` (`docs/dev/memory/roadmap.md`,
     `docs/dev/memory/questions.md`, `docs/dev/memory/design/`).
   - Check the current behavior in the code with `mcp__cocoindex-code__search`, or by reading files.
     Record file paths. If the index is unavailable and you could not read the code, say so and mark
     the Current Behavior as unverified.
     Never ask the user something `docs/dev` or the code already answers.
2. **Interview (grill-me).** Ask until every template section is answered or explicitly parked.
   - One topic at a time, one to three questions per turn. Use `AskUserQuestion` for choices.
   - Bring a recommended answer, based on what you found, so the user can say "yes".
   - Challenge vague answers ("better", "faster", "works well"). Ask for an observable check.
   - Keep it implementation-agnostic. When the user starts on libraries, files or design, park it
     in a short note for the plan stage and return to the topic.
   - Test the size: if the story has more than one independently shippable outcome, or cannot ship
     without another story, propose splitting it. If it is a step of a larger task, propose merging.
   - Topics, in order: business goal; epic requirements delivered (FR/NFR); current behavior
     (confirm what you verified); user flow; edge cases; error handling; out of scope; docs and
     mobile impact; constraints; acceptance criteria; dependencies; assumptions.
   - For acceptance criteria, write Given / When / Then, one testable statement each, mark each
     `auto` (scenario test) or `manual`, and map each to an FR/NFR/EC/ER.
   - Finish with a sweep: "What are we taking for granted? What do we not know that the plan
     depends on?" Put each belief stated as fact in the Assumptions table (SA-n / SU-n) with status,
     how to verify, and owner. Verify cheap ones yourself first.
   - Stop when every section is written or marked `TBD (owner, date)`, never silently skipped.
3. **Draft and create.**
   - `vp run tm new story "<title>" --parent <EPIC>` (add `--phase N` and `--labels` only if known).
     It prints the file path.
   - Replace the generated body with the full story using exactly the section titles above. Keep the
     frontmatter as generated.
   - `vp run tm check`.
4. **Automated review loop** (max 3 iterations), see below.
5. **Human review.** Always required, even when the loop is clean. Show the human the review
   table, any open findings, and the file path. The human can approve, request changes, or reject.
   - Changes: the author edits the story. If the change is substantial, run one more reviewer
     iteration, which starts a fresh max of 3.
   - Reject: leave the file in `backlog` and ask whether to delete it with `vp run tm rm <ID>`; run
     it only if they say yes.
6. **Hand off.** Only after approval:
   - Set the workflow label if appropriate: `vp run tm label <ID> +plan` (stages are `plan`,
     `implement`, `verify`, `review`; the story is ready for `plan`). Add `mobile-impact` if the
     story touches mobile.
   - Copy unverified assumption and unknown rows that outlive the story into `docs/dev/memory/questions.md`,
     prefixed with the story ID and row ID.
   - `vp run tm check`, then `vp run tm log "created PRB.T-NNN <title>"`.
   - Say the next step is the plan stage. Do not plan here. Do not commit unless asked.

## Automated review loop

The reviewer is a separate, read-only subagent defined in
[`.agents/agents/story-reviewer.md`](../../agents/story-reviewer.md). It has no Write, Edit or Bash
tool, so it cannot change anything.

- Spawn it with the Agent tool and `subagent_type: "story-reviewer"`. Project agents load at
  session start; if that type is not registered in the current session, fall back to
  `subagent_type: "Explore"` and pass the full instructions from the agent file as the prompt.
  Never use a type that has write tools.
- Each iteration spawns a FRESH reviewer. Give it only: the path of the story file, the path of the
  parent epic file, the path of `story.template.md`, and the instruction to follow its own
  checklist. Do not give it the author's reasoning or justification. It must not edit anything.
- The reviewer returns either the single line `NO BLOCKING FINDINGS` (it may still list
  non-blocking findings) or a list of findings, each with `id`, `severity`
  (`blocking` | `non-blocking`), `section`, `problem`, `evidence`, `suggested fix`.
- The author (you, the agent that wrote the story) addresses every blocking finding by editing the
  story file, or, if it disagrees, records a one-line reason for the human. Non-blocking: fix when
  cheap, otherwise list them. Never edit the reviewer's output and never argue with the reviewer in
  the next iteration.
- Stop when an iteration returns `NO BLOCKING FINDINGS`, or after 3 iterations. If blocking
  findings remain after the 3rd iteration, say so plainly and pass them to the human.
- Before the human review, give the human a short table: iteration, finding id, severity, what
  changed or why it was rejected, and any still-open findings. Do not put the review log inside
  the story file.

## Quality bar before human review

- The story is one outcome that could ship to production alone, and its goal contributes to the
  epic goal.
- Every cited FR/NFR exists in the epic; the story is on the epic's candidate list or says why not.
- Current Behavior is factual, with file paths, or marked unverified.
- Every acceptance criterion is independently testable, marked `auto` or `manual`, mapped to a
  requirement, and together they cover the Expected Behavior, every edge case and every error case.
- Docs impact and mobile impact are stated.
- No code, pseudocode, plan or design decisions anywhere.
- Assumptions and unknowns are listed with status, verification and owner; no blocking unknown is
  left without an owner.
- No section is empty; unknowns are `TBD (owner, date)`.
- `vp run tm check` passes.
