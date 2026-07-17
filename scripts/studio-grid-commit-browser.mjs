/** G6-05 production-Chrome journey for canonical Grid commit, reload and undo. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const SCREENSHOT = "artifacts/quality/GRID/2026-07-16/g6-05-commit-browser.png";

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
    transfer.items.add(new File([blob], "g6-05-commit.png", { type: "image/png" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
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
    const openDatabase = (name, version) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        if (name !== "sprite-boy-studio-projects") return;
        const database = request.result;
        if (!database.objectStoreNames.contains("project-checkpoints")) database.createObjectStore("project-checkpoints", { keyPath: "projectId" });
        if (!database.objectStoreNames.contains("project-autosave-journal")) database.createObjectStore("project-autosave-journal", { keyPath: "projectId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      request.onblocked = () => reject(new Error("IndexedDB open was blocked."));
    });
    const autosaveDb = await openDatabase("sprite-boy-studio-projects", 1);
    const checkpoint = await requestValue(autosaveDb.transaction("project-checkpoints", "readonly").objectStore("project-checkpoints").get(projectId));
    const journal = await requestValue(autosaveDb.transaction("project-autosave-journal", "readonly").objectStore("project-autosave-journal").get(projectId));
    autosaveDb.close();
    const record = checkpoint ?? journal;
    const project = record?.projectJson ? JSON.parse(record.projectJson) : null;
    const assetsDb = await openDatabase("sprite-boy-studio-assets", 2);
    const metadataStore = assetsDb.transaction("asset-metadata", "readonly").objectStore("asset-metadata");
    const entries = await requestValue(metadataStore.index("by-project").getAll(IDBKeyRange.only(projectId)));
    const records = entries.map((entry) => entry.record);
    assetsDb.close();
    {
      return {
        projectId,
        revision: record?.revision ?? null,
        sourceAssetId: project?.workspace?.selectedAssetId ?? null,
        activeWorkspace: project?.workspace?.activeWorkspace ?? null,
        recipeCount: project ? Object.keys(project.processingRecipes ?? {}).length : null,
        regionCount: project ? Object.keys(project.regions ?? {}).length : null,
        assetCount: project ? Object.keys(project.assets ?? {}).length : null,
        repositoryCount: records.length,
        repositoryIds: records.map((record) => record.id).sort(),
        databaseNames: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((entry) => entry.name) : [],
        rawAssetEntries: entries.map((entry) => ({ projectId: entry.projectId, assetId: entry.assetId, recordId: entry.record?.id ?? null })),
        sourceInRepository: project?.workspace?.selectedAssetId
          ? records.some((record) => record.id === project.workspace.selectedAssetId)
          : false,
      };
    }
    } catch (error) {
      return { readError: error instanceof Error ? error.name + ": " + error.message : String(error) };
    }
  })()`);
}

export async function runGridCommitBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g605-browser-"));
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
    stage = "navigate";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(
      `document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`,
      60_000,
    );
    if (await selectSource(client) !== true) throw new Error("Source fixture could not be selected.");
    stage = "source-ready";
    await client.waitFor(
      `document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("Ready to process")`,
      60_000,
    );
    const initial = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-results-tray]");
      return {
        status: root?.querySelector('[role="status"]')?.textContent?.trim() ?? "",
        processDisabled: root?.querySelector('button[aria-label="Process slices"]')?.hasAttribute("disabled") ?? true,
      };
    })()`);
    if (initial.processDisabled) throw new Error(`Process action was disabled: ${JSON.stringify(initial)}`);

    stage = "process";
    await client.evaluate(`document.querySelector('[data-slice-results-tray] button[aria-label="Process slices"]')?.click()`);
    await client.waitFor(
      `document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("staged slices ready")`,
      60_000,
    );
    const processed = await client.evaluate(`(() => {
      const root = document.querySelector("[data-slice-results-tray]");
      return {
        status: root?.querySelector('[role="status"]')?.textContent?.trim() ?? "",
        outputs: root?.querySelectorAll('button[aria-label^="Slice "]').length ?? 0,
        commitVisible: Boolean(root?.querySelector('button[aria-label="Commit slices"]')),
      };
    })()`);
    if (processed.outputs !== 8 || !processed.commitVisible) {
      throw new Error(`Grid outputs did not settle for commit: ${JSON.stringify(processed)}`);
    }

    stage = "commit";
    await client.evaluate(`document.querySelector('[data-slice-results-tray] button[aria-label="Commit slices"]')?.click()`);
    await client.waitFor(`document.body.innerText.includes("8 slices committed to the project.")`, 60_000);
    await client.waitFor(`document.querySelector('button[data-command-id="edit.undo"]')?.hasAttribute("disabled") === false`, 10_000);
    const committed = await readCanonical(client);
    if (!committed || committed.regionCount !== 8 || committed.recipeCount !== 1 || committed.assetCount !== 1 || committed.repositoryCount !== 1) {
      throw new Error(`Canonical commit was not durable: ${JSON.stringify(committed)}`);
    }
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`document.body.innerText.includes("Saved locally")`, 60_000);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    stage = "reload-after-commit";
    await client.send("Page.reload", { ignoreCache: false });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`, 60_000);
    await client.waitFor(
      `document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("Ready to process")`,
      60_000,
    );
    const reloaded = await readCanonical(client);
    const restoredSource = await client.evaluate(`(() => ({
      dropzone: Boolean(document.querySelector("[data-slice-source-dropzone]")),
      processDisabled: document.querySelector('[data-slice-results-tray] button[aria-label="Process slices"]')?.hasAttribute("disabled") ?? true,
      sourceCanvas: Boolean(document.querySelector("[data-slice-source-canvas-frame]")),
      runtimeUrlText: /(?:blob:|data:image)/u.test(document.querySelector("main")?.innerText ?? ""),
    }))()`);
    if (!reloaded || reloaded.regionCount !== 8 || reloaded.recipeCount !== 1 || reloaded.repositoryCount !== 1 || !restoredSource.sourceCanvas || restoredSource.processDisabled) {
      throw new Error(`Commit reload did not restore source and graph: ${JSON.stringify({ reloaded, restoredSource })}`);
    }

    stage = "undo";
    const undoState = await client.evaluate(`(() => {
      const button = document.querySelector('button[data-command-id="edit.undo"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return { enabled: false };
      button.click();
      return { enabled: true };
    })()`);
    if (!undoState.enabled) throw new Error("Canonical Slice undo was disabled after reload.");
    await client.waitFor(`document.querySelector('button[data-command-id="edit.undo"]')?.hasAttribute("disabled") === true`, 10_000);
    const undone = await readCanonical(client);
    if (!undone || undone.regionCount !== 0 || undone.recipeCount !== 0 || undone.assetCount !== 1 || undone.sourceAssetId !== committed.sourceAssetId) {
      throw new Error(`Canonical undo did not remove committed graph only: ${JSON.stringify({ committed, undone })}`);
    }
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`document.body.innerText.includes("Saved locally")`, 60_000);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    stage = "reload-after-undo";
    await client.send("Page.reload", { ignoreCache: false });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`, 60_000);
    await client.waitFor(
      `document.querySelector('[data-slice-results-tray] [role="status"]')?.textContent?.includes("Ready to process")`,
      60_000,
    );
    const afterUndoReload = await readCanonical(client);
    if (!afterUndoReload || afterUndoReload.regionCount !== 0 || afterUndoReload.recipeCount !== 0 || afterUndoReload.assetCount !== 1 || afterUndoReload.repositoryCount !== 1 || !afterUndoReload.sourceInRepository) {
      throw new Error(`Undo reload left a non-canonical repository: ${JSON.stringify(afterUndoReload)}`);
    }
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const layout = await client.evaluate(`(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.body.scrollHeight > document.body.clientHeight,
    }))()`);
    const screenshot = await capture(client, screenshotPath);
    const errors = {
      console: client.consoleErrorCount,
      exception: client.exceptionCount,
      log: client.logErrorCount,
      network: client.networkFailureCount,
      http: client.httpErrorCount,
    };
    const passed = initial.status.includes("Ready to process") && !initial.processDisabled
      && processed.outputs === 8 && processed.commitVisible
      && committed.regionCount === 8 && committed.recipeCount === 1
      && reloaded.regionCount === 8 && reloaded.recipeCount === 1
      && restoredSource.sourceCanvas && !restoredSource.processDisabled
      && undone.regionCount === 0 && undone.recipeCount === 0
      && afterUndoReload.regionCount === 0 && afterUndoReload.recipeCount === 0
      && afterUndoReload.repositoryCount === 1 && afterUndoReload.sourceInRepository
      && restoredSource.runtimeUrlText === false
      && accessibility.unlabeledInteractiveCount === 0
      && layout.horizontalOverflow === false && layout.verticalOverflow === false
      && Object.values(errors).every((value) => value === 0);
    if (!passed) throw new Error(`G6-05 browser evidence failed closed: ${JSON.stringify({ initial, processed, committed, reloaded, restoredSource, undone, afterUndoReload, accessibility, layout, errors })}`);
    stage = "accepted";
    return {
      schemaVersion: 1,
      check: "grid-commit-browser",
      status: "pass",
      initial,
      processed,
      committed,
      reloaded,
      restoredSource,
      undone,
      afterUndoReload,
      accessibility,
      layout,
      screenshot,
      errors,
    };
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "G6-05 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridCommitBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "grid-commit-browser", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
