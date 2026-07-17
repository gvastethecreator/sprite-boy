/** G6-02 production-Chrome journey for processing feedback and staged results. */
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

const SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g6-02-results-browser.png";

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return { path: outputPath, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
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
    context.clearRect(0, 0, canvas.width, canvas.height);
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
    transfer.items.add(new File([blob], "g6-02-results.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

export async function runGridResultsBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g602-browser-"));
  let vite;
  let chrome;
  let client;
  let stage = "launch";
  try {
    vite = spawnViteServer(cwd, port, "preview");
    await waitForPreview(baseUrl, vite);
    chrome = spawn(resolveChromeExecutable(options), [
      "--headless=new", "--disable-background-networking", "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows", "--disable-component-update", "--disable-default-apps",
      "--disable-extensions", "--disable-renderer-backgrounding", "--disable-sync", "--metrics-recording-only",
      "--no-default-browser-check", "--no-first-run", "--remote-debugging-port=0",
      `--user-data-dir=${profile}`, "--window-size=1440,900", "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profile, chrome);
    client = await connectToPage(devToolsPort, 30_000);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("Accessibility.enable"),
      client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }),
    ]);
    stage = "navigate";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`, 60_000);
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    stage = "source-ready";
    await client.waitFor(`Boolean(document.querySelector("[data-slice-results-tray]"))`, 60_000);
    await client.waitFor(`document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("Ready to process")`, 60_000);
    const initial = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-results-tray]");
      return {
        ready: root?.querySelector('[role="status"]')?.textContent?.trim() ?? "",
        processDisabled: root?.querySelector('button[aria-label="Process slices"]')?.hasAttribute("disabled") ?? true,
        outputCount: root?.querySelectorAll('button[aria-label^="Slice "]').length ?? 0,
      };
    })()`);
    if (initial.processDisabled) throw new Error(`Process action was disabled: ${JSON.stringify(initial)}`);
    stage = "process";
    await client.evaluate(`document.querySelector('[data-slice-results-tray] button[aria-label="Process slices"]')?.click()`);
    await client.waitFor(`document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("staged slices ready")`, 60_000);
    const processed = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-results-tray]");
      const status = root?.querySelector('[role="status"]')?.textContent?.trim() ?? "";
      const outputs = root?.querySelectorAll('button[aria-label^="Slice "]').length ?? 0;
      const selected = root?.querySelector('button[aria-pressed="true"]')?.getAttribute("aria-label") ?? null;
      const summary = root?.textContent?.trim() ?? "";
      return {
        status,
        outputs,
        selected,
        hasProcessAgain: Boolean(root?.querySelector('button[aria-label="Process again"]')),
        hasClear: Boolean(root?.querySelector('button[aria-label="Clear"]')),
        summary,
      };
    })()`);
    if (processed.outputs < 1 || !processed.hasProcessAgain || !processed.hasClear) {
      throw new Error(`Staged results did not settle: ${JSON.stringify(processed)}`);
    }
    const selected = await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('[data-slice-results-tray] button[aria-label^="Slice "]')];
      if (buttons.length < 2) return { count: buttons.length, selected: null };
      buttons[1].click();
      return { count: buttons.length, selected: buttons[1].getAttribute("aria-pressed") };
    })()`);
    if (selected.count >= 2) {
      await client.waitFor(`document.querySelectorAll('[data-slice-results-tray] button[aria-label^="Slice "]')[1]?.getAttribute("aria-pressed") === "true"`, 10_000);
    }
    const settledSelection = selected.count >= 2
      ? await client.evaluate(`(() => ({ count: document.querySelectorAll('[data-slice-results-tray] button[aria-label^="Slice "]').length, selected: document.querySelectorAll('[data-slice-results-tray] button[aria-label^="Slice "]')[1]?.getAttribute("aria-pressed") ?? null }))()`)
      : selected;
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const layout = await client.evaluate(`(() => {
      const root = document.querySelector("[data-studio-workspace]");
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        verticalOverflow: document.body.scrollHeight > document.body.clientHeight || (root ? root.getBoundingClientRect().bottom > window.innerHeight : true),
        trayHeight: document.querySelector("[data-slice-results-tray]")?.getBoundingClientRect().height ?? 0,
      };
    })()`);
    const screenshot = await capture(client, screenshotPath);
    const errors = { console: client.consoleErrorCount, exception: client.exceptionCount, log: client.logErrorCount, network: client.networkFailureCount, http: client.httpErrorCount };
    const passed = initial.ready.includes("Ready to process") && initial.processDisabled === false
      && processed.status.includes("staged slices ready") && processed.outputs > 0
      && processed.hasProcessAgain && processed.hasClear
      && (settledSelection.count < 2 || settledSelection.selected === "true")
      && accessibility.unlabeledInteractiveCount === 0 && layout.horizontalOverflow === false
      && layout.verticalOverflow === false && Object.values(errors).every((value) => value === 0);
    if (!passed) throw new Error(`G6-02 browser evidence failed closed: ${JSON.stringify({ initial, processed, selected: settledSelection, accessibility, layout, errors })}`);
    stage = "accepted";
    return { schemaVersion: 1, check: "grid-results-browser", status: "pass", initial, processed, selected: settledSelection, accessibility, layout, screenshot, errors };
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "G6-02 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridResultsBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "grid-results-browser", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
