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
    typeof evidence.actionsVisible !== "boolean" ||
    typeof evidence.pickerCancelPreserved !== "boolean" ||
    typeof evidence.pickerCancelFocusRestored !== "boolean" ||
    typeof evidence.replaceKeptCurrentSource !== "boolean" ||
    typeof evidence.retryableErrorFocused !== "boolean" ||
    typeof evidence.retryFailureFocusRestored !== "boolean" ||
    typeof evidence.retryBusyBlocksDuplicateActions !== "boolean" ||
    typeof evidence.retrySucceeded !== "boolean" ||
    typeof evidence.retrySuccessFocusRestored !== "boolean" ||
    typeof evidence.resetConfirmationAccessible !== "boolean" ||
    typeof evidence.resetCancelPreserved !== "boolean" ||
    typeof evidence.resetCompleted !== "boolean" ||
    typeof evidence.resetResourceReleased !== "boolean" ||
    typeof evidence.resetFocusRestored !== "boolean" ||
    typeof evidence.preferencesPreserved !== "boolean" ||
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
    evidence.actionsVisible && evidence.pickerCancelPreserved &&
    evidence.pickerCancelFocusRestored && evidence.replaceKeptCurrentSource &&
    evidence.retryableErrorFocused && evidence.retryFailureFocusRestored &&
    evidence.retryBusyBlocksDuplicateActions && evidence.retrySucceeded &&
    evidence.retrySuccessFocusRestored && evidence.resetConfirmationAccessible &&
    evidence.resetCancelPreserved && evidence.resetCompleted &&
    evidence.resetResourceReleased && evidence.resetFocusRestored &&
    evidence.preferencesPreserved &&
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
      actionsVisible: evidence.actionsVisible,
      pickerCancelPreserved: evidence.pickerCancelPreserved,
      pickerCancelFocusRestored: evidence.pickerCancelFocusRestored,
      replaceKeptCurrentSource: evidence.replaceKeptCurrentSource,
      retryableErrorFocused: evidence.retryableErrorFocused,
      retryFailureFocusRestored: evidence.retryFailureFocusRestored,
      retryBusyBlocksDuplicateActions: evidence.retryBusyBlocksDuplicateActions,
      retrySucceeded: evidence.retrySucceeded,
      retrySuccessFocusRestored: evidence.retrySuccessFocusRestored,
      resetConfirmationAccessible: evidence.resetConfirmationAccessible,
      resetCancelPreserved: evidence.resetCancelPreserved,
      resetCompleted: evidence.resetCompleted,
      resetResourceReleased: evidence.resetResourceReleased,
      resetFocusRestored: evidence.resetFocusRestored,
      preferencesPreserved: evidence.preferencesPreserved,
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

async function cancelReplacementPicker(client) {
  return client.evaluate(`(() => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const transfer = new DataTransfer();
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function selectReplacementPng(client) {
  return client.evaluate(`(async () => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const nativeReadAsDataUrl = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      if (blob instanceof File && blob.name === "replacement-source.png") {
        setTimeout(() => Reflect.apply(nativeReadAsDataUrl, this, [blob]), 350);
        return;
      }
      Reflect.apply(nativeReadAsDataUrl, this, [blob]);
    };
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#22c55e";
    context.fillRect(0, 0, 24, 24);
    context.fillStyle = "#f59e0b";
    context.fillRect(24, 0, 24, 24);
    const blob = await new Promise((resolvePromise) => canvas.toBlob(resolvePromise, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "replacement-source.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function selectRetryableReplacement(client) {
  return client.evaluate(`(async () => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#0ea5e9";
    context.fillRect(0, 0, 20, 20);
    context.fillStyle = "#fb7185";
    context.fillRect(20, 0, 20, 20);
    const blob = await new Promise((resolvePromise) => canvas.toBlob(resolvePromise, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "retryable-source.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function clickSliceSourceAction(client, label) {
  return client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.focus({ preventScroll: true });
    button.click();
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
        const nativeCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);
        globalThis.__spriteBoySlicePreviewUrls = { created: [], revoked: [], bitmapClosed: 0 };
        globalThis.__spriteBoySliceDecodeFixture = { failuresRemaining: 0, delayMs: 0 };
        URL.createObjectURL = (blob) => {
          const url = nativeCreate(blob);
          globalThis.__spriteBoySlicePreviewUrls.created.push(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          globalThis.__spriteBoySlicePreviewUrls.revoked.push(url);
          return nativeRevoke(url);
        };
        if (nativeCreateImageBitmap) {
          globalThis.createImageBitmap = async (...args) => {
            if (globalThis.__spriteBoySliceDecodeFixture.delayMs > 0) {
              await new Promise((resolvePromise) => setTimeout(
                resolvePromise,
                globalThis.__spriteBoySliceDecodeFixture.delayMs,
              ));
            }
            if (globalThis.__spriteBoySliceDecodeFixture.failuresRemaining > 0) {
              globalThis.__spriteBoySliceDecodeFixture.failuresRemaining -= 1;
              throw new DOMException("Fixture decode failure", "EncodingError");
            }
            const bitmap = await nativeCreateImageBitmap(...args);
            const nativeClose = bitmap.close.bind(bitmap);
            try {
              Object.defineProperty(bitmap, "close", {
                configurable: true,
                value: () => {
                  globalThis.__spriteBoySlicePreviewUrls.bitmapClosed += 1;
                  return nativeClose();
                },
              });
            } catch {
              // Browser proof still validates URL cleanup if the host object is sealed.
            }
            return bitmap;
          };
        }
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
    const initialPage = await client.evaluate(`(() => {
      const content = document.querySelector('[data-studio-workspace-content="slice"]');
      const canvas = document.querySelector('[aria-label="Canvas workspace"] canvas');
      const metadata = document.querySelector("[data-slice-source-metadata]");
      const actions = document.querySelector('[role="toolbar"][aria-label="Slice source actions"]');
      const canvasRect = canvas?.getBoundingClientRect();
      const urlCounts = globalThis.__spriteBoySlicePreviewUrls ?? { created: -1, revoked: -1 };
      const proofUrl = globalThis.__spriteBoySlicePreviewProofUrl;
      return {
        metadataVisible: Boolean(metadata?.textContent?.includes("browser-source.png") &&
          metadata.textContent.includes("64 × 32") && metadata.textContent.includes("PNG")),
        canvasVisible: Boolean(canvasRect && canvasRect.width > 0 && canvasRect.height > 0),
        dropzoneRemoved: !document.querySelector("[data-slice-source-dropzone]"),
        focusRestored: document.activeElement === content,
        actionsVisible: Boolean(actions?.textContent?.includes("Replace source") &&
          actions.textContent.includes("Reset source")),
        pageFits: document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
        route: location.hash,
        previewLeaseReleased: typeof proofUrl === "string" &&
          Array.isArray(urlCounts.revoked) && urlCounts.revoked.includes(proofUrl),
      };
    })()`);

    if (await clickSliceSourceAction(client, "Replace source") !== true) {
      throw new Error("Slice replace trigger is unavailable for picker-cancel recovery.");
    }
    if (await cancelReplacementPicker(client) !== true) {
      throw new Error("Slice picker-cancel fixture is unavailable.");
    }
    await client.waitFor(`(() => {
      const replace = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Replace source");
      return replace === document.activeElement;
    })()`);
    const pickerCancelPreserved = await client.evaluate(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]");
      return Boolean(metadata?.textContent?.includes("browser-source.png") &&
        document.querySelector('[aria-label="Canvas workspace"] canvas'));
    })()`);
    const pickerCancelFocusRestored = true;

    if (await replaceWithInvalidSource(client) !== true) {
      throw new Error("Slice invalid live replacement fixture is unavailable.");
    }
    await client.waitFor(`(() => {
      const actions = document.querySelector('[role="toolbar"][aria-label="Slice source actions"]')?.parentElement;
      return Boolean(actions?.querySelector('[role="alert"]')?.textContent?.includes("current source was kept"));
    })()`);
    const invalidKeptCurrentSource = await client.evaluate(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]");
      return Boolean(metadata?.textContent?.includes("browser-source.png") &&
        document.querySelector('[aria-label="Canvas workspace"] canvas'));
    })()`);

    if (await selectReplacementPng(client) !== true) {
      throw new Error("Slice valid replacement fixture is unavailable.");
    }
    await client.waitFor(`(() => {
      const status = document.querySelector('[role="toolbar"][aria-label="Slice source actions"]')?.parentElement
        ?.querySelector('[role="status"]');
      const metadata = document.querySelector("[data-slice-source-metadata]");
      return Boolean(status?.textContent?.includes("current source stays active") &&
        metadata?.textContent?.includes("browser-source.png"));
    })()`);
    const busyKeptCurrentSource = true;
    await client.waitFor(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]");
      return Boolean(metadata?.textContent?.includes("replacement-source.png") &&
        metadata.textContent.includes("48 × 24") &&
        document.querySelector('[aria-label="Canvas workspace"] canvas'));
    })()`);
    const replaceKeptCurrentSource = invalidKeptCurrentSource && busyKeptCurrentSource;

    if (await clickSliceSourceAction(client, "Replace source") !== true) {
      throw new Error("Slice replace trigger is unavailable for retry recovery.");
    }
    await client.evaluate(`(() => {
      globalThis.__spriteBoySliceDecodeFixture.failuresRemaining = 2;
      globalThis.__spriteBoySliceDecodeFixture.delayMs = 180;
    })()`);
    if (await selectRetryableReplacement(client) !== true) {
      throw new Error("Slice retryable replacement fixture is unavailable.");
    }
    await client.waitFor(`(() => {
      const retry = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Retry");
      const metadata = document.querySelector("[data-slice-source-metadata]");
      return retry === document.activeElement &&
        Boolean(metadata?.textContent?.includes("replacement-source.png")) &&
        Boolean(document.querySelector('[aria-label="Canvas workspace"] canvas'));
    })()`);
    const retryableErrorFocused = true;

    if (await clickSliceSourceAction(client, "Retry") !== true) {
      throw new Error("Slice retry action is unavailable after retryable decode failure.");
    }
    await client.waitFor(`(() => {
      const retry = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Retry");
      const metadata = document.querySelector("[data-slice-source-metadata]");
      return retry === document.activeElement &&
        Boolean(metadata?.textContent?.includes("replacement-source.png")) &&
        Boolean(document.querySelector('[aria-label="Canvas workspace"] canvas'));
    })()`);
    const retryFailureFocusRestored = true;

    if (await clickSliceSourceAction(client, "Retry") !== true) {
      throw new Error("Slice retry action is unavailable for successful recovery.");
    }
    await client.waitFor(`(() => {
      const status = document.querySelector('[role="toolbar"][aria-label="Slice source actions"]')?.parentElement
        ?.querySelector('[role="status"]');
      const replace = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Replacing…");
      const reset = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Reset source");
      return Boolean(status?.textContent?.includes("current source stays active")) &&
        replace instanceof HTMLButtonElement && replace.disabled &&
        reset instanceof HTMLButtonElement && !reset.disabled;
    })()`);
    const retryBusyBlocksDuplicateActions = true;
    await client.waitFor(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]");
      const content = document.querySelector('[data-studio-workspace-content="slice"]');
      return Boolean(metadata?.textContent?.includes("retryable-source.png") &&
        metadata.textContent.includes("40 × 20") &&
        document.querySelector('[aria-label="Canvas workspace"] canvas')) &&
        document.activeElement === content;
    })()`);
    await client.evaluate(`(() => { globalThis.__spriteBoySliceDecodeFixture.delayMs = 0; })()`);
    const retrySucceeded = true;
    const retrySuccessFocusRestored = true;
    await client.evaluate("new Promise((resolvePromise) => setTimeout(resolvePromise, 3200))");
    await captureScreenshot(client, options.screenshotPath);

    const resetSetup = await client.evaluate(`(() => {
      localStorage.setItem("spriteSlice_prefs", JSON.stringify({ marker: "g0-04-preserve" }));
      const reset = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Reset source");
      if (!(reset instanceof HTMLButtonElement)) return false;
      reset.click();
      return true;
    })()`);
    if (!resetSetup) throw new Error("Slice reset action is unavailable.");
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]'))`);
    const resetConfirmationAccessible = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]');
      const cancel = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.trim() === "Keep source");
      return Boolean(dialog?.textContent?.includes("preferences and the asset library stay intact") &&
        cancel === document.activeElement);
    })()`);
    await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]');
      const cancel = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.trim() === "Keep source");
      cancel?.click();
    })()`);
    await client.waitFor(`!document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]')`);
    const resetCancelPreserved = await client.evaluate(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]");
      const reset = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Reset source");
      return Boolean(metadata?.textContent?.includes("retryable-source.png") &&
        document.querySelector('[aria-label="Canvas workspace"] canvas') &&
        reset === document.activeElement);
    })()`);

    const resetResourceBefore = await client.evaluate(
      "globalThis.__spriteBoySlicePreviewUrls?.bitmapClosed ?? -1",
    );
    await client.evaluate(`(() => {
      const reset = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Reset source");
      reset?.click();
    })()`);
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]'))`);
    await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]');
      const confirm = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.trim() === "Reset source");
      confirm?.click();
    })()`);
    await client.waitFor(`Boolean(document.querySelector("[data-slice-source-dropzone]"))`);
    await client.waitFor(`(() => {
      const button = document.querySelector('[data-slice-source-dropzone] button');
      return button instanceof HTMLButtonElement && document.activeElement === button;
    })()`);
    const resetPage = await client.evaluate(`(() => {
      const dropzone = document.querySelector("[data-slice-source-dropzone]");
      const button = dropzone?.querySelector("button");
      const closed = globalThis.__spriteBoySlicePreviewUrls?.bitmapClosed ?? -1;
      return {
        resetCompleted: Boolean(dropzone && !document.querySelector('[aria-label="Canvas workspace"] canvas')),
        resetResourceReleased: closed > ${JSON.stringify(resetResourceBefore)},
        resetFocusRestored: button instanceof HTMLButtonElement && document.activeElement === button,
        preferencesPreserved: localStorage.getItem("spriteSlice_prefs") ===
          JSON.stringify({ marker: "g0-04-preserve" }),
      };
    })()`);
    return evaluateSliceSourceEvidence({
      busyAnnounced,
      replacementRaceRecovered,
      ...initialPage,
      pickerCancelPreserved,
      pickerCancelFocusRestored,
      replaceKeptCurrentSource,
      retryableErrorFocused,
      retryFailureFocusRestored,
      retryBusyBlocksDuplicateActions,
      retrySucceeded,
      retrySuccessFocusRestored,
      resetConfirmationAccessible,
      resetCancelPreserved,
      ...resetPage,
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
