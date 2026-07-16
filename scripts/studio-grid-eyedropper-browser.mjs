/** G4-02 production-Chrome journey: canonical eyedropper through zoom, pan and DPR. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

const SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g4-02-eyedropper-dpr.png";
const CHROMA_SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g4-03-chroma-controls.png";

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
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    if (!context) return false;
    const colors = ["#f43f5e", "#22c55e", "#38bdf8", "#f59e0b"];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        context.fillStyle = colors[(row + column) % colors.length];
        context.fillRect(10 + column * 100, 10 + row * 100, 80, 80);
      }
    }
    context.fillStyle = "#123456";
    context.fillRect(40, 40, 40, 40);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "g4-02-eyedropper.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function dispatchCanvasPointer(client, type, point, extra = {}) {
  return client.evaluate(`(() => {
    const canvas = document.querySelector("[data-studio-source-canvas]");
    const target = canvas?.parentElement;
    if (!target) return false;
    const event = new MouseEvent(${JSON.stringify(type)}, {
      button: ${Number(extra.button ?? 0)},
      buttons: ${Number(extra.buttons ?? 0)},
      clientX: ${Number(point.x)},
      clientY: ${Number(point.y)},
      bubbles: true,
      cancelable: true,
    });
    ${extra.movementX === undefined ? "" : `Object.defineProperty(event, "movementX", { value: ${Number(extra.movementX)} });`}
    ${extra.movementY === undefined ? "" : `Object.defineProperty(event, "movementY", { value: ${Number(extra.movementY)} });`}
    target.dispatchEvent(event);
    return true;
  })()`);
}

async function configureChroma(client) {
  return client.evaluate(`(() => {
    const root = document.querySelector("[data-slice-chroma-controls]");
    const checkbox = root?.querySelector('input[type="checkbox"]');
    const color = root?.querySelector('input[aria-label="Chroma key hex color"]');
    const swatch = root?.querySelector('input[type="color"]');
    const ranges = root?.querySelectorAll('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!(checkbox instanceof HTMLInputElement) || !(color instanceof HTMLInputElement) ||
      !(swatch instanceof HTMLInputElement) || ranges?.length !== 3 || !setter) return false;
    checkbox.click();
    setter.call(swatch, "#ff00aa");
    swatch.dispatchEvent(new Event("input", { bubbles: true }));
    swatch.dispatchEvent(new Event("change", { bubbles: true }));
    [35, 20, 15].forEach((value, index) => {
      const input = ranges[index];
      setter.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    return true;
  })()`);
}

export async function runGridEyedropperBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT);
  const chromaScreenshotPath = resolve(cwd, options.chromaScreenshotPath ?? CHROMA_SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g402-browser-"));
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
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 2,
        mobile: false,
      }),
    ]);

    stage = "navigate";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`, 60_000);
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    stage = "source-ready";
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "8"`, 60_000);
    await client.waitFor(`Boolean(document.querySelector('button[aria-label="Pick color from canvas"]'))`);

    const initial = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const picker = document.querySelector('button[aria-label="Pick color from canvas"]');
      const color = document.querySelector('input[aria-label="Background removal target color"]');
      const rect = canvas?.getBoundingClientRect();
      const overlay = document.querySelector("[data-slice-grid-overlay-canvas]");
      return {
        dpr: window.devicePixelRatio,
        canvasRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        scale: overlay?.dataset.gridOverlayScale,
        offset: overlay?.dataset.gridOverlayOffset,
        pickerLabel: picker?.getAttribute("aria-label"),
        pickerPressed: picker?.getAttribute("aria-pressed"),
        color: color?.getAttribute("value") ?? color?.value,
        chromaColor: document.querySelector("[data-slice-chroma-controls]")?.getAttribute("data-chroma-color"),
      };
    })()`);

    stage = "chroma-controls";
    if (await configureChroma(client) !== true) throw new Error("Canonical chroma controls are unavailable.");
    await client.waitFor(`(() => {
      const root = document.querySelector("[data-slice-chroma-controls]");
      return root?.dataset.chromaEnabled === "true" && root?.dataset.chromaColor === "#ff00aa"
        && root?.dataset.chromaTolerance === "35" && root?.dataset.chromaSmoothness === "20"
        && root?.dataset.chromaSpill === "15";
    })()`);
    const configuredChroma = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-chroma-controls]");
      return {
        enabled: root?.dataset.chromaEnabled,
        color: root?.dataset.chromaColor,
        tolerance: root?.dataset.chromaTolerance,
        smoothness: root?.dataset.chromaSmoothness,
        spill: root?.dataset.chromaSpill,
        summary: root?.querySelector('[aria-label="Chroma preview summary"]')?.textContent?.trim(),
        controls: root?.querySelectorAll("input,button").length,
      };
    })()`);
    const chromaScreenshot = await capture(client, chromaScreenshotPath);
    await client.evaluate(`document.querySelector('button[aria-label="Reset chroma settings"]')?.click()`);
    await client.waitFor(`(() => {
      const root = document.querySelector("[data-slice-chroma-controls]");
      return root?.dataset.chromaEnabled === "false" && root?.dataset.chromaColor === "#00ff00"
        && root?.dataset.chromaTolerance === "0" && root?.dataset.chromaSmoothness === "0"
        && root?.dataset.chromaSpill === "0";
    })()`);
    const resetChroma = await client.evaluate(`(() => ({
      enabled: document.querySelector("[data-slice-chroma-controls]")?.dataset.chromaEnabled,
      color: document.querySelector("[data-slice-chroma-controls]")?.dataset.chromaColor,
    }))()`);

    stage = "transform";
    const initialScale = initial.scale;
    await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const target = canvas?.parentElement;
      const bounds = target?.getBoundingClientRect();
      if (!target || !bounds) return false;
      target.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240,
        ctrlKey: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        bubbles: true,
        cancelable: true,
      }));
      return true;
    })()`);
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayScale !== ${JSON.stringify(initialScale)}`);
    const zoom = await client.evaluate(`(() => ({
      scale: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayScale,
      offset: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayOffset,
    }))()`);
    const canvasBounds = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const rect = canvas?.getBoundingClientRect();
      const overlay = document.querySelector("[data-slice-grid-overlay-canvas]");
      if (!rect || !overlay) return null;
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        scale: Number(overlay.dataset.gridOverlayScale),
        offset: (overlay.dataset.gridOverlayOffset ?? "0,0").split(",").map(Number),
      };
    })()`);
    if (!canvasBounds) throw new Error("Canvas transform metadata unavailable.");
    const sourcePoint = { x: 60, y: 60 };
    const centerPoint = {
      x: canvasBounds.rect.left + canvasBounds.rect.width / 2,
      y: canvasBounds.rect.top + canvasBounds.rect.height / 2,
    };
    await dispatchCanvasPointer(client, "mousedown", centerPoint, { button: 1, buttons: 4 });
    await dispatchCanvasPointer(client, "mousemove", {
      x: centerPoint.x + 32,
      y: centerPoint.y + 18,
    }, { button: 1, buttons: 4, movementX: 32, movementY: 18 });
    await dispatchCanvasPointer(client, "mouseup", centerPoint, { button: 1 });
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayOffset !== ${JSON.stringify(zoom.offset)}`);
    const pan = await client.evaluate(`(() => ({
      scale: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayScale,
      offset: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayOffset,
    }))()`);
    const finalCanvasBounds = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const rect = canvas?.getBoundingClientRect();
      const overlay = document.querySelector("[data-slice-grid-overlay-canvas]");
      if (!rect || !overlay) return null;
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        scale: Number(overlay.dataset.gridOverlayScale),
        offset: (overlay.dataset.gridOverlayOffset ?? "0,0").split(",").map(Number),
      };
    })()`);
    if (!finalCanvasBounds) throw new Error("Panned canvas metadata unavailable.");
    const [finalOffsetX, finalOffsetY] = finalCanvasBounds.offset;
    const samplePoint = {
      x: finalCanvasBounds.rect.left + finalOffsetX + (sourcePoint.x + 0.5) * finalCanvasBounds.scale,
      y: finalCanvasBounds.rect.top + finalOffsetY + (sourcePoint.y + 0.5) * finalCanvasBounds.scale,
    };

    stage = "escape";
    await client.evaluate(`document.querySelector('button[aria-label="Pick color from canvas"]')?.click()`);
    await client.waitFor(`document.querySelector('button[aria-label="Cancel canvas color picker"]')?.getAttribute("aria-pressed") === "true"`);
    await client.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);
    await client.waitFor(`Boolean(document.querySelector('button[aria-label="Pick color from canvas"]'))`);
    const escaped = await client.evaluate(`(() => ({
      active: Boolean(document.querySelector('[data-eyedropper-status="active"]')),
      label: document.querySelector('button[aria-label="Pick color from canvas"]')?.getAttribute("aria-label"),
    }))()`);

    stage = "sample";
    await client.evaluate(`document.querySelector('button[aria-label="Pick color from canvas"]')?.click()`);
    await client.waitFor(`document.querySelector('button[aria-label="Cancel canvas color picker"]')?.getAttribute("aria-pressed") === "true"`);
    await dispatchCanvasPointer(client, "mousedown", samplePoint);
    await client.waitFor(`document.querySelector('input[aria-label="Background removal target color"]')?.value === "#123456"`);
    const sampled = await client.evaluate(`(() => ({
      color: document.querySelector('input[aria-label="Background removal target color"]')?.value,
      chromaColor: document.querySelector("[data-slice-chroma-controls]")?.getAttribute("data-chroma-color"),
      active: Boolean(document.querySelector('[data-eyedropper-status="active"]')),
      pickerLabel: document.querySelector('button[aria-label^="Pick color from canvas"], button[aria-label="Cancel canvas color picker"]')?.getAttribute("aria-label"),
      sampledClient: ${JSON.stringify(samplePoint)},
      sourcePoint: ${JSON.stringify(sourcePoint)},
    }))()`);

    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const screenshot = await capture(client, screenshotPath);
    const errors = {
      console: client.consoleErrorCount,
      exception: client.exceptionCount,
      log: client.logErrorCount,
      network: client.networkFailureCount,
      http: client.httpErrorCount,
    };
    const layout = await client.evaluate(`(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }))()`);
    const passed = initial.dpr === 2 && initial.pickerLabel === "Pick color from canvas"
      && initial.pickerPressed === "false" && zoom.scale !== initialScale
      && pan.offset !== zoom.offset && escaped.active === false
      && escaped.label === "Pick color from canvas" && sampled.color === "#123456"
      && sampled.chromaColor === "#123456"
      && configuredChroma.enabled === "true" && configuredChroma.color === "#ff00aa"
      && configuredChroma.tolerance === "35" && configuredChroma.smoothness === "20"
      && configuredChroma.spill === "15" && configuredChroma.summary?.includes("Chroma key on")
      && resetChroma.enabled === "false" && resetChroma.color === "#00ff00"
      && sampled.active === false && accessibility.unlabeledInteractiveCount === 0
      && layout.horizontalOverflow === false && layout.verticalOverflow === false
      && Object.values(errors).every((value) => value === 0);
    if (!passed) throw new Error(`G4-02 browser evidence failed closed: ${JSON.stringify({ initial, zoom, pan, escaped, sampled, accessibility, layout, errors })}`);
    stage = "accepted";
    return {
      schemaVersion: 1,
      check: "grid-eyedropper-dpr-browser",
      status: "pass",
      initial,
      zoom,
      pan,
      escaped,
      configuredChroma,
      resetChroma,
      sampled,
      accessibility,
      layout,
      screenshot: { path: screenshotPath, ...screenshot },
      chromaScreenshot: { path: chromaScreenshotPath, ...chromaScreenshot },
      errors,
    };
  } catch (error) {
    let diagnostic = null;
    try {
      diagnostic = client ? await client.evaluate(`(() => ({
        url: location.href,
        readyState: document.readyState,
        chroma: (() => {
          const root = document.querySelector("[data-slice-chroma-controls]");
          return root ? {
            enabled: root.getAttribute("data-chroma-enabled"),
            color: root.getAttribute("data-chroma-color"),
            tolerance: root.getAttribute("data-chroma-tolerance"),
            smoothness: root.getAttribute("data-chroma-smoothness"),
            spill: root.getAttribute("data-chroma-spill"),
          } : null;
        })(),
        body: document.body?.innerText?.slice(0, 800) ?? null,
      }))()`) : null;
    } catch {
      diagnostic = null;
    }
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}${diagnostic ? ` | ${JSON.stringify(diagnostic)}` : ""}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "G4-02 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridEyedropperBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "grid-eyedropper-dpr-browser",
      status: "fail",
      message: error instanceof Error ? error.message : "unknown",
    })}\n`);
    process.exitCode = 1;
  }
}
