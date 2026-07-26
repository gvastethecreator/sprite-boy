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
  summarizeAccessibilityTree,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";

const DESKTOP_SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g3-03-crop-controls.png";
const COMPACT_SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g3-03-crop-controls-compact.png";

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(result.data, "base64");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function selectSource(client) {
  return client.evaluate(`(async () => {
    const input = document.querySelector('input[type="file"][accept*="image/png"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const colors = ['#f43f5e', '#22c55e', '#38bdf8', '#f59e0b'];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        context.fillStyle = colors[(row + column) % colors.length];
        context.fillRect(10 + column * 100, 10 + row * 100, 80, 80);
      }
    }
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'g3-03-crop.png', { type: 'image/png' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function setCrop(client, threshold, padding) {
  const drag = async (name, value) => {
    const points = await client.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(`input[aria-label="${name}"]`)});
      const track = input?.closest('[data-toolcraft-slider]')?.querySelector('[data-slot="slider-track"]');
      if (!(input instanceof HTMLInputElement) || !(track instanceof HTMLElement)) return null;
      const rect = track.getBoundingClientRect();
      const min = Number(input.min);
      const max = Number(input.max);
      const current = Number(input.value);
      const x = (raw) => rect.left + ((raw - min) / (max - min)) * rect.width;
      return { start: { x: x(current), y: rect.top + rect.height / 2 }, end: { x: x(${JSON.stringify(value)}), y: rect.top + rect.height / 2 } };
    })()`);
    if (!points) return false;
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.start.x, y: points.start.y, button: "none" });
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: points.start.x, y: points.start.y, button: "left", buttons: 1, clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.end.x, y: points.end.y, button: "left", buttons: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: points.end.x, y: points.end.y, button: "left", buttons: 0, clickCount: 1 });
    await client.waitFor(`document.querySelector(${JSON.stringify(`input[aria-label="${name}"]`)})?.value === ${JSON.stringify(String(value))}`);
    return true;
  };
  if (!await drag("Alpha threshold", threshold)) return false;
  if (!await drag("Padding", padding)) return false;
  return true;
}

async function exportProject(client) {
  await client.evaluate(`globalThis.__g303.savedProject = null`);
  await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
  await client.waitFor(`Boolean(document.querySelector('[data-command-id="project.save"]:not(:disabled)'))`);
  await client.evaluate(`document.querySelector('[data-command-id="project.save"]')?.click()`);
  await client.waitFor(`typeof globalThis.__g303.savedProject === 'string'`);
  return client.evaluate(`(() => {
    const project = JSON.parse(globalThis.__g303.savedProject).project;
    return project.sliceGrid?.recipe?.crop ?? null;
  })()`);
}

export async function runGridCropBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const desktopPath = resolve(cwd, options.desktopScreenshot ?? DESKTOP_SCREENSHOT);
  const compactPath = resolve(cwd, options.compactScreenshot ?? COMPACT_SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g303-browser-"));
  let vite;
  let chrome;
  let client;
  let stage = "launch";
  try {
    vite = spawnViteServer(cwd, port, "preview");
    await waitForPreview(baseUrl, vite);
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
      "--window-size=1440,900",
      "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profile, chrome);
    client = await connectToPage(devToolsPort, 30_000);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("Accessibility.enable"),
    ]);
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
        const nativeClick = HTMLAnchorElement.prototype.click;
        const blobs = new Map();
        globalThis.__g303 = { savedProject: null };
        URL.createObjectURL = (blob) => {
          const url = nativeCreateObjectURL(blob);
          blobs.set(url, blob);
          return url;
        };
        HTMLAnchorElement.prototype.click = function click() {
          if (typeof this.download === 'string' && this.download.endsWith('.json') && blobs.has(this.href)) {
            blobs.get(this.href).text().then((text) => { globalThis.__g303.savedProject = text; });
            return;
          }
          return nativeClick.call(this);
        };
      })();`,
    });

    stage = "navigate";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('[data-slice-source-dropzone]'))`, 60_000);
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    stage = "source-ready";
    await client.waitFor(`document.querySelector('[data-slice-grid-overlay-canvas]')?.dataset.gridOverlayCells === '8'`, 60_000);

    const initial = await client.evaluate(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      const reset = [...(inspector?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === 'Reset');
      return {
        threshold: inspector?.getAttribute('data-grid-crop-threshold'),
        padding: inspector?.getAttribute('data-grid-crop-padding'),
        enabled: inspector?.getAttribute('data-grid-crop-enabled'),
        summary: inspector?.querySelector('[aria-label="Crop preview summary"]')?.textContent?.trim(),
        resetDisabled: reset?.disabled === true,
      };
    })()`);

    stage = "configure";
    if (await setCrop(client, 35, 4) !== true) throw new Error("Crop sliders are unavailable.");
    await client.waitFor(`(() => {
      const summary = document.querySelector('[aria-label="Crop preview summary"]')?.textContent ?? '';
      return summary.includes('35% alpha threshold') && summary.includes('4px pad');
    })()`);
    const configuredAttributes = await client.evaluate(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      return {
        count: document.querySelectorAll('[data-slice-grid-inspector]').length,
        threshold: inspector?.getAttribute('data-grid-crop-threshold'),
        padding: inspector?.getAttribute('data-grid-crop-padding'),
      };
    })()`);
    if (Number(configuredAttributes?.threshold) !== 35 || Number(configuredAttributes?.padding) !== 4) {
      throw new Error(`Crop data attributes did not sync: ${JSON.stringify(configuredAttributes)}`);
    }
    const configured = await client.evaluate(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      const sliders = [...(inspector?.querySelectorAll('input[type="range"]') ?? [])];
      const reset = [...(inspector?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === 'Reset');
      return {
        threshold: inspector?.getAttribute('data-grid-crop-threshold'),
        padding: inspector?.getAttribute('data-grid-crop-padding'),
        enabled: inspector?.getAttribute('data-grid-crop-enabled'),
        summary: inspector?.querySelector('[aria-label="Crop preview summary"]')?.textContent?.trim(),
        sliderNames: sliders.map((slider) => slider.labels?.[0]?.textContent?.trim()),
        described: sliders.every((slider) => Boolean(slider.getAttribute('aria-describedby'))),
        resetDisabled: reset?.disabled === true,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      };
    })()`);
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const desktop = await capture(client, desktopPath);

    stage = "reset";
    await client.evaluate(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      const reset = [...(inspector?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === 'Reset');
      reset?.click();
    })()`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-enabled') === 'false'`);
    const resetCrop = await client.evaluate(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      return {
        threshold: Number(inspector?.getAttribute('data-grid-crop-threshold')),
        padding: Number(inspector?.getAttribute('data-grid-crop-padding')),
      };
    })()`);
    await setCrop(client, 35, 4);
    await client.waitFor(`Number(document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-padding')) === 4`);
    stage = "export-configured";
    const exportedCrop = await exportProject(client);
    if (exportedCrop?.threshold !== 35 || exportedCrop?.padding !== 4) {
      throw new Error(`Saved crop recipe did not sync: ${JSON.stringify(exportedCrop)}`);
    }
    await client.evaluate(`document.querySelectorAll('button[aria-label^="Dismiss notification:"]')
      .forEach((button) => button.click())`);

    stage = "compact";
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.waitFor(`Boolean(document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]'))`);
    await client.evaluate(`(() => {
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]');
      [...(toolbar?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.includes('Properties'))?.click();
    })()`);
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"] [data-slice-grid-inspector]'))`);
    const compact = await client.evaluate(`(() => ({
      dialog: Boolean(document.querySelector('[role="dialog"]')),
      sliders: document.querySelectorAll('[role="dialog"] input[type="range"]').length,
      threshold: document.querySelector('[role="dialog"] [data-slice-grid-inspector]')?.getAttribute('data-grid-crop-threshold'),
      padding: document.querySelector('[role="dialog"] [data-slice-grid-inspector]')?.getAttribute('data-grid-crop-padding'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }))()`);
    const compactCapture = await capture(client, compactPath);
    const runtime = {
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    };

    if (
      initial.threshold !== "0" || initial.padding !== "0" || initial.enabled !== "false"
      || !initial.summary?.includes("Auto crop is off") || !initial.resetDisabled
      || configured.threshold !== "35" || configured.padding !== "4" || configured.enabled !== "true"
      || !configured.summary?.includes("8 cells use 35% alpha threshold") || !configured.summary?.includes("4px pad")
      || configured.sliderNames.length !== 2 || !configured.described || configured.resetDisabled
      || configured.horizontalOverflow
      || exportedCrop?.threshold !== 35 || exportedCrop?.padding !== 4
      || resetCrop?.threshold !== 0 || resetCrop?.padding !== 0
      || accessibility.unlabeledInteractiveCount !== 0 || accessibility.mainLandmarkCount !== 1
      || !compact.dialog || compact.sliders !== 2 || compact.threshold !== "35" || compact.padding !== "4"
      || compact.horizontalOverflow || compact.verticalOverflow
      || Object.values(runtime).some((count) => count !== 0)
    ) throw new Error(`G3-03 browser evidence failed closed: ${JSON.stringify({
      initial, configured, exportedCrop, resetCrop,
      accessibility, compact, runtime,
    })}`);

    stage = "accepted";
    return Object.freeze({
      status: "pass",
      url: `${baseUrl}/#/studio/slice`,
      viewports: ["1440x900", "900x700"],
      initial,
      configured,
      exportedCrop,
      resetCrop,
      accessibility,
      compact,
      desktopScreenshot: { path: DESKTOP_SCREENSHOT, ...desktop },
      compactScreenshot: { path: COMPACT_SCREENSHOT, ...compactCapture },
      ...runtime,
    });
  } catch (error) {
    let diagnostic = null;
    try {
      diagnostic = client ? await client.evaluate(`(() => ({
        url: location.href,
        readyState: document.readyState,
        title: document.title,
        body: document.body?.innerText?.slice(0, 800) ?? null,
      }))()`) : null;
    } catch {
      diagnostic = null;
    }
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}${
      diagnostic ? ` | ${JSON.stringify(diagnostic)}` : ""
    }`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "G3-03 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridCropBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "fail",
      check: "g3-03-grid-crop-browser",
      message: error instanceof Error ? error.message : "unknown",
    })}\n`);
    process.exitCode = 1;
  }
}
