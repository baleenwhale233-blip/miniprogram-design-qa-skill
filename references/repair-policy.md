# Repair Policy

This repo supports a repair-loop workflow, but it does **not** currently rewrite source code by itself.

After the initial report, classification can identify high-confidence front-end issues that are good candidates for an external repair step performed by another agent or an engineer.

The existing `autoFixable` naming in JSON artifacts is retained for compatibility. Read it as “eligible repair candidate”, not “the repo will edit source code automatically”.

## Eligible categories

- spacing or alignment mistakes
- obvious layout breakage
- visual hierarchy mistakes already contradicted by the reference design
- safe-area or padding mistakes
- wrong or placeholder copy
- missing or broken empty/loading/error presentation
- clearly incorrect interaction affordances in front-end code

## Ineligible categories

- ambiguous design intent
- backend or data correctness
- business rules
- navigation or product flow decisions
- behavior requiring design approval
- anything that cannot be justified by the current reference evidence

## Eligibility rule

A finding is auto-fixable only when all of the following are true:

- confidence is at or above the configured threshold
- category is on the eligible list
- no product, design, or backend decision is still open
- the fix stays inside front-end code and established project conventions

## Output requirements

The final report must always separate:

- issues repaired in an external repair step
- issues intentionally left for human confirmation
- residual risks after recheck

Because the actual source-code repair step is external today, treat “repaired issues” as workflow input supplied to the final report, not as something this repo edits by itself.
