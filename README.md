# miniprogram-design-qa

Native-first visual and interaction acceptance tooling for **WeChat mini-programs**.

This repository is intended to be shared as source on GitHub. It is not currently positioned as an npm package.

This repository is designed to be usable in two ways:

- as a Codex skill via [SKILL.md](./SKILL.md)
- as a general automation/tooling repo via `scripts/`, `templates/`, and `references/`

The core design goal is simple:

- collect **native runtime evidence**
- compare it with an optional design reference
- classify findings
- support a repair-loop workflow for high-confidence front-end issues
- produce initial and final Chinese QA reports

## What Is General vs Codex-Specific

These parts are agent-neutral and can be reused by any AI agent or engineer:

- [`scripts/`](./scripts)
- [`templates/qa-scenario.example.json`](./templates/qa-scenario.example.json)
- [`templates/qa-scenario.schema.json`](./templates/qa-scenario.schema.json)
- [`references/`](./references)

These parts are Codex-oriented metadata:

- [`SKILL.md`](./SKILL.md)
- [`agents/openai.yaml`](./agents/openai.yaml)

If another agent can read files, run shell commands, and edit project code, it can still use the general layer without understanding Codex skills.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy the scenario template into your mini-program project and adapt it:

```bash
cp templates/qa-scenario.example.json /path/to/consumer-project/qa/rescue-detail-owner.json
```

3. Detect the target project:

```bash
npm run qa:detect -- --project-root /path/to/consumer-project
```

4. Capture native screenshots from a configured scenario:

```bash
npm run qa:capture -- --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/rescue-detail-owner.json
```

Or call the native DevTools executor directly:

```bash
npm run qa:capture:devtools -- --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/rescue-detail-owner.json
```

5. If you have a design reference, normalize and compare:

```bash
npm run qa:normalize -- --actual actual.png --design design.png --output-dir .qa-output/normalized
npm run qa:compare -- --actual .qa-output/normalized/actual.normalized.png --design .qa-output/normalized/design.normalized.png --output .qa-output/diff.png
```

6. Classify findings and build reports:

```bash
npm run qa:classify -- --findings findings.json
npm run qa:report:initial -- --input initial-report.json
npm run qa:report:final -- --input final-report.json
```

7. Or run the pipeline end to end:

```bash
npm run qa:pipeline -- --mode initial --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/rescue-detail-owner.json
```

After fixes are applied, rerun in final mode:

```bash
npm run qa:pipeline -- --mode final --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/rescue-detail-owner.json --repaired-issues repaired-issues.json
```

## Consumer Project Contract

The consumer project should provide:

- one or more scenario JSON files
- stable routes and fixture/state setup
- explicit ready markers
- optional reserved masking metadata for dynamic regions
- optional project-local prepare/capture hooks or adapters

For tabbed screens, prefer entering the target tab through route/query state instead of relying on capture-time taps.

The default capture path is:

1. built-in native DevTools capture via `capture-devtools.mjs`
2. optional project-local adapter or hook
3. manual runtime screenshots

Recommended rule for tab scenarios:

1. Prefer route/query or another explicit initial-state mechanism to enter the target tab.
2. Use capture-time tap only when the task is explicitly validating the tab-switch interaction itself.
3. Treat route-driven tab entry as the default for visual/state acceptance because it is more stable and easier to reproduce.

Recommended interpretation:

- state acceptance: use route/query to enter the correct tab or sub-state
- interaction acceptance: use capture-time taps only when the task is specifically about validating the tab-switch interaction

The recommended scenario contract is documented in:

- [references/scenario-schema.md](./references/scenario-schema.md)
- [templates/qa-scenario.schema.json](./templates/qa-scenario.schema.json)
- [references/output-artifacts.md](./references/output-artifacts.md)

Machine-readable outputs are intended for external agents and scripts to consume directly. Use the output-artifacts reference instead of inferring JSON shapes from source code.

## Evidence Policy

This repo is **native-runtime first**.

- Primary: WeChat DevTools CLI plus native capture flow
- Secondary: project-provided native screenshot adapters or hooks
- Fallback: manual native screenshots
- Supplemental only: H5 or browser mirrors

Do not treat H5 as the primary visual truth for a native mini-program page.

## Defaults and Configuration

Some scripts include configurable defaults for convenience, such as:

- common WeChat DevTools CLI installation paths on macOS
- a default DevTools automation port
- `.qa-output/` as the default working output directory

These are **overridable defaults**, not required environment bindings.

- CLI arguments always take precedence over defaults
- consumer projects should treat those defaults as examples, not as the only supported setup

Environment-variable overrides:

- `WECHAT_DEVTOOLS_CLI` or `MINIPROGRAM_QA_DEVTOOLS_CLI`
- `MINIPROGRAM_QA_PORT`
- `MINIPROGRAM_QA_OUTPUT_DIR`

Example override for CI-like or non-default environments:

```bash
WECHAT_DEVTOOLS_CLI=/path/to/cli \
MINIPROGRAM_QA_PORT=41001 \
MINIPROGRAM_QA_OUTPUT_DIR=.qa-output-ci \
npm run qa:capture -- --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/example.json
```

## Repair Loop Policy

The default workflow includes:

1. initial acceptance
2. classification of findings
3. optional external repair of high-confidence front-end issues
4. re-capture and re-check
5. final acceptance report

See [references/repair-policy.md](./references/repair-policy.md) for the exact boundary.

## Current Scope

First-class support in v1:

- WeChat mini-programs
- Taro projects targeting `weapp`
- native screenshot comparison against local design screenshots or local baseline screenshots
- Figma node metadata in scenarios for external/export workflows

Out of scope in v1:

- H5-first QA workflows
- generic multi-platform mini-program support
- in-repo source-code repair for ambiguous product or design decisions

## Known Limitations

- WeChat mini-program is the first-class runtime target in v1.
- DevTools automation can still be flaky depending on local machine state, installed DevTools version, and automation-port availability.
- `capture-devtools` is usable and now returns structured phase errors, but runtime stability still depends on WeChat DevTools automation behaving consistently.
- `run-qa-pipeline` is available for `capture -> compare -> classify -> report`, but source-code repair still depends on an external agent or engineer between phases.
- `figmaFileKey` and `figmaNodeId` are metadata only; the built-in pipeline does not export screenshots from Figma.
- `ignoreRegions` is applied by the built-in compare pipeline only when capture metadata can resolve selector geometry. Fallback/manual capture may not provide enough geometry, in which case the pipeline emits a warning instead of silently masking.

## Commands

- `npm run qa:detect -- --project-root <path>`
- `npm run qa:launch -- --project-root <path>`
- `npm run qa:capture:devtools -- --project-root <path> --scenario <file>`
- `npm run qa:capture -- --project-root <path> --scenario <file>`
- `npm run qa:normalize -- --actual <file> --design <file> --output-dir <dir>`
- `npm run qa:compare -- --actual <file> --design <file> --output <file>`
- `npm run qa:classify -- --findings <file>`
- `npm run qa:report:initial -- --input <file>`
- `npm run qa:report:final -- --input <file>`
- `npm run qa:pipeline -- --mode initial|final --project-root <path> --scenario <file>`
- `npm run smoke`
