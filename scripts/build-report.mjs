#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, parseArgs, printHelp, readJson, resolvePath, exitWithError } from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/build-report.mjs --mode initial|final --input <file> [--output <file>]

Render a Chinese QA report from a normalized JSON payload.
`;

function formatList(items, emptyText = "- None") {
  if (!items || items.length === 0) {
    return emptyText;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function buildInitialReport(input) {
  return [
    "前端验收报告（初验）",
    "",
    "验收对象：",
    formatList(input.subject ?? []),
    "",
    "证据来源：",
    formatList(input.evidence ?? []),
    "",
    "前端验收结果：",
    formatList(input.results ?? []),
    "",
    "自动发现的问题：",
    formatList(input.findings ?? []),
    "",
    "可自动修复的问题：",
    formatList(input.autoFixable ?? []),
    "",
    "需人工确认的问题：",
    formatList(input.manualReview ?? []),
    "",
  ].join("\n");
}

export function buildFinalReport(input) {
  return [
    "前端验收报告（复验）",
    "",
    "验收对象：",
    formatList(input.subject ?? []),
    "",
    "证据来源：",
    formatList(input.evidence ?? []),
    "",
    "主动修掉的问题：",
    formatList(input.repairedIssues ?? [], "- No auto-fix phase was needed"),
    "",
    "复验结果：",
    formatList(input.recheckResults ?? []),
    "",
    "剩余风险：",
    formatList(input.residualRisks ?? []),
    "",
    "结论：",
    formatList(input.conclusion ?? []),
    "",
  ].join("\n");
}

export function buildReport({ mode, input }) {
  if (mode !== "initial" && mode !== "final") {
    exitWithError("Invalid mode value. Use initial or final.", {
      receivedMode: mode,
    });
  }

  return mode === "initial" ? buildInitialReport(input) : buildFinalReport(input);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const mode = args.mode;
  const inputPath = resolvePath(process.cwd(), args.input);

  if (!mode || !inputPath) {
    exitWithError("Missing required --mode or --input argument.");
  }

  if (mode !== "initial" && mode !== "final") {
    exitWithError("Invalid --mode value. Use initial or final.", {
      receivedMode: mode,
    });
  }

  const input = readJson(inputPath);
  const markdown = buildReport({ mode, input });

  if (args.output) {
    const outputPath = resolvePath(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, markdown, "utf8");
  }

  process.stdout.write(markdown);
}
