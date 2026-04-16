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
  node scripts/compare-images.mjs --actual <file> --design <file> --output <diff.png> [--threshold 0.1]

Create a diff image and mismatch summary for two equally sized PNG files.
`;

export async function compareImages({
  actualPath,
  designPath,
  diffPath,
  threshold = 0.1,
  includeAA = false,
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

  const result = await compareImages({
    actualPath,
    designPath,
    diffPath,
    threshold: Number(args.threshold ?? 0.1),
    includeAA: Boolean(args["include-aa"]),
  });

  logJson(result);
}
