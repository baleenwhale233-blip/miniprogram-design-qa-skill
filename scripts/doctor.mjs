#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildScenarioOutputDir,
  ensureDir,
  getDefaultAutomationPort,
  getDefaultDevtoolsCliCandidates,
  logJson,
  parseArgs,
  printHelp,
  resolvePath,
  fileExists,
  hasFlag,
  parseNumber,
  readJson,
} from "./_shared.mjs";
import { detectProject } from "./detect-project.mjs";
import { validateScenario } from "./validate-scenario.mjs";

const HELP = `
Usage:
  node scripts/doctor.mjs --project-root <path> --scenario <file> [--output-dir <dir>] [--port <number>]

Run lightweight environment and contract diagnostics for the built-in mini-program QA workflow.
`;

function issue(level, message, details = {}) {
  return { level, message, ...details };
}

function fileReadable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function dirWritable(dirPath) {
  try {
    ensureDir(dirPath);
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const projectRoot = resolvePath(process.cwd(), args["project-root"]);
  const scenarioPath = resolvePath(process.cwd(), args.scenario);

  if (!projectRoot || !scenarioPath) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: "Missing required --project-root or --scenario argument." }, null, 2)}\n`);
    process.exit(1);
  }

  const outputDir = resolvePath(
    process.cwd(),
    args["output-dir"] ?? buildScenarioOutputDir(projectRoot, scenarioPath),
  );
  const port = parseNumber(args.port ?? getDefaultAutomationPort(), 0);
  const issues = [];

  if (!fileExists(scenarioPath)) {
    issues.push(issue("error", "Scenario file does not exist.", { scenarioPath }));
  }

  let scenario;
  if (fileExists(scenarioPath)) {
    scenario = readJson(scenarioPath);
    const validation = validateScenario(scenario);
    issues.push(...validation.issues);
  }

  const detection = detectProject(projectRoot);
  if (!detection.detected) {
    issues.push(issue("error", "Project was not detected as a compatible WeChat mini-program project.", { projectRoot }));
  }

  if (!detection.nativeExecutor.cliPath) {
    issues.push(issue("warning", "WeChat DevTools CLI was not discovered via default candidates or environment overrides.", {
      checkedCandidates: getDefaultDevtoolsCliCandidates(),
    }));
  }

  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    issues.push(issue("error", "Automation port is invalid.", { port }));
  }

  if (!dirWritable(outputDir)) {
    issues.push(issue("error", "Output directory is not writable.", { outputDir }));
  }

  if (scenario?.design?.designImagePath) {
    const designImagePath = resolvePath(projectRoot, scenario.design.designImagePath);
    if (!fileReadable(designImagePath)) {
      issues.push(issue("warning", "designImagePath is configured but not readable.", {
        designImagePath,
      }));
    }
  }

  if (scenario?.design?.baselineImagePath) {
    const baselineImagePath = resolvePath(projectRoot, scenario.design.baselineImagePath);
    if (!fileReadable(baselineImagePath)) {
      issues.push(issue("warning", "baselineImagePath is configured but not readable.", {
        baselineImagePath,
      }));
    }
  }

  if (scenario?.compare?.segmentDesignImages) {
    for (const [segment, designPath] of Object.entries(scenario.compare.segmentDesignImages)) {
      const segmentPath = resolvePath(projectRoot, designPath);
      if (!fileReadable(segmentPath)) {
        issues.push(issue("warning", "Segment design image is configured but not readable.", {
          segment,
          designPath: segmentPath,
        }));
      }
    }
  }

  if (!Array.isArray(scenario?.capture?.segments) || scenario.capture.segments.length === 0) {
    issues.push(issue("warning", "No capture.segments are configured. Segment compare will be skipped.", {
      scenarioPath,
    }));
  }

  const result = {
    ok: !issues.some((entry) => entry.level === "error"),
    projectRoot,
    scenarioPath,
    outputDir,
    port,
    detection,
    issues,
  };

  if (!result.ok) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  logJson(result);
}
