#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  ensureDir,
  exitWithError,
  hasFlag,
  logJson,
  parseArgs,
  parseBoolean,
  printHelp,
  readJson,
  resolvePath,
  sanitizeName,
  toAbsoluteList,
  writeJson,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/capture-miniprogram.mjs --project-root <path> --scenario <file> [--output-dir <dir>]

Capture native mini-program evidence from one of three sources:
1. capture.devtools via scripts/capture-devtools.mjs
2. capture.helperCommand
3. capture.manualFiles
4. capture.manualDirectory
`;

function normalizeScreenshotList(projectRoot, scenario) {
  const manualFiles = toAbsoluteList(projectRoot, scenario.capture?.manualFiles ?? []);
  const manualDirectory = resolvePath(projectRoot, scenario.capture?.manualDirectory);

  if (manualFiles.length > 0) {
    return manualFiles;
  }

  if (!manualDirectory) {
    return [];
  }

  const entries = fs.existsSync(manualDirectory)
    ? fs.readdirSync(manualDirectory).filter((entry) => /\.(png|jpg|jpeg)$/i.test(entry))
    : [];

  return entries
    .map((entry) => path.join(manualDirectory, entry))
    .sort((left, right) => left.localeCompare(right));
}

const argv = process.argv.slice(2);
if (hasFlag(argv, "help")) {
  printHelp(HELP);
  process.exit(0);
}

const args = parseArgs(argv);
const projectRoot = resolvePath(process.cwd(), args["project-root"]);
const scenarioPath = resolvePath(process.cwd(), args.scenario);

if (!projectRoot || !scenarioPath) {
  exitWithError("Missing required --project-root or --scenario argument.");
}

const outputDir = resolvePath(process.cwd(), args["output-dir"] ?? path.join(projectRoot, ".qa-output", path.basename(scenarioPath, path.extname(scenarioPath))));
ensureDir(outputDir);

const scenario = readJson(scenarioPath);
const helperCommand = scenario.capture?.helperCommand;
const useDevtools = parseBoolean(scenario.capture?.devtools, true);

if (useDevtools) {
  try {
    const { captureWithDevtools } = await import("./capture-devtools.mjs");
    const result = await captureWithDevtools({
      projectRoot,
      scenarioPath,
      outputDir,
      cliPath: resolvePath(process.cwd(), args["cli-path"]),
      port: args.port ?? "9421",
      trustProject: parseBoolean(args["trust-project"], false),
    });
    logJson(result);
    process.exit(0);
  } catch (error) {
    const cause = error && typeof error === "object" && "error" in error
      ? error.error
      : error instanceof Error
        ? error.message
        : String(error);

    if (!helperCommand && !(scenario.capture?.manualFiles?.length) && !scenario.capture?.manualDirectory) {
      exitWithError("capture.devtools failed and no fallback evidence source is configured.", {
        phase: "devtools-fallback",
        cause,
      });
    }
  }
}

let helperResult;
if (helperCommand) {
  helperResult = spawnSync(helperCommand, {
    cwd: projectRoot,
    shell: true,
    encoding: "utf8",
    env: {
      ...process.env,
      MINIPROGRAM_QA_OUTPUT_DIR: outputDir,
      MINIPROGRAM_QA_SCENARIO_ID: scenario.id ?? "",
      MINIPROGRAM_QA_ROUTE: scenario.route ?? "",
    },
  });

  if (helperResult.status !== 0) {
    exitWithError("capture.helperCommand failed.", {
      command: helperCommand,
      stdout: helperResult.stdout?.trim() ?? "",
      stderr: helperResult.stderr?.trim() ?? "",
    });
  }
}

const screenshotPaths = normalizeScreenshotList(projectRoot, scenario);

if (screenshotPaths.length === 0) {
  exitWithError("No runtime screenshots were found. Provide capture.helperCommand, capture.manualFiles, or capture.manualDirectory.", {
    scenarioPath,
    outputDir,
  });
}

const copiedScreenshots = screenshotPaths.map((sourcePath, index) => {
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  const targetName = `${String(index + 1).padStart(2, "0")}-${sanitizeName(path.basename(sourcePath, extension))}${extension}`;
  const targetPath = path.join(outputDir, targetName);
  copyFile(sourcePath, targetPath);
  return targetPath;
});

const metadata = {
  ok: true,
  scenarioId: scenario.id ?? path.basename(scenarioPath, path.extname(scenarioPath)),
  scenarioPath,
  projectRoot,
  route: scenario.route ?? null,
  query: scenario.query ?? {},
  fixture: scenario.fixture ?? null,
  viewport: scenario.viewport ?? null,
  readySignal: scenario.readySignal ?? null,
  captureMode: scenario.capture?.mode ?? "viewport",
  segments: scenario.capture?.segments ?? [],
  screenshots: copiedScreenshots,
  evidenceSource: helperCommand ? "project-adapter" : "manual",
  helperCommand: helperCommand ?? null,
  helperStdout: helperResult?.stdout?.trim() ?? "",
  helperStderr: helperResult?.stderr?.trim() ?? "",
};

writeJson(path.join(outputDir, "capture-metadata.json"), metadata);
logJson(metadata);
