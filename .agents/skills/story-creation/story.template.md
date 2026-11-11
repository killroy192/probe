<!--
Template for a story body. `tm new story` writes the frontmatter; keep it as generated and replace
everything below it with this structure. Delete these guidance comments when filling in.
Section titles must match exactly (see SKILL.md). Never leave a section out; write
`TBD (owner, date)` for anything unknown.
Implementation-agnostic: no code, pseudocode, diffs, file edit sequences or design decisions.
Those belong in the plan stage.
-->

# <Story title: one outcome, not an activity>

## Business Goal

<!-- Why this matters to users or the product, as outcomes rather than implementation.
Two parts: the problem or pain, and the proposed solution in one or two sentences. -->

**Problem:**

**Proposed solution:**

## Epic and Requirements

<!-- The parent epic (same as `parent` in the frontmatter), and which of its requirements this story
delivers. Cite epic IDs exactly; the reviewer checks they exist. Say which candidate story in the
epic this is. -->

- **Epic:** PRB.E-NNN <title>
- **Candidate story:** # <n> <title> (or why it is not on the list)
- **Delivers:** FR-n, NFR-n (one line each on what part of the requirement this story covers)
- **One deployable outcome:** <!-- One sentence: what a user can do or observe once this ships to
  production alone, and how that contributes to the epic goal. If it only makes sense together
  with another story, say so under Dependencies or split it. -->

## Current Behavior

<!-- Factual, verified against the code (via `mcp__cocoindex-code__search` or by reading files),
split by layer where useful (terminal UI, server, data, mobile). Cite file paths. Mark anything not
verified as `unverified` and add it to Assumptions. Do not describe desired behavior here. -->

## Expected Behavior

<!-- User-visible and system-visible behavior once the work is complete. -->

### User Flow

<!-- The expected journey, as numbered steps from the user's point of view. -->

### Edge Cases

<!-- Important edge cases and how each should behave. Number them (EC-1, ...) so acceptance
criteria can cite them. -->

### Error Handling

<!-- Behavior for failures, validation errors, unavailable services, permission issues. Number them
(ER-1, ...). -->

## Out Of Scope

<!-- Explicit exclusions to prevent scope creep, each with a reason or the story that covers it. -->

-

## Technical Scope

<!-- Which layers and kinds of change are touched (terminal UI, server API, contracts, data model,
integrations, mobile, docs). Names areas only. No steps, code, algorithms or design decisions.
State docs impact (which probe/docs pages change) and mobile impact (none, or what must still
compile or work). -->

- **Layers:**
- **Docs impact:**
- **Mobile impact:**

## Non-functional Requirements and Constraints

<!-- Limits the implementation must respect: required stack or conventions, integration
constraints, performance or operational limits, mandatory architecture rules. Only points that bind
the plan; cite the epic NFR when one applies. Do not describe the design. -->

-

## Acceptance Criteria

<!-- How this story is validated. Each criterion is independently testable, specific, and free of
implementation detail. Use Given / When / Then. Mark how it is checked: `auto` (scenario test) or
`manual` (and by whom). Map each to the epic requirement it satisfies. Together they must cover the
Expected Behavior, every edge case, and every error case. An `auto` criterion names the scenario
ids that check it; those scenarios verify `docs/scenarios` requirements, never the AC. -->

| ID   | Criterion (Given / When / Then) | Check (auto / manual) | Covers (FR / NFR / EC / ER) |
| ---- | ------------------------------- | --------------------- | --------------------------- |
| AC-1 | Given ..., when ..., then ...   | auto                  | FR-1                        |

## Dependencies

<!-- Stories, epics, decisions or people this story needs before it can ship. Use IDs. Write `None`
if none. No cycles. -->

| Depends on | Why | Status |
| ---------- | --- | ------ |
| PRB.T-NNN  |     |        |

## Assumptions

<!-- Everything we believe without proof (assumption) or do not know yet (unknown), scoped to this
story. Assumptions are not constraints. Be exhaustive: if the plan breaks when it is wrong, it
belongs here. Unverified rows that outlive this story go to docs/dev/questions.md. -->

| ID   | Statement | Kind (assumption / unknown) | Status (unverified / verified / false) | How and when to verify | Owner |
| ---- | --------- | --------------------------- | -------------------------------------- | ---------------------- | ----- |
| SA-1 |           | assumption                  | unverified                             |                        |       |
| SU-1 |           | unknown                     | unverified                             |                        |       |
