<!--
Template for an epic body. `tm new epic` writes the frontmatter; keep it as generated and replace
everything below it with this structure. Delete these guidance comments when filling in.
Product level only: no libraries, schemas, file layouts or code. Those belong in stories.
Write `TBD (owner, date)` for anything unknown. Never leave a section out.
-->

# <Epic title: the outcome, not the activity>

## Goal

<!-- One sentence: what outcome, for whom. An outsider must be able to tell if it was reached. -->

## Why and why now

<!-- The problem or opportunity, the evidence, and the cost of not doing it. -->

## KPI

<!-- One primary KPI and at most two guardrails (must not get worse). The KPI need not be money. -->

| Metric | Kind      | Baseline | Target | Measured how and where | By when |
| ------ | --------- | -------- | ------ | ---------------------- | ------- |
|        | primary   |          |        |                        |         |
|        | guardrail |          |        |                        |         |

## Users and scenarios

<!-- Who, and 2-5 concrete scenarios that matter most. These are the scenarios we verify. -->

1. As a ..., I ... so that ...

## Scope

**In:**

-

**Out (non-goals, with a reason):**

-

## Functional requirements

<!-- What the product must do, as observable behavior, one per line, each testable. Product level:
say what the user can do, not how it is built. IDs are stable; stories cite them. -->

| ID   | Requirement | Priority (must / should / could) | Scenario |
| ---- | ----------- | -------------------------------- | -------- |
| FR-1 |             | must                             | 1        |

## Non-functional requirements

<!-- Qualities the result must have. Give each a measurable limit, or write why none applies.
Cover every row below; delete none. Probe-specific: performance is a product value here (no
continuously repainting animations, no dropped frames), and mobile must still compile. -->

| ID    | Quality                                                 | Requirement with a measurable limit | Not applicable because |
| ----- | ------------------------------------------------------- | ----------------------------------- | ---------------------- |
| NFR-1 | Performance                                             |                                     |                        |
| NFR-2 | Reliability and recovery                                |                                     |                        |
| NFR-3 | Security and privacy                                    |                                     |                        |
| NFR-4 | Compatibility (OS, browsers, agent CLIs, mobile impact) |                                     |                        |
| NFR-5 | Usability and accessibility                             |                                     |                        |
| NFR-6 | Observability (logs, status, how we tell it broke)      |                                     |                        |
| NFR-7 | Maintainability and docs                                |                                     |                        |

## Approach

<!-- How we achieve the goal, at product level: the main moves, their order, alternatives considered
and why they lost. No technology choices. -->

## Stories (candidates)

<!-- 2-8 stories. Each is big enough to carry its own plan, implementation and verification.
Created later with the story skill; this list is a sketch. -->

| #   | Title | Value in one line | Order / depends on |
| --- | ----- | ----------------- | ------------------ |
| 1   |       |                   |                    |

## Verification

<!-- How we know the goal is met, defined before work starts. -->

- **Traceability:** every FR and NFR above appears in one row; none is left unverified.

| Requirement | Verified by (scenario test / measurement / manual check) | Owner |
| ----------- | -------------------------------------------------------- | ----- |
| FR-1        |                                                          |       |

- **KPI measurement:**
- **Automated scenarios** (scenario tests, epic PRB.E-012): which of the scenarios above
- **Manual checks:** what, by whom
- **Sign-off:** who says it is done

## Dependencies and sequencing

<!-- Other epics, tools, decisions, people. Phase in memory/roadmap.md. -->

## Risks

<!-- What could make this fail or hurt. Not a duplicate of unknowns: a risk is a possible bad outcome. -->

| ID  | Risk | Likelihood / impact | Mitigation |
| --- | ---- | ------------------- | ---------- |
| R-1 |      |                     |            |

## Assumptions and unknowns

<!-- Everything we believe without proof (assumption) or do not know yet (unknown). Be exhaustive:
if the plan breaks when it is wrong, it belongs here. Unverified rows are copied to
memory/questions.md with this epic's ID. An epic with a `must` requirement that depends on an
unverified assumption is not ready to start; verify it in the first story. -->

| ID  | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner | Affects (FR / NFR / story) |
| --- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- | -------------------------- |
| A-1 |           | assumption                  | unverified                             |                        |       |                            |
| U-1 |           | unknown                     | unverified                             |                        |       |                            |

## Open questions

<!-- Decisions still to be made (not facts to find out; those are unknowns above). Each with an owner. -->

-

## Notes for stories

<!-- Technical ideas the user raised during the interview. Parked here for the story skill. -->

## Done when

<!-- Measurable checks, one line each; they restate the KPI target and the verification above. -->

- [ ]
