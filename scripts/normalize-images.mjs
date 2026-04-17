#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureDir,
  exitWithError,
  hasFlag,
  logJson,
  parseArgs,
  printHelp,
  resolvePath,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/normalize-images.mjs --actual <file> --design <file> --output-dir <dir> [--fit contain|cover]

Normalize actual and reference images to a shared PNG canvas for comparison.
`;

function computeTransform({ sourceWidth, sourceHeight, targetWidth, targetHeight, fit }) {
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
    return {
      scaleX: 1,
      scaleY: 1,
      left: 0,
      top: 0,
      width: sourceWidth ?? 0,
      height: sourceHeight ?? 0,
    };
  }

  if (fit !== "contain") {
    return {
      scaleX: targetWidth / sourceWidth,
      scaleY: targetHeight / sourceHeight,
      left: 0,
      top: 0,
      width: targetWidth,
      height: targetHeight,
    };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const left = Math.floor((targetWidth - width) / 2);
  const top = Math.floor((targetHeight - height) / 2);

  return {
    scaleX: scale,
    scaleY: scale,
    left,
    top,
    width,
    height,
  };
}

export async function normalizeImages({
  actualPath,
  designPath,
  outputDir,
  fit = "contain",
  background = "#ffffffff",
}) {
  if (!actualPath || !designPath || !outputDir) {
    exitWithError("Missing required actualPath, designPath, or outputDir.");
  }

  ensureDir(outputDir);

  const { default: sharp } = await import("sharp");

  const actualMetadata = await sharp(actualPath).metadata();
  const designMetadata = await sharp(designPath).metadata();
  const targetWidth = Math.max(actualMetadata.width ?? 0, designMetadata.width ?? 0);
  const targetHeight = Math.max(actualMetadata.height ?? 0, designMetadata.height ?? 0);

  if (targetWidth <= 0 || targetHeight <= 0) {
    exitWithError("Could not determine target dimensions for normalization.");
  }

  const actualOutput = path.join(outputDir, "actual.normalized.png");
  const designOutput = path.join(outputDir, "design.normalized.png");

  await sharp(actualPath)
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit,
      background,
    })
    .png()
    .toFile(actualOutput);

  await sharp(designPath)
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit,
      background,
    })
    .png()
    .toFile(designOutput);

  return {
    ok: true,
    fit,
    background,
    targetWidth,
    targetHeight,
    actualOriginalWidth: actualMetadata.width ?? 0,
    actualOriginalHeight: actualMetadata.height ?? 0,
    designOriginalWidth: designMetadata.width ?? 0,
    designOriginalHeight: designMetadata.height ?? 0,
    actualTransform: computeTransform({
      sourceWidth: actualMetadata.width ?? 0,
      sourceHeight: actualMetadata.height ?? 0,
      targetWidth,
      targetHeight,
      fit,
    }),
    designTransform: computeTransform({
      sourceWidth: designMetadata.width ?? 0,
      sourceHeight: designMetadata.height ?? 0,
      targetWidth,
      targetHeight,
      fit,
    }),
    actualOutput,
    designOutput,
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
  const outputDir = resolvePath(process.cwd(), args["output-dir"]);

  const result = await normalizeImages({
    actualPath,
    designPath,
    outputDir,
    fit: args.fit ?? "contain",
    background: args.background ?? "#ffffffff",
  });

  logJson(result);
}
