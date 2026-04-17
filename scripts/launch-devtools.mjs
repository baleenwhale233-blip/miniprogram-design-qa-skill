#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  fileExists,
  getDefaultDevtoolsCliCandidates,
  getDefaultAutomationPort,
  hasFlag,
  logJson,
  parseArgs,
  printHelp,
  resolvePath,
  sleep,
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
  - In auto mode, this script uses the DevTools automation port (--auto-port) so capture-devtools can attach to the same session.
`;

const DEFAULT_AUTO_READY_RETRIES = 15;
const DEFAULT_AUTO_READY_DELAY_MS = 1000;

async function waitForAutomationEndpoint(port) {
  const wsEndpoint = `ws://127.0.0.1:${port}`;
  const module = await import("miniprogram-automator");
  const automator = module.default ?? module;
  const attempts = [];

  for (let attempt = 1; attempt <= DEFAULT_AUTO_READY_RETRIES; attempt += 1) {
    try {
      const miniProgram = await Promise.race([
        automator.connect({ wsEndpoint }),
        sleep(2000).then(() => {
          throw new Error("connect timeout");
        }),
      ]);

      try {
        miniProgram.disconnect();
      } catch {
        // best effort
      }

      return {
        wsEndpoint,
        attempts,
        successfulAttempt: attempt,
      };
    } catch (error) {
      attempts.push({
        attempt,
        cause: error instanceof Error ? error.message : String(error),
      });
      await sleep(DEFAULT_AUTO_READY_DELAY_MS);
    }
  }

  throw new Error(`Automation endpoint ${wsEndpoint} did not become ready in time`);
}

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

const port = args.port ?? getDefaultAutomationPort();
const mode = args.mode ?? "auto";
const command = mode === "open" ? "open" : "auto";
const portFlag = mode === "auto" ? "--auto-port" : "--port";
const commandArgs = [command, "--project", projectRoot, portFlag, String(port)];

if (args["trust-project"]) {
  commandArgs.push("--trust-project");
}

if (mode === "auto") {
  const launchResult = await new Promise((resolve, reject) => {
    const child = spawn(cliPath, commandArgs, {
      detached: true,
      stdio: "ignore",
    });
    let settled = false;

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.once("exit", (code, signal) => {
      if (!settled && code && code !== 0) {
        settled = true;
        reject(new Error(`DevTools auto session exited early with code ${code}${signal ? ` (${signal})` : ""}`));
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve({
          pid: child.pid ?? null,
        });
      }
    }, 1500);
  }).catch((error) => {
    exitWithError("Failed to launch WeChat DevTools automation session.", {
      cliPath,
      projectRoot,
      mode,
      port: Number(port),
      cause: error instanceof Error ? error.message : String(error),
    });
  });

  const endpoint = await waitForAutomationEndpoint(Number(port)).catch((error) => {
    exitWithError("Failed to confirm WeChat DevTools automation endpoint readiness.", {
      cliPath,
      projectRoot,
      mode,
      port: Number(port),
      cause: error instanceof Error ? error.message : String(error),
    });
  });

  logJson({
    ok: true,
    cliPath,
    projectRoot,
    port: Number(port),
    mode,
    portFlag,
    command: [cliPath, ...commandArgs],
    pid: launchResult?.pid ?? null,
    wsEndpoint: endpoint?.wsEndpoint ?? null,
    readyAttempt: endpoint?.successfulAttempt ?? null,
    stdout: "",
    stderr: "",
    nextStep: `Use capture-devtools with --port ${port} to attach to this automation session.`,
  });
} else {
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
    portFlag,
    command: [cliPath, ...commandArgs],
    stdout: run.stdout?.trim() ?? "",
    stderr: run.stderr?.trim() ?? "",
    nextStep: "Use the opened DevTools session for preview or manual capture.",
  });
}
