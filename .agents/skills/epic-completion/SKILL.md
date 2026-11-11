---
name: epic-completion
description: Close a finished Probe epic (PRB.E-NNN) - confirm its stories are done, move it to done without verifying it again, score its body, move lasting project and product knowledge into docs, keep a short history in the ticket and delete the planning detail. Use when the user says an epic is finished or should be completed or closed.
---

# Epic completion

The epic-level twin of [story-completion](../story-completion/SKILL.md): same scoring, same decision
table, same duplicate check and approval step. Read that skill first; this one only states what
differs. An epic is a product goal, so more of it is product history and roadmap, and less of it is
build detail.

## Workflow

1. **Gate.** `vp run tm ls --parent <ID>`. Every story and bug is `done`, or the user says in so
   many words that the rest is dropped or moved to another epic. Open children otherwise: stop,
   list them, ask. Complete the stories first (story-completion), because their knowledge feeds
   the epic's.
2. **Load.** `vp run tm show <ID>`, then the epic's done stories (already short) and the roadmap
   entry for it.
3. **Move.** `vp run tm mv <ID> done`, no verification: the
   KPI and the scenarios were checked while the work ran.
4. **Score, decide, duplicate-check, show, wait, apply** exactly as in story-completion, with the
   epic reading of the rubric below. Include the [linked files](../story-completion/SKILL.md#linked-files)
   of the epic and of its stories that story-completion left in place: research, ideas and design
   drafts. A file that is still linked from a ticket outside this epic stays.
5. **Report**, and list the roadmap and docs edits.

## Epic reading of the rubric

| Section                                  | Usual outcome                                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal, Why and why now                    | History: keep, condensed to the problem and why it mattered then                                                                                                                  |
| KPI                                      | History: keep as the result, "target X, reached Y on <date>" (ask if unknown)                                                                                                     |
| Users and scenarios                      | Project where the scenario still describes behavior (`docs/user/`, `docs/scenarios/`), else delete                                                                                |
| Scope (in and out)                       | Out-of-scope rows with a reason are History; in-scope rows are implementation                                                                                                     |
| Functional / non-functional requirements | Built behavior: FR/NFR rows in `docs/scenarios/`; a constraint that outlives the epic: internals. The table itself is deleted; the AC to scenario-id mapping stays in the stories |
| Approach, alternatives considered        | Rejected alternatives and why: History. The chosen path: implementation                                                                                                           |
| Stories (candidates)                     | Delete; the stories are tickets. Keep a "Delivered by" list of story IDs and titles                                                                                               |
| Verification, Done when                  | Delete the plan. The result is in the KPI line                                                                                                                                    |
| Dependencies and sequencing              | Delete unless it records a decision about order that still binds (History)                                                                                                        |
| Risks                                    | A risk that happened, or a mitigation that became a rule: History or Project. Others: delete                                                                                      |
| Assumptions and unknowns                 | Verified or false with consequences: History. Still unverified: move to `docs/dev/questions.md`                                                                                   |
| Open questions                           | Unanswered: `docs/dev/questions.md`, retitled to stand alone. Answered: History or Project                                                                                        |
| Notes for stories                        | Rules a future story must follow: Project (docs or rules files). Rest: delete                                                                                                     |

Product and scope decisions made in the epic belong in `docs/dev/roadmap.md` if they are not there
yet; check, and do not duplicate.

## The epic after completion

```
## Goal            the outcome, as reached, in one or two sentences
## Result          the KPI: baseline, target, measured, date; guardrails
## Delivered by    child ticket IDs with their titles
## Decisions       decisions, reasons, dates, rejected options
## Docs            links to where the knowledge moved
## Follow-ups      what was cut or postponed and where it is tracked
```

Keep it to a page. Do not delete child tickets; they are the record of the work.

## Traps

- Do not complete an epic with an open story to tidy the board.
- The KPI result must come from a measurement in a ticket, PR or scenario output. If none exists,
  write `not measured` and say so in the report; never infer it.
- Anything still true and unverified leaves the ticket for `questions.md`, so it is not lost with
  the epic.
