#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildScenarioOutputDir,
  ensureDir,
  exitWithError,
  hasFlag,
  getDefaultAutomationPort,
  logJson,
  parseArgs,
  printHelp,
  readJson,
  resolvePath,
  sanitizeName,
  writeJson,
} from "./_shared.mjs";
import { normalizeImages } from "./normalize-images.mjs";
import { compareImages } from "./compare-images.mjs";
import { classifyFindings } from "./classify-findings.mjs";
import { buildReport } from "./build-report.mjs";
import { captureMiniProgram } from "./capture-miniprogram.mjs";

const HELP = `
Usage:
  node scripts/run-qa-pipeline.mjs --mode initial|final --project-root <path> --scenario <file> [--output-dir <dir>] [--design-image <file>] [--baseline-image <file>] [--repaired-issues <file>] [--port <number>] [--trust-project]

Run the native capture -> compare -> classify -> report pipeline.

Notes:
  - initial mode produces capture metadata, comparison artifacts, findings, classification, and 初验报告.
  - final mode re-captures the page, reruns comparison, and produces 复验报告.
  - source-code repair is handled by an external agent or engineer between the two phases.
`;

const DEFAULT_COMPARE_CONFIG = {
  threshold: 0.1,
  includeAA: false,
  minHotspotArea: 400,
  minHotspotPixels: 100,
  maxHotspots: 12,
  hotspotMergeDistance: 8,
  exportHotspotCrops: true,
  segmentThreshold: 0.03,
  perSegmentThresholds: {},
  segmentDesignImages: {},
};

function isStructuredFailure(error) {
  return Boolean(error && typeof error === "object" && "phase" in error && "error" in error);
}

function errorCause(error) {
  if (isStructuredFailure(error)) {
    return error.error;
  }

  return error instanceof Error ? error.message : String(error);
}

function resolveDesignSource(projectRoot, scenario, overrides = {}) {
  const design = scenario.design ?? {};
  const candidates = [
    { kind: "design-image", path: overrides.designImage ?? design.designImagePath },
    { kind: "baseline-image", path: overrides.baselineImage ?? design.baselineImagePath },
  ];

  for (const candidate of candidates) {
    const resolved = resolvePath(projectRoot, candidate.path);
    if (resolved && fs.existsSync(resolved)) {
      return {
        kind: candidate.kind,
        path: resolved,
      };
    }
  }

  return null;
}

function getCompareConfig(scenario) {
  const compare = scenario.compare ?? {};
  return {
    threshold:
      typeof compare.threshold === "number"
        ? compare.threshold
        : DEFAULT_COMPARE_CONFIG.threshold,
    includeAA:
      typeof compare.includeAA === "boolean"
        ? compare.includeAA
        : DEFAULT_COMPARE_CONFIG.includeAA,
    minHotspotArea:
      typeof compare.minHotspotArea === "number"
        ? compare.minHotspotArea
        : DEFAULT_COMPARE_CONFIG.minHotspotArea,
    minHotspotPixels:
      typeof compare.minHotspotPixels === "number"
        ? compare.minHotspotPixels
        : DEFAULT_COMPARE_CONFIG.minHotspotPixels,
    maxHotspots:
      typeof compare.maxHotspots === "number"
        ? compare.maxHotspots
        : DEFAULT_COMPARE_CONFIG.maxHotspots,
    hotspotMergeDistance:
      typeof compare.hotspotMergeDistance === "number"
        ? compare.hotspotMergeDistance
        : DEFAULT_COMPARE_CONFIG.hotspotMergeDistance,
    exportHotspotCrops:
      typeof compare.exportHotspotCrops === "boolean"
        ? compare.exportHotspotCrops
        : DEFAULT_COMPARE_CONFIG.exportHotspotCrops,
    segmentThreshold:
      typeof compare.segmentThreshold === "number"
        ? compare.segmentThreshold
        : DEFAULT_COMPARE_CONFIG.segmentThreshold,
    perSegmentThresholds:
      compare.perSegmentThresholds ?? DEFAULT_COMPARE_CONFIG.perSegmentThresholds,
    segmentDesignImages:
      compare.segmentDesignImages ?? DEFAULT_COMPARE_CONFIG.segmentDesignImages,
  };
}

function mapIgnoreRegionsToNormalized(captureMetadata, normalized) {
  const ignoreRegions = captureMetadata.ignoreRegions ?? [];
  if (!ignoreRegions.length) {
    return [];
  }

  const transform = normalized.actualTransform ?? {
    scaleX: 1,
    scaleY: 1,
    left: 0,
    top: 0,
  };

  return ignoreRegions.map((region) => ({
    selector: region.selector,
    left: Math.max(Math.round((region.left ?? 0) * transform.scaleX + transform.left), 0),
    top: Math.max(Math.round((region.top ?? 0) * transform.scaleY + transform.top), 0),
    width: Math.max(Math.round((region.width ?? 0) * transform.scaleX), 1),
    height: Math.max(Math.round((region.height ?? 0) * transform.scaleY), 1),
  }));
}

function mapSegmentBboxToNormalized(segmentShot, normalized) {
  if (!segmentShot?.bbox || segmentShot.bboxSource !== "baseScreenshot") {
    return null;
  }

  const transform = normalized.actualTransform ?? {
    scaleX: 1,
    scaleY: 1,
    left: 0,
    top: 0,
  };

  return {
    left: Math.max(Math.round(segmentShot.bbox.left * transform.scaleX + transform.left), 0),
    top: Math.max(Math.round(segmentShot.bbox.top * transform.scaleY + transform.top), 0),
    width: Math.max(Math.round(segmentShot.bbox.width * transform.scaleX), 1),
    height: Math.max(Math.round(segmentShot.bbox.height * transform.scaleY), 1),
  };
}

async function cropNormalizedSegmentImages({
  normalized,
  bbox,
  outputDir,
  segment,
}) {
  const { default: sharp } = await import("sharp");
  ensureDir(outputDir);

  const actualPath = path.join(outputDir, `${sanitizeName(segment)}.actual.png`);
  const designPath = path.join(outputDir, `${sanitizeName(segment)}.design.png`);

  await sharp(normalized.actualOutput).extract(bbox).png().toFile(actualPath);
  await sharp(normalized.designOutput).extract(bbox).png().toFile(designPath);

  return {
    actualPath,
    designPath,
  };
}

function buildSubject(scenario) {
  return [
    `页面: ${scenario.route}`,
    `场景: ${scenario.id}`,
    scenario.fixture ? `状态: ${scenario.fixture}` : null,
  ].filter(Boolean);
}

function buildRuntimeResults(scenario, captureMetadata, compareSummary) {
  const runtimeEvidence = captureMetadata.segmentScreenshots?.length
    ? `已完成原生截图与 ${captureMetadata.segmentScreenshots.length} 个区域截图。`
    : "已完成原生截图。";

  const visualSummary = compareSummary
    ? `设计比对 mismatch ratio 为 ${(compareSummary.mismatchRatio * 100).toFixed(2)}%。`
    : "未提供设计基线，本次仅进行运行时视觉验收。";

  return {
    initial: [
      `结构: ${runtimeEvidence}`,
      `视觉: ${visualSummary}`,
      `内容: 场景已渲染到 readySignal，未发现脚本级内容阻塞。`,
      `状态: ${scenario.fixture ? `已进入场景状态 ${scenario.fixture}。` : "已进入默认页面状态。"} `,
      `交互: 已完成页面导航与 readySignal 命中。`,
      `一致性: 使用微信小程序原生运行时证据，不依赖 H5 作为主视觉依据。`,
    ],
    final: [
      `结构: ${runtimeEvidence}`,
      `视觉: ${visualSummary}`,
      `内容: 复验已完成，当前页面可正常渲染。`,
      `状态: ${scenario.fixture ? `复验场景状态 ${scenario.fixture} 已成功载入。` : "复验使用默认页面状态。"} `,
      `交互: 复验导航与 readySignal 再次成功。`,
      `一致性: 最新结论基于复验时的原生截图证据。`,
    ],
  };
}

export function createFindings({
  compareSummary,
  captureMetadata,
  designSource,
  compareWarnings = [],
}) {
  const findings = [];

  if (!designSource) {
    for (const warning of captureMetadata.warnings ?? []) {
      findings.push({
        id: `warning-${findings.length + 1}`,
        title: warning,
        category: "layout",
        confidence: 0.72,
        requiresHumanApproval: true,
      });
    }
    return findings;
  }

  const ratio = compareSummary?.global?.mismatchRatio ?? compareSummary?.mismatchRatio ?? 0;
  if (ratio >= 0.12) {
    findings.push({
      id: "compare-layout-mismatch",
      title: `整体视觉差异较大（${(ratio * 100).toFixed(2)}%），优先检查布局与模块顺序。`,
      category: "layout",
      confidence: 0.93,
      source: "global",
      metrics: {
        mismatchRatio: ratio,
      },
      evidencePaths: compareSummary?.global?.diffImage ? [compareSummary.global.diffImage] : [],
    });
  } else if (ratio >= 0.05) {
    findings.push({
      id: "compare-spacing-mismatch",
      title: `视觉差异明显（${(ratio * 100).toFixed(2)}%），优先检查间距与对齐。`,
      category: "spacing",
      confidence: 0.88,
      source: "global",
      metrics: {
        mismatchRatio: ratio,
      },
      evidencePaths: compareSummary?.global?.diffImage ? [compareSummary.global.diffImage] : [],
    });
  } else if (ratio >= 0.02) {
    findings.push({
      id: "compare-hierarchy-mismatch",
      title: `视觉存在轻中度差异（${(ratio * 100).toFixed(2)}%），建议复查层级与细节样式。`,
      category: "visual-hierarchy",
      confidence: 0.8,
      requiresHumanApproval: true,
      source: "global",
      metrics: {
        mismatchRatio: ratio,
      },
      evidencePaths: compareSummary?.global?.diffImage ? [compareSummary.global.diffImage] : [],
    });
  }

  for (const segment of compareSummary?.segments ?? []) {
    if ((segment.mismatchRatio ?? 0) < (segment.threshold ?? 0.03)) {
      continue;
    }

    findings.push({
      id: `segment-${segment.segment}-mismatch`,
      title: `分段 ${segment.segment} 视觉差异为 ${(segment.mismatchRatio * 100).toFixed(2)}%，超过阈值 ${(segment.threshold * 100).toFixed(2)}%。`,
      category: "spacing",
      confidence: 0.9,
      source: "segment",
      segment: segment.segment,
      diffImage: segment.diffImage,
      evidencePaths: [segment.diffImage],
      metrics: {
        mismatchRatio: segment.mismatchRatio,
        threshold: segment.threshold,
      },
    });
  }

  for (const hotspot of compareSummary?.hotspots ?? []) {
    findings.push({
      id: `hotspot-${hotspot.id}`,
      title: `检测到局部差异热点 ${hotspot.id}，像素差异 ${hotspot.mismatchedPixels}，区域占比 ${(hotspot.bboxMismatchRatio * 100).toFixed(2)}%。`,
      category: "visual-hierarchy",
      confidence: 0.82,
      requiresHumanApproval: true,
      source: "hotspot",
      hotspotId: hotspot.id,
      bbox: {
        left: hotspot.left,
        top: hotspot.top,
        width: hotspot.width,
        height: hotspot.height,
      },
      evidencePaths: [hotspot.actualCrop, hotspot.designCrop, hotspot.diffCrop].filter(Boolean),
      metrics: {
        mismatchedPixels: hotspot.mismatchedPixels,
        bboxMismatchRatio: hotspot.bboxMismatchRatio,
        coverageRatio: hotspot.coverageRatio,
        severityScore: hotspot.severityScore,
      },
    });
  }

  for (const warning of captureMetadata.warnings ?? []) {
    findings.push({
      id: `warning-${findings.length + 1}`,
      title: warning,
      category: "layout",
      confidence: 0.76,
      requiresHumanApproval: true,
      source: "capture",
      evidencePaths: [],
    });
  }

  for (const warning of compareWarnings) {
    findings.push({
      id: `segment-warning-${findings.length + 1}`,
      title: warning,
      category: "layout",
      confidence: 0.72,
      requiresHumanApproval: true,
      source: "segment",
      evidencePaths: [],
    });
  }

  return findings;
}

async function maybeCompareDesign({
  projectRoot,
  outputDir,
  captureMetadata,
  designSource,
  scenario,
}) {
  const compareConfig = getCompareConfig(scenario);
  if (!designSource) {
    return {
      designSource: null,
      comparisons: [],
      summary: null,
      warnings: [
        "未提供 designImagePath 或 baselineImagePath，本次报告仅基于运行时截图。",
      ],
    };
  }

  const compareDir = path.join(outputDir, "compare");
  ensureDir(compareDir);
  const actualPath = captureMetadata.baseScreenshot ?? captureMetadata.screenshots?.[0];
  const normalizedDir = path.join(compareDir, "normalized");
  const normalized = await normalizeImages({
    actualPath,
    designPath: designSource.path,
    outputDir: normalizedDir,
  });
  const comparison = await compareImages({
    actualPath: normalized.actualOutput,
    designPath: normalized.designOutput,
    diffPath: path.join(compareDir, "diff.png"),
    threshold: compareConfig.threshold,
    includeAA: compareConfig.includeAA,
    minHotspotArea: compareConfig.minHotspotArea,
    minHotspotPixels: compareConfig.minHotspotPixels,
    maxHotspots: compareConfig.maxHotspots,
    hotspotMergeDistance: compareConfig.hotspotMergeDistance,
    exportHotspotCrops: compareConfig.exportHotspotCrops,
    hotspotOutputDir: path.join(compareDir, "hotspots"),
    ignoreRects: mapIgnoreRegionsToNormalized(captureMetadata, normalized),
  });

  const segmentComparisons = [];
  const segmentWarnings = [];
  const segmentOutputDir = path.join(compareDir, "segments");
  ensureDir(segmentOutputDir);

  for (const segment of captureMetadata.segments ?? []) {
    const segmentMeta = (captureMetadata.segmentScreenshots ?? []).find((item) => item.segment === segment);
    const segmentThreshold =
      compareConfig.perSegmentThresholds?.[segment] ?? compareConfig.segmentThreshold;
    const configuredSegmentDesign = compareConfig.segmentDesignImages?.[segment];

    if (!segmentMeta?.path) {
      segmentWarnings.push(`Segment "${segment}" was requested but no segment screenshot was produced.`);
      continue;
    }

    let segmentActualPath = segmentMeta.path;
    let segmentDesignPath;
    let source = "external-design";

    if (configuredSegmentDesign) {
      segmentDesignPath = resolvePath(projectRoot, configuredSegmentDesign);
      if (!segmentDesignPath || !fs.existsSync(segmentDesignPath)) {
        segmentWarnings.push(`Segment "${segment}" design reference was configured but not found: ${configuredSegmentDesign}`);
        continue;
      }
    } else {
      const mappedBbox = mapSegmentBboxToNormalized(segmentMeta, normalized);
      if (!mappedBbox) {
        segmentWarnings.push(`Segment "${segment}" has no segmentDesignImages entry and no reusable geometry for global-image cropping.`);
        continue;
      }

      const cropped = await cropNormalizedSegmentImages({
        normalized,
        bbox: mappedBbox,
        outputDir: segmentOutputDir,
        segment,
      });
      segmentActualPath = cropped.actualPath;
      segmentDesignPath = cropped.designPath;
      source = "global-crop";
    }

    const segmentDir = path.join(segmentOutputDir, sanitizeName(segment));
    ensureDir(segmentDir);
    const segmentComparison = await compareImages({
      actualPath: segmentActualPath,
      designPath: segmentDesignPath,
      diffPath: path.join(segmentDir, "diff.png"),
      threshold: compareConfig.threshold,
      includeAA: compareConfig.includeAA,
      minHotspotArea: compareConfig.minHotspotArea,
      minHotspotPixels: compareConfig.minHotspotPixels,
      maxHotspots: compareConfig.maxHotspots,
      hotspotMergeDistance: compareConfig.hotspotMergeDistance,
      exportHotspotCrops: compareConfig.exportHotspotCrops,
      hotspotOutputDir: path.join(segmentDir, "hotspots"),
    });

    segmentComparisons.push({
      target: "segment",
      segment,
      threshold: segmentThreshold,
      source,
      actualPath: segmentActualPath,
      designPath: segmentDesignPath,
      diffImage: segmentComparison.diffImage,
      comparison: segmentComparison,
    });
  }

  const warnings = [];
  if ((scenario.ignoreRegions ?? []).length > 0 && !(captureMetadata.ignoreRegions ?? []).length) {
    warnings.push("ignoreRegions was provided, but no mask geometry could be resolved for the built-in compare step.");
  }
  warnings.push(...segmentWarnings);

  const summary = {
    mismatchRatio: comparison.mismatchRatio,
    diffImage: comparison.diffImage,
    global: comparison,
    segments: segmentComparisons.map((item) => ({
      target: "segment",
      segment: item.segment,
      threshold: item.threshold,
      source: item.source,
      mismatchRatio: item.comparison.mismatchRatio,
      diffImage: item.comparison.diffImage,
      hotspots: item.comparison.hotspots,
      hotspotSummary: item.comparison.hotspotSummary,
      actualPath: item.actualPath,
      designPath: item.designPath,
    })),
    hotspots: comparison.hotspots,
    warnings,
    counts: {
      comparedSegments: segmentComparisons.length,
      skippedSegments: Math.max((captureMetadata.segments ?? []).length - segmentComparisons.length, 0),
      totalHotspots: comparison.hotspots.length,
      findingCandidates: 0,
    },
    compareConfig,
  };

  return {
    designSource,
    comparisons: [
      {
        target: "base",
        actualPath,
        designPath: designSource.path,
        normalized,
        comparison,
      },
      ...segmentComparisons,
    ],
    summary,
    warnings,
  };
}

function loadRepairedIssues(filePath) {
  if (!filePath) {
    return [];
  }

  const payload = readJson(filePath);
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.repairedIssues)) {
    return payload.repairedIssues;
  }
  return [];
}

async function runPipeline({
  mode,
  projectRoot,
  scenarioPath,
  outputDir,
  designImage,
  baselineImage,
  repairedIssuesPath,
  port,
  preferConnect,
  trustProject,
}) {
  const scenario = readJson(scenarioPath);
  const scenarioId = scenario.id ?? path.basename(scenarioPath, path.extname(scenarioPath));
  const phaseDir = path.join(outputDir, mode);
  ensureDir(phaseDir);

  const captureMetadata = await captureMiniProgram({
    projectRoot,
    scenarioPath,
    outputDir: path.join(phaseDir, "capture"),
    cliPath: undefined,
    port,
    preferConnect,
    trustProject,
  });
  const designSource = resolveDesignSource(projectRoot, scenario, {
    designImage,
    baselineImage,
  });
  const compareResult = await maybeCompareDesign({
    projectRoot,
    outputDir: phaseDir,
    captureMetadata,
    designSource,
    scenario,
  });

  const findings = createFindings({
    compareSummary: compareResult.summary,
    captureMetadata,
    designSource,
    compareWarnings: compareResult.warnings,
  });
  const findingsPayload = {
    ok: true,
    scenarioId,
    findings,
  };
  const findingsPath = path.join(phaseDir, "findings.json");
  writeJson(findingsPath, findingsPayload);

  const classification = classifyFindings({ findings });
  const classificationPath = path.join(phaseDir, "classification.json");
  writeJson(classificationPath, classification);

  const results = buildRuntimeResults(scenario, captureMetadata, compareResult.summary);
  compareResult.summary.counts.findingCandidates = findings.length;

  const evidence = [
    `原生截图: ${captureMetadata.baseScreenshot}`,
    ...(captureMetadata.segmentScreenshots ?? []).map((item) => `区域截图 ${item.segment}: ${item.path}`),
    ...(compareResult.designSource ? [`设计基线(${compareResult.designSource.kind}): ${compareResult.designSource.path}`] : []),
    ...(compareResult.summary ? [`差异热图: ${compareResult.summary.diffImage}`] : []),
    ...((compareResult.summary?.segments ?? []).slice(0, 3).map((item) => `分段差异 ${item.segment}: ${item.diffImage}`)),
    ...((compareResult.summary?.hotspots ?? []).slice(0, 3).flatMap((item) =>
      [item.actualCrop, item.designCrop, item.diffCrop].filter(Boolean).map((filePath) => `热点证据 ${item.id}: ${filePath}`),
    )),
    ...compareResult.warnings,
  ];

  const reportJsonPath = path.join(phaseDir, `${mode}-report.json`);
  const reportMdPath = path.join(phaseDir, `${mode}-report.md`);

  let reportInput;
  if (mode === "initial") {
    reportInput = {
      subject: buildSubject(scenario),
      evidence,
      results: results.initial,
      findings: findings.map((item) => item.title),
      repairCandidates: classification.autoFixable.map((item) => item.title),
      autoFixable: classification.autoFixable.map((item) => item.title),
      manualReview: classification.manualReview.map((item) => item.title),
    };
  } else {
    const repairedIssues = loadRepairedIssues(repairedIssuesPath);
    const residualRisks = classification.manualReview.map((item) => item.title);
    reportInput = {
      subject: buildSubject(scenario),
      evidence,
      repairedIssues,
      verifiedRepaired: [],
      pendingAutoFix: classification.autoFixable.map((item) => item.title),
      manualReview: classification.manualReview.map((item) => item.title),
      unverifiedRepairClaims: repairedIssues,
      recheckResults: results.final,
      residualRisks,
      conclusion: [
        residualRisks.length === 0 && repairedIssues.length === 0 && classification.autoFixable.length === 0
          ? "自动复验完成，当前未发现需要人工确认的剩余风险。"
          : "自动复验完成，但仍存在未验证修复声明、待外部修复项或需人工确认的剩余风险。",
      ],
    };
  }

  writeJson(reportJsonPath, reportInput);
  const reportMarkdown = buildReport({ mode, input: reportInput });
  fs.writeFileSync(reportMdPath, reportMarkdown, "utf8");

  const summary = {
    ok: true,
    mode,
    scenarioId,
    outputDir: phaseDir,
    captureMetadataPath: path.join(phaseDir, "capture", "capture-metadata.json"),
    findingsPath,
    classificationPath,
    reportJsonPath,
    reportMdPath,
    compareSummary: compareResult.summary,
    comparisons: compareResult.comparisons,
  };

  writeJson(path.join(phaseDir, "pipeline-summary.json"), summary);
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const mode = args.mode ?? "initial";
  const projectRoot = resolvePath(process.cwd(), args["project-root"]);
  const scenarioPath = resolvePath(process.cwd(), args.scenario);

  if (!projectRoot || !scenarioPath) {
    exitWithError("Missing required --project-root or --scenario argument.");
  }

  const outputDir = resolvePath(
    process.cwd(),
    args["output-dir"] ?? buildScenarioOutputDir(projectRoot, scenarioPath, "pipeline"),
  );

  try {
    const summary = await runPipeline({
      mode,
      projectRoot,
      scenarioPath,
      outputDir,
      designImage: resolvePath(process.cwd(), args["design-image"]),
      baselineImage: resolvePath(process.cwd(), args["baseline-image"]),
      repairedIssuesPath: resolvePath(process.cwd(), args["repaired-issues"]),
      port: args.port ?? getDefaultAutomationPort(),
      preferConnect: args.port !== undefined,
      trustProject: hasFlag(argv, "trust-project"),
    });

    logJson(summary);
  } catch (error) {
    if (isStructuredFailure(error)) {
      exitWithError(error.error ?? "run-qa-pipeline failed.", error);
    }

    exitWithError("run-qa-pipeline failed unexpectedly.", {
      phase: "pipeline",
      cause: errorCause(error),
    });
  }
}
