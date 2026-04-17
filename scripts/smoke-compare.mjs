#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { compareImages } from "./compare-images.mjs";
import { createFindings } from "./run-qa-pipeline.mjs";

const outputDir = "/tmp/miniprogram-design-qa-smoke-compare";
fs.mkdirSync(outputDir, { recursive: true });

function makePng(filePath, painter, width = 40, height = 40) {
  const png = new PNG({ width, height });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (y * png.width + x) * 4;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
    }
  }
  painter(png);
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

const actualPath = path.join(outputDir, "actual-large.png");
const designPath = path.join(outputDir, "design-large.png");
makePng(actualPath, () => {}, 100, 100);
makePng(designPath, (png) => {
  for (let y = 10; y < 20; y += 1) {
    for (let x = 10; x < 20; x += 1) {
      const idx = (y * png.width + x) * 4;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }
}, 100, 100);

const globalResult = await compareImages({
  actualPath,
  designPath,
  diffPath: path.join(outputDir, "diff-global.png"),
  minHotspotArea: 25,
  minHotspotPixels: 20,
  hotspotOutputDir: path.join(outputDir, "hotspots"),
});

const segmentActualPath = path.join(outputDir, "segment-actual.png");
const segmentDesignPath = path.join(outputDir, "segment-design.png");
makePng(segmentActualPath, () => {});
makePng(segmentDesignPath, (png) => {
  for (let y = 4; y < 12; y += 1) {
    for (let x = 4; x < 12; x += 1) {
      const idx = (y * png.width + x) * 4;
      png.data[idx] = 255;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }
});

const segmentResult = await compareImages({
  actualPath: segmentActualPath,
  designPath: segmentDesignPath,
  diffPath: path.join(outputDir, "diff-segment.png"),
  minHotspotArea: 16,
  minHotspotPixels: 10,
  hotspotOutputDir: path.join(outputDir, "segment-hotspots"),
});

if (!globalResult.hotspots.length) {
  throw new Error("Expected at least one hotspot in global compare.");
}

if ((globalResult.hotspots[0]?.area ?? 0) < 25) {
  throw new Error("Expected hotspot area to exceed threshold.");
}

if ((globalResult.hotspots[0]?.mismatchedPixels ?? 0) < 20) {
  throw new Error("Expected hotspot mismatched pixel count to exceed threshold.");
}

if (globalResult.mismatchRatio >= 0.02) {
  throw new Error(`Expected low global mismatch ratio, got ${globalResult.mismatchRatio}`);
}

const hotspotFinding = createFindings({
  compareSummary: {
    global: globalResult,
    mismatchRatio: globalResult.mismatchRatio,
    diffImage: globalResult.diffImage,
    segments: [],
    hotspots: globalResult.hotspots,
  },
  captureMetadata: {
    warnings: [],
  },
  designSource: {
    kind: "baseline-image",
    path: designPath,
  },
  compareWarnings: [],
}).find((item) => item.source === "hotspot");

if (!hotspotFinding) {
  throw new Error("Expected a hotspot-derived finding source.");
}

const segmentComparison = {
  target: "segment",
  segment: "sample-segment",
  mismatchRatio: segmentResult.mismatchRatio,
  comparison: segmentResult,
};

if (segmentComparison.target !== "segment") {
  throw new Error("Expected a segment compare object.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      global: globalResult,
      segment: segmentComparison,
      hotspotFinding,
    },
    null,
    2,
  ),
);
