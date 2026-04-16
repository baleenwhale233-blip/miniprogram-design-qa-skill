#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, logJson, parseArgs, printHelp, readJson, resolvePath, exitWithError } from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/classify-findings.mjs --findings <file> [--min-confidence 0.85]

Classify findings into auto-fixable and manual-review groups using the repair policy.
`;

const AUTO_FIXABLE_CATEGORIES = new Set([
  "layout",
  "spacing",
  "visual-hierarchy",
  "safe-area",
  "copy",
  "state-presentation",
  "interaction-affordance",
]);

export function classifyFindings({
  findings = [],
  minConfidence = 0.85,
}) {
  const autoFixable = [];
  const manualReview = [];

  for (const finding of findings) {
    const confidence = Number(finding.confidence ?? 0);
    const category = String(finding.category ?? "");
    const blocked =
      finding.needsDesignDecision ||
      finding.requiresBackendChange ||
      finding.requiresProductDecision ||
      finding.requiresHumanApproval;

    const eligible =
      confidence >= minConfidence &&
      AUTO_FIXABLE_CATEGORIES.has(category) &&
      !blocked;

    const enriched = {
      ...finding,
      confidence,
      eligibleForAutoFix: eligible,
    };

    if (eligible) {
      autoFixable.push(enriched);
    } else {
      manualReview.push(enriched);
    }
  }

  return {
    ok: true,
    policy: {
      minConfidence,
      allowedCategories: [...AUTO_FIXABLE_CATEGORIES],
    },
    summary: {
      totalFindings: findings.length,
      autoFixable: autoFixable.length,
      manualReview: manualReview.length,
    },
    autoFixable,
    manualReview,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const findingsPath = resolvePath(process.cwd(), args.findings);

  if (!findingsPath) {
    exitWithError("Missing required --findings argument.");
  }

  const payload = readJson(findingsPath);
  const result = classifyFindings({
    findings: payload.findings ?? [],
    minConfidence: Number(args["min-confidence"] ?? 0.85),
  });

  logJson(result);
}
