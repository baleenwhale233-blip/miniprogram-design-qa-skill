# Repair Policy

Auto-fix is enabled by default after the initial report, but only for **high-confidence front-end issues**.

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

- issues repaired automatically
- issues intentionally left for human confirmation
- residual risks after recheck
