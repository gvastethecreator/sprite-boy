/** S1-04/S1-06 production-Chrome journey for irregular Slice regions. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

async function selectSource(client, sourcePath) {
  if (sourcePath) {
    const documentNode = await client.send("DOM.getDocument", { depth: 0 });
    const input = await client.send("DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector: 'input[accept="image/png,image/jpeg,image/webp"]',
    });
    if (!input.nodeId) return false;
    await client.send("DOM.setFileInputFiles", { files: [sourcePath], nodeId: input.nodeId });
    return true;
  }
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

async function dragSourceBounds(client, startRatio, endRatio) {
  const points = await client.evaluate(`(() => {
    const region = document.querySelector('[data-manual-region-id]');
    const canvas = document.querySelector('[data-studio-source-canvas]');
    if (!(region instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return null;
    const values = (region.dataset.manualRegionBounds ?? "").split(",").map(Number);
    const source = (canvas.dataset.canvasContentSize ?? "").split("x").map(Number);
    const rect = region.getBoundingClientRect();
    if (values.length !== 4 || source.length !== 2 || values.some((value) => !Number.isFinite(value)) || source.some((value) => !Number.isFinite(value))) return null;
    const scale = rect.width / values[2];
    const offsetX = rect.left - values[0] * scale;
    const offsetY = rect.top - values[1] * scale;
    return {
      start: { x: offsetX + source[0] * ${startRatio.x} * scale, y: offsetY + source[1] * ${startRatio.y} * scale },
      end: { x: offsetX + source[0] * ${endRatio.x} * scale, y: offsetY + source[1] * ${endRatio.y} * scale },
    };
  })()`);
  if (!points) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.start.x, y: points.start.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: points.start.x, y: points.start.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.end.x, y: points.end.y, button: "left", buttons: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: points.end.x, y: points.end.y, button: "left", buttons: 0, clickCount: 1 });
  return true;
}

async function dragSelectedRegion(client, selector, deltaSourceX, deltaSourceY) {
  const drag = await client.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    const region = target?.closest('[data-manual-region-id]');
    if (!(target instanceof HTMLElement) || !(region instanceof HTMLElement)) return null;
    const values = (region.dataset.manualRegionBounds ?? "").split(",").map(Number);
    const rect = region.getBoundingClientRect();
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] < 1) return null;
    const scale = rect.width / values[2];
    const targetRect = target.getBoundingClientRect();
    const start = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 };
    return { start, end: { x: start.x + ${deltaSourceX} * scale, y: start.y + ${deltaSourceY} * scale } };
  })()`);
  if (!drag) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: drag.start.x, y: drag.start.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: drag.start.x, y: drag.start.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: drag.end.x, y: drag.end.y, button: "left", buttons: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: drag.end.x, y: drag.end.y, button: "left", buttons: 0, clickCount: 1 });
  return true;
}

async function readManualRegions(client) {
  return client.evaluate(`(() => [...document.querySelectorAll('[data-manual-region-id]')].map((region) => ({
    id: region.getAttribute('data-manual-region-id'),
    bounds: (region.getAttribute('data-manual-region-bounds') ?? '').split(',').map(Number),
    selected: region.querySelector('[data-manual-region-move]')?.getAttribute('aria-pressed') === 'true',
  })))()`);
}

async function readManualInputs(client) {
  return client.evaluate(`(() => Object.fromEntries([...document.querySelectorAll('[aria-label="Manual region controls"] input[type="number"]')].map((input) => [input.getAttribute('aria-label'), Number(input.value)])))()`);
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
  const manualScreenshotPath = options.manualScreenshotPath ? resolve(cwd, options.manualScreenshotPath) : null;
  const serverMode = options.serverMode ?? "preview";
  if (serverMode !== "preview" && serverMode !== "dev") throw new TypeError("Irregular browser server mode is invalid.");
  const externalBaseUrl = typeof options.baseUrl === "string" && options.baseUrl.trim().length > 0
    ? new URL(options.baseUrl)
    : null;
  const port = externalBaseUrl ? null : await allocatePort();
  const baseUrl = externalBaseUrl?.origin ?? `http://127.0.0.1:${port}`;
  const sourcePath = options.sourcePath ? resolve(cwd, options.sourcePath) : null;
  if (sourcePath && !existsSync(sourcePath)) throw new Error(`Irregular source file does not exist: ${sourcePath}`);
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-s1-irregular-browser-"));
  let vite;
  let chrome;
  let client;
  let stage = "launch";
  try {
    if (port !== null) {
      vite = spawnViteServer(cwd, port, serverMode);
      await waitForPreview(baseUrl, vite);
    }
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
    if (await selectSource(client, sourcePath) !== true) throw new Error("Source fixture could not be selected.");
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
    if (!await clickByText(client, '[aria-label="Manual region controls"]', "Create from coordinates")) throw new Error("Manual create action unavailable.");
    await client.waitFor(`document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')?.textContent?.includes("1 regions")`, 30_000);
    const afterManual = await client.evaluate(`(() => ({ regions: document.querySelectorAll('[aria-label="Region list"] button').length, selected: document.querySelector('[aria-label="Region list"] button[aria-pressed="true"]')?.textContent?.trim() ?? null }))()`);
    if (afterManual.regions !== 1) throw new Error(`Manual region was not created: ${JSON.stringify(afterManual)}`);

    stage = "manual-canvas-create";
    if (!await dragSourceBounds(client, { x: 0.35, y: 0.2 }, { x: 0.63, y: 0.62 })) throw new Error("Manual canvas drag was unavailable.");
    await client.waitFor(`document.querySelectorAll('[data-manual-region-id]').length === 2`, 30_000);
    const afterCanvasCreate = await readManualRegions(client);
    if (afterCanvasCreate.length !== 2 || !afterCanvasCreate[1]?.selected) throw new Error(`Canvas Region was not created or selected: ${JSON.stringify(afterCanvasCreate)}`);
    const canvasRegionId = afterCanvasCreate[1].id;
    const createdBounds = afterCanvasCreate[1].bounds;

    stage = "manual-canvas-move";
    if (!await dragSelectedRegion(client, '[data-manual-region-move][aria-pressed="true"]', 12, 8)) throw new Error("Selected Region move handle was unavailable.");
    await client.waitFor(`document.querySelector('[data-manual-region-id=${JSON.stringify(canvasRegionId)}]')?.getAttribute('data-manual-region-bounds') !== ${JSON.stringify(createdBounds.join(","))}`, 20_000);
    const afterCanvasMove = await readManualRegions(client);

    stage = "manual-canvas-resize";
    const movedBounds = afterCanvasMove.find((region) => region.selected)?.bounds;
    if (!movedBounds || !await dragSelectedRegion(client, '[data-manual-region-resize="se"]', 18, 11)) throw new Error("Selected Region resize handle was unavailable.");
    await client.waitFor(`document.querySelector('[data-manual-region-id=${JSON.stringify(canvasRegionId)}]')?.getAttribute('data-manual-region-bounds') !== ${JSON.stringify(movedBounds.join(","))}`, 20_000);
    const afterCanvasResize = await readManualRegions(client);
    const resizedBounds = afterCanvasResize.find((region) => region.selected)?.bounds;
    if (!resizedBounds || resizedBounds[2] <= movedBounds[2] || resizedBounds[3] <= movedBounds[3]) {
      throw new Error(`Canvas Region did not resize in both axes: ${JSON.stringify({ movedBounds, resizedBounds })}`);
    }
    const manualInputs = await readManualInputs(client);
    if (manualInputs["Region x"] !== resizedBounds[0] || manualInputs["Region y"] !== resizedBounds[1]
      || manualInputs["Region width"] !== resizedBounds[2] || manualInputs["Region height"] !== resizedBounds[3]) {
      throw new Error(`Manual coordinate inputs did not follow the canvas resize: ${JSON.stringify({ manualInputs, resizedBounds })}`);
    }

    stage = "manual-canvas-undo-redo";
    let manualUndoSteps = 0;
    for (; manualUndoSteps < 5; manualUndoSteps += 1) {
      if (!await clickSelector(client, 'button[data-command-id="edit.undo"]')) throw new Error("Manual resize undo was unavailable.");
      await pause(client, 350);
      const undoSnapshot = await readManualRegions(client);
      if (undoSnapshot.find((region) => region.id === canvasRegionId)?.bounds.join(",") === movedBounds.join(",")) {
        manualUndoSteps += 1;
        break;
      }
    }
    const boundsAfterUndo = (await readManualRegions(client)).find((region) => region.id === canvasRegionId)?.bounds.join(",") ?? null;
    if (manualUndoSteps < 1 || boundsAfterUndo !== movedBounds.join(",")) throw new Error("Manual resize was not reachable in canonical undo history.");
    let manualRedoSteps = 0;
    let afterManualUndoRedo = await readManualRegions(client);
    for (; manualRedoSteps < 5; manualRedoSteps += 1) {
      const redoEnabled = await client.evaluate(`document.querySelector('button[data-command-id="edit.redo"]')?.disabled === false`);
      if (!redoEnabled || !await clickSelector(client, 'button[data-command-id="edit.redo"]')) throw new Error("Manual resize redo was unavailable.");
      await pause(client, 350);
      afterManualUndoRedo = await readManualRegions(client);
      if (afterManualUndoRedo.find((region) => region.id === canvasRegionId)?.bounds.join(",") === resizedBounds.join(",")) {
        manualRedoSteps += 1;
        break;
      }
    }
    if (afterManualUndoRedo.find((region) => region.id === canvasRegionId)?.bounds.join(",") !== resizedBounds.join(",")) {
      throw new Error(`Manual resize redo did not restore its bounds: ${JSON.stringify(afterManualUndoRedo)}`);
    }

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
    await client.waitFor(`document.querySelector('[aria-labelledby="irregular-slice-tools-title"]')?.textContent?.includes(${JSON.stringify(`${beforeReload.regionCount} regions`)})`, 30_000);
    const afterReload = await readCanonical(client);
    if (!afterReload || afterReload.regionCount < 1) throw new Error(`Region persistence failed: ${JSON.stringify({ beforeReload, afterReload })}`);
    if (!await clickByText(client, '[aria-labelledby="irregular-slice-tools-title"] [role="tablist"]', "Manual")) throw new Error("Manual controls could not be restored after reload.");
    await client.waitFor(`document.querySelectorAll('[data-manual-region-id]').length >= ${beforeReload.regionCount}`, 30_000);
    if (!await clickSelector(client, '[aria-label="Region list"] button:last-child')) throw new Error("Reloaded manual Region could not be selected.");
    await client.waitFor(`document.querySelectorAll('[data-manual-region-resize]').length === 8`, 10_000);
    const afterReloadRegions = await readManualRegions(client);
    const manualScreenshot = manualScreenshotPath ? await capture(client, manualScreenshotPath) : null;

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
    return { schemaVersion: 1, check: "irregular-slice-browser", status: "pass", sourcePath, afterManual, afterCanvasCreate, afterCanvasMove, afterCanvasResize, manualInputs, manualUndoSteps, manualRedoSteps, afterManualUndoRedo, wand, beforeReload, afterReload, afterReloadRegions, manualScreenshot, exportShell, downloads, accessibility, layout, screenshot, errors };
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
        manualButton: (() => { const button = [...document.querySelectorAll('[aria-label="Manual region controls"] button')].find((candidate) => candidate.textContent?.includes("Create from coordinates")); return button ? { disabled: button.hasAttribute("disabled"), text: button.textContent?.trim() } : null; })(),
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
    process.stdout.write(`${JSON.stringify(await runIrregularBrowserGate({
      baseUrl: process.env.STUDIO_IRREGULAR_BASE_URL,
      manualScreenshotPath: process.env.STUDIO_IRREGULAR_MANUAL_SCREENSHOT,
      screenshotPath: process.env.STUDIO_IRREGULAR_SCREENSHOT,
      serverMode: process.env.STUDIO_IRREGULAR_SERVER_MODE,
      sourcePath: process.env.STUDIO_IRREGULAR_SOURCE_PATH,
    }))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "irregular-slice-browser", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
