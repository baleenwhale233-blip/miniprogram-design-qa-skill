# Executor Matrix

Use this priority order for evidence collection.

## 1. Primary executor

**WeChat DevTools CLI plus automation-capable native capture flow**

Use this when:

- the project is a WeChat mini-program
- WeChat DevTools CLI is installed
- the consumer project provides a helper or adapter that can drive capture

Confidence level: highest

Default implementation in this repo:

- `scripts/capture-devtools.mjs`
- wrapped by `scripts/capture-miniprogram.mjs`

## 2. Secondary executor

**Project-provided native screenshot adapters or hooks**

Use this when:

- the project already exposes a capture script, state-preparation hook, CI snapshot step, or simulator export flow
- screenshots still come from the native mini-program runtime

Confidence level: high

## 3. Fallback executor

**Manually supplied native screenshots**

Use this when:

- the runtime cannot be automated in the current environment
- the screenshots are still confirmed to come from the native mini-program runtime

Confidence level: medium

## 4. Supplemental evidence only

**Browser mirror or H5**

Use this only when:

- the project already exposes an H5 mirror
- the team wants structural or interaction side evidence

Do not treat this as the primary acceptance path for visual conclusions.

Confidence level: low for native visual fidelity

## Failure handling

- If the primary executor is unavailable, say so explicitly in the report
- If only fallback evidence exists, downgrade confidence instead of pretending full validation happened
- Do not claim a pass based only on code inspection when runtime evidence is unavailable
