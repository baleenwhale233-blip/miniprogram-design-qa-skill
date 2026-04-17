#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, logJson, parseArgs, printHelp, readJson, resolvePath, exitWithError } from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/validate-scenario.mjs --scenario <file>

Validate the core scenario contract used by the built-in mini-program QA pipeline.
`;

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pushError(list, message, details = {}) {
  list.push({ level: "error", message, ...details });
}

function pushWarning(list, message, details = {}) {
  list.push({ level: "warning", message, ...details });
}

export function validateScenario(scenario) {
  const issues = [];

  if (!isObject(scenario)) {
    pushError(issues, "Scenario must be a JSON object.");
    return {
      ok: false,
      issues,
    };
  }

  if (!scenario.id || typeof scenario.id !== "string") {
    pushError(issues, "Scenario.id must be a non-empty string.");
  }

  if (!scenario.route || typeof scenario.route !== "string") {
    pushError(issues, "Scenario.route must be a non-empty string.");
  }

  if (!isObject(scenario.viewport)) {
    pushError(issues, "Scenario.viewport must be an object.");
  } else {
    for (const key of ["width", "height", "deviceScaleFactor"]) {
      if (typeof scenario.viewport[key] !== "number" || scenario.viewport[key] <= 0) {
        pushError(issues, `Scenario.viewport.${key} must be a positive number.`);
      }
    }
  }

  if (!isObject(scenario.readySignal)) {
    pushError(issues, "Scenario.readySignal must be an object.");
  } else {
    const allowedSignalTypes = new Set(["selector", "text", "data-stable", "network-idle"]);
    if (!allowedSignalTypes.has(scenario.readySignal.type)) {
      pushError(issues, "Scenario.readySignal.type must be one of selector, text, data-stable, network-idle.");
    }
    if (
      scenario.readySignal.type !== "data-stable" &&
      scenario.readySignal.type !== "network-idle" &&
      (!scenario.readySignal.value || typeof scenario.readySignal.value !== "string")
    ) {
      pushError(issues, "Scenario.readySignal.value must be a non-empty string for selector/text waits.");
    }
  }

  if (!isObject(scenario.capture)) {
    pushError(issues, "Scenario.capture must be an object.");
  } else {
    const allowedModes = new Set(["viewport", "fullPage"]);
    if (!allowedModes.has(scenario.capture.mode)) {
      pushError(issues, "Scenario.capture.mode must be viewport or fullPage.");
    }

    if (scenario.capture.segments !== undefined && !Array.isArray(scenario.capture.segments)) {
      pushError(issues, "Scenario.capture.segments must be an array when provided.");
    }

    if (scenario.capture.segmentSelectors !== undefined && !isObject(scenario.capture.segmentSelectors)) {
      pushError(issues, "Scenario.capture.segmentSelectors must be an object when provided.");
    }
  }

  if (scenario.design !== undefined && !isObject(scenario.design)) {
    pushError(issues, "Scenario.design must be an object when provided.");
  }

  if (scenario.ignoreRegions !== undefined && !Array.isArray(scenario.ignoreRegions)) {
    pushError(issues, "Scenario.ignoreRegions must be an array when provided.");
  }

  if (scenario.compare !== undefined) {
    if (!isObject(scenario.compare)) {
      pushError(issues, "Scenario.compare must be an object when provided.");
    } else {
      if (
        scenario.compare.perSegmentThresholds !== undefined &&
        !isObject(scenario.compare.perSegmentThresholds)
      ) {
        pushError(issues, "Scenario.compare.perSegmentThresholds must be an object when provided.");
      }

      if (
        scenario.compare.segmentDesignImages !== undefined &&
        !isObject(scenario.compare.segmentDesignImages)
      ) {
        pushError(issues, "Scenario.compare.segmentDesignImages must be an object when provided.");
      }
    }
  }

  if (
    Array.isArray(scenario.capture?.segments) &&
    scenario.capture.segments.length > 0 &&
    scenario.capture.segmentSelectors === undefined
  ) {
    pushWarning(issues, "Scenario.capture.segments is present without capture.segmentSelectors. Only selector-shaped segment names will be directly resolvable.");
  }

  if (
    scenario.design?.figmaFileKey &&
    scenario.design?.figmaNodeId &&
    !scenario.design?.designImagePath &&
    !scenario.design?.baselineImagePath
  ) {
    pushWarning(issues, "Figma metadata is present without a local designImagePath/baselineImagePath. Built-in compare will not export screenshots from Figma.");
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const scenarioPath = resolvePath(process.cwd(), args.scenario);
  if (!scenarioPath) {
    exitWithError("Missing required --scenario argument.");
  }

  const scenario = readJson(scenarioPath);
  const result = {
    scenarioPath,
    ...validateScenario(scenario),
  };

  if (!result.ok) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  logJson(result);
}
