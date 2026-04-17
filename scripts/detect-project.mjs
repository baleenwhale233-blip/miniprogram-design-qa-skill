#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findFirstExisting,
  getDefaultDevtoolsCliCandidates,
  hasFlag,
  logJson,
  parseArgs,
  printHelp,
  readJson,
  resolvePath,
  exitWithError,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/detect-project.mjs --project-root <path> [--output <file>]

Detect WeChat mini-program style projects and likely execution adapters.
`;

function walkUpForFile(startDir, relativeName) {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, relativeName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function detectFramework(packageJson) {
  const allDeps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  if (allDeps["@tarojs/taro"] || allDeps["@tarojs/plugin-platform-weapp"]) {
    return "taro";
  }

  if (allDeps["@dcloudio/uni-app"] || allDeps["@dcloudio/vite-plugin-uni"]) {
    return "uni-app";
  }

  return "unknown";
}

export function detectProject(projectRoot) {
  if (!projectRoot) {
    exitWithError("Missing required projectRoot.");
  }

  const packageJsonPath = walkUpForFile(projectRoot, "package.json");
  const projectConfigPath = walkUpForFile(projectRoot, "project.config.json");
  const appJsonPath = walkUpForFile(projectRoot, "app.json");
  const taroAppConfigPath = findFirstExisting([
    path.join(projectRoot, "src/app.config.ts"),
    path.join(projectRoot, "src/app.config.js"),
    path.join(projectRoot, "app.config.ts"),
    path.join(projectRoot, "app.config.js"),
  ]);

  const packageJson = packageJsonPath ? readJson(packageJsonPath) : undefined;
  const framework = packageJson
    ? detectFramework(packageJson)
    : projectConfigPath || appJsonPath
      ? "wechat-native"
      : "unknown";
  const detected = Boolean(projectConfigPath || appJsonPath || taroAppConfigPath || framework !== "unknown");

  const devtoolsCliPath = findFirstExisting(getDefaultDevtoolsCliCandidates());

  let appId;
  let miniprogramRoot;
  if (projectConfigPath) {
    try {
      const projectConfig = readJson(projectConfigPath);
      appId = projectConfig.appid;
      miniprogramRoot = projectConfig.miniprogramRoot;
    } catch {
      // Keep detection resilient for partial or invalid config files.
    }
  }

  return {
    ok: true,
    detected,
    platform: detected ? "wechat-miniprogram" : "unknown",
    framework,
    projectRoot,
    packageJsonPath,
    projectConfigPath,
    appJsonPath,
    taroAppConfigPath,
    appId: appId ?? null,
    miniprogramRoot: miniprogramRoot ?? null,
    nativeExecutor: {
      type: devtoolsCliPath ? "wechat-devtools-cli" : "none",
      cliPath: devtoolsCliPath ?? null,
    },
    evidence: [
      projectConfigPath ? "project.config.json" : null,
      appJsonPath ? "app.json" : null,
      taroAppConfigPath ? "taro app.config" : null,
      packageJsonPath ? "package.json" : null,
    ].filter(Boolean),
    warnings: detected ? [] : ["No WeChat mini-program project markers were found."],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
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

  const result = detectProject(projectRoot);

  if (args.output) {
    const outputPath = resolvePath(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  logJson(result);
}
