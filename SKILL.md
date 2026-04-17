---
name: miniprogram-design-qa
description: Run native visual and interaction acceptance for WeChat mini-program pages by collecting runtime screenshots, comparing them with design references, and producing structured acceptance reports within a repair-loop workflow. Trigger when the user asks for mini-program acceptance, visual QA, screenshot diff, design comparison, WeChat mini-program review, or 原生小程序验收.
---

# Miniprogram Design QA

Use this skill for **native WeChat mini-program acceptance**.

This skill is native-runtime first:

- Prefer WeChat DevTools automation or project-provided native screenshot adapters
- Do not treat Playwright or H5 mirrors as the primary evidence path
- Treat H5 only as optional supplemental evidence when the project already exposes it
- Support local design screenshots or baseline screenshots as built-in compare inputs
- Allow Figma node metadata in scenarios for external/export workflows
- Default to a closed loop: initial acceptance, externally applied high-confidence front-end repair, and re-acceptance

## When To Use

Use this skill when the user asks for any of the following:

- mini-program acceptance
- native WeChat UI QA
- design comparison against local screenshots/baselines or scenarios linked to Figma metadata
- screenshot diff or regression check for a mini-program page
- 原生小程序页面验收
- 前端验收 with a mini-program runtime

Do not use this as the primary skill for browser-only pages. Use a browser-focused QA skill instead.

## Workflow

1. Detect the target project and available native executor with `scripts/detect-project.mjs`.
2. Load an explicit QA scenario file or discover one from the consumer project.
3. Launch or connect to WeChat DevTools with `scripts/launch-devtools.mjs` when native automation is available.
4. Prefer native runtime evidence with `scripts/capture-devtools.mjs`, or use `scripts/capture-miniprogram.mjs` as the fallback-aware wrapper.
5. If a design reference is present, normalize and compare screenshots with:
   - `scripts/normalize-images.mjs`
   - `scripts/compare-images.mjs`
6. When you want the full evidence chain in one command, prefer `scripts/run-qa-pipeline.mjs`.
7. Build an initial `前端验收报告（初验）`.
8. Classify findings with `scripts/classify-findings.mjs`.
9. Classify high-confidence front-end repair candidates according to the repair policy. Any actual source-code repair is performed by an external agent or engineer.
10. Re-run capture and comparison for impacted scenarios.
11. Build a final `前端验收报告（复验）`.

## Required Behavior

- Always distinguish initial findings from post-repair findings.
- Always separate:
  - conclusions from native runtime evidence
  - conclusions from design-reference comparison
  - lower-confidence conclusions from fallback/manual evidence
- Never claim strong visual confidence from H5 alone.
- Never auto-fix ambiguous design intent, business rules, or backend/data correctness issues.
- Prefer explicit ready signals over blind sleeps.
- Prefer segmented screenshots for long pages.
- For tabbed pages, prefer route/query-driven initial state instead of capture-time taps.
- Only use capture-time tab switching when the task explicitly needs interaction validation.
- Treat route/query-driven tab entry as the default for visual and state acceptance, not as a page-specific exception.
- Use `ignoreRegions` when you want the built-in compare step to ignore selector-backed regions. If the active capture path cannot resolve selector geometry, report that limitation instead of assuming the mask was applied.

## Scenario Contract

This skill is driven by a scenario JSON file. The core fields are:

- `id`
- `route`
- `query`
- `fixture`
- `viewport`
- `readySignal`
- `capture`
- `design`
- `ignoreRegions`
- `notes`

Read [references/scenario-schema.md](references/scenario-schema.md) before creating or editing scenarios.

## Repair Policy

Use [references/repair-policy.md](references/repair-policy.md) to decide whether a finding is eligible for an external repair step.

## Executor Policy

Use the executor order in [references/executor-matrix.md](references/executor-matrix.md):

1. WeChat DevTools CLI plus automation-capable native capture flow
2. Project-provided native screenshot adapters or hooks
3. Manually supplied native screenshots
4. H5 or browser mirrors as supplemental evidence only

Platform defaults such as common DevTools CLI paths, default ports, and `.qa-output/` are convenience defaults only. They must remain overridable and should never be treated as the only supported environment.

## Design Sources

Supported design inputs:

- design screenshot
- baseline screenshot
- Figma node metadata
- runtime-only acceptance when no design reference exists

Read [references/design-sources.md](references/design-sources.md) for input precedence and fallback behavior.
