# Scenario Schema

`miniprogram-design-qa` is driven by JSON scenario files supplied by the consumer project.

Machine-readable validation is available in [templates/qa-scenario.schema.json](../templates/qa-scenario.schema.json).

## Common top-level fields

- `id`: Stable scenario identifier. Required by schema.
- `route`: WeChat mini-program route, for example `pages/rescue/detail/index`. Required by schema.
- `query`: Route params object. Optional. Prefer using this to enter target tabs, filters, or page sub-states when the page supports route-driven state.
- `fixture`: Logical fixture or state name used by the consumer project. Optional.
- `viewport`: Runtime viewport configuration. Required by schema.
- `readySignal`: Explicit signal that the page is stable enough to capture. Required by schema.
- `capture`: Capture configuration. Required by schema.
- `design`: Design-reference metadata. Optional in schema; the built-in compare step only consumes local `designImagePath` or `baselineImagePath`.
- `ignoreRegions`: Optional masking selectors. The built-in compare step applies them when capture metadata can resolve selector geometry.
- `notes`: Human-readable warnings or setup notes. Optional in schema.

## Suggested JSON shape

```json
{
  "id": "rescue-detail-owner",
  "route": "pages/rescue/detail/index",
  "query": {
    "caseId": "sample-case",
    "mode": "owner",
    "tab": "detail"
  },
  "fixture": "sample-case",
  "viewport": {
    "width": 390,
    "height": 844,
    "deviceScaleFactor": 2
  },
  "readySignal": {
    "type": "selector",
    "value": ".detail-page-shell",
    "timeoutMs": 10000,
    "stableMs": 500
  },
  "capture": {
    "mode": "fullPage",
    "devtools": true,
    "navigationMode": "relaunch",
    "fullPage": true,
    "segments": [
      "header",
      "hero",
      "timeline",
      "bottom-bar"
    ],
    "segmentSelectors": {
      "header": ".detail-header",
      "hero": ".detail-hero",
      "timeline": ".detail-timeline",
      "bottom-bar": ".detail-bottom-bar"
    },
    "prepareCommand": "node scripts/project-prepare-qa.js",
    "helperCommand": "node scripts/project-capture.js",
    "manualFiles": []
  },
  "design": {
    "figmaFileKey": "abc123",
    "figmaNodeId": "123:456",
    "designImagePath": "",
    "baselineImagePath": ""
  },
  "ignoreRegions": [
    ".timestamp",
    ".avatar-image"
  ],
  "notes": [
    "Requires a logged-in owner fixture."
  ]
}
```

## Semantics

### `readySignal`

Supported v1 signal types:

- `selector`
- `text`
- `data-stable`
- `network-idle` as a backward-compatible alias for `data-stable`

Prefer explicit app-level markers instead of arbitrary waits.
`data-stable` means page-data stability polling, not browser-level network idle.

### `capture`

Required fields:

- `mode`: `viewport` or `fullPage`
- `segments`: list of stable named sections for long pages

Optional helper fields used by the provided scripts:

- `devtools`: whether the wrapper should attempt the built-in native DevTools executor first
- `helperCommand`: optional project-local capture adapter command that writes or returns native screenshots
- `prepareCommand`: optional project-local state-preparation command used before capture
- `navigationMode`: `relaunch` or `navigate`
- `fullPage`: explicit override for stitched full-page capture
- `segmentSelectors`: map from segment name to selector used for native cropping
- `manualFiles`: explicit screenshot file list
- `manualDirectory`: directory containing runtime screenshots

Supported optional timing fields:

- `timeoutMs`
- `stableMs`

### `design`

Built-in image comparison consumes one of the following local file inputs:

- `designImagePath`
- `baselineImagePath`

The following fields are metadata only:

- `figmaFileKey`
- `figmaNodeId`

### `ignoreRegions`

`ignoreRegions` is an optional list of selectors to ignore during built-in image comparison.

- built-in DevTools capture can resolve selector geometry and pass the resulting rectangles into compare
- manual or adapter fallback may not provide enough geometry, in which case the pipeline emits a warning instead of silently masking

## Stability guidance

- Use deterministic fixture names
- Add clear ready markers to the app
- Break long pages into segments
- Mask timestamps, avatars, random imagery, and upload placeholders
- For tabbed pages, prefer route/query-driven tab entry over capture-time taps
- Reserve tap-based tab switching for flows that explicitly need interaction validation

Recommended default:

- visual/state QA should enter tab or sub-state via route/query
- interaction QA may add capture-time tap steps only when the interaction itself is in scope
