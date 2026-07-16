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

const DESKTOP_SCREENSHOT = "artifacts/quality/EDITOR/2026-07-16/a1-02-compose-bootstrap.png";
const COMPACT_SCREENSHOT = "artifacts/quality/EDITOR/2026-07-16/a1-02-compose-bootstrap-compact.png";

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

export async function runComposeBootstrapBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const desktopPath = resolve(cwd, options.desktopScreenshot ?? DESKTOP_SCREENSHOT);
  const compactPath = resolve(cwd, options.compactScreenshot ?? COMPACT_SCREENSHOT);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-a102-browser-"));
  let vite;
  let chrome;
  let client;
  let stage = "launch";
  try {
    vite = spawnViteServer(cwd, port, "dev");
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
    stage = "navigate-empty-compose";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/compose` });
    await client.waitFor(`document.body.innerText.includes("Start a composition")`, 60_000);
    stage = "wait-startup-runtime";
    await client.waitFor(`(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Import image');
      return Boolean(button && !button.disabled);
    })()`, 60_000);

    const emptyState = await client.evaluate(`(() => ({
      heading: document.querySelector('#compose-bootstrap-title')?.textContent?.trim(),
      importLabel: document.querySelector('input[aria-label="Import image into Compose"]')?.getAttribute('accept'),
      projectButton: document.querySelector('button[aria-label="Project"]')?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight
    }))()`);

    stage = "open-rename";
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`Boolean(document.querySelector('[data-project-rename-trigger]'))`);
    await client.evaluate(`document.querySelector('[data-project-rename-trigger]')?.click()`);
    await client.waitFor(`Boolean(document.querySelector('#studio-project-name'))`);
    const renamed = await client.evaluate(`(() => {
      const input = document.querySelector('#studio-project-name');
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Atlas Studio');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.closest('form')?.requestSubmit();
      return true;
    })()`);
    if (!renamed) throw new Error("A1-02 browser rename controls are unavailable.");
    stage = "commit-rename";
    await client.waitFor(`document.querySelector('button[aria-label="Project"]')?.textContent?.includes("Atlas Studio")`);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    stage = "inject-invalid-import";
    const invalidInjected = await client.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Import image into Compose"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const transfer = new DataTransfer();
      transfer.items.add(new File([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      ], 'broken.png', { type: 'image/png', lastModified: 1 }));
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!invalidInjected) throw new Error("A1-02 invalid browser import could not be injected.");
    await client.waitFor(`document.querySelector('main [role="alert"]')?.textContent?.includes("could not be decoded")`, 60_000);
    const invalidFeedback = await client.evaluate(`(() => {
      const alert = document.querySelector('main [role="alert"]');
      return {
        message: alert?.textContent?.trim() ?? null,
        focused: document.activeElement === alert,
      };
    })()`);

    stage = "drop-valid-import";
    const imported = await client.evaluate(`(async () => {
      const target = document.querySelector('section[aria-labelledby="compose-bootstrap-title"]');
      if (!(target instanceof HTMLElement)) return false;
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.fillStyle = '#7c3aed';
      context.fillRect(0, 0, 64, 32);
      context.fillStyle = '#f8fafc';
      context.fillRect(8, 6, 20, 18);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!(blob instanceof Blob)) return false;
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'atlas-hero.png', { type: 'image/png', lastModified: 1 }));
      target.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
      return true;
    })()`);
    if (!imported) throw new Error("A1-02 browser import could not be injected.");
    stage = "wait-composition";
    await client.waitFor(`document.body.innerText.includes("Composition graph ready")`, 60_000);
    const importOutcome = await client.evaluate(`(() => ({
      ready: document.body.innerText.includes('Composition graph ready'),
      alert: document.querySelector('main [role="alert"]')?.textContent?.trim() ?? null,
      mainText: document.querySelector('main')?.innerText?.slice(-500) ?? ''
    }))()`);
    if (!importOutcome.ready) {
      throw new Error(`import failed: ${importOutcome.alert ?? importOutcome.mainText}`);
    }
    stage = "wait-autosave";
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`document.body.innerText.includes("Saved locally")`, 60_000);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    const composed = await client.evaluate(`(() => ({
      heading: document.querySelector('#compose-bootstrap-title')?.textContent?.trim(),
      body: document.body.innerText,
      projectName: document.querySelector('button[aria-label="Project"]')?.textContent?.trim(),
      sourceButtons: document.querySelectorAll('main li button').length,
      settingsVisible: Boolean(document.querySelector('form[aria-label="Canvas settings"]')),
      fileInputCount: document.querySelectorAll('input[aria-label="Import image into Compose"]').length,
      durableUrlText: /(?:blob:|data:image)/.test(document.body.innerText),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight
    }))()`);
    const accessibility = summarizeAccessibilityTree(
      (await client.send("Accessibility.getFullAXTree")).nodes,
    );
    const desktop = await capture(client, desktopPath);

    stage = "reload";
    await client.send("Page.reload", { ignoreCache: false });
    await client.waitFor(`document.body.innerText.includes("Composition graph ready")`, 60_000);
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);
    await client.waitFor(`document.body.innerText.includes("Saved locally")`, 60_000);
    const reloaded = await client.evaluate(`(() => ({
      projectName: document.querySelector('button[aria-label="Project"]')?.textContent?.trim(),
      heading: document.querySelector('#compose-bootstrap-title')?.textContent?.trim(),
      sourceButtons: document.querySelectorAll('main li button').length,
      saved: document.body.innerText.includes('Saved locally'),
      openProjectDisabled: document.querySelector('[data-command-id="project.open"]')?.disabled === true,
      openProjectReason: document.querySelector('[data-command-id="project.open"]')?.getAttribute('title'),
      settingsVisible: Boolean(document.querySelector('form[aria-label="Canvas settings"]'))
    }))()`);
    const durableAsset = await client.evaluate(`(async () => {
      const { IndexedDbAssetRepository } = await import('/core/assets/index.ts');
      const projectId = localStorage.getItem('sprite-boy-studio:active-project:v1');
      if (!projectId) return null;
      const repository = new IndexedDbAssetRepository(projectId);
      try {
        const records = await repository.list();
        if (records.length !== 1) return { count: records.length };
        const record = records[0];
        const blob = await repository.getBlob(record.id);
        return {
          count: 1,
          name: record.name,
          width: record.width,
          height: record.height,
          mimeType: blob.type,
          byteSize: blob.size,
        };
      } finally {
        repository.dispose();
      }
    })()`);
    reloaded.durableAsset = durableAsset;
    await client.evaluate(`document.querySelector('button[aria-label="Project"]')?.click()`);

    stage = "compact";
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.waitFor(`Boolean(document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]'))`);
    const compactOpen = await client.evaluate(`(() => {
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]');
      const properties = toolbar && [...toolbar.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Properties'));
      properties?.click();
      return { toolbar: Boolean(toolbar), properties: Boolean(properties) };
    })()`);
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"] form[aria-label="Canvas settings"]'))`);
    const compact = await client.evaluate(`(() => ({
      dialog: Boolean(document.querySelector('[role="dialog"]')),
      canvasSettings: Boolean(document.querySelector('[role="dialog"] form[aria-label="Canvas settings"]')),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      focusedElement: document.activeElement?.tagName
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
      emptyState.heading !== "Start a composition"
      || emptyState.importLabel !== "image/png,image/jpeg,image/webp"
      || emptyState.horizontalOverflow
      || emptyState.verticalOverflow
      || invalidFeedback.message !== "Image source could not be decoded."
      || !invalidFeedback.focused
      || composed.heading !== "atlas-hero.png composition"
      || !composed.projectName?.includes("Atlas Studio")
      || composed.sourceButtons !== 1
      || composed.fileInputCount !== 1
      || composed.durableUrlText
      || composed.horizontalOverflow
      || composed.verticalOverflow
      || !composed.settingsVisible
      || accessibility.unlabeledInteractiveCount !== 0
      || accessibility.mainLandmarkCount !== 1
      || !reloaded.projectName?.includes("Atlas Studio")
      || reloaded.heading !== "atlas-hero.png composition"
      || reloaded.sourceButtons !== 1
      || !reloaded.saved
      || !reloaded.openProjectDisabled
      || reloaded.openProjectReason !== "Portable project opening is not available in Compose yet."
      || !reloaded.settingsVisible
      || reloaded.durableAsset?.count !== 1
      || reloaded.durableAsset?.name !== "atlas-hero.png"
      || reloaded.durableAsset?.width !== 64
      || reloaded.durableAsset?.height !== 32
      || reloaded.durableAsset?.mimeType !== "image/png"
      || !(reloaded.durableAsset?.byteSize > 8)
      || !compactOpen.toolbar
      || !compactOpen.properties
      || !compact.dialog
      || !compact.canvasSettings
      || compact.horizontalOverflow
      || compact.verticalOverflow
      || Object.values(runtime).some((count) => count !== 0)
    ) throw new Error(`A1-02 browser evidence failed closed: ${JSON.stringify({
      emptyState,
      invalidFeedback,
      composed: { ...composed, body: undefined },
      reloaded,
      compactOpen,
      compact,
      accessibility,
      runtime,
    })}`);

    stage = "accepted";
    return Object.freeze({
      status: "pass",
      url: `${baseUrl}/#/studio/compose`,
      viewports: ["1440x900", "900x700"],
      emptyState,
      invalidFeedback,
      composed: { ...composed, body: undefined },
      accessibility,
      reloaded,
      compact,
      desktopScreenshot: { path: DESKTOP_SCREENSHOT, ...desktop },
      compactScreenshot: { path: COMPACT_SCREENSHOT, ...compactCapture },
      ...runtime,
    });
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : "unknown browser failure"}`);
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "A1-02 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runComposeBootstrapBrowserGate())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "fail",
      check: "a1-02-compose-bootstrap-browser",
      message: error instanceof Error ? error.message : "unknown",
    })}\n`);
    process.exitCode = 1;
  }
}
