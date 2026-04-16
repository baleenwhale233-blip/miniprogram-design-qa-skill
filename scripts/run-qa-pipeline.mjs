#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  exitWithError,
  hasFlag,
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
import { captureWithDevtools } from "./capture-devtools.mjs";

const HELP = `
Usage:
  node scripts/run-qa-pipeline.mjs --mode initial|final --project-root <path> --scenario <file> [--output-dir <dir>] [--design-image <file>] [--baseline-image <file>] [--repaired-issues <file>] [--port <number>] [--trust-project]

Run the native capture -> compare -> classify -> report pipeline.

Notes:
  - initial mode produces capture metadata, comparison artifacts, findings, classification, and 初验报告.
  - final mode re-captures the page, reruns comparison, and produces 复验报告.
  - automatic code repair is still handled by an agent or engineer between the two phases.
`;

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

function createFindings({ compareSummary, captureMetadata, designSource }) {
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

  const ratio = compareSummary?.mismatchRatio ?? 0;
  if (ratio >= 0.12) {
    findings.push({
      id: "compare-layout-mismatch",
      title: `整体视觉差异较大（${(ratio * 100).toFixed(2)}%），优先检查布局与模块顺序。`,
      category: "layout",
      confidence: 0.93,
    });
  } else if (ratio >= 0.05) {
    findings.push({
      id: "compare-spacing-mismatch",
      title: `视觉差异明显（${(ratio * 100).toFixed(2)}%），优先检查间距与对齐。`,
      category: "spacing",
      confidence: 0.88,
    });
  } else if (ratio >= 0.02) {
    findings.push({
      id: "compare-hierarchy-mismatch",
      title: `视觉存在轻中度差异（${(ratio * 100).toFixed(2)}%），建议复查层级与细节样式。`,
      category: "visual-hierarchy",
      confidence: 0.8,
      requiresHumanApproval: true,
    });
  }

  for (const warning of captureMetadata.warnings ?? []) {
    findings.push({
      id: `warning-${findings.length + 1}`,
      title: warning,
      category: "layout",
      confidence: 0.76,
      requiresHumanApproval: true,
    });
  }

  return findings;
}

async function maybeCompareDesign({
  projectRoot,
  outputDir,
  captureMetadata,
  designSource,
}) {
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
  });

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
    ],
    summary: comparison,
    warnings: [],
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

  const captureMetadata = await captureWithDevtools({
    projectRoot,
    scenarioPath,
    outputDir: path.join(phaseDir, "capture"),
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
  });

  const findings = createFindings({
    compareSummary: compareResult.summary,
    captureMetadata,
    designSource,
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
  const evidence = [
    `原生截图: ${captureMetadata.baseScreenshot}`,
    ...captureMetadata.segmentScreenshots.map((item) => `区域截图 ${item.segment}: ${item.path}`),
    ...(compareResult.designSource ? [`设计基线(${compareResult.designSource.kind}): ${compareResult.designSource.path}`] : []),
    ...(compareResult.summary ? [`差异热图: ${compareResult.summary.diffImage}`] : []),
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
      recheckResults: results.final,
      residualRisks,
      conclusion: [
        residualRisks.length === 0
          ? "自动复验完成，当前未发现需要人工确认的剩余风险。"
          : "自动复验完成，但仍存在需要人工确认的剩余风险。",
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
  };

  writeJson(path.join(phaseDir, "pipeline-summary.json"), summary);
  return summary;
}

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
  args["output-dir"] ?? path.join(projectRoot, ".qa-output", path.basename(scenarioPath, path.extname(scenarioPath)), "pipeline"),
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
    port: args.port ?? "9421",
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
