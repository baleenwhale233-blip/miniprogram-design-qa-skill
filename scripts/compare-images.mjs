#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureDir,
  exitWithError,
  hasFlag,
  logJson,
  parseBoolean,
  parseNumber,
  parseArgs,
  printHelp,
  resolvePath,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/compare-images.mjs --actual <file> --design <file> --output <diff.png> [--threshold 0.1] [--include-aa] [--ignore-rects-file <json>] [--ignore-rects-json '<json>'] [--min-hotspot-area <n>] [--min-hotspot-pixels <n>] [--max-hotspots <n>] [--hotspot-merge-distance <n>] [--hotspot-output-dir <dir>] [--export-hotspot-crops]

Create a diff image and mismatch summary for two equally sized PNG files.
`;

const DEFAULT_COMPARE_OPTIONS = {
  threshold: 0.1,
  includeAA: false,
  minHotspotArea: 400,
  minHotspotPixels: 100,
  maxHotspots: 12,
  hotspotMergeDistance: 8,
  exportHotspotCrops: true,
  hotspotOutputDir: undefined,
};

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

function getCompareOptions(input = {}) {
  return {
    threshold: parseNumber(input.threshold, DEFAULT_COMPARE_OPTIONS.threshold),
    includeAA: parseBoolean(input.includeAA, DEFAULT_COMPARE_OPTIONS.includeAA),
    minHotspotArea: parseNumber(input.minHotspotArea, DEFAULT_COMPARE_OPTIONS.minHotspotArea),
    minHotspotPixels: parseNumber(input.minHotspotPixels, DEFAULT_COMPARE_OPTIONS.minHotspotPixels),
    maxHotspots: parseNumber(input.maxHotspots, DEFAULT_COMPARE_OPTIONS.maxHotspots),
    hotspotMergeDistance: parseNumber(
      input.hotspotMergeDistance,
      DEFAULT_COMPARE_OPTIONS.hotspotMergeDistance,
    ),
    exportHotspotCrops: parseBoolean(
      input.exportHotspotCrops,
      DEFAULT_COMPARE_OPTIONS.exportHotspotCrops,
    ),
    hotspotOutputDir: input.hotspotOutputDir
      ? resolvePath(process.cwd(), input.hotspotOutputDir)
      : undefined,
  };
}

function isMaskPixel(maskPng, x, y) {
  const index = (y * maskPng.width + x) * 4;
  return maskPng.data[index + 3] > 0;
}

function collectConnectedComponents(maskPng) {
  const visited = new Uint8Array(maskPng.width * maskPng.height);
  const components = [];
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  for (let y = 0; y < maskPng.height; y += 1) {
    for (let x = 0; x < maskPng.width; x += 1) {
      const visitIndex = y * maskPng.width + x;
      if (visited[visitIndex] || !isMaskPixel(maskPng, x, y)) {
        continue;
      }

      const queue = [[x, y]];
      visited[visitIndex] = 1;
      let head = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let mismatchedPixels = 0;

      while (head < queue.length) {
        const [currentX, currentY] = queue[head];
        head += 1;
        mismatchedPixels += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        for (const [dx, dy] of directions) {
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (
            nextX < 0 ||
            nextY < 0 ||
            nextX >= maskPng.width ||
            nextY >= maskPng.height
          ) {
            continue;
          }

          const nextIndex = nextY * maskPng.width + nextX;
          if (visited[nextIndex] || !isMaskPixel(maskPng, nextX, nextY)) {
            continue;
          }

          visited[nextIndex] = 1;
          queue.push([nextX, nextY]);
        }
      }

      components.push({
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: (maxX - minX + 1) * (maxY - minY + 1),
        mismatchedPixels,
      });
    }
  }

  return components;
}

function bboxDistance(a, b) {
  const dx =
    a.right < b.left ? b.left - a.right - 1 :
    b.right < a.left ? a.left - b.right - 1 :
    0;
  const dy =
    a.bottom < b.top ? b.top - a.bottom - 1 :
    b.bottom < a.top ? a.top - b.bottom - 1 :
    0;
  return Math.max(dx, dy);
}

function mergeComponents(components, mergeDistance) {
  const merged = [];

  for (const component of components) {
    let current = { ...component };
    let mergedIntoExisting = false;

    for (let index = 0; index < merged.length; index += 1) {
      const candidate = merged[index];
      if (bboxDistance(current, candidate) > mergeDistance) {
        continue;
      }

      merged[index] = {
        left: Math.min(candidate.left, current.left),
        top: Math.min(candidate.top, current.top),
        right: Math.max(candidate.right, current.right),
        bottom: Math.max(candidate.bottom, current.bottom),
        width: Math.max(candidate.right, current.right) - Math.min(candidate.left, current.left) + 1,
        height: Math.max(candidate.bottom, current.bottom) - Math.min(candidate.top, current.top) + 1,
        area:
          (Math.max(candidate.right, current.right) - Math.min(candidate.left, current.left) + 1) *
          (Math.max(candidate.bottom, current.bottom) - Math.min(candidate.top, current.top) + 1),
        mismatchedPixels: candidate.mismatchedPixels + current.mismatchedPixels,
      };
      mergedIntoExisting = true;
      break;
    }

    if (!mergedIntoExisting) {
      merged.push(current);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let index = 0; index < merged.length; index += 1) {
      for (let inner = index + 1; inner < merged.length; inner += 1) {
        if (bboxDistance(merged[index], merged[inner]) > mergeDistance) {
          continue;
        }

        const a = merged[index];
        const b = merged[inner];
        merged[index] = {
          left: Math.min(a.left, b.left),
          top: Math.min(a.top, b.top),
          right: Math.max(a.right, b.right),
          bottom: Math.max(a.bottom, b.bottom),
          width: Math.max(a.right, b.right) - Math.min(a.left, b.left) + 1,
          height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top) + 1,
          area:
            (Math.max(a.right, b.right) - Math.min(a.left, b.left) + 1) *
            (Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top) + 1),
          mismatchedPixels: a.mismatchedPixels + b.mismatchedPixels,
        };
        merged.splice(inner, 1);
        changed = true;
        break outer;
      }
    }
  }

  return merged;
}

async function exportHotspotCrops({
  actualPath,
  designPath,
  diffPath,
  hotspots,
  hotspotOutputDir,
}) {
  if (!hotspots.length) {
    return;
  }

  const { default: sharp } = await import("sharp");
  ensureDir(hotspotOutputDir);

  for (const hotspot of hotspots) {
    const hotspotDir = path.join(hotspotOutputDir, hotspot.id);
    ensureDir(hotspotDir);

    const region = {
      left: hotspot.left,
      top: hotspot.top,
      width: hotspot.width,
      height: hotspot.height,
    };

    const actualCrop = path.join(hotspotDir, "actual.png");
    const designCrop = path.join(hotspotDir, "design.png");
    const diffCrop = path.join(hotspotDir, "diff.png");

    await sharp(actualPath).extract(region).png().toFile(actualCrop);
    await sharp(designPath).extract(region).png().toFile(designCrop);
    await sharp(diffPath).extract(region).png().toFile(diffCrop);

    hotspot.actualCrop = actualCrop;
    hotspot.designCrop = designCrop;
    hotspot.diffCrop = diffCrop;
  }
}

async function detectHotspots({
  actualPath,
  designPath,
  diffPath,
  actualPng,
  designPng,
  options,
}) {
  const { PNG } = await import("pngjs");
  const { default: pixelmatch } = await import("pixelmatch");

  const maskPng = new PNG({ width: actualPng.width, height: actualPng.height });
  pixelmatch(
    actualPng.data,
    designPng.data,
    maskPng.data,
    actualPng.width,
    actualPng.height,
    {
      threshold: options.threshold,
      includeAA: options.includeAA,
      diffMask: true,
    },
  );

  const rawComponents = collectConnectedComponents(maskPng);
  const mergedComponents = mergeComponents(rawComponents, options.hotspotMergeDistance);
  let filteredSmallComponents = 0;

  const hotspots = mergedComponents
    .filter((component) => {
      const keep =
        component.area >= options.minHotspotArea ||
        component.mismatchedPixels >= options.minHotspotPixels;
      if (!keep) {
        filteredSmallComponents += 1;
      }
      return keep;
    })
    .map((component, index) => ({
      id: `hotspot-${String(index + 1).padStart(2, "0")}`,
      left: component.left,
      top: component.top,
      width: component.width,
      height: component.height,
      area: component.area,
      mismatchedPixels: component.mismatchedPixels,
      bboxMismatchRatio: component.mismatchedPixels / component.area,
      coverageRatio: component.area / (actualPng.width * actualPng.height),
      severityScore: component.mismatchedPixels * (1 + component.mismatchedPixels / component.area),
    }))
    .sort((left, right) => right.severityScore - left.severityScore)
    .slice(0, options.maxHotspots);

  if (options.exportHotspotCrops) {
    const hotspotOutputDir =
      options.hotspotOutputDir ?? path.join(path.dirname(diffPath), "hotspots");
    await exportHotspotCrops({
      actualPath,
      designPath,
      diffPath,
      hotspots,
      hotspotOutputDir,
    });
  }

  return {
    hotspots,
    hotspotSummary: {
      totalHotspots: rawComponents.length,
      keptHotspots: hotspots.length,
      filteredSmallComponents,
      largestArea: hotspots[0]?.area ?? 0,
      largestMismatchPixels: hotspots[0]?.mismatchedPixels ?? 0,
    },
  };
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
  threshold = DEFAULT_COMPARE_OPTIONS.threshold,
  includeAA = DEFAULT_COMPARE_OPTIONS.includeAA,
  ignoreRects = [],
  minHotspotArea = DEFAULT_COMPARE_OPTIONS.minHotspotArea,
  minHotspotPixels = DEFAULT_COMPARE_OPTIONS.minHotspotPixels,
  maxHotspots = DEFAULT_COMPARE_OPTIONS.maxHotspots,
  hotspotMergeDistance = DEFAULT_COMPARE_OPTIONS.hotspotMergeDistance,
  exportHotspotCrops = DEFAULT_COMPARE_OPTIONS.exportHotspotCrops,
  hotspotOutputDir = DEFAULT_COMPARE_OPTIONS.hotspotOutputDir,
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

  const options = {
    threshold,
    includeAA,
    minHotspotArea,
    minHotspotPixels,
    maxHotspots,
    hotspotMergeDistance,
    exportHotspotCrops,
    hotspotOutputDir,
  };

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

  const { hotspots, hotspotSummary } = await detectHotspots({
    actualPath,
    designPath,
    diffPath,
    actualPng,
    designPng,
    options,
  });

  return {
    ok: true,
    width: actualPng.width,
    height: actualPng.height,
    threshold,
    includeAA,
    options,
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / (actualPng.width * actualPng.height),
    ignoredRects: ignoreRects.length,
    diffImage: diffPath,
    hotspots,
    hotspotSummary,
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
  const options = getCompareOptions({
    threshold: args.threshold,
    includeAA: args["include-aa"],
    minHotspotArea: args["min-hotspot-area"],
    minHotspotPixels: args["min-hotspot-pixels"],
    maxHotspots: args["max-hotspots"],
    hotspotMergeDistance: args["hotspot-merge-distance"],
    exportHotspotCrops:
      args["export-hotspot-crops"] ?? args["export-hotspot-crops"] === false
        ? args["export-hotspot-crops"]
        : true,
    hotspotOutputDir: args["hotspot-output-dir"],
  });

  const result = await compareImages({
    actualPath,
    designPath,
    diffPath,
    ignoreRects,
    ...options,
  });

  logJson(result);
}
