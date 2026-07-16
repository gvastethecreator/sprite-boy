/** G0-02 production-Chrome journey for the native Slice source boundary. */
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
const RUNTIME_DEADLINE_MS = 50_000;

export function evaluateSliceSourceEvidence(evidence) {
  if (
    evidence === null || typeof evidence !== "object" ||
    typeof evidence.busyAnnounced !== "boolean" ||
    typeof evidence.replacementRaceRecovered !== "boolean" ||
    typeof evidence.metadataVisible !== "boolean" ||
    typeof evidence.previewLeaseReleased !== "boolean" ||
    typeof evidence.canvasVisible !== "boolean" ||
    typeof evidence.dropzoneRemoved !== "boolean" ||
    typeof evidence.focusRestored !== "boolean" ||
    typeof evidence.pageFits !== "boolean" ||
    typeof evidence.route !== "string"
  ) {
    throw new TypeError("Slice source browser evidence is invalid.");
  }
  const errors = Object.freeze({
    console: evidence.consoleErrorCount,
    exception: evidence.exceptionCount,
    log: evidence.logErrorCount,
    network: evidence.networkFailureCount,
    http: evidence.httpErrorCount,
  });
  if (Object.values(errors).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("Slice source browser diagnostics are invalid.");
  }
  const passed = evidence.busyAnnounced && evidence.replacementRaceRecovered &&
    evidence.metadataVisible && evidence.previewLeaseReleased &&
    evidence.canvasVisible && evidence.dropzoneRemoved &&
    evidence.focusRestored && evidence.pageFits && evidence.route === "#/studio/slice" &&
    Object.values(errors).every((value) => value === 0);
  return Object.freeze({
    schemaVersion: 1,
    check: "slice-source-browser",
    status: passed ? "pass" : "fail",
    metrics: Object.freeze({
      busyAnnounced: evidence.busyAnnounced,
      replacementRaceRecovered: evidence.replacementRaceRecovered,
      metadataVisible: evidence.metadataVisible,
      previewLeaseReleased: evidence.previewLeaseReleased,
      canvasVisible: evidence.canvasVisible,
      dropzoneRemoved: evidence.dropzoneRemoved,
      focusRestored: evidence.focusRestored,
      pageFits: evidence.pageFits,
      route: evidence.route,
      errors,
    }),
  });
}

async function captureScreenshot(client, screenshotPath) {
  if (!screenshotPath) return;
  const outputPath = resolve(screenshotPath);
  const capture = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, Buffer.from(capture.data, "base64"));
}

async function selectGeneratedPng(client) {
  return client.evaluate(`(async () => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const nativeCreateImageBitmap = globalThis.createImageBitmap.bind(globalThis);
    globalThis.createImageBitmap = async (...args) => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
      return nativeCreateImageBitmap(...args);
    };
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#ff2f81";
    context.fillRect(0, 0, 32, 32);
    context.fillStyle = "#38bdf8";
    context.fillRect(32, 0, 32, 32);
    const blob = await new Promise((resolvePromise) => canvas.toBlob(resolvePromise, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "browser-source.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function startSlowCommit(client) {
  return client.evaluate(`(async () => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const nativeReadAsDataUrl = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      if (blob instanceof File && blob.name === "slow-valid.png") {
        setTimeout(() => Reflect.apply(nativeReadAsDataUrl, this, [blob]), 500);
        return;
      }
      Reflect.apply(nativeReadAsDataUrl, this, [blob]);
    };
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#a855f7";
    context.fillRect(0, 0, 32, 32);
    const validBlob = await new Promise((resolvePromise) => canvas.toBlob(resolvePromise, "image/png"));
    if (!(validBlob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([validBlob], "slow-valid.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function replaceWithInvalidSource(client) {
  return client.evaluate(`(() => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["not a png"], "replacement-invalid.png", {
      type: "image/png",
    }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

export async function runSliceSourceBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-slice-source-chrome-"));
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
        const nativeCreate = URL.createObjectURL.bind(URL);
        const nativeRevoke = URL.revokeObjectURL.bind(URL);
        globalThis.__spriteBoySlicePreviewUrls = { created: [], revoked: [] };
        URL.createObjectURL = (blob) => {
          const url = nativeCreate(blob);
          globalThis.__spriteBoySlicePreviewUrls.created.push(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          globalThis.__spriteBoySlicePreviewUrls.revoked.push(url);
          return nativeRevoke(url);
        };
      })();`,
    });
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === "complete" && Boolean(
      document.querySelector("[data-slice-source-dropzone]"),
    )`);
    await client.waitForNetworkIdle();
    if (await startSlowCommit(client) !== true) {
      throw new Error("Slice replacement-race fixture is unavailable.");
    }
    await client.waitFor(`(() => {
      const preview = document.querySelector("[data-slice-source-preview]");
      return preview?.getAttribute("aria-busy") === "true" &&
        preview.textContent?.includes("Opening the validated source in Slice");
    })()`);
    const previewUrlCaptured = await client.evaluate(`(() => {
      const image = document.querySelector('[data-slice-source-preview] img');
      if (!(image instanceof HTMLImageElement) || !image.src.startsWith("blob:")) return false;
      globalThis.__spriteBoySlicePreviewProofUrl = image.src;
      return true;
    })()`);
    if (!previewUrlCaptured) throw new Error("Slice preview lease URL is unavailable.");
    if (await replaceWithInvalidSource(client) !== true) {
      throw new Error("Slice invalid replacement fixture is unavailable.");
    }
    await client.waitFor(`(() => {
      const dropzone = document.querySelector("[data-slice-source-dropzone]");
      const alert = dropzone?.querySelector('[role="alert"]');
      const button = dropzone?.querySelector("button");
      return Boolean(alert?.textContent?.includes("do not match")) &&
        dropzone?.getAttribute("aria-busy") !== "true" &&
        button instanceof HTMLButtonElement && !button.disabled;
    })()`);
    const replacementRaceRecovered = true;
    if (await selectGeneratedPng(client) !== true) {
      throw new Error("Slice source picker input is unavailable.");
    }
    await client.waitFor(`document.querySelector("[data-slice-source-dropzone]")?.getAttribute("aria-busy") === "true"`);
    const busyAnnounced = true;
    await client.waitFor(`Boolean(document.querySelector('[aria-label="Canvas workspace"] canvas')) &&
      !document.querySelector("[data-slice-source-dropzone]")`);
    await client.waitFor(`document.body.innerText.includes("Imported browser-source.png")`);
    await client.evaluate("new Promise((resolvePromise) => setTimeout(resolvePromise, 3200))");
    await captureScreenshot(client, options.screenshotPath);

    const page = await client.evaluate(`(() => {
      const content = document.querySelector('[data-studio-workspace-content="slice"]');
      const canvas = document.querySelector('[aria-label="Canvas workspace"] canvas');
      const metadata = document.querySelector("[data-slice-source-metadata]");
      const canvasRect = canvas?.getBoundingClientRect();
      const urlCounts = globalThis.__spriteBoySlicePreviewUrls ?? { created: -1, revoked: -1 };
      const proofUrl = globalThis.__spriteBoySlicePreviewProofUrl;
      return {
        metadataVisible: Boolean(metadata?.textContent?.includes("browser-source.png") &&
          metadata.textContent.includes("64 × 32") && metadata.textContent.includes("PNG")),
        canvasVisible: Boolean(canvasRect && canvasRect.width > 0 && canvasRect.height > 0),
        dropzoneRemoved: !document.querySelector("[data-slice-source-dropzone]"),
        focusRestored: document.activeElement === content,
        pageFits: document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
        route: location.hash,
        previewLeaseReleased: typeof proofUrl === "string" &&
          Array.isArray(urlCounts.revoked) && urlCounts.revoked.includes(proofUrl),
      };
    })()`);
    return evaluateSliceSourceEvidence({
      busyAnnounced,
      replacementRaceRecovered,
      ...page,
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    });
  }, () => cleanupBrowserRuntime(
    client,
    chrome,
    preview,
    profileDirectory,
    "Slice source browser runtime cleanup failed.",
  ), RUNTIME_DEADLINE_MS);
}

export async function runSliceSourceBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runSliceSourceBrowser({
      screenshotPath: process.env.STUDIO_SLICE_SOURCE_SCREENSHOT,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch (error) {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "slice-source-browser",
      status: "fail",
      reason: error instanceof Error ? error.message : "browser-journey-unavailable",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runSliceSourceBrowserCli();
