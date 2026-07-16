/** G2-04 real-Chrome proof for DPR/zoom/pan/resize-safe Slice grid overlay geometry. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  allocatePort,
  cleanupBrowserRuntime,
  connectToPage,
  resolveChromeExecutable,
  runWithBrowserRuntimeDeadline,
  spawnViteServer,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";

const HOST = "127.0.0.1";
const HARNESS_PATH = "/tests/browser/gridOverlayHarness.html";
const DEADLINE_MS = 60_000;

function screenshot(client, outputPath) {
  return client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  }).then(({ data }) => {
    const path = resolve(outputPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(data, "base64"));
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  });
}

function diagnostics(client) {
  return {
    console: client.consoleErrorCount,
    exception: client.exceptionCount,
    log: client.logErrorCount,
    network: client.networkFailureCount,
    http: client.httpErrorCount,
  };
}

export async function runGridOverlayBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-grid-overlay-chrome-"));
  let server;
  let chrome;
  let client;

  return runWithBrowserRuntimeDeadline(async () => {
    server = spawnViteServer(cwd, port);
    await waitForPreview(`${baseUrl}${HARNESS_PATH}`, server);
    chrome = spawn(chromePath, [
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
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profileDirectory, chrome);
    client = await connectToPage(devToolsPort, 30_000);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 900,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    await client.send("Page.navigate", { url: `${baseUrl}${HARNESS_PATH}` });
    await client.waitFor("document.readyState === 'complete'");
    await client.waitForNetworkIdle();
    const bootstrap = await client.evaluate(`(() => ({
      ready: globalThis.__gridOverlayHarness?.ready === true,
      viteError: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(0, 500) ?? '',
    }))()`);
    if (!bootstrap.ready) throw new Error(bootstrap.viteError || "G2-04 browser harness did not initialize.");
    await client.waitFor("document.readyState === 'complete' && globalThis.__gridOverlayHarness?.ready === true");
    await client.evaluate("new Promise((resolve) => setTimeout(resolve, 250))");
    const initial = await client.evaluate("globalThis.__gridOverlayHarness.snapshot()");
    if (initial.backing !== "640x360") {
      throw new Error(`G2-04 initial overlay backing was ${initial.backing || "empty"}.`);
    }

    await client.evaluate(`globalThis.__gridOverlayHarness.setTransform({
      scale: 27.5,
      offset: { x: -18.25, y: 96.75 },
    })`);
    await client.waitFor("globalThis.__gridOverlayHarness.snapshot().scale === 27.5 && globalThis.__gridOverlayHarness.snapshot().offset === '-18.25,96.75'");
    const transformed = await client.evaluate("globalThis.__gridOverlayHarness.snapshot()");

    await client.evaluate("globalThis.__gridOverlayHarness.setStageSize(420, 260)");
    await client.waitFor("globalThis.__gridOverlayHarness.snapshot().backing === '420x260'");
    const resized = await client.evaluate("globalThis.__gridOverlayHarness.snapshot()");

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await client.evaluate("dispatchEvent(new Event('resize'))");
    await client.waitFor("globalThis.__gridOverlayHarness.snapshot().dpr === 2 && globalThis.__gridOverlayHarness.snapshot().backing === '840x520'");
    const dpr2 = await client.evaluate("globalThis.__gridOverlayHarness.snapshot()");

    await client.evaluate(`(() => {
      const stage = document.querySelector('[data-grid-overlay-stage]');
      const bounds = stage.getBoundingClientRect();
      document.elementFromPoint(bounds.right - 8, bounds.bottom - 8)?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: bounds.right - 8,
        clientY: bounds.bottom - 8,
      }));
    })()`);
    const pointerTarget = await client.evaluate("globalThis.__gridOverlayHarness.snapshot().pointerTarget");
    const drawCountBeforeIdle = await client.evaluate("globalThis.__gridOverlayHarness.snapshot().drawCount");
    await client.evaluate("new Promise((resolve) => setTimeout(resolve, 300))");
    const drawCountAfterIdle = await client.evaluate("globalThis.__gridOverlayHarness.snapshot().drawCount");
    const screenshotSha256 = await screenshot(client, options.screenshotPath);
    const errors = diagnostics(client);
    const cleanupBacking = await client.evaluate("globalThis.__gridOverlayHarness.unmount()");

    const passed = initial.dpr === 1 && initial.backing === "640x360" && initial.cells === 6 &&
      initial.sampledAlpha > 0 && transformed.scale === 27.5 &&
      transformed.offset === "-18.25,96.75" && transformed.sampledAlpha > 0 &&
      resized.stageWidth === 420 && resized.stageHeight === 260 && resized.backing === "420x260" &&
      dpr2.dpr === 2 && dpr2.backing === "840x520" && dpr2.sampledAlpha > 0 &&
      pointerTarget === "stage" && drawCountBeforeIdle === drawCountAfterIdle &&
      cleanupBacking[0] === 0 && cleanupBacking[1] === 0 &&
      Object.values(errors).every((value) => value === 0) && /^[0-9a-f]{64}$/u.test(screenshotSha256);
    return {
      schemaVersion: 1,
      check: "slice-grid-overlay-browser",
      status: passed ? "pass" : "fail",
      metrics: {
        source: "7x5",
        layout: "2x3",
        initial,
        transformed,
        resized,
        dpr2,
        pointerTarget,
        idleDrawDelta: drawCountAfterIdle - drawCountBeforeIdle,
        cleanupBacking,
        screenshotSha256,
        errors,
      },
    };
  }, () => cleanupBrowserRuntime(
    client,
    chrome,
    server,
    profileDirectory,
    "Grid overlay browser runtime cleanup failed.",
  ), DEADLINE_MS);
}

export async function runGridOverlayBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runGridOverlayBrowser({
      screenshotPath: process.env.STUDIO_GRID_OVERLAY_SCREENSHOT ??
        "artifacts/quality/GRID/2026-07-16/g2-04-grid-overlay.png",
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "slice-grid-overlay-browser",
      status: "fail",
      reason: "grid-overlay-browser-unavailable",
    })}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) process.exitCode = await runGridOverlayBrowserCli();
