/** G7 production-Chrome journey for Grid exports and Compose handoff. */
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
  waitForSliceSourceDropzone,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";

const SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g7-export-browser.png";

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(result.data, "base64");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return {
    path: outputPath,
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
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "g7-export.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function installDownloadProbe(client) {
  await client.evaluate(`(() => {
    const records = [];
    const blobs = new Map();
    let sequence = 0;
    globalThis.__gridExportDownloads = records;
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = "blob:grid-export-" + (++sequence);
      blobs.set(url, blob);
      return url;
    };
    const revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      if (!blobs.has(url)) revokeUrl(url);
    };
    HTMLAnchorElement.prototype.click = function () {
      const url = this.href;
      const blob = blobs.get(url);
      if (this.download && blob instanceof Blob) {
        void blob.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer);
          records.push({
            fileName: this.download,
            mimeType: blob.type,
            byteSize: blob.size,
            signature: Array.from(bytes.slice(0, 4)),
          });
        });
      }
      // Keep the probe in-page: invoking the native click would ask the
      // headless browser to navigate to the synthetic blob URL and emit a
      // security log unrelated to the export contract.
      return undefined;
    };
  })()`);
}

async function clickSelector(client, selector) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!(target instanceof HTMLElement)) return false; target.click(); return true; })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  return result.result?.value === true;
}

async function clickNative(client, selector) {
  const rect = await client.evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!(target instanceof HTMLElement)) return null; const rect = target.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height }; })()`);
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  return true;
}

async function pause(client, milliseconds) {
  await client.evaluate(`new Promise((resolve) => setTimeout(resolve, ${milliseconds}))`);
}

async function clickUntil(client, selector, predicate, attempts = 3, native = false) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(native ? await clickNative(client, selector) : await clickSelector(client, selector))) return false;
    try {
      await client.waitFor(predicate, 5_000);
      return true;
    } catch {
      if (attempt + 1 < attempts) await pause(client, 250);
    }
  }
  return false;
}

async function readCanonical(client) {
  return client.evaluate(`(async () => {
    try {
      const projectId = localStorage.getItem("sprite-boy-studio:active-project:v1");
      if (!projectId) return null;
      const requestValue = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
      });
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("sprite-boy-studio-projects", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      });
      const checkpoint = await requestValue(database.transaction("project-checkpoints", "readonly").objectStore("project-checkpoints").get(projectId));
      const journal = await requestValue(database.transaction("project-autosave-journal", "readonly").objectStore("project-autosave-journal").get(projectId));
      database.close();
      const record = checkpoint ?? journal;
      const project = record?.projectJson ? JSON.parse(record.projectJson) : null;
      return project ? {
        activeWorkspace: project.workspace?.activeWorkspace ?? null,
        selectedRegionId: project.workspace?.selectedRegionId ?? null,
        selectedCompositionId: project.workspace?.selectedCompositionId ?? null,
        recipeCount: Object.keys(project.processingRecipes ?? {}).length,
        regionCount: Object.keys(project.regions ?? {}).length,
        compositionCount: Object.keys(project.compositions ?? {}).length,
        layerCount: Object.keys(project.layers ?? {}).length,
      } : null;
    } catch (error) {
      return { readError: error instanceof Error ? error.name + ": " + error.message : String(error) };
    }
  })()`);
}

export async function runGridExportBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g7-export-browser-"));
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
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);

    stage = "navigate-slice";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await waitForSliceSourceDropzone(client);
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    await client.waitFor(`document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("Ready to process")`, 60_000);
    await pause(client, 500);
    stage = "process";
    if (!await clickSelector(client, '[data-slice-results-tray] button[aria-label="Process slices"]')) throw new Error("Process button was not available.");
    await client.waitFor(`document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("staged slices ready")`, 60_000);
    stage = "commit";
    if (!await clickSelector(client, '[data-slice-results-tray] button[aria-label="Commit slices"]')) throw new Error("Commit button was not available.");
    stage = "commit-toast";
    await client.waitFor(`document.body.innerText.includes("8 slices committed to the project.")`, 60_000);
    stage = "commit-save";
    if (!await clickSelector(client, 'button[aria-label="Project"]')) throw new Error("Project menu was not available.");
    await client.waitFor(`document.body.innerText.includes("Saved locally")`, 60_000);
    await clickSelector(client, 'button[aria-label="Project"]');
    await pause(client, 300);

    stage = "open-export";
    stage = "install-download-probe";
    await installDownloadProbe(client);
    stage = "click-export";
    await client.waitFor(`document.querySelector('a[aria-label="Export"]')?.getAttribute("aria-disabled") !== "true"`, 30_000);
    if (!await clickUntil(client, 'a[aria-label="Export"]', `location.hash === "#/studio/export"`, 3, true)) throw new Error("Export navigation was not available.");
    stage = "wait-export-center";
    await client.waitFor(`Boolean(document.querySelector("[data-grid-export-center]"))`, 30_000);
    const exportShell = await client.evaluate(`(() => ({
      route: location.hash,
      regionTiles: document.querySelectorAll('[data-grid-export-center] button[aria-label^="Export region"]').length,
      exportZipEnabled: !(document.querySelector('[data-grid-export-center] button[aria-label="Export ZIP"]')?.hasAttribute("disabled") ?? true),
      downloadPngEnabled: !(document.querySelector('[data-grid-export-center] button[aria-label="Download PNG"]')?.hasAttribute("disabled") ?? true),
      composeEnabled: !(document.querySelector('[data-grid-export-center] button[aria-label="Open in Compose"]')?.hasAttribute("disabled") ?? true),
      exportZipButton: document.querySelector('[data-grid-export-center] button[aria-label="Export ZIP"]')?.outerHTML ?? null,
      downloadPngButton: document.querySelector('[data-grid-export-center] button[aria-label="Download PNG"]')?.outerHTML ?? null,
      composeButton: document.querySelector('[data-grid-export-center] button[aria-label="Open in Compose"]')?.outerHTML ?? null,
    }))()`);
    if (exportShell.regionTiles !== 8 || !exportShell.exportZipEnabled || !exportShell.downloadPngEnabled || !exportShell.composeEnabled) {
      throw new Error(`Export center did not expose committed outputs: ${JSON.stringify(exportShell)}`);
    }

    stage = "download-png";
    if (!await clickSelector(client, '[data-grid-export-center] button[aria-label="Download PNG"]')) throw new Error("PNG download button was not available.");
    await client.waitFor(`document.body.innerText.includes("exported as PNG.")`, 30_000);
    await client.waitFor(`(globalThis.__gridExportDownloads?.length ?? 0) >= 1`, 30_000);
    const pngDownload = await client.evaluate("globalThis.__gridExportDownloads?.[0] ?? null");

    stage = "download-zip";
    if (!await clickSelector(client, '[data-grid-export-center] button[aria-label="Export ZIP"]')) throw new Error("ZIP export button was not available.");
    await client.waitFor(`document.body.innerText.includes("exported with manifest.")`, 30_000);
    await client.waitFor(`(globalThis.__gridExportDownloads?.length ?? 0) >= 2`, 30_000);
    const downloads = await client.evaluate("globalThis.__gridExportDownloads ?? []");
    const zipDownload = downloads[1] ?? null;
    await pause(client, 4_000);
    const screenshot = await capture(client, screenshotPath);

    stage = "compose-handoff";
    if (!await clickSelector(client, '[data-grid-export-center] button[aria-label="Open in Compose"]')) throw new Error("Compose handoff button was not available.");
    await client.waitFor(`location.hash === "#/studio/compose" && Boolean(document.querySelector('[data-studio-workspace-content="compose"]'))`, 30_000);
    await client.waitFor(`document.body.innerText.includes("Composition graph ready")`, 30_000);
    if (!await clickSelector(client, 'button[aria-label="Project"]')) throw new Error("Project menu was not available after Compose handoff.");
    await client.waitFor(`document.body.innerText.includes("Saved locally")`, 60_000);
    await clickSelector(client, 'button[aria-label="Project"]');
    const composeHandoff = await readCanonical(client);
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const layout = await client.evaluate(`({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.body.scrollHeight > document.body.clientHeight,
    })`);
    const errors = {
      console: client.consoleErrorCount,
      exception: client.exceptionCount,
      log: client.logErrorCount,
      network: client.networkFailureCount,
      http: client.httpErrorCount,
    };
    const passed = exportShell.route === "#/studio/export"
      && exportShell.regionTiles === 8
      && pngDownload?.mimeType === "image/png"
      && pngDownload?.signature?.[0] === 137
      && zipDownload?.mimeType === "application/zip"
      && zipDownload?.signature?.[0] === 80
      && zipDownload?.signature?.[1] === 75
      && composeHandoff?.activeWorkspace === "compose"
      && composeHandoff?.selectedRegionId
      && composeHandoff?.compositionCount === 1
      && composeHandoff?.layerCount === 1
      && accessibility.unlabeledInteractiveCount === 0
      && layout.horizontalOverflow === false
      && layout.verticalOverflow === false
      && Object.values(errors).every((value) => value === 0);
    if (!passed) throw new Error(`G7 browser evidence failed closed: ${JSON.stringify({ exportShell, pngDownload, zipDownload, composeHandoff, accessibility, layout, errors, logErrorKinds: client.logErrorKinds })}`);
    stage = "accepted";
    return {
      schemaVersion: 1,
      check: "grid-export-browser",
      status: "pass",
      exportShell,
      pngDownload,
      zipDownload,
      composeHandoff,
      accessibility,
      layout,
      screenshot,
      errors,
      logErrorKinds: client.logErrorKinds,
    };
  } catch (error) {
    let detail = null;
    try {
      detail = await client?.evaluate(`(() => ({
        hash: location.hash,
        body: document.body.innerText.slice(-500),
        trayStatus: document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent ?? null,
        trayButtons: [...document.querySelectorAll('[data-slice-results-tray] button')].map((button) => ({ label: button.getAttribute("aria-label"), disabled: button.hasAttribute("disabled"), propertyDisabled: button.disabled, html: button.outerHTML.slice(0, 300) })),
        exportLink: (() => { const link = document.querySelector('a[aria-label="Export"]'); return link ? { href: link.getAttribute("href"), ariaDisabled: link.getAttribute("aria-disabled"), className: link.className } : null; })(),
        errors: { console: client?.consoleErrorCount ?? null, exception: client?.exceptionCount ?? null, log: client?.logErrorCount ?? null, network: client?.networkFailureCount ?? null, http: client?.httpErrorCount ?? null },
      }))()`);
    } catch {
      // Navigation or teardown can remove the page context; the stage remains useful.
    }
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "G7 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridExportBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "grid-export-browser", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
