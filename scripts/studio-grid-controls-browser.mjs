/** G2-03 production-Chrome journey for Slice grid controls and preview Worker. */
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
  runWithBrowserRuntimeDeadline,
  spawnViteServer,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";

const HOST = "127.0.0.1";
const DEADLINE_MS = 60_000;

async function captureScreenshot(client, path) {
  if (!path) return;
  const outputPath = resolve(path);
  const capture = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, Buffer.from(capture.data, "base64"));
}

async function selectGridSource(client, name, cloneDelayMs, workerMessageDelayMs) {
  return client.evaluate(`(async () => {
    globalThis.__gridProbe.cloneDelayMs = ${JSON.stringify(cloneDelayMs)};
    globalThis.__gridProbe.workerMessageDelayMs = ${JSON.stringify(workerMessageDelayMs)};
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.clearRect(0, 0, 400, 200);
    const colors = ["#f43f5e", "#22c55e", "#38bdf8", "#f59e0b"];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        context.fillStyle = colors[(row + col) % colors.length];
        context.fillRect(10 + col * 100, 10 + row * 100, 80, 80);
      }
    }
    const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], ${JSON.stringify(name)}, { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function resetSource(client) {
  const opened = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === "Reset source");
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error("Reset source action is unavailable.");
  await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]'))`);
  const confirmed = await client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]');
    const button = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent?.trim() === "Reset source");
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!confirmed) throw new Error("Reset source confirmation is unavailable.");
  await client.waitFor(`Boolean(document.querySelector("[data-slice-source-dropzone]"))`);
}

export async function runGridControlsBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-grid-controls-chrome-"));
  let preview;
  let chrome;
  let client;

  return runWithBrowserRuntimeDeadline(async () => {
    preview = spawnViteServer(cwd, port, "preview");
    await waitForPreview(baseUrl, preview);
    chrome = spawn(chromePath, [
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
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profileDirectory, chrome);
    client = await connectToPage(devToolsPort);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const NativeWorker = globalThis.Worker;
        const nativeCreateImageBitmap = globalThis.createImageBitmap.bind(globalThis);
        const probe = globalThis.__gridProbe = {
          cloneDelayMs: 0,
          workerMessageDelayMs: 0,
          cloneCalls: 0,
          workersCreated: 0,
          workersTerminated: 0,
          workerModuleUrls: [],
          bitmapTransfers: 0,
          ownerTransferred: 0,
          cancelledPendingMessages: 0,
          lastOwner: null,
          lastClone: null,
        };
        globalThis.createImageBitmap = async (...args) => {
          const cloningOwner = args[0] instanceof ImageBitmap;
          if (cloningOwner) {
            probe.cloneCalls += 1;
            if (probe.cloneDelayMs > 0) {
              await new Promise((resolveDelay) => setTimeout(resolveDelay, probe.cloneDelayMs));
            }
          }
          const bitmap = await nativeCreateImageBitmap(...args);
          if (!cloningOwner) probe.lastOwner = bitmap;
          if (cloningOwner) {
            probe.lastClone = bitmap;
          }
          return bitmap;
        };
        globalThis.Worker = class TrackingWorker extends NativeWorker {
          constructor(url, options) {
            super(url, options);
            this.__gridTarget = String(url).includes("gridPreviewInference.worker");
            this.__listenerMap = new Map();
            this.__timers = new Set();
            this.__terminated = false;
            if (this.__gridTarget) {
              probe.workersCreated += 1;
              probe.workerModuleUrls.push(String(url));
            }
          }
          addEventListener(type, listener, options) {
            if (!this.__gridTarget || type !== "message") {
              return super.addEventListener(type, listener, options);
            }
            const wrapped = (event) => {
              const delay = probe.workerMessageDelayMs;
              if (delay <= 0) return listener.call(this, event);
              const timer = setTimeout(() => {
                this.__timers.delete(timer);
                if (!this.__terminated) listener.call(this, event);
              }, delay);
              this.__timers.add(timer);
            };
            this.__listenerMap.set(listener, wrapped);
            return super.addEventListener(type, wrapped, options);
          }
          removeEventListener(type, listener, options) {
            const wrapped = this.__listenerMap.get(listener) ?? listener;
            this.__listenerMap.delete(listener);
            return super.removeEventListener(type, wrapped, options);
          }
          postMessage(message, transfer) {
            if (this.__gridTarget && message?.type === "infer") {
              const bitmap = message.source?.kind === "bitmap" ? message.source.bitmap : null;
              probe.bitmapTransfers += Array.isArray(transfer) && transfer.includes(bitmap) ? 1 : 0;
              probe.ownerTransferred += bitmap && bitmap === probe.lastOwner ? 1 : 0;
            }
            return super.postMessage(message, transfer);
          }
          terminate() {
            if (this.__gridTarget && !this.__terminated) {
              probe.workersTerminated += 1;
              probe.cancelledPendingMessages += this.__timers.size > 0 ? 1 : 0;
            }
            this.__terminated = true;
            for (const timer of this.__timers) clearTimeout(timer);
            this.__timers.clear();
            return super.terminate();
          }
        };
      })();`,
    });
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === "complete" && Boolean(
      document.querySelector("[data-slice-source-dropzone]"),
    )`);
    await client.waitForNetworkIdle();

    if (await selectGridSource(client, "clone-cancel.png", 800, 0) !== true) {
      throw new Error("Clone cancellation fixture could not start.");
    }
    await client.waitFor(`Boolean(document.querySelector("[data-slice-grid-inspector]"))`);
    await client.waitFor("globalThis.__gridProbe.cloneCalls > 0");
    await resetSource(client);
    await client.evaluate("new Promise((resolveDelay) => setTimeout(resolveDelay, 950))");
    const lateCloneSuppressed = await client.evaluate(`(() => {
      const probe = globalThis.__gridProbe;
      return probe.cloneCalls > 0 && probe.workersCreated === 0 &&
        Boolean(document.querySelector("[data-slice-source-dropzone]")) &&
        !document.querySelector("[data-slice-grid-inspector]");
    })()`);

    if (await selectGridSource(client, "worker-cancel.png", 0, 1200) !== true) {
      throw new Error("Worker cancellation fixture could not start.");
    }
    await client.waitFor(`globalThis.__gridProbe.workersCreated > 0 &&
      document.querySelector('[data-slice-grid-inspector] [role="status"]')?.textContent?.includes("Detecting grid")`);
    await client.waitFor("globalThis.__gridProbe.bitmapTransfers > 0");
    await client.evaluate("new Promise((resolveDelay) => setTimeout(resolveDelay, 350))");
    await resetSource(client);
    const workerCancelled = await client.evaluate(
      "globalThis.__gridProbe.workersTerminated > 0",
    );

    if (await selectGridSource(client, "detected-2x4.png", 0, 0) !== true) {
      throw new Error("Detected-grid fixture could not start.");
    }
    await client.waitFor(`(() => {
      const status = document.querySelector('[data-slice-grid-inspector] [role="status"]');
      return status?.getAttribute("data-grid-inference-origin") === "detected" &&
        status.textContent?.includes("Detected 2 rows × 4 columns") &&
        status.textContent?.includes("8 cells");
    })()`);
    const desktop = await client.evaluate(`(() => {
      const inspector = document.querySelector("[data-slice-grid-inspector]");
      const text = document.body.innerText;
      const probe = globalThis.__gridProbe;
      return {
        inspectorVisible: Boolean(inspector && inspector.getBoundingClientRect().width > 0),
        legacyGridQuarantined: !text.includes("Grid Layout") && !text.includes("Sync Grids"),
        detectedOrigin: inspector?.getAttribute("data-grid-inference-origin"),
        realModuleWorker: probe.workerModuleUrls.some((url) => url.includes("gridPreviewInference.worker")),
        cloneTransferred: probe.bitmapTransfers > 0,
        ownerTransferred: probe.ownerTransferred,
        ownerStillReadable: probe.lastOwner instanceof ImageBitmap && probe.lastOwner.width === 400,
      };
    })()`);

    await client.evaluate(`(() => {
      const manual = document.querySelector('[data-slice-grid-inspector] input[type="radio"][value="manual"]');
      manual?.click();
      const rows = document.querySelector('[data-slice-grid-inspector] input[type="number"]');
      if (!(rows instanceof HTMLInputElement)) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(rows, "0");
      rows.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector] input[type="number"]')
      ?.getAttribute("aria-invalid") === "true"`);
    const invalidAttemptVisible = true;

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.waitFor(`Boolean(Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Properties"))`);
    await client.evaluate(`Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Properties")?.click()`);
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"] [data-slice-grid-inspector]'))`);
    const compactDrawerVisible = true;

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.waitFor(`Boolean(document.querySelector('[data-slice-grid-inspector]')) &&
      !document.querySelector('[role="dialog"] [data-slice-grid-inspector]')`);
    await captureScreenshot(client, options.screenshotPath);
    await client.evaluate("new Promise((resolveDelay) => setTimeout(resolveDelay, 150))");
    const lifecycle = await client.evaluate(`(() => {
      const probe = globalThis.__gridProbe;
      return {
        workersCreated: probe.workersCreated,
        workersTerminated: probe.workersTerminated,
        cancelledPendingMessages: probe.cancelledPendingMessages,
        pageFits: document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
        route: location.hash,
      };
    })()`);

    const errors = {
      console: client.consoleErrorCount,
      exception: client.exceptionCount,
      log: client.logErrorCount,
      network: client.networkFailureCount,
      http: client.httpErrorCount,
    };
    const passed = lateCloneSuppressed && workerCancelled && desktop.inspectorVisible &&
      desktop.legacyGridQuarantined && desktop.detectedOrigin === "detected" &&
      desktop.realModuleWorker && desktop.cloneTransferred && desktop.ownerTransferred === 0 &&
      desktop.ownerStillReadable && invalidAttemptVisible && compactDrawerVisible &&
      lifecycle.cancelledPendingMessages > 0 &&
      lifecycle.workersCreated === lifecycle.workersTerminated && lifecycle.pageFits &&
      lifecycle.route === "#/studio/slice" && Object.values(errors).every((value) => value === 0);
    return {
      schemaVersion: 1,
      check: "slice-grid-controls-browser",
      status: passed ? "pass" : "fail",
      metrics: {
        lateCloneSuppressed,
        workerCancelled,
        ...desktop,
        invalidAttemptVisible,
        compactDrawerVisible,
        ...lifecycle,
        errors,
      },
    };
  }, () => cleanupBrowserRuntime(
    client,
    chrome,
    preview,
    profileDirectory,
    "Grid controls browser runtime cleanup failed.",
  ), DEADLINE_MS);
}

export async function runGridControlsBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runGridControlsBrowser({
      screenshotPath: process.env.STUDIO_GRID_CONTROLS_SCREENSHOT,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch (error) {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "slice-grid-controls-browser",
      status: "fail",
      reason: error instanceof Error ? error.message : "browser-journey-unavailable",
    })}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) process.exitCode = await runGridControlsBrowserCli();
