#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMiniProgramUrl,
  buildScenarioOutputDir,
  ensureDir,
  exitWithError,
  fileExists,
  getDefaultDevtoolsCliCandidates,
  getDefaultAutomationPort,
  hasFlag,
  logJson,
  parseArgs,
  parseBoolean,
  parseNumber,
  pollUntil,
  printHelp,
  readJson,
  resolvePath,
  runShellCommand,
  sanitizeName,
  sleep,
  writeJson,
} from "./_shared.mjs";

const HELP = `
Usage:
  node scripts/capture-devtools.mjs --project-root <path> --scenario <file> [--output-dir <dir>] [--port <number>] [--cli-path <path>] [--trust-project]

Launch WeChat DevTools through miniprogram-automator, navigate to the target page,
wait for the configured ready signal, and capture native runtime screenshots.

Notes:
  - Common macOS WeChat DevTools CLI locations are used as convenience defaults.
  - Pass --cli-path to override discovery.
  - The default automation port is configurable through --port.
`;

const DEFAULT_LAUNCH_RETRIES = 3;
const DEFAULT_LAUNCH_RETRY_DELAY_MS = 2000;
const DEFAULT_LAUNCH_TIMEOUT_MS = 12000;
const DEFAULT_CONNECT_RETRIES = 5;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

function createFailure(phase, message, details = {}) {
  return {
    ok: false,
    phase,
    error: message,
    ...details,
  };
}

function isStructuredFailure(error) {
  return Boolean(error && typeof error === "object" && "phase" in error && "error" in error);
}

function getErrorCause(error) {
  if (isStructuredFailure(error)) {
    return error.error;
  }

  return error instanceof Error ? error.message : String(error);
}

function getScenarioDefaults(scenario) {
  const capture = scenario.capture ?? {};
  const readySignal = scenario.readySignal ?? {};
  const viewport = scenario.viewport ?? {};

  return {
    capture,
    readySignal,
    viewport,
    timeoutMs: parseNumber(readySignal.timeoutMs, 10000),
    stableMs: parseNumber(readySignal.stableMs, 500),
    navigationMode: capture.navigationMode ?? "relaunch",
    useFullPage: parseBoolean(capture.fullPage, capture.mode === "fullPage"),
    segmentSelectors: capture.segmentSelectors ?? {},
    ignoreRegions: scenario.ignoreRegions ?? [],
  };
}

function getCliPath(cliPathArg) {
  return cliPathArg ?? getDefaultDevtoolsCliCandidates().find((candidate) => fileExists(candidate));
}

async function loadAutomator() {
  try {
    const module = await import("miniprogram-automator");
    return module.default ?? module;
  } catch (error) {
    throw createFailure("load-automator", "miniprogram-automator is not installed. Run npm install in this repository before using capture-devtools.", {
      phase: "load-automator",
      cause: getErrorCause(error),
    });
  }
}

async function connectMiniProgramWithRetries({
  automator,
  port,
  scenarioId,
  projectRoot,
}) {
  const connectPort = Number(port);
  const wsEndpoint = `ws://127.0.0.1:${connectPort}`;
  const attempts = [];

  for (let attempt = 1; attempt <= DEFAULT_CONNECT_RETRIES; attempt += 1) {
    try {
      const miniProgram = await Promise.race([
        automator.connect({
          wsEndpoint,
        }),
        sleep(DEFAULT_CONNECT_TIMEOUT_MS).then(() => {
          throw Error(`Connect attempt timed out after ${DEFAULT_CONNECT_TIMEOUT_MS} ms`);
        }),
      ]);

      return {
        miniProgram,
        connectionInfo: {
          connectionMode: "attach-existing",
          successfulAttempt: attempt,
          attemptCount: attempt,
          usedPort: connectPort,
          wsEndpoint,
          attempts,
        },
      };
    } catch (error) {
      attempts.push({
        attempt,
        port: connectPort,
        wsEndpoint,
        cause: getErrorCause(error),
      });

      if (attempt < DEFAULT_CONNECT_RETRIES) {
        await sleep(DEFAULT_CONNECT_RETRY_DELAY_MS);
      }
    }
  }

  return {
    miniProgram: null,
    connectionInfo: {
      connectionMode: "attach-existing",
      successfulAttempt: 0,
      attemptCount: DEFAULT_CONNECT_RETRIES,
      usedPort: connectPort,
      wsEndpoint,
      attempts,
    },
  };
}

async function launchMiniProgramWithRetries({
  automator,
  projectRoot,
  cliPath,
  port,
  trustProject,
  scenarioId,
}) {
  const basePort = Number(port);
  const attempts = [];

  for (let attempt = 1; attempt <= DEFAULT_LAUNCH_RETRIES; attempt += 1) {
    const attemptPort = basePort + (attempt - 1);

    try {
      const miniProgram = await Promise.race([
        automator.launch({
          projectPath: projectRoot,
          cliPath,
          port: attemptPort,
          trustProject,
        }),
        sleep(DEFAULT_LAUNCH_TIMEOUT_MS).then(() => {
          throw new Error(`Launch attempt timed out after ${DEFAULT_LAUNCH_TIMEOUT_MS} ms`);
        }),
      ]);

      return {
        miniProgram,
        launchInfo: {
          connectionMode: "launch",
          successfulAttempt: attempt,
          attemptCount: attempt,
          requestedPort: basePort,
          usedPort: attemptPort,
          retriesEnabled: DEFAULT_LAUNCH_RETRIES,
          attempts,
        },
      };
    } catch (error) {
      attempts.push({
        attempt,
        port: attemptPort,
        cause: getErrorCause(error),
      });

      if (attempt < DEFAULT_LAUNCH_RETRIES) {
        await sleep(DEFAULT_LAUNCH_RETRY_DELAY_MS);
        continue;
      }

      throw createFailure("launch-devtools", "Failed to launch or connect to WeChat DevTools automation after retries.", {
        scenarioId,
        projectRoot,
        cliPath,
        requestedPort: basePort,
        attempts,
      });
    }
  }

  throw createFailure("launch-devtools", "Failed to launch or connect to WeChat DevTools automation after retries.", {
    scenarioId,
    projectRoot,
    cliPath,
    requestedPort: basePort,
    attempts,
  });
}

async function waitForReadySignal(page, defaults, routeContext) {
  const { readySignal, timeoutMs, stableMs } = defaults;
  const signalType = readySignal.type ?? "selector";
  const signalValue = readySignal.value;

  if (!signalValue && signalType !== "network-idle" && signalType !== "data-stable") {
    throw createFailure("wait-ready", "readySignal.value is required for selector/text waits.", {
      route: routeContext.route,
      readySignal,
    });
  }

  if (signalType === "selector") {
    const matched = await pollUntil(async () => {
      const element = await page.$(signalValue);
      return element ? true : null;
    }, { timeoutMs, intervalMs: 250 });

    if (!matched) {
      throw createFailure("wait-ready", "Timed out waiting for selector readySignal.", {
        route: routeContext.route,
        readySignal,
      });
    }
  } else if (signalType === "text") {
    const matched = await pollUntil(async () => {
      try {
        const serialized = JSON.stringify(await page.data());
        return serialized.includes(String(signalValue)) ? true : null;
      } catch {
        return null;
      }
    }, { timeoutMs, intervalMs: 300 });

    if (!matched) {
      throw createFailure("wait-ready", "Timed out waiting for text readySignal in page data.", {
        route: routeContext.route,
        readySignal,
      });
    }
  } else if (signalType === "network-idle" || signalType === "data-stable") {
    let lastSnapshot = "";
    let lastChangeAt = Date.now();
    const matched = await pollUntil(async () => {
      try {
        const snapshot = JSON.stringify(await page.data());
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          lastChangeAt = Date.now();
          return null;
        }

        return Date.now() - lastChangeAt >= stableMs ? true : null;
      } catch {
        return null;
      }
    }, { timeoutMs, intervalMs: 350 });

    if (!matched) {
      throw createFailure("wait-ready", "Timed out waiting for page-data stability.", {
        route: routeContext.route,
        readySignal,
      });
    }
  } else {
    throw createFailure("wait-ready", "Unsupported readySignal.type.", {
      route: routeContext.route,
      readySignal,
    });
  }

  if (stableMs > 0) {
    await sleep(stableMs);
  }
}

async function captureViewport({ miniProgram, outputDir }) {
  try {
    const imagePath = path.join(outputDir, "viewport.png");
    await miniProgram.screenshot({ path: imagePath });
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(imagePath).metadata();

    return {
      imagePath,
      framePaths: [imagePath],
      scale: 1,
      width: parseNumber(metadata.width, 0),
      height: parseNumber(metadata.height, 0),
    };
  } catch (error) {
    throw createFailure("capture-viewport", "Failed to capture viewport screenshot.", {
      cause: getErrorCause(error),
    });
  }
}

async function stitchFullPage({ miniProgram, page, viewport, outputDir }) {
  try {
    const pageSize = await page.size();
    const pageHeight = Math.max(parseNumber(pageSize.height, viewport.height), viewport.height);
    const viewportHeight = Math.max(parseNumber(viewport.height, 0), 1);
    const stops = [];

    for (let cursor = 0; cursor < pageHeight; cursor += viewportHeight) {
      stops.push(Math.min(cursor, Math.max(pageHeight - viewportHeight, 0)));
    }

    if (stops.length === 0) {
      stops.push(0);
    }

    const uniqueStops = [...new Set(stops)];
    const frames = [];

    for (let index = 0; index < uniqueStops.length; index += 1) {
      const scrollTop = uniqueStops[index];
      await miniProgram.pageScrollTo(scrollTop);
      await sleep(400);
      const framePath = path.join(outputDir, `frame-${String(index + 1).padStart(2, "0")}.png`);
      await miniProgram.screenshot({ path: framePath });
      frames.push({ scrollTop, framePath });
    }

    const { default: sharp } = await import("sharp");
    const firstFrame = await sharp(frames[0].framePath).metadata();
    const frameWidth = parseNumber(firstFrame.width, 0);
    const frameHeight = parseNumber(firstFrame.height, 0);
    const scale = frameHeight / viewportHeight;
    const stitchedHeight = Math.max(Math.round(pageHeight * scale), frameHeight);
    const imagePath = path.join(outputDir, "fullpage.png");

    await sharp({
      create: {
        width: frameWidth,
        height: stitchedHeight,
        channels: 4,
        background: "#ffffffff",
      },
    })
      .composite(
        frames.map(({ scrollTop, framePath }) => ({
          input: framePath,
          top: Math.round(scrollTop * scale),
          left: 0,
        })),
      )
      .png()
      .toFile(imagePath);

    await miniProgram.pageScrollTo(0);

    return {
      imagePath,
      framePaths: frames.map((item) => item.framePath),
      scale,
      width: frameWidth,
      height: stitchedHeight,
    };
  } catch (error) {
    throw createFailure("capture-fullpage", "Failed to stitch full-page screenshot.", {
      cause: getErrorCause(error),
    });
  }
}

function resolveSegmentSelector(segment, selectors) {
  if (selectors[segment]) {
    return selectors[segment];
  }

  if (segment.startsWith(".") || segment.startsWith("#")) {
    return segment;
  }

  return null;
}

async function collectIgnoreRegions({
  page,
  defaults,
  viewport,
  baseCapture,
  warnings,
}) {
  const ignoreRegions = defaults.ignoreRegions ?? [];
  if (!ignoreRegions.length) {
    return [];
  }

  const viewportWidth = Math.max(parseNumber(viewport.width, 0), 1);
  const viewportHeight = Math.max(parseNumber(viewport.height, 0), 1);
  const scaleX = parseNumber(baseCapture.width, viewportWidth) / viewportWidth;
  const scaleY = parseNumber(baseCapture.height, viewportHeight) / viewportHeight;
  const currentScrollTop = defaults.useFullPage ? 0 : parseNumber(await page.scrollTop(), 0);
  const regions = [];

  for (const item of ignoreRegions) {
    const selector = resolveSegmentSelector(item, defaults.segmentSelectors) ?? item;
    const element = await page.$(selector);

    if (!element) {
      warnings.push(`ignoreRegions selector "${selector}" was not found.`);
      continue;
    }

    const offset = await element.offset();
    const size = await element.size();
    const left = parseNumber(offset.left ?? offset.x, 0);
    const top = parseNumber(offset.top ?? offset.y, 0);
    const width = Math.max(parseNumber(size.width, 0), 1);
    const height = Math.max(parseNumber(size.height, 0), 1);
    const normalizedTop = defaults.useFullPage ? top : Math.max(top - currentScrollTop, 0);

    regions.push({
      selector,
      left: Math.max(Math.round(left * scaleX), 0),
      top: Math.max(Math.round(normalizedTop * scaleY), 0),
      width: Math.max(Math.round(width * scaleX), 1),
      height: Math.max(Math.round(height * scaleY), 1),
      source: "actual-image",
    });
  }

  return regions;
}

async function cropSegments({
  page,
  miniProgram,
  baseImagePath,
  outputDir,
  defaults,
  viewport,
  warnings,
}) {
  try {
    const segments = defaults.capture.segments ?? [];
    if (segments.length === 0) {
      return [];
    }

    const { default: sharp } = await import("sharp");
    const baseMetadata = await sharp(baseImagePath).metadata();
    const viewportWidth = Math.max(parseNumber(viewport.width, 0), 1);
    const viewportHeight = Math.max(parseNumber(viewport.height, 0), 1);
    const scaleX = parseNumber(baseMetadata.width, viewportWidth) / viewportWidth;
    const scaleY = parseNumber(baseMetadata.height, viewportHeight) / viewportHeight;
    const segmentShots = [];

    for (const segment of segments) {
      const selector = resolveSegmentSelector(segment, defaults.segmentSelectors);
      if (!selector) {
        warnings.push(`No selector mapping was found for segment "${segment}".`);
        continue;
      }

      const element = await page.$(selector);
      if (!element) {
        warnings.push(`Segment selector "${selector}" for "${segment}" was not found.`);
        continue;
      }

      const offset = await element.offset();
      const size = await element.size();
      const top = parseNumber(offset.top ?? offset.y, 0);
      const left = parseNumber(offset.left ?? offset.x, 0);
      const width = Math.max(parseNumber(size.width, 0), 1);
      const height = Math.max(parseNumber(size.height, 0), 1);

      let sourcePath = baseImagePath;
      let cropTop = top * scaleY;
      const cropLeft = left * scaleX;

      if (!defaults.useFullPage) {
        const targetScrollTop = Math.max(top - 16, 0);
        await miniProgram.pageScrollTo(targetScrollTop);
        await sleep(defaults.stableMs);
        sourcePath = path.join(outputDir, `${sanitizeName(segment)}.viewport-source.png`);
        await miniProgram.screenshot({ path: sourcePath });
        cropTop = Math.max((top - targetScrollTop) * scaleY, 0);
      }

      const sourceMetadata = await sharp(sourcePath).metadata();
      const extractLeft = Math.max(Math.round(cropLeft), 0);
      const extractTop = Math.max(Math.round(cropTop), 0);
      const extractWidth = Math.min(Math.round(width * scaleX), parseNumber(sourceMetadata.width, 0) - extractLeft);
      const extractHeight = Math.min(Math.round(height * scaleY), parseNumber(sourceMetadata.height, 0) - extractTop);

      if (extractWidth <= 0 || extractHeight <= 0) {
        warnings.push(`Segment "${segment}" resolved to an invalid crop region.`);
        continue;
      }

      const segmentPath = path.join(outputDir, `${sanitizeName(segment)}.png`);
      await sharp(sourcePath)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight,
        })
        .png()
        .toFile(segmentPath);

      segmentShots.push({
        segment,
        selector,
        path: segmentPath,
      });
    }

    await miniProgram.pageScrollTo(0);
    return segmentShots;
  } catch (error) {
    throw createFailure("capture-segments", "Failed while capturing segment screenshots.", {
      cause: getErrorCause(error),
    });
  }
}

export async function captureWithDevtools({
  projectRoot,
  scenarioPath,
  outputDir,
  cliPath,
  port = getDefaultAutomationPort(),
  trustProject = false,
  preferConnect = false,
}) {
  const scenario = readJson(scenarioPath);
  const scenarioId = scenario.id ?? path.basename(scenarioPath, path.extname(scenarioPath));
  const defaults = getScenarioDefaults(scenario);
  const warnings = [];

  const effectiveCliPath = getCliPath(cliPath);
  if (!effectiveCliPath) {
    throw createFailure("resolve-cli", "WeChat DevTools CLI was not found. Pass --cli-path to override discovery.", {
      scenarioId,
      projectRoot,
    });
  }

  ensureDir(outputDir);

  const prepareCommand = defaults.capture.prepareCommand;
  if (prepareCommand) {
    const result = runShellCommand(prepareCommand, {
      cwd: projectRoot,
      env: {
        ...process.env,
        MINIPROGRAM_QA_OUTPUT_DIR: outputDir,
        MINIPROGRAM_QA_SCENARIO_ID: scenarioId,
        MINIPROGRAM_QA_ROUTE: scenario.route ?? "",
        MINIPROGRAM_QA_QUERY: JSON.stringify(scenario.query ?? {}),
        MINIPROGRAM_QA_FIXTURE: scenario.fixture ?? "",
      },
    });

    if (result.status !== 0) {
      throw createFailure("prepare-command", "capture.prepareCommand failed.", {
        scenarioId,
        projectRoot,
        command: prepareCommand,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
      });
    }
  }

  const automator = await loadAutomator();
  let miniProgram;
  let connectionInfo = null;

  if (preferConnect) {
    const existingConnection = await connectMiniProgramWithRetries({
      automator,
      port,
      scenarioId,
      projectRoot,
    });

    if (existingConnection.miniProgram) {
      miniProgram = existingConnection.miniProgram;
      connectionInfo = existingConnection.connectionInfo;
    } else {
      warnings.push(
        `Failed to attach existing DevTools automation session on port ${port}; falling back to launch mode.`,
      );
      connectionInfo = existingConnection.connectionInfo;
    }
  }

  let launchInfo = null;
  if (!miniProgram) {
    const launched = await launchMiniProgramWithRetries({
      automator,
      projectRoot,
      cliPath: effectiveCliPath,
      port,
      trustProject,
      scenarioId,
    });
    miniProgram = launched.miniProgram;
    launchInfo = launched.launchInfo;
  }

  try {
    const url = buildMiniProgramUrl(scenario.route, scenario.query);
    try {
      if (defaults.navigationMode === "navigate") {
        await miniProgram.navigateTo(url);
      } else {
        await miniProgram.reLaunch(url);
      }
    } catch (error) {
      throw createFailure("navigate", "Failed to navigate to target mini-program route.", {
        scenarioId,
        route: scenario.route,
        url,
        cause: getErrorCause(error),
      });
    }

    let page;
    try {
      page = await miniProgram.currentPage();
    } catch (error) {
      throw createFailure("current-page", "Failed to resolve current mini-program page after navigation.", {
        scenarioId,
        route: scenario.route,
        url,
        cause: getErrorCause(error),
      });
    }
    if (!page) {
      throw createFailure("navigate", "No current page is available after navigation.", {
        scenarioId,
        route: scenario.route,
      });
    }

    await waitForReadySignal(page, defaults, {
      scenarioId,
      route: scenario.route,
    });

    const baseCapture = defaults.useFullPage
      ? await stitchFullPage({ miniProgram, page, viewport: defaults.viewport, outputDir })
      : await captureViewport({ miniProgram, outputDir });

    const segmentShots = await cropSegments({
      page,
      miniProgram,
      baseImagePath: baseCapture.imagePath,
      outputDir,
      defaults,
      viewport: defaults.viewport,
      warnings,
    });
    const ignoreRegions = await collectIgnoreRegions({
      page,
      defaults,
      viewport: defaults.viewport,
      baseCapture,
      warnings,
    });

    const metadata = {
      ok: true,
      scenarioId,
      scenarioPath,
      projectRoot,
      route: scenario.route ?? null,
      query: scenario.query ?? {},
      fixture: scenario.fixture ?? null,
      viewport: scenario.viewport ?? null,
      readySignal: scenario.readySignal ?? null,
      captureMode: scenario.capture?.mode ?? "viewport",
      navigationMode: defaults.navigationMode,
      executor: {
        type: "devtools-automator",
        cliPath: effectiveCliPath,
        requestedPort: Number(port),
        usedPort: launchInfo?.usedPort ?? connectionInfo?.usedPort ?? Number(port),
        connectionMode: launchInfo?.connectionMode ?? connectionInfo?.connectionMode ?? "launch",
        successfulAttempt:
          launchInfo?.successfulAttempt ?? connectionInfo?.successfulAttempt ?? 0,
        attemptCount:
          launchInfo?.attemptCount ?? connectionInfo?.attemptCount ?? 0,
      },
      attachAttempts: connectionInfo?.attempts ?? [],
      launchAttempts: launchInfo?.attempts ?? [],
      evidenceSource: "devtools-automator",
      screenshots: [baseCapture.imagePath, ...segmentShots.map((item) => item.path)],
      baseScreenshot: baseCapture.imagePath,
      frameScreenshots: baseCapture.framePaths,
      segmentScreenshots: segmentShots,
      segments: scenario.capture?.segments ?? [],
      ignoreRegions,
      warnings,
    };

    try {
      writeJson(path.join(outputDir, "capture-metadata.json"), metadata);
    } catch (error) {
      throw createFailure("write-metadata", "Failed to write capture metadata.", {
        scenarioId,
        outputDir,
        cause: getErrorCause(error),
      });
    }
    return metadata;
  } finally {
    try {
      await miniProgram.close();
    } catch {
      // Best-effort cleanup.
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help")) {
    printHelp(HELP);
    process.exit(0);
  }

  const args = parseArgs(argv);
  const projectRoot = resolvePath(process.cwd(), args["project-root"]);
  const scenarioPath = resolvePath(process.cwd(), args.scenario);

  if (!projectRoot || !scenarioPath) {
    exitWithError("Missing required --project-root or --scenario argument.", {
      phase: "parse-args",
    });
  }

  const outputDir = resolvePath(
    process.cwd(),
    args["output-dir"] ?? buildScenarioOutputDir(projectRoot, scenarioPath),
  );

  captureWithDevtools({
    projectRoot,
    scenarioPath,
    outputDir,
    cliPath: resolvePath(process.cwd(), args["cli-path"]),
    port: args.port ?? getDefaultAutomationPort(),
    trustProject: parseBoolean(args["trust-project"], false),
    preferConnect: args.port !== undefined,
  })
    .then((result) => {
      logJson(result);
    })
    .catch((error) => {
      if (isStructuredFailure(error)) {
        exitWithError(error.error ?? "capture-devtools failed.", error);
      }

      exitWithError("capture-devtools failed unexpectedly.", {
        phase: "unexpected",
        cause: error instanceof Error ? error.message : String(error),
      });
    });
}
