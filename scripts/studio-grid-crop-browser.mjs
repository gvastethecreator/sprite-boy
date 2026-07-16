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
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
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
  return client.evaluate(`(() => {
    const inspector = document.querySelector('[data-slice-grid-inspector]');
    const threshold = inspector?.querySelector('input[aria-describedby$="-crop-summary"][max="100"]');
    const sliders = inspector?.querySelectorAll('input[type="range"]');
    const padding = sliders?.[1];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!(threshold instanceof HTMLInputElement) || !(padding instanceof HTMLInputElement) || !setter) return false;
    for (const value of [10, 20, ${JSON.stringify(threshold)}]) {
      setter.call(threshold, String(value));
      threshold.dispatchEvent(new Event('input', { bubbles: true }));
    }
    threshold.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    for (const value of [1, 2, ${JSON.stringify(padding)}]) {
      setter.call(padding, String(value));
      padding.dispatchEvent(new Event('input', { bubbles: true }));
    }
    padding.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return true;
  })()`);
}

async function exportProject(client) {
  await client.evaluate(`(() => {
    globalThis.__g303.savedProject = null;
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
    }));
  })()`);
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
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      return inspector?.getAttribute('data-grid-crop-threshold') === '35'
        && inspector?.getAttribute('data-grid-crop-padding') === '4';
    })()`);
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
    const exportedCrop = await exportProject(client);
    await client.waitFor(`document.querySelector('[data-command-id="edit.undo"]')?.disabled === false`);
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      return inspector?.getAttribute('data-grid-crop-threshold') === '35'
        && inspector?.getAttribute('data-grid-crop-padding') === '0';
    })()`);
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-enabled') === 'false'`);
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-threshold') === '35'`);
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-padding') === '4'`);
    const dragCoalesced = true;
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const desktop = await capture(client, desktopPath);

    stage = "reset-undo-redo";
    await client.evaluate(`(() => {
      const inspector = document.querySelector('[data-slice-grid-inspector]');
      const reset = [...(inspector?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === 'Reset');
      reset?.click();
    })()`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-enabled') === 'false'`);
    const resetCrop = await exportProject(client);
    await client.waitFor(`document.querySelector('[data-command-id="edit.undo"]')?.disabled === false`);
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-padding') === '4'`);
    const undoRestored = await client.evaluate(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-threshold') === '35'`);
    await client.waitFor(`document.querySelector('[data-command-id="edit.redo"]')?.disabled === false`);
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-enabled') === 'false'`);
    const redoReset = true;
    await setCrop(client, 35, 4);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector]')?.getAttribute('data-grid-crop-padding') === '4'`);
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
      || !initial.summary?.includes("original bounds") || !initial.resetDisabled
      || configured.threshold !== "35" || configured.padding !== "4" || configured.enabled !== "true"
      || !configured.summary?.includes("8 cells use 35% alpha threshold and 4px padding")
      || configured.sliderNames.length !== 2 || !configured.described || configured.resetDisabled
      || configured.horizontalOverflow || configured.verticalOverflow
      || exportedCrop?.threshold !== 35 || exportedCrop?.padding !== 4
      || !dragCoalesced
      || resetCrop?.threshold !== 0 || resetCrop?.padding !== 0
      || !undoRestored || !redoReset
      || accessibility.unlabeledInteractiveCount !== 0 || accessibility.mainLandmarkCount !== 1
      || !compact.dialog || compact.sliders !== 2 || compact.threshold !== "35" || compact.padding !== "4"
      || compact.horizontalOverflow || compact.verticalOverflow
      || Object.values(runtime).some((count) => count !== 0)
    ) throw new Error(`G3-03 browser evidence failed closed: ${JSON.stringify({
      initial, configured, exportedCrop, dragCoalesced, resetCrop, undoRestored, redoReset,
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
      dragCoalesced,
      resetCrop,
      undoRestored,
      redoReset,
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
