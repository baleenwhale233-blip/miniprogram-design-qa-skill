#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  fileExists,
  getDefaultDevtoolsCliCandidates,
  hasFlag,
  logJson,
  parseArgs,
  printHelp,
  resolvePath,
  exitWithError,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/launch-devtools.mjs --project-root <path> [--cli-path <path>] [--port <number>] [--mode open|auto]

Open or automation-enable WeChat DevTools for a target mini-program project.

Notes:
  - Common macOS WeChat DevTools CLI locations are used as convenience defaults.
  - Pass --cli-path to override discovery.
  - The default port is configurable through --port.
`;

const argv = process.argv.slice(2);
if (hasFlag(argv, "help")) {
  printHelp(HELP);
  process.exit(0);
}

const args = parseArgs(argv);
const projectRoot = resolvePath(process.cwd(), args["project-root"]);

if (!projectRoot) {
  exitWithError("Missing required --project-root argument.");
}

const cliPath = args["cli-path"] ?? getDefaultDevtoolsCliCandidates().find((candidate) => fileExists(candidate));

if (!cliPath) {
  exitWithError("WeChat DevTools CLI was not found. Install WeChat DevTools or pass --cli-path.");
}

const port = args.port ?? "9421";
const mode = args.mode ?? "auto";
const command = mode === "open" ? "open" : "auto";
const commandArgs = [command, "--project", projectRoot, "--port", String(port)];

if (args["trust-project"]) {
  commandArgs.push("--trust-project");
}

const run = spawnSync(cliPath, commandArgs, {
  encoding: "utf8",
});

if (run.status !== 0) {
  exitWithError("Failed to launch WeChat DevTools.", {
    cliPath,
    projectRoot,
    mode,
    stdout: run.stdout?.trim() ?? "",
    stderr: run.stderr?.trim() ?? "",
  });
}

logJson({
  ok: true,
  cliPath,
  projectRoot,
  port: Number(port),
  mode,
  command: [cliPath, ...commandArgs],
  stdout: run.stdout?.trim() ?? "",
  stderr: run.stderr?.trim() ?? "",
  nextStep:
    mode === "auto"
      ? "Use a project-provided adapter, hook, or external executor to capture native screenshots."
      : "Use the opened DevTools session for preview or manual capture.",
});
