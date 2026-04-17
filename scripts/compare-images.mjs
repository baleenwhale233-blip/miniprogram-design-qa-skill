#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  exitWithError,
  hasFlag,
  logJson,
  parseArgs,
  printHelp,
  resolvePath,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/compare-images.mjs --actual <file> --design <file> --output <diff.png> [--threshold 0.1] [--ignore-rects-file <json>] [--ignore-rects-json '<json>']

Create a diff image and mismatch summary for two equally sized PNG files.
`;

function validateIgnoreRects(value) {
  if (!Array.isArray(value)) {
    exitWithError("ignoreRects must be an array of rectangle objects.");
  }

  return value.map((rect, index) => {
    if (!rect || typeof rect !== "object") {
      exitWithError("Each ignore rect must be an object.", { index });
    }

    const normalized = {
      left: Number(rect.left),
      top: Number(rect.top),
      width: Number(rect.width),
      height: Number(rect.height),
    };

    if (
      !Number.isFinite(normalized.left) ||
      !Number.isFinite(normalized.top) ||
      !Number.isFinite(normalized.width) ||
      !Number.isFinite(normalized.height)
    ) {
      exitWithError("Each ignore rect must have numeric left, top, width, and height.", {
        index,
        rect,
      });
    }

    return normalized;
  });
}

function readIgnoreRectsFromArgs(args) {
  if (args["ignore-rects-file"] && args["ignore-rects-json"]) {
    exitWithError("Pass either --ignore-rects-file or --ignore-rects-json, not both.");
  }

  if (args["ignore-rects-file"]) {
    const filePath = resolvePath(process.cwd(), args["ignore-rects-file"]);
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return validateIgnoreRects(payload);
  }

  if (args["ignore-rects-json"]) {
    const payload = JSON.parse(args["ignore-rects-json"]);
    return validateIgnoreRects(payload);
  }

  return [];
}

function applyIgnoreRects(actualPng, designPng, ignoreRects = []) {
  for (const rect of ignoreRects) {
    const left = Math.max(Math.round(rect.left ?? 0), 0);
    const top = Math.max(Math.round(rect.top ?? 0), 0);
    const width = Math.max(Math.round(rect.width ?? 0), 0);
    const height = Math.max(Math.round(rect.height ?? 0), 0);
    const maxX = Math.min(left + width, actualPng.width);
    const maxY = Math.min(top + height, actualPng.height);

    for (let y = top; y < maxY; y += 1) {
      for (let x = left; x < maxX; x += 1) {
        const index = (y * actualPng.width + x) * 4;
        actualPng.data[index] = 0;
        actualPng.data[index + 1] = 0;
        actualPng.data[index + 2] = 0;
        actualPng.data[index + 3] = 0;
        designPng.data[index] = 0;
        designPng.data[index + 1] = 0;
        designPng.data[index + 2] = 0;
        designPng.data[index + 3] = 0;
      }
    }
  }
}

export async function compareImages({
  actualPath,
  designPath,
  diffPath,
  threshold = 0.1,
  includeAA = false,
  ignoreRects = [],
}) {
  if (!actualPath || !designPath || !diffPath) {
    exitWithError("Missing required actualPath, designPath, or diffPath.");
  }

  const { PNG } = await import("pngjs");
  const { default: pixelmatch } = await import("pixelmatch");

  const actualPng = PNG.sync.read(fs.readFileSync(actualPath));
  const designPng = PNG.sync.read(fs.readFileSync(designPath));

  if (actualPng.width !== designPng.width || actualPng.height !== designPng.height) {
    exitWithError("Input images must have identical dimensions. Run normalize-images first.", {
      actualSize: { width: actualPng.width, height: actualPng.height },
      designSize: { width: designPng.width, height: designPng.height },
    });
  }

  applyIgnoreRects(actualPng, designPng, ignoreRects);

  const diffPng = new PNG({ width: actualPng.width, height: actualPng.height });
  const mismatchedPixels = pixelmatch(
    actualPng.data,
    designPng.data,
    diffPng.data,
    actualPng.width,
    actualPng.height,
    {
      threshold,
      includeAA,
    },
  );

  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diffPng));

  return {
    ok: true,
    width: actualPng.width,
    height: actualPng.height,
    threshold,
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / (actualPng.width * actualPng.height),
    ignoredRects: ignoreRects.length,
    diffImage: diffPath,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const actualPath = resolvePath(process.cwd(), args.actual);
  const designPath = resolvePath(process.cwd(), args.design);
  const diffPath = resolvePath(process.cwd(), args.output);
  const ignoreRects = readIgnoreRectsFromArgs(args);

  const result = await compareImages({
    actualPath,
    designPath,
    diffPath,
    threshold: Number(args.threshold ?? 0.1),
    includeAA: Boolean(args["include-aa"]),
    ignoreRects,
  });

  logJson(result);
}
