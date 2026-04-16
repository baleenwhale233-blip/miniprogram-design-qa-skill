# Design Sources

`miniprogram-design-qa` supports three design reference inputs.

## Priority order

1. Figma node
2. Static design screenshot
3. Baseline screenshot from a prior accepted build
4. No design reference, runtime-only acceptance

## Figma node

Use when the user provides:

- a Figma URL
- a file key and node id
- an existing design context pipeline that can export node screenshots

Best for:

- feature work tied to a living design source
- design-to-code checks

## Static design screenshot

Use when:

- the team has a handoff screenshot
- the design is shared outside Figma

Best for:

- quick spot checks
- simple visual comparisons

## Baseline screenshot

Use when:

- the task is regression-oriented
- the accepted source of truth is a prior runtime capture

Best for:

- release validation
- “did this page drift?” comparisons

## No design reference

If no design reference exists:

- still run runtime acceptance
- still produce initial and final reports
- clearly say that design comparison was unavailable
