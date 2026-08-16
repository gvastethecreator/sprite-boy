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

const DESKTOP_SCREENSHOT = "artifacts/quality/EDITOR/2026-07-30/b1-00-canvas-grid.png";
const NARROW_SCREENSHOT = "artifacts/quality/EDITOR/2026-07-30/b1-00-canvas-grid-narrow.png";
const SETTINGS_SCREENSHOT = "artifacts/quality/EDITOR/2026-07-30/b1-00-canvas-settings-narrow.png";

async function capture(client, outputPath) {
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes);
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function injectImage(client, input) {
  const result = await client.evaluate(`(async () => {
    const cellIndex = ${input.cellIndex};
    const source = document.createElement('canvas');
    source.width = 96;
    source.height = 48;
    const context = source.getContext('2d');
    if (!context) return { ok: false, reason: 'canvas-2d' };
    context.fillStyle = '${input.color}';
    context.fillRect(0, 0, 96, 48);
    context.fillStyle = '#ffffff';
    context.fillRect(${input.cellIndex === 0 ? 8 : 56}, 8, 32, 32);
    const blob = await new Promise((resolveBlob) => source.toBlob(resolveBlob, 'image/png'));
    if (!(blob instanceof Blob)) return { ok: false, reason: 'blob' };
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], '${input.name}', { type: 'image/png', lastModified: cellIndex + 1 }));
    if ('${input.method}' === 'drop') {
      const target = document.querySelector('[data-compose-grid-cell="${input.cellIndex}"]');
      if (!(target instanceof HTMLElement)) return { ok: false, reason: 'drop-target' };
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return { ok: true, method: 'drop' };
    }
    const add = document.querySelector('button[aria-label^="Add image to cell ${input.cellIndex + 1},"]');
    const file = document.querySelector('input[aria-label="Import images into Compose"]');
    if (!(add instanceof HTMLButtonElement) || !(file instanceof HTMLInputElement)) {
      return { ok: false, reason: 'picker-target' };
    }
    add.focus();
    add.click();
    Object.defineProperty(file, 'files', { configurable: true, value: transfer.files });
    file.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, method: 'picker' };
  })()`);
  if (!result?.ok) throw new Error(`Compose image injection failed: ${JSON.stringify(result)}`);
  return result;
}

export async function runComposeBootstrapBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const desktopPath = resolve(cwd, options.desktopScreenshot ?? DESKTOP_SCREENSHOT);
  const narrowPath = resolve(cwd, options.narrowScreenshot ?? NARROW_SCREENSHOT);
  const settingsPath = resolve(cwd, options.settingsScreenshot ?? SETTINGS_SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-canvas-first-browser-"));
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

    stage = "blank-canvas";
    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await client.waitFor(`Boolean(document.querySelector('[data-compose-canvas-stage]'))`, 60_000);
    stage = "blank-settings";
    await client.waitFor(`Boolean(document.querySelector('form[aria-label="Canvas settings"]'))`, 60_000);
    const empty = await client.evaluate(`(() => ({
      route: location.hash,
      heading: document.querySelector('#compose-canvas-title')?.textContent?.trim() ?? null,
      mode: document.querySelector('[data-compose-layout-mode]')?.getAttribute('data-compose-layout-mode'),
      size: document.querySelector('[data-compose-layout-mode]')?.innerText?.match(/\\d+\\s*×\\s*\\d+/)?.[0] ?? null,
      layerCount: document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length,
      dropSurface: Boolean(document.querySelector('[data-compose-drop-surface]')),
      lightweightCanvas: Boolean(document.querySelector('[data-compose-lightweight-canvas]')),
      settings: Boolean(document.querySelector('form[aria-label="Canvas settings"]')),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }))()`);

    stage = "rename-project";
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`Boolean(document.querySelector('[data-project-rename-trigger]'))`);
    await client.evaluate(`document.querySelector('[data-project-rename-trigger]')?.click()`);
    await client.waitFor(`Boolean(document.querySelector('#studio-project-name'))`);
    const renamed = await client.evaluate(`(() => {
      const input = document.querySelector('#studio-project-name');
      if (!(input instanceof HTMLInputElement)) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Canvas Studio');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.closest('form')?.requestSubmit();
      return true;
    })()`);
    if (!renamed) throw new Error("Project rename controls are unavailable.");
    await client.waitFor(`document.querySelector('button[aria-label="Project"]')?.textContent?.includes('Canvas Studio')`);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    stage = "recover-invalid-image";
    const invalidInjected = await client.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Import images into Compose"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'broken.png', { type: 'image/png' }));
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!invalidInjected) throw new Error("Invalid image fixture could not be injected.");
    await client.waitFor(`document.querySelector('[data-compose-canvas-first] [role="alert"]')?.textContent?.includes('could not be decoded')`, 60_000);
    const recovery = await client.evaluate(`(() => {
      const alert = document.querySelector('[data-compose-canvas-first] [role="alert"]');
      return {
        focused: document.activeElement === alert,
        canvasPreserved: Boolean(document.querySelector('[data-compose-canvas-stage]')),
        chooseAnother: Boolean([...alert.querySelectorAll('button')].find((button) => button.textContent?.includes('Choose another'))),
      };
    })()`);

    stage = "grid-imports";
    await client.evaluate(`[...document.querySelectorAll('[role="radio"]')].find((button) => button.textContent?.includes('Grid'))?.click()`);
    await client.waitFor(`document.querySelectorAll('[data-compose-grid-cell]').length === 4`);
    await client.evaluate(`(() => {
      const first = document.querySelector('[data-compose-grid-cell="0"]');
      if (!(first instanceof HTMLButtonElement)) return false;
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      return true;
    })()`);
    await client.waitFor(`document.activeElement === document.querySelector('[data-compose-grid-cell="1"]') && document.activeElement?.getAttribute('aria-selected') === 'true'`);
    await client.evaluate(`document.querySelector('[data-compose-grid-cell="1"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))`);
    await client.waitFor(`document.activeElement === document.querySelector('[data-compose-grid-cell="0"]') && document.activeElement?.getAttribute('aria-selected') === 'true'`);
    const keyboardNavigation = await client.evaluate(`(() => ({
      ok: document.activeElement === document.querySelector('[data-compose-grid-cell="0"]'),
      tabStops: [...document.querySelectorAll('[data-compose-grid-cell]')].filter((cell) => cell.tabIndex === 0).length,
    }))()`);
    stage = "grid-first-import";
    const firstImport = await injectImage(client, { cellIndex: 0, name: "hero-a.png", color: "#6d5dfc", method: "drop" });
    await client.waitFor(`document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length === 1`, 60_000);
    stage = "grid-second-import";
    const secondImport = await injectImage(client, { cellIndex: 1, name: "hero-b.png", color: "#ef5da8", method: "picker" });
    await client.waitFor(`document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length === 2`, 60_000);
    stage = "success-focus";
    await client.waitFor(`document.activeElement?.getAttribute('aria-label')?.startsWith('Add image to cell 2,')`, 30_000);
    const successFocus = await client.evaluate(`document.activeElement?.getAttribute('aria-label') ?? null`);
    await client.waitFor(`document.querySelector('[data-compose-grid-cell="0"]')?.getAttribute('data-compose-cell-occupancy') === '1' && document.querySelector('[data-compose-grid-cell="1"]')?.getAttribute('data-compose-cell-occupancy') === '1'`);

    stage = "resize-canvas";
    const settingsApplied = await client.evaluate(`(() => {
      const ratio = document.querySelector('select[id^="composition-ratio-"]');
      if (!(ratio instanceof HTMLSelectElement)) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(ratio, '16:9');
      ratio.dispatchEvent(new Event('change', { bubbles: true }));
      ratio.closest('form')?.requestSubmit();
      return true;
    })()`);
    if (!settingsApplied) throw new Error("Canvas settings controls are unavailable.");
    await client.waitFor(`document.querySelector('[data-compose-layout-mode]')?.innerText?.includes('512 × 288')`, 60_000);
    await client.waitFor(`document.querySelector('input[aria-label="Layer Y"]')?.value === '72'`, 60_000);
    await client.waitForNetworkIdle();

    const composed = await client.evaluate(`(() => ({
      projectName: document.querySelector('button[aria-label="Project"]')?.textContent?.trim() ?? null,
      mode: document.querySelector('[data-compose-layout-mode]')?.getAttribute('data-compose-layout-mode'),
      rows: document.querySelector('select[aria-label="Grid rows"]')?.value,
      columns: document.querySelector('select[aria-label="Grid columns"]')?.value,
      size: document.querySelector('[data-compose-layout-mode]')?.innerText?.match(/\\d+\\s*×\\s*\\d+/)?.[0] ?? null,
      layerCount: document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length,
      occupiedCells: [...document.querySelectorAll('[data-compose-grid-cell]')].filter((cell) => cell.getAttribute('data-compose-cell-occupancy') === '1').length,
      selectedLayerY: document.querySelector('input[aria-label="Layer Y"]')?.value,
      fileInputCount: document.querySelectorAll('input[aria-label="Import images into Compose"]').length,
      durableUrlText: /(?:blob:|data:image)/.test(document.body.innerText),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }))()`);
    const accessibility = summarizeAccessibilityTree((await client.send("Accessibility.getFullAXTree")).nodes);
    const desktop = await capture(client, desktopPath);

    stage = "edit-layer-controls";
    const layerControlsApplied = await client.evaluate(`(() => {
      const x = document.querySelector('input[aria-label="Layer X"]');
      const opacity = document.querySelector('input[aria-label="Layer opacity"]');
      if (!(x instanceof HTMLInputElement) || !(opacity instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(x, '380');
      x.dispatchEvent(new Event('input', { bubbles: true }));
      x.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      x.blur();
      setter?.call(opacity, '55');
      const opacityRoot = opacity.closest('[data-toolcraft-slider]');
      opacityRoot?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
      opacityRoot?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      const hide = document.querySelector('button[aria-label^="Hide "]');
      const lock = document.querySelector('button[aria-label^="Lock "]');
      if (!(hide instanceof HTMLButtonElement) || !(lock instanceof HTMLButtonElement)) return false;
      hide.click();
      lock.click();
      return true;
    })()`);
    if (!layerControlsApplied) throw new Error("Compose layer controls were unavailable.");
    await client.waitFor(`document.querySelector('input[aria-label="Layer X"]')?.value === '380' && document.querySelector('input[aria-label="Layer opacity"]')?.value === '55' && Boolean(document.querySelector('button[aria-label^="Show "]')) && Boolean(document.querySelector('button[aria-label^="Unlock "]'))`);
    const layerEdits = await client.evaluate(`(() => ({
      x: document.querySelector('input[aria-label="Layer X"]')?.value,
      opacity: document.querySelector('input[aria-label="Layer opacity"]')?.value,
      hidden: Boolean(document.querySelector('button[aria-label^="Show "]')),
      locked: Boolean(document.querySelector('button[aria-label^="Unlock "]')),
      detached: !document.body.innerText.includes('A position or scale change detaches this layer from the cell.'),
    }))()`);
    stage = "save-layer-controls";
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`Boolean(document.querySelector('[data-command-id="project.save"]:not(:disabled)'))`);
    await client.evaluate(`document.querySelector('[data-command-id="project.save"]')?.click()`);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`document.body.innerText.includes('Saved locally')`, 60_000);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    stage = "reload";
    await client.send("Page.reload", { ignoreCache: false });
    await client.waitFor(`document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length === 2`, 60_000);
    await client.waitFor(`document.querySelectorAll('[data-compose-grid-cell]').length === 4`, 60_000);
    const reloaded = await client.evaluate(`(() => ({
      route: location.hash,
      projectName: document.querySelector('button[aria-label="Project"]')?.textContent?.trim() ?? null,
      mode: document.querySelector('[data-compose-layout-mode]')?.getAttribute('data-compose-layout-mode'),
      size: document.querySelector('[data-compose-layout-mode]')?.innerText?.match(/\\d+\\s*×\\s*\\d+/)?.[0] ?? null,
      layerCount: document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length,
      occupiedCells: [...document.querySelectorAll('[data-compose-grid-cell]')].filter((cell) => cell.getAttribute('data-compose-cell-occupancy') === '1').length,
      selectedLayerY: document.querySelector('input[aria-label="Layer Y"]')?.value,
      selectedLayerX: document.querySelector('input[aria-label="Layer X"]')?.value,
      selectedLayerOpacity: document.querySelector('input[aria-label="Layer opacity"]')?.value,
      selectedLayerHidden: Boolean(document.querySelector('button[aria-label^="Show "]')),
      selectedLayerLocked: Boolean(document.querySelector('button[aria-label^="Unlock "]')),
    }))()`);
    const durableAssets = await client.evaluate(`(async () => {
      const projectId = localStorage.getItem('sprite-boy-studio:active-project:v1');
      if (!projectId) return [];
      const database = await new Promise((resolveDatabase, reject) => {
        const request = indexedDB.open('sprite-boy-studio-assets');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolveDatabase(request.result);
      });
      try {
        const entries = await new Promise((resolveEntries, reject) => {
          const transaction = database.transaction('asset-metadata', 'readonly');
          const request = transaction.objectStore('asset-metadata').index('by-project').getAll(projectId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolveEntries(request.result);
        });
        return entries
          .map((entry) => entry.record)
          .map((record) => ({ name: record.name, width: record.width, height: record.height }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } finally {
        database.close();
      }
    })()`);

    await client.evaluate(`document.querySelector('button[aria-label^="Unlock "]')?.click(); document.querySelector('button[aria-label^="Show "]')?.click();`);
    await client.waitFor(`Boolean(document.querySelector('button[aria-label^="Lock "]')) && Boolean(document.querySelector('button[aria-label^="Hide "]'))`);

    stage = "narrow";
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    await client.waitFor(`innerWidth === 390 && document.querySelectorAll('[data-compose-grid-cell]').length === 4`);
    const narrowState = await client.evaluate(`(() => ({
      canvas: Boolean(document.querySelector('[data-compose-canvas-stage]')),
      canvasSettingsButton: Boolean([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Canvas settings')),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }))()`);
    const narrow = await capture(client, narrowPath);
    await client.evaluate(`([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Canvas settings'))?.click()`);
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"] form[aria-label="Canvas settings"]'))`, 30_000);
    const settings = await capture(client, settingsPath);

    const runtime = {
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    };
    if (
      empty.route !== "#/studio/compose" || empty.heading !== "Untitled composition" || empty.mode !== "free" ||
      empty.size !== "512 × 512" || empty.layerCount !== 0 || !empty.dropSurface || !empty.lightweightCanvas || !empty.settings ||
      empty.horizontalOverflow || empty.verticalOverflow ||
      !recovery.focused || !recovery.canvasPreserved || !recovery.chooseAnother ||
      !keyboardNavigation.ok || keyboardNavigation.tabStops !== 1 ||
      firstImport.method !== "drop" || secondImport.method !== "picker" ||
      !successFocus?.startsWith("Add image to cell 2,") ||
      !composed.projectName?.includes("Canvas Studio") || composed.mode !== "grid" || composed.rows !== "2" ||
      composed.columns !== "2" || composed.size !== "512 × 288" || composed.layerCount !== 2 ||
      composed.occupiedCells !== 2 || composed.selectedLayerY !== "72" || composed.fileInputCount !== 1 ||
      composed.durableUrlText || composed.horizontalOverflow || composed.verticalOverflow ||
      accessibility.unlabeledInteractiveCount !== 0 || accessibility.mainLandmarkCount !== 1 ||
      reloaded.route !== "#/studio/compose" || !reloaded.projectName?.includes("Canvas Studio") ||
      reloaded.mode !== "grid" || reloaded.size !== "512 × 288" || reloaded.layerCount !== 2 ||
      reloaded.occupiedCells !== 2 || reloaded.selectedLayerY !== "72" ||
      layerEdits.x !== "380" || layerEdits.opacity !== "55" || !layerEdits.hidden || !layerEdits.locked || !layerEdits.detached ||
      reloaded.selectedLayerX !== "380" || reloaded.selectedLayerOpacity !== "55" || !reloaded.selectedLayerHidden || !reloaded.selectedLayerLocked ||
      JSON.stringify(durableAssets) !== JSON.stringify([
        { name: "hero-a.png", width: 96, height: 48 },
        { name: "hero-b.png", width: 96, height: 48 },
      ]) ||
      !narrowState.canvas || !narrowState.canvasSettingsButton || narrowState.horizontalOverflow || narrowState.verticalOverflow ||
      Object.values(runtime).some((count) => count !== 0)
    ) {
      throw new Error(`Canvas-first browser evidence failed closed: ${JSON.stringify({
        empty, recovery, keyboardNavigation, firstImport, secondImport, successFocus, composed, layerEdits, accessibility, reloaded, durableAssets, narrowState, runtime,
      })}`);
    }

    stage = "accepted";
    return Object.freeze({
      status: "pass",
      url: `${baseUrl}/#/studio/compose`,
      viewports: ["1440x900", "390x844"],
      empty,
      recovery,
      keyboardNavigation,
      imports: [firstImport, secondImport],
      successFocus,
      composed,
      layerEdits,
      accessibility,
      reloaded,
      durableAssets,
      narrow: narrowState,
      desktopScreenshot: { path: desktopPath, ...desktop },
      narrowScreenshot: { path: narrowPath, ...narrow },
      settingsScreenshot: { path: settingsPath, ...settings },
      ...runtime,
    });
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "Canvas-first browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runComposeBootstrapBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Canvas-first browser gate failed."}\n`);
    process.exitCode = 1;
  }
}
