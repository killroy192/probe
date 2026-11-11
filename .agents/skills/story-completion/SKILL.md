---
name: story-completion
description: Close a finished Probe story or bug (PRB.T-NNN) - move it from in-progress to done without verifying it, score its body, move lasting project knowledge into docs, keep a short history in the ticket and delete the planning and implementation detail. Use when the user says a task is done, merged or should be completed or closed.
---

# Story completion

Runs after the work merged. It does not verify the implementation (that is
[verify-story-implementation](../verify-story-implementation/SKILL.md), earlier). It turns a long
working ticket into a short record and puts what the project still needs where
[AGENTS.md](../../../AGENTS.md#documentation) says it goes. The ticket is the work's history, not its
documentation.

## Workflow

1. **Load.** `vp run tm show <ID>` and its epic. Read the merged diff or PR if the user names one;
   the code is the truth when the ticket and the code disagree.
2. **Move.** `vp run tm mv <ID> done`. Do this first and
   unconditionally; the compression below can fail without leaving the status wrong.
3. **Split** the body into chunks: one section, table row group or decision paragraph each.
4. **Score** every chunk 0 to 2 on three dimensions (rubric below). Write the result as a table:
   chunk, three scores, action.
5. **Decide** per chunk with the table below. Do the same for every linked side file (see
   [Linked files](#linked-files)).
6. **Check for duplicates** before writing any docs text: search `docs/user`, `docs/operations`,
   `docs/internals`, `docs/dev/roadmap.md` and the glossary (`cocoindex-code` MCP, then grep). Text
   that is already there is deleted from the ticket, not copied. Text that contradicts the docs is
   a finding: fix the docs, or say so.
7. **Show the table and the planned docs edits, and wait for approval.** Deleting is the one step
   that is hard to undo outside git. Skip the wait only when the user said to proceed unattended.
8. **Apply.** Write the docs, rewrite the ticket body, delete the rows of this ticket from
   `docs/dev/questions.md` (a still-open question stays, retitled to stand alone). `vp run tm check`.
   Do not commit unless asked; reference the ID when you do.
9. **Report**: status moved, docs files touched, chunks kept, chunks deleted, what you were unsure about.

## Scoring rubric

Score each chunk on each dimension: **0** none, **1** some, **2** a lot.

| Dimension                 | Ask                                                                          | 2 means                                                                                |
| ------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **History**               | Would someone later need to know what we decided, why, or what we ruled out? | A decision with its reason, a rejected option, a user ruling with its date, a trap hit |
| **Project**               | Is it true of the built system and does a maintainer, user or agent need it? | A constraint, behavior or procedure that code, types and tests do not show             |
| **Implementation / plan** | Did it only help build, review or verify this story?                         | Step lists, file and symbol inventories, test plans, AC tables, probing notes, scratch |

A chunk can score high on several. Judge "project" strictly: if reading the code answers it, it is
a 0. A restated acceptance criterion is implementation, not history.

## Decision

Apply the first row that matches.

| Scores              | Action                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Project 1 or 2      | **Docs.** Compose it as the shortest text that stays true, in the right place (below). Already there: delete. |
| and History 1 or 2  | Also keep one line in the ticket's History pointing at the doc.                                               |
| History 1 or 2      | **Keep in the ticket**, condensed to the decision and its reason, with dates and PR or commit.                |
| Only Implementation | **Delete.** No summary, no pointer.                                                                           |
| All 0               | **Delete.**                                                                                                   |

Where project text goes (from AGENTS.md): architecture, cross-component constraints and traps to
`docs/internals/`; procedures to `docs/operations/`; how to use a shipped feature to `docs/user/`;
requirements of built behavior to the FR/NFR tables in `docs/scenarios/` (the AC to scenario-id
mapping stays in the ticket's Delivered);
a product or scope decision to `docs/dev/roadmap.md`; an unverified claim that spans tickets stays in
`docs/dev/questions.md`. Follow the documentation rules there: no field lists, no control flow, no
PR summaries; a local reason the code cannot show is a code comment, not a doc.

## Linked files

A ticket links side material in `docs/dev/research/` (spikes, studies), `docs/dev/ideas/`,
`docs/dev/design/` and rows of `docs/dev/questions.md`. Find them by the links in the body and by
grepping `docs/dev` for the ticket ID. Each one is scored with the same rubric, as a whole file or
by section, and then:

- **Project 1 or 2** (a finding, constraint or trap that is still true of the built system):
  compose it into the right doc, after the duplicate check. This is the common case for a spike
  whose result shaped the code.
- **Otherwise** delete the file, and keep at most a line of its History in the ticket (its
  finding, not its path).
- **Another ticket, idea or design still needs it** (grep for its path and title first): leave it,
  and say so. Never delete a file something else links to; fix or remove those links first.
- A `questions.md` row for this ticket: answered rows are folded into the ticket or a doc and
  deleted; a still-open row stays, retitled to stand alone.
- An idea or design draft that was built is documented in `docs/internals/` or `docs/user/` and
  deleted; one that was not built and is not this ticket's is left alone.

After deleting a file, no link to its path may remain in `docs/dev`; the Docs section of the ticket
links to the docs it moved into, not to the deleted file.

## The ticket after completion

Keep the frontmatter (`tm` owns it) and the H1. Replace the body with these sections, omitting one
only when it would be empty:

```
## Goal            one or two sentences: the problem and the outcome, as delivered
## Delivered       what shipped, in the user's terms; PR or commit; scenario or test names that prove it
## Decisions       each decision, its reason, the date and who made it; rejected options in a clause
## Docs            links to the docs this ticket's knowledge moved into
## Follow-ups      what was left out and where it is tracked (ticket ID or questions.md)
```

Target well under a page. Epic requirement IDs (FR-n, NFR-n) the story satisfied may stay in
Delivered as a list; the AC table, plans, current-behavior investigation, technical scope, test
inventories and handoff notes do not.

## Traps

- Do not delete a history chunk because it looks long; condense it. Do not keep an implementation
  chunk because it took effort to write.
- Never invent history. If the reason for a decision is not in the ticket, the PR or the code,
  keep the decision and drop the reason rather than guess.
- A story that did not merge is not completed: stop and ask.
- A spike report is evidence, not documentation: do not keep it only because it is well written.
- Never edit `ids.json` or frontmatter by hand; use `tm`.
