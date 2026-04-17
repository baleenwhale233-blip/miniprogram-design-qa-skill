# Release Notes

## Initial public release

This release establishes `miniprogram-design-qa` as a native-first QA toolkit for WeChat mini-programs.

### Highlights

- Added a built-in native DevTools capture path
- Added a fallback-aware capture wrapper for:
  - built-in DevTools capture
  - project-local capture adapters/hooks
  - manual runtime screenshots
- Added an initial/final pipeline for:
  - capture
  - compare
  - classify
  - report
- Added machine-readable output artifact documentation
- Tightened the public contract so docs, schema, and code align more closely
- Documented route/query-driven tab entry as the default strategy for state-oriented tab QA
- Added built-in ignore-region masking support when capture metadata can resolve selector geometry

### What works now

- Native runtime capture for WeChat mini-program pages
- Scenario-driven QA using:
  - route
  - query
  - viewport
  - readySignal
  - segmentSelectors
- Built-in compare against local:
  - design screenshots
  - baseline screenshots
- Repair-loop workflow support:
  - findings classification
  - external repair step
  - final recheck reporting
- `ignoreRegions` masking when selector geometry is available
- Machine-readable outputs for:
  - capture metadata
  - findings
  - classification
  - reports
  - pipeline summary

### Important contract clarifications

- This repository does **not** currently rewrite source code by itself
- Figma support is currently **metadata-oriented**
  - `figmaFileKey` and `figmaNodeId` can live in scenarios
  - built-in compare does **not** export screenshots from Figma
- Built-in visual comparison is based on local image inputs:
  - `designImagePath`
  - `baselineImagePath`
- `network-idle` is treated as a backward-compatible alias for page-data stability polling, not true browser-level network idle
- For tabbed pages, the default QA strategy is:
  - route/query-driven initial state for visual/state validation
  - capture-time tap only when the tab-switch interaction itself is in scope

### Known limitations

- WeChat mini-program is the first-class supported runtime in this release
- DevTools automation can still be sensitive to local machine state and automation session readiness
- Fallback/manual capture paths may provide reduced masking behavior for `ignoreRegions`
- In-repo source-code repair is intentionally out of scope; repair remains an external agent/engineer step

### Main commands

- `npm run qa:detect`
- `npm run qa:launch`
- `npm run qa:capture:devtools`
- `npm run qa:capture`
- `npm run qa:pipeline`
- `npm run qa:compare`
- `npm run qa:classify`
- `npm run smoke`
