# Output Artifacts

This repo writes machine-readable JSON artifacts intended to be consumed by other agents, scripts, or engineers.

## `capture-metadata.json`

Written by:

- `scripts/capture-devtools.mjs`
- `scripts/capture-miniprogram.mjs`

Core fields:

- `scenarioId`
- `scenarioPath`
- `projectRoot`
- `route`
- `query`
- `fixture`
- `viewport`
- `readySignal`
- `captureMode`
- `navigationMode`
- `executor`
- `evidenceSource`
- `screenshots`
- `baseScreenshot`
- `frameScreenshots`
- `segmentScreenshots`
- `segments`
- `ignoreRegions`
- `warnings`

Notes:

- `segmentScreenshots` is populated only when segment capture is available.
- `ignoreRegions` contains resolved rectangle geometry only when the active capture path can map scenario selectors to image coordinates.
- manual or adapter fallback may return fewer executor details than built-in DevTools capture.

## `findings.json`

Written by:

- `scripts/run-qa-pipeline.mjs`

Core fields:

- `scenarioId`
- `findings`

Each finding may include:

- `id`
- `title`
- `category`
- `confidence`
- `requiresHumanApproval`

## `classification.json`

Written by:

- `scripts/classify-findings.mjs`
- `scripts/run-qa-pipeline.mjs`

Core fields:

- `policy.minConfidence`
- `policy.allowedCategories`
- `summary.totalFindings`
- `summary.autoFixable`
- `summary.manualReview`
- `autoFixable`
- `manualReview`

Notes:

- classification identifies repair candidates
- it does not perform source-code repair

## `initial-report.json` / `final-report.json`

Written by:

- `scripts/run-qa-pipeline.mjs`

Initial report JSON typically contains:

- `subject`
- `evidence`
- `results`
- `findings`
- `autoFixable`
- `manualReview`

Final report JSON typically contains:

- `subject`
- `evidence`
- `repairedIssues`
- `recheckResults`
- `residualRisks`
- `conclusion`

Notes:

- `repairedIssues` is externally supplied workflow input when a repair phase exists
- the repo does not currently rewrite source code itself

## `pipeline-summary.json`

Written by:

- `scripts/run-qa-pipeline.mjs`

Core fields:

- `mode`
- `scenarioId`
- `outputDir`
- `captureMetadataPath`
- `findingsPath`
- `classificationPath`
- `reportJsonPath`
- `reportMdPath`
- `compareSummary`
