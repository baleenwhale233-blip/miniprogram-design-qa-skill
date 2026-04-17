# Evals

This directory contains small prompt-level and contract-level examples for checking whether `miniprogram-design-qa` should trigger and how it should be interpreted.

## Files

- `trigger-cases.jsonl`

## Minimal usage

Read the cases and verify:

- `should_trigger`
- `why`
- whether the case implies:
  - native mini-program acceptance
  - browser-only work that should not use this skill
  - runtime-only acceptance
  - local-design compare
  - Figma metadata only

These evals do not require WeChat DevTools. They are intended to validate trigger/contract understanding, not runtime capture.
