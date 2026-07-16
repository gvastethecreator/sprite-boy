import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { build } from "vite";
import {
  allocatePort,
  cleanupBrowserRuntime,
  connectToPage,
  processHasExited,
  resolveChromeExecutable,
  safeRemoveProfile,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";

const SCREENSHOT_PATH = "artifacts/quality/EDITOR/2026-07-16/a1-03-composition-canvas.png";

const STATIC_SERVER_SOURCE = String.raw`
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[1]);
const port = Number(process.argv[2]);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (pathname === "/") { response.writeHead(200, { "content-type": "text/plain" }); response.end("ready"); return; }
    const target = path.resolve(root, "." + pathname);
    if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    fs.readFile(target, (error, bytes) => {
      if (error) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
      response.end(bytes);
    });
  } catch { response.writeHead(400); response.end(); }
}).listen(port, "127.0.0.1");
`;

function findBuiltHarness(root) {
  for (const name of readdirSync(root)) {
    const candidate = resolve(root, name);
    if (statSync(candidate).isDirectory()) {
      const nested = findBuiltHarness(candidate);
      if (nested) return nested;
    } else if (name === "compositionCanvasSettingsHarness.html") {
      return candidate;
    }
  }
  return null;
}

async function buildBrowserHarness(cwd, outputDirectory) {
  await build({
    root: cwd,
    logLevel: "silent",
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(cwd, "tests/browser/compositionCanvasSettingsHarness.html"),
      },
    },
  });
  const harness = findBuiltHarness(outputDirectory);
  if (!harness) throw new Error("A1-03 built harness is unavailable.");
  return `/${harness.slice(resolve(outputDirectory).length + 1).replaceAll("\\", "/")}`;
}

function spawnStaticServer(cwd, outputDirectory, port) {
  return spawn(process.execPath, ["-e", STATIC_SERVER_SOURCE, outputDirectory, String(port)], {
    cwd,
    env: process.env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
}

async function collectAttemptDiagnostics(baseUrl, client, server, stage) {
  let serverHealth = "unavailable";
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
    serverHealth = `http-${response.status}`;
  } catch {
    serverHealth = "unreachable";
  }
  let page = { route: null, readyState: "unavailable", harnessPromise: false };
  if (client) {
    try {
      page = await client.evaluate(`({
        route: location.href,
        readyState: document.readyState,
        harnessPromise: globalThis.__spriteBoyA103 instanceof Promise,
      })`);
    } catch {
      // Structural fallback remains safe and sufficient for retry classification.
    }
  }
  return Object.freeze({
    stage,
    serverHealth,
    serverExitedEarly: Boolean(server && processHasExited(server)),
    page,
    runtime: client ? {
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    } : null,
  });
}

export async function runCompositionCanvasBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT_PATH);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-a103-browser-"));
  const buildDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-a103-build-"));
  let harnessPath = "/tests/browser/compositionCanvasSettingsHarness.html";
  let vite;
  let chrome;
  let client;
  let evidence;
  let failure;
  let cleanupFailure;
  let stage = "harness-build";
  try {
    harnessPath = await buildBrowserHarness(cwd, buildDirectory);
    stage = "server-start";
    vite = spawnStaticServer(cwd, buildDirectory, port);
    await waitForPreview(baseUrl, vite);
    stage = "server-ready";
    chrome = spawn(resolveChromeExecutable(options), [
      "--headless=new",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-default-browser-check",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profile, chrome);
    client = await connectToPage(devToolsPort, 30_000);
    stage = "browser-connected";
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    await client.send("Page.navigate", { url: `${baseUrl}${harnessPath}` });
    stage = "harness-navigation";
    await client.waitFor("globalThis.__spriteBoyA103 instanceof Promise", 60_000);
    stage = "harness-running";
    const journey = await client.evaluate("globalThis.__spriteBoyA103");
    if (!journey || journey.status !== "pass") throw new Error("A1-03 browser journey failed.");

    const tabbableFocus = await client.evaluate(`(() => {
      const first = document.querySelector('select[id^="composition-ratio-"]');
      if (!(first instanceof HTMLSelectElement)) return false;
      first.focus();
      return document.activeElement === first;
    })()`);
    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const png = Buffer.from(screenshot.data, "base64");
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, png);
    const runtime = {
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    };
    const passed = tabbableFocus && journey.revision === 1 && journey.historyEntries === 1 &&
      journey.canvas?.width === 128 && journey.canvas?.height === 72 &&
      journey.canvas?.background === "#3157a4" && journey.export?.byteSize > 0 &&
      journey.reloadMatches && journey.invalidDraftVisible && journey.pageFits &&
      Object.values(runtime).every((count) => count === 0);
    if (!passed) throw new Error(`A1-03 browser evidence failed closed: ${JSON.stringify({
      tabbableFocus,
      journey,
      runtime,
    })}`);
    evidence = Object.freeze({
      status: "pass",
      ...journey,
      tabbableFocus,
      screenshotPath: SCREENSHOT_PATH,
      screenshotBytes: png.byteLength,
      screenshotSha256: createHash("sha256").update(png).digest("hex"),
      ...runtime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const kind = message.includes("readiness timed out")
      ? "readiness-timeout"
      : message.includes("harness") || stage.startsWith("harness")
        ? "harness-failure"
        : "runtime-failure";
    failure = Object.freeze({
      kind,
      diagnostics: await collectAttemptDiagnostics(baseUrl, client, vite, stage),
    });
  } finally {
    try {
      await cleanupBrowserRuntime(client, chrome, vite, profile, "A1-03 browser cleanup failed.");
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await safeRemoveProfile(buildDirectory);
    } catch (error) {
      cleanupFailure ??= error;
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  const cleanup = Object.freeze({
    cdpClosed: true,
    chromeExited: !chrome || processHasExited(chrome),
    serverExited: !vite || processHasExited(vite),
    profileRemoved: !existsSync(profile),
    buildRemoved: !existsSync(buildDirectory),
  });
  if (Object.values(cleanup).some((value) => value !== true)) {
    throw new Error(`A1-03 browser cleanup evidence failed closed: ${JSON.stringify(cleanup)}`);
  }
  if (failure) {
    throw new Error(`A1-03 browser attempt failed: ${JSON.stringify({ ...failure, cleanup })}`);
  }
  return Object.freeze({ ...evidence, cleanup });
}

export async function runCompositionCanvasBrowserGateWithRetry(options = {}) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await runCompositionCanvasBrowserGate(options);
      return Object.freeze({ ...result, attempts: attempt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "browser-attempt-failed";
      attempts.push(message);
      const retryable = message.includes('"kind":"readiness-timeout"') &&
        message.includes('"cdpClosed":true') &&
        message.includes('"chromeExited":true') &&
        message.includes('"serverExited":true') &&
        message.includes('"profileRemoved":true') &&
        message.includes('"buildRemoved":true');
      if (!retryable || attempt === 2) {
        throw new Error(`A1-03 browser gate failed after ${attempt} attempt(s): ${attempts.join(" | ")}`);
      }
    }
  }
  throw new Error("A1-03 browser gate exhausted attempts.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runCompositionCanvasBrowserGateWithRetry())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "fail",
      check: "a1-03-composition-canvas-browser",
      reason: error instanceof Error ? error.message : "browser-gate-failed",
    })}\n`);
    process.exitCode = 1;
  }
}
