import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

export function hasFlag(argv, flag) {
  return argv.includes(`--${flag}`);
}

export function printHelp(text) {
  process.stdout.write(`${text.trim()}\n`);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolvePath(baseDir, maybeRelativePath) {
  if (!maybeRelativePath) {
    return undefined;
  }

  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.resolve(baseDir, maybeRelativePath);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function exitWithError(message, details = {}) {
  const payload = {
    ok: false,
    error: message,
    ...details,
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}

export function logJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function maybeWriteOutput(outputPath, value) {
  if (!outputPath) {
    return;
  }
  writeJson(outputPath, value);
}

export function fileExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function findFirstExisting(paths) {
  return paths.find((candidate) => fileExists(candidate));
}

export function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

export function sanitizeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function toAbsoluteList(baseDir, values = []) {
  return values.map((value) => resolvePath(baseDir, value));
}

export function parseBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function pollUntil(check, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 10000);
  const intervalMs = Number(options.intervalMs ?? 250);
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const result = await check();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }

  return null;
}

export function runShellCommand(command, options = {}) {
  return spawnSync(command, {
    shell: true,
    encoding: "utf8",
    ...options,
  });
}

export function getDefaultDevtoolsCliCandidates() {
  return [
    "/Applications/wechatwebdevtools.app/Contents/MacOS/cli",
    "/Applications/微信开发者工具.app/Contents/MacOS/cli",
  ];
}

export function buildMiniProgramUrl(route, query = {}) {
  const normalizedRoute = String(route).startsWith("/") ? String(route) : `/${String(route)}`;
  const entries = Object.entries(query ?? {}).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return normalizedRoute;
  }

  return `${normalizedRoute}?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

export function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
