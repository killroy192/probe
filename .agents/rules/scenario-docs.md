---
paths:
  - "docs/scenarios/**"
---

# Scenario doc rules

A scenario doc (`docs/scenarios/<slug>.md`, `<slug>` in kebab case) states one user goal of the
built product and the requirements that scenario tests verify. How the tests are written and run is
in [the scenario rules](scenarios.md); this file covers only the docs.

## Format

```markdown
# <The user goal, in plain words>

<One to three sentences: who does this, what they want, and the outcome.>

## Workflows

### <Workflow name>

1. <Step as the user does and sees it, mouse-first.>

<Optional mermaid flowchart or stateDiagram-v2, where it shows branches or states better than steps.>

- <Variant, refusal or edge outcome.>

## Requirements

| ID    | Requirement                                                     |
| ----- | --------------------------------------------------------------- |
| FR-1  | <One testable statement of built behavior, present tense.>      |
| NFR-1 | <A measurable quality with its limit, such as "within 3 s of".> |

## Related

- [<Doc title>](../user/<file>.md#<anchor>)
```

List a new file in the [index](../../docs/scenarios/README.md). `Related` links go to existing
`docs/user/`, `docs/internals/` and `docs/operations/` pages and headings. No prose beyond the format.

## Content

- **Only built behavior.** Each requirement is true of the code today. Planned work stays out.
- **Stable ids.** FRs then NFRs, numbered from 1 per file. An id is never reused or renumbered; a new
  row takes the next free number, and a removed one leaves a gap.
- **Observable terms only.** No ticket, AC or test ids, file paths or function names.
- **One testable statement per row.** Split an "and" list a test would check separately; merge
  near-duplicates.
- **Cross-cutting requirements live in one file.** Other files link to it instead of restating it.
- **An NFR states its limit** in user terms, and the perf scenario that measures it uses that limit.
- **Tests point at docs.** Scenarios cite requirements with `verifies`; a ticket maps its ACs to
  scenario ids. A scenario doc never lists tests.
- **Changing or removing a requirement** means updating the scenarios that verify it in the same
  change: the registry refuses a ref to an id the table no longer holds.
