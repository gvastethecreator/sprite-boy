/** G5-03 production-Chrome journey for canonical pixel/palette controls. */
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

const SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g5-03-pixel-controls.png";

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(result.data, "base64");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
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
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "g5-03-pixel-controls.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

export async function runGridPixelBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g503-browser-"));
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
      client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }),
    ]);

    stage = "navigate";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`, 60_000);
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    stage = "source-ready";
    await client.waitFor(`Boolean(document.querySelector("[data-slice-pixel-controls]"))`, 60_000);

    const initial = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-pixel-controls]");
      return {
        enabled: root?.dataset.pixelEnabled,
        size: root?.dataset.pixelSize,
        colors: root?.dataset.pixelColors,
        mode: root?.dataset.pixelMode,
        summary: root?.querySelector('[aria-label="Pixel processing summary"]')?.textContent?.trim(),
      };
    })()`);

    stage = "configure";
    const configured = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-pixel-controls]");
      const enabled = root?.querySelector('input[aria-label="Enable pixel stage"]');
      const size = root?.querySelector('select[aria-label="Pixel target size"]');
      const fixed = root?.querySelector('input[type="radio"][value="fixed"]');
      let preset = root?.querySelector('select[aria-label="Fixed palette preset"]');
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (!(enabled instanceof HTMLInputElement) || !(size instanceof HTMLSelectElement) ||
        !(fixed instanceof HTMLInputElement) || !selectSetter) {
        return {
          enabled: enabled?.constructor?.name,
          size: size?.constructor?.name,
          fixed: fixed?.constructor?.name,
          preset: preset?.constructor?.name,
          selectSetter: Boolean(selectSetter),
        };
      }
      enabled.click();
      selectSetter.call(size, "64");
      size.dispatchEvent(new Event("change", { bubbles: true }));
      fixed.click();
      preset = root?.querySelector('select[aria-label="Fixed palette preset"]');
      if (!(preset instanceof HTMLSelectElement)) return { preset: preset?.constructor?.name ?? null };
      selectSetter.call(preset, "pico-8");
      preset.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    if (configured !== true) throw new Error(`Pixel controls could not be configured: ${JSON.stringify(configured)}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const configuredState = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-pixel-controls]");
      return {
        enabled: root?.dataset.pixelEnabled,
        size: root?.dataset.pixelSize,
        mode: root?.dataset.pixelMode,
        summary: root?.querySelector('[aria-label="Pixel processing summary"]')?.textContent?.trim(),
      };
    })()`);
    if (configuredState.enabled !== "true" || configuredState.size !== "64" || configuredState.mode !== "fixed" || !configuredState.summary?.includes("PICO-8")) {
      throw new Error(`Pixel configuration did not settle: ${JSON.stringify(configuredState)}`);
    }
    const configuredPixel = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-pixel-controls]");
      return {
        enabled: root?.dataset.pixelEnabled,
        size: root?.dataset.pixelSize,
        colors: root?.dataset.pixelColors,
        mode: root?.dataset.pixelMode,
        preset: root?.querySelector('select[aria-label="Fixed palette preset"]')?.value,
        swatches: root?.querySelectorAll('[aria-label="Active palette colors"] > span').length,
        summary: root?.querySelector('[aria-label="Pixel processing summary"]')?.textContent?.trim(),
      };
    })()`);
    await client.evaluate(`document.querySelector("[data-slice-pixel-controls]")?.scrollIntoView({ block: "center", inline: "nearest" })`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    const screenshot = await capture(client, screenshotPath);

    stage = "reset";
    await client.evaluate(`document.querySelector('button[aria-label="Reset pixel settings"]')?.click()`);
    await client.waitFor(`(() => {
      const root = document.querySelector("[data-slice-pixel-controls]");
      return root?.dataset.pixelEnabled === "false" && root?.dataset.pixelSize === "16" && root?.dataset.pixelMode === "auto";
    })()`);
    const reset = await client.evaluate(`(() => ({
      enabled: document.querySelector("[data-slice-pixel-controls]")?.dataset.pixelEnabled,
      size: document.querySelector("[data-slice-pixel-controls]")?.dataset.pixelSize,
      mode: document.querySelector("[data-slice-pixel-controls]")?.dataset.pixelMode,
    }))()`);
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const errors = { console: client.consoleErrorCount, exception: client.exceptionCount, log: client.logErrorCount, network: client.networkFailureCount, http: client.httpErrorCount };
    const layout = await client.evaluate(`(() => {
      const root = document.querySelector("[data-studio-workspace]");
      const panel = document.querySelector('[data-studio-panel-variant="sidebar"]');
      const inspector = document.querySelector("[data-slice-grid-inspector]");
      const metrics = (element) => element ? {
        rect: (() => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; })(),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      } : null;
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        verticalOverflow: document.body.scrollHeight > document.body.clientHeight ||
          (root ? root.getBoundingClientRect().bottom > window.innerHeight : true),
        document: { scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight },
        body: { scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight },
        topLevel: [...document.body.children].map((element) => ({ tag: element.tagName, id: element.id, className: element.className, rect: (() => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; })() })),
        root: metrics(root),
        panel: metrics(panel),
        inspector: metrics(inspector),
      };
    })()`);
    const passed = initial.enabled === "false" && initial.size === "16" && initial.mode === "auto"
      && configuredPixel.enabled === "true" && configuredPixel.size === "64"
      && configuredPixel.mode === "fixed" && configuredPixel.preset === "pico-8"
      && configuredPixel.swatches === 8 && configuredPixel.summary?.includes("PICO-8")
      && reset.enabled === "false" && reset.size === "16" && reset.mode === "auto"
      && accessibility.unlabeledInteractiveCount === 0 && layout.horizontalOverflow === false
      && layout.verticalOverflow === false && Object.values(errors).every((value) => value === 0);
    if (!passed) throw new Error(`G5-03 browser evidence failed closed: ${JSON.stringify({ initial, configuredPixel, reset, accessibility, layout, errors })}`);
    stage = "accepted";
    return { schemaVersion: 1, check: "grid-pixel-controls-browser", status: "pass", initial, configuredPixel, reset, accessibility, layout, screenshot: { path: screenshotPath, ...screenshot }, errors };
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "G5-03 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridPixelBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "grid-pixel-controls-browser", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
