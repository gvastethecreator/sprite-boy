/** S1-04/S1-06 production-Chrome journey for irregular Slice regions. */
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

const SCREENSHOT = "artifacts/quality/GRID/2026-07-16/s1-04-irregular-browser.png";

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return { path: outputPath, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function pause(client, milliseconds) {
  await client.evaluate(`new Promise((resolve) => setTimeout(resolve, ${milliseconds}))`);
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
    transfer.items.add(new File([blob], "s1-irregular.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function clickSelector(client, selector) {
  return client.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
}

async function clickNative(client, selector) {
  const point = await client.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  if (!point || point.width <= 0 || point.height <= 0) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return true;
}

async function clickByText(client, rootSelector, text) {
  return client.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!(root instanceof HTMLElement)) return false;
    const target = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(text)}));
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
}

async function setNumber(client, label, value) {
  return client.evaluate(`(() => {
    const target = [...document.querySelectorAll('input[type="number"]')].find((input) => input.getAttribute("aria-label") === ${JSON.stringify(label)});
    if (!(target instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(target, ${JSON.stringify(String(value))});
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function clickCanvasPoint(client, xRatio, yRatio) {
  const point = await client.evaluate(`(() => {
    const canvas = document.querySelector('[data-studio-source-canvas]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + rect.width * ${xRatio}, y: rect.top + rect.height * ${yRatio}, width: rect.width, height: rect.height };
  })()`);
  if (!point || point.width <= 0 || point.height <= 0) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return true;
}

async function installDownloadProbe(client) {
  await client.evaluate(`(() => {
    const records = [];
    const blobs = new Map();
    let sequence = 0;
    globalThis.__irregularDownloads = records;
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = "blob:irregular-" + (++sequence); blobs.set(url, blob); return url; };
    const revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { if (!blobs.has(url)) revokeUrl(url); };
    HTMLAnchorElement.prototype.click = function () {
      const blob = blobs.get(this.href);
      if (this.download && blob instanceof Blob) void blob.arrayBuffer().then((buffer) => records.push({
        fileName: this.download,
        mimeType: blob.type,
        byteSize: blob.size,
        signature: Array.from(new Uint8Array(buffer).slice(0, 4)),
      }));
    };
    void createUrl;
  })()`);
}

async function readCanonical(client) {
  return client.evaluate(`(async () => {
    try {
      const projectId = localStorage.getItem("sprite-boy-studio:active-project:v1");
      if (!projectId) return null;
      const value = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open("sprite-boy-studio-projects", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const checkpoint = await value(database.transaction("project-checkpoints", "readonly").objectStore("project-checkpoints").get(projectId));
      const journal = await value(database.transaction("project-autosave-journal", "readonly").objectStore("project-autosave-journal").get(projectId));
      database.close();
      const record = checkpoint ?? journal;
      const project = record?.projectJson ? JSON.parse(record.projectJson) : null;
      return project ? {
        workspace: project.workspace?.activeWorkspace ?? null,
        regionCount: Object.keys(project.regions ?? {}).length,
        assetCount: Object.keys(project.assets ?? {}).length,
        selectedRegionId: project.workspace?.selectedRegionId ?? null,
      } : null;
    } catch (error) {
      return { readError: error instanceof Error ? error.message : String(error) };
    }
  })()`);
}

export async function runIrregularBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-s1-irregular-browser-"));
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
    await waitForSliceSourceDropzone(client);
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    await client.waitFor(`document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("Ready to process")`, 60_000);
    await client.waitFor(`Boolean(document.querySelector('[aria-labelledby="irregular-slice-tools-title"]'))`, 60_000);
    await pause(client, 400);

    const legacyControls = await client.evaluate(`(() => ({ autoDetect: document.body.innerText.includes("Auto-Detect Sprites"), legacyMagicWand: document.body.innerText.includes("Magic Wand") && !document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')?.textContent?.includes("Magic wand controls") }))()`);
    if (legacyControls.autoDetect || legacyControls.legacyMagicWand) throw new Error(`Legacy Slice controls leaked into canonical workspace: ${JSON.stringify(legacyControls)}`);

    stage = "manual-create";
    if (!await clickByText(client, '[aria-labelledby="irregular-slice-tools-title"] [role="tablist"]', "Manual")) throw new Error("Manual tool tab unavailable.");
    await client.waitFor(`Boolean(document.querySelector('[aria-label="Manual region controls"]'))`, 10_000);
    for (const [label, value] of [["Region x", 20], ["Region y", 20], ["Region width", 80], ["Region height", 80]]) {
      if (!await setNumber(client, label, value)) throw new Error(`${label} input unavailable.`);
    }
    if (!await clickByText(client, '[aria-label="Manual region controls"]', "Create from bounds")) throw new Error("Manual create action unavailable.");
    await client.waitFor(`document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')?.textContent?.includes("1 regions")`, 30_000);
    const afterManual = await client.evaluate(`(() => ({ regions: document.querySelectorAll('[aria-label="Region list"] button').length, selected: document.querySelector('[aria-label="Region list"] button[aria-pressed="true"]')?.textContent?.trim() ?? null }))()`);
    if (afterManual.regions !== 1) throw new Error(`Manual region was not created: ${JSON.stringify(afterManual)}`);

    stage = "wand-select";
    if (!await clickByText(client, '[aria-labelledby="irregular-slice-tools-title"] [role="tablist"]', "Wand")) throw new Error("Wand tool tab unavailable.");
    await client.waitFor(`Boolean(document.querySelector('[aria-label="Magic wand controls"]'))`, 10_000);
    if (!await clickCanvasPoint(client, 0.125, 0.25)) throw new Error("Source canvas point unavailable.");
    let wandSelected = false;
    for (const [xRatio, yRatio] of [[0.32, 0.43], [0.45, 0.43], [0.58, 0.43], [0.71, 0.43], [0.32, 0.57], [0.45, 0.57], [0.58, 0.57], [0.71, 0.57], [0.2, 0.2], [0.5, 0.25], [0.8, 0.6]]) {
      if (wandSelected) break;
      await clickCanvasPoint(client, xRatio, yRatio);
      try {
        await client.waitFor(`document.querySelector('[aria-label="Magic wand controls"]')?.textContent?.includes("1 selected")`, 2_000);
        wandSelected = true;
      } catch {
        // The canvas content can be letterboxed; keep probing visible cells.
      }
    }
    if (!wandSelected) throw new Error("Wand click did not select a connected component.");
    const wand = await client.evaluate(`(() => document.querySelector('[aria-label="Magic wand controls"]')?.textContent?.trim() ?? "")()`);
    if (!await clickByText(client, '[aria-label="Magic wand controls"]', "Clear")) throw new Error("Wand clear action unavailable.");
    await client.waitFor(`document.querySelector('[aria-label="Magic wand controls"]')?.textContent?.includes("0 selected")`, 10_000);

    stage = "region-actions";
    if (!await clickByText(client, '[aria-labelledby="irregular-slice-tools-title"] [role="tablist"]', "Manual")) throw new Error("Manual controls could not be restored.");
    await client.waitFor(`Boolean(document.querySelector('[aria-label="Manual region controls"]'))`, 10_000);
    const beforeUndo = await client.evaluate(`document.querySelectorAll('[aria-label="Region list"] button').length`);
    const undo = await client.evaluate(`Boolean(document.querySelector('button[data-command-id="edit.undo"]'))`);
    if (!undo) throw new Error("Canonical undo command unavailable.");
    let undoApplied = false;
    for (let attempt = 0; attempt < 3 && !undoApplied; attempt += 1) {
      await clickSelector(client, 'button[data-command-id="edit.undo"]');
      try {
        await client.waitFor(`document.querySelectorAll('[aria-label="Region list"] button').length < ${beforeUndo}`, 3_000);
        undoApplied = true;
      } catch {
        await pause(client, 250);
      }
    }
    if (!undoApplied) throw new Error(`Canonical undo did not reduce the Region list from ${beforeUndo}.`);

    stage = "save-reload";
    if (!await clickSelector(client, 'button[aria-label="Project"]')) throw new Error("Project menu unavailable.");
    await client.waitFor(`Boolean(document.querySelector('[role="menu"][aria-label="Project actions"]'))`, 10_000);
    await pause(client, 250);
    if (!await clickSelector(client, 'button[data-command-id="project.save"]')) throw new Error("Project save command unavailable.");
    await pause(client, 2_000);
    const beforeReload = await readCanonical(client);
    if (!beforeReload || beforeReload.regionCount < 1) throw new Error(`Project checkpoint did not contain irregular regions: ${JSON.stringify(beforeReload)}`);
    await client.send("Page.reload", { ignoreCache: true });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector('[aria-labelledby="irregular-slice-tools-title"]'))`, 60_000);
    await client.waitFor(`document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')?.textContent?.includes("1 regions")`, 30_000);
    const afterReload = await readCanonical(client);
    if (!afterReload || afterReload.regionCount < 1) throw new Error(`Region persistence failed: ${JSON.stringify({ beforeReload, afterReload })}`);

    stage = "export";
    await installDownloadProbe(client);
    await client.waitFor(`document.querySelector('a[aria-label="Export"]')?.getAttribute("aria-disabled") !== "true"`, 30_000);
    if (!await clickNative(client, 'a[aria-label="Export"]')) throw new Error("Export navigation unavailable.");
    await client.waitFor(`location.hash === "#/studio/export" && Boolean(document.querySelector("[data-grid-export-center]"))`, 30_000);
    const exportShell = await client.evaluate(`(() => ({ regionTiles: document.querySelectorAll('[data-grid-export-center] button[aria-label^="Export region"]').length, png: !document.querySelector('[data-grid-export-center] button[aria-label="Download PNG"]')?.disabled, zip: !document.querySelector('[data-grid-export-center] button[aria-label="Export ZIP"]')?.disabled }))()`);
    if (exportShell.regionTiles < 1 || !exportShell.png || !exportShell.zip) throw new Error(`Irregular export center did not expose regions: ${JSON.stringify(exportShell)}`);
    await clickSelector(client, '[data-grid-export-center] button[aria-label="Download PNG"]');
    await client.waitFor(`(globalThis.__irregularDownloads?.length ?? 0) >= 1`, 30_000);
    await clickSelector(client, '[data-grid-export-center] button[aria-label="Export ZIP"]');
    await client.waitFor(`(globalThis.__irregularDownloads?.length ?? 0) >= 2`, 30_000);
    const downloads = await client.evaluate("globalThis.__irregularDownloads ?? []");

    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const layout = await client.evaluate(`({ horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, verticalOverflow: document.body.scrollHeight > document.body.clientHeight })`);
    const screenshot = await capture(client, screenshotPath);
    const errors = { console: client.consoleErrorCount, exception: client.exceptionCount, log: client.logErrorCount, network: client.networkFailureCount, http: client.httpErrorCount };
    const passed = afterReload.regionCount >= 1
      && downloads[0]?.mimeType === "image/png" && downloads[0]?.signature?.[0] === 137
      && downloads[1]?.mimeType === "application/zip" && downloads[1]?.signature?.[0] === 80 && downloads[1]?.signature?.[1] === 75
      && accessibility.unlabeledInteractiveCount === 0
      && layout.horizontalOverflow === false && layout.verticalOverflow === false
      && Object.values(errors).every((value) => value === 0);
    if (!passed) throw new Error(`Irregular browser evidence failed closed: ${JSON.stringify({ afterReload, downloads, accessibility, layout, errors })}`);
    stage = "accepted";
    return { schemaVersion: 1, check: "irregular-slice-browser", status: "pass", afterManual, wand, beforeReload, afterReload, exportShell, downloads, accessibility, layout, screenshot, errors };
  } catch (error) {
    let detail = null;
    try {
      detail = await client?.evaluate(`(() => ({
        readyState: document.readyState,
        hash: location.hash,
        body: document.body.innerText.slice(-500),
        hasDropzone: Boolean(document.querySelector("[data-slice-source-dropzone]")),
        hasIrregularTools: Boolean(document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')),
        toolTabs: [...document.querySelectorAll('[aria-labelledby="irregular-slice-tools-title"] [role="tab"]')].map((button) => ({ text: button.textContent?.trim(), selected: button.getAttribute("aria-selected") })),
        manualPanels: document.querySelectorAll('[aria-label="Manual region controls"]').length,
        manualButton: (() => { const button = [...document.querySelectorAll('[aria-label="Manual region controls"] button')].find((candidate) => candidate.textContent?.includes("Create from bounds")); return button ? { disabled: button.hasAttribute("disabled"), text: button.textContent?.trim() } : null; })(),
        regionSummary: document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')?.textContent?.slice(0, 160) ?? null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()).filter(Boolean),
        canvas: (() => { const canvas = document.querySelector('[data-studio-source-canvas]'); if (!(canvas instanceof HTMLCanvasElement)) return null; const rect = canvas.getBoundingClientRect(); return { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, content: canvas.dataset.canvasContentSize ?? null, ownership: canvas.dataset.canonicalCanvasOwnership ?? null }; })(),
        regionButtons: document.querySelectorAll('[aria-label="Region list"] button').length,
        selectedRegion: document.querySelector('[aria-label="Region list"] button[aria-pressed="true"]')?.textContent?.trim() ?? null,
        undo: (() => { const button = document.querySelector('button[data-command-id="edit.undo"]'); return button ? { disabled: button.disabled, ariaDisabled: button.getAttribute("aria-disabled"), title: button.getAttribute("title") } : null; })(),
        projectMenu: Boolean(document.querySelector('[data-project-menu]')),
        projectSave: Boolean(document.querySelector('button[data-command-id="project.save"]')),
        persistence: [...document.querySelectorAll('[role="status"], [role="alert"]')].map((node) => node.textContent?.trim()).filter(Boolean).slice(-8),
      }))()`);
    } catch {
      // Navigation/teardown can remove the page context; stage remains useful.
    }
    const runtimeErrors = { console: client?.consoleErrorCount ?? null, exception: client?.exceptionCount ?? null, exceptionKinds: client?.exceptionKinds ?? [], log: client?.logErrorCount ?? null, network: client?.networkFailureCount ?? null, http: client?.httpErrorCount ?? null };
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}${detail ? ` ${JSON.stringify(detail)}` : ""} ${JSON.stringify(runtimeErrors)}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "Irregular browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runIrregularBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "irregular-slice-browser", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
