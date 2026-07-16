import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  allocatePort,
  cleanupBrowserRuntime,
  connectToPage,
  resolveChromeExecutable,
  spawnViteServer,
  waitForDevToolsPort,
  waitForPreview,
} from "../../scripts/studio-browser-smoke.mjs";

const GOLDEN_PATH = "artifacts/quality/GRID/2026-07-16/s1-05-region-to-asset-golden.png";
const VISUAL_PATH = "artifacts/quality/GRID/2026-07-16/s1-05-region-to-asset-visual.png";

export class RegionToAssetBrowserGateError extends Error {
  constructor(reason, phase, observed) {
    super("S1-05 browser gate failed closed.");
    this.name = "RegionToAssetBrowserGateError";
    this.reason = reason;
    this.phase = phase;
    this.observed = Object.freeze(observed);
  }
}

async function prewarmJourney(baseUrl) {
  for (const path of [
    "/tests/browser/regionToAssetHarness.html",
    "/tests/browser/regionToAssetJourney.ts",
    "/features/slice/assets/browserRegionCrop.ts",
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    if (!response.ok) throw new Error("prewarm failed");
    await response.arrayBuffer();
  }
}

export async function runRegionToAssetBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const goldenPath = resolve(cwd, options.goldenPath ?? GOLDEN_PATH);
  const visualPath = resolve(cwd, options.visualPath ?? VISUAL_PATH);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-s105-browser-"));
  let vite;
  let chrome;
  let client;
  let phase = "server-start";
  let journeyReady = false;
  let value = null;
  try {
    phase = "browser-resolve";
    const chromePath = resolveChromeExecutable(options);
    phase = "server-start";
    vite = spawnViteServer(cwd, port, "dev");
    await waitForPreview(baseUrl, vite);
    phase = "module-prewarm";
    await prewarmJourney(baseUrl);
    phase = "browser-start";
    chrome = spawn(chromePath, [
      "--headless=new", "--disable-background-networking", "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows", "--disable-component-update", "--disable-default-apps",
      "--disable-extensions", "--disable-renderer-backgrounding", "--disable-sync", "--metrics-recording-only",
      "--no-default-browser-check", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--window-size=900,700", "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profile, chrome);
    client = await connectToPage(devToolsPort, 30_000);
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable"), client.send("Network.enable")]);
    phase = "journey-ready";
    try { await client.send("Page.navigate", { url: `${baseUrl}/tests/browser/regionToAssetHarness.html` }); } catch { /* readiness is authoritative */ }
    await client.waitFor("globalThis.__spriteBoyS105 instanceof Promise", 60_000);
    journeyReady = true;
    phase = "journey-result";
    const evaluated = await client.evaluate(`(async () => {
      try { return { ok: true, value: await globalThis.__spriteBoyS105 }; }
      catch { return { ok: false }; }
    })()`);
    value = evaluated?.value;
    if (!evaluated?.ok || !value || typeof value.outputBase64 !== "string") throw new Error("S1-05 browser journey failed.");
    phase = "evidence";
    const runtime = {
      consoleErrorCount: client.consoleErrorCount, exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount, networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    };
    if (value.outputWidth !== 4 || value.outputHeight !== 3 || value.bounds !== "1,1,4,3"
      || value.transparentPixelCount !== 1 || value.partialAlphaPixelCount !== 1
      || !Array.isArray(value.pixels) || value.pixels.length !== 48
      || Object.values(runtime).some((count) => count !== 0)) throw new Error("S1-05 browser evidence failed closed.");
    phase = "capture";
    const golden = Buffer.from(value.outputBase64, "base64");
    const screenshotResult = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const screenshot = Buffer.from(screenshotResult.data, "base64");
    phase = "artifact-write";
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, golden);
    writeFileSync(visualPath, screenshot);
    return Object.freeze({
      status: "pass", outputWidth: value.outputWidth, outputHeight: value.outputHeight,
      bounds: value.bounds, transparentPixelCount: value.transparentPixelCount,
      partialAlphaPixelCount: value.partialAlphaPixelCount,
      pixelSha256: createHash("sha256").update(Buffer.from(value.pixels)).digest("hex"),
      goldenPath: GOLDEN_PATH, goldenBytes: golden.byteLength,
      goldenSha256: createHash("sha256").update(golden).digest("hex"),
      visualPath: VISUAL_PATH, visualBytes: screenshot.byteLength,
      visualSha256: createHash("sha256").update(screenshot).digest("hex"),
      ...runtime,
    });
  } catch {
    const observed = {
      journeyReady,
      outputWidth: Number.isSafeInteger(value?.outputWidth) ? value.outputWidth : null,
      outputHeight: Number.isSafeInteger(value?.outputHeight) ? value.outputHeight : null,
      transparentPixelCount: Number.isSafeInteger(value?.transparentPixelCount) ? value.transparentPixelCount : null,
      partialAlphaPixelCount: Number.isSafeInteger(value?.partialAlphaPixelCount) ? value.partialAlphaPixelCount : null,
      consoleErrorCount: Number.isSafeInteger(client?.consoleErrorCount) ? client.consoleErrorCount : null,
      exceptionCount: Number.isSafeInteger(client?.exceptionCount) ? client.exceptionCount : null,
      logErrorCount: Number.isSafeInteger(client?.logErrorCount) ? client.logErrorCount : null,
      networkFailureCount: Number.isSafeInteger(client?.networkFailureCount) ? client.networkFailureCount : null,
      httpErrorCount: Number.isSafeInteger(client?.httpErrorCount) ? client.httpErrorCount : null,
    };
    throw new RegionToAssetBrowserGateError(`failed-${phase}`, phase, observed);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "S1-05 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await runRegionToAssetBrowserGate())}\n`); }
  catch (error) {
    const failure = error instanceof RegionToAssetBrowserGateError
      ? { reason: error.reason, phase: error.phase, observed: error.observed }
      : { reason: "failed-cleanup-or-bootstrap", phase: "unknown", observed: null };
    process.stderr.write(`${JSON.stringify({ status: "fail", check: "s1-05-region-to-asset-browser", ...failure })}\n`);
    process.exitCode = 1;
  }
}
