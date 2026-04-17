# Design Sources

`miniprogram-design-qa` supports local design reference inputs plus optional Figma metadata.

## Priority order

1. Static design screenshot
2. Baseline screenshot from a prior accepted build
3. Figma node metadata
4. No design reference, runtime-only acceptance

## Figma node metadata

Use when the user provides:

- a Figma URL
- a file key and node id
- an existing external workflow that can export node screenshots

Best for:

- preserving design linkage inside the scenario
- delegating export to an external Figma-aware workflow

Important:

- the built-in compare pipeline does **not** export screenshots from Figma
- `figmaFileKey` and `figmaNodeId` are treated as metadata only
- to run built-in image comparison, provide a local `designImagePath` or `baselineImagePath`

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
