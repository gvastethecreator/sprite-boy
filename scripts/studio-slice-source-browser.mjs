/** Production-Chrome proof for the native Slice source path. */
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
  waitForSliceSourceDropzone,
} from "./studio-browser-smoke.mjs";

const HOST = "127.0.0.1";
const RUNTIME_DEADLINE_MS = 50_000;

const REQUIRED_BOOLEAN_KEYS = Object.freeze([
  "busyAnnounced",
  "metadataVisible",
  "actionsVisible",
  "canvasVisible",
  "dropzoneRemoved",
  "manualGridControlsVisible",
  "columnDividerResized",
  "rowDividerResized",
  "keyboardResizeWorks",
  "pickerCancelPreserved",
  "pickerCancelFocusRestored",
  "replaceKeptCurrentSource",
  "replacementSucceeded",
  "resetConfirmationAccessible",
  "resetCancelPreserved",
  "resetCompleted",
  "resetFocusRestored",
  "pageFits",
]);

export function evaluateSliceSourceEvidence(evidence) {
  if (evidence === null || typeof evidence !== "object" ||
    REQUIRED_BOOLEAN_KEYS.some((key) => typeof evidence[key] !== "boolean") ||
    typeof evidence.route !== "string") {
    throw new TypeError("Slice source browser evidence is invalid.");
  }
  const errors = {
    console: evidence.consoleErrorCount,
    exception: evidence.exceptionCount,
    log: evidence.logErrorCount,
    network: evidence.networkFailureCount,
    http: evidence.httpErrorCount,
  };
  if (Object.values(errors).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("Slice source browser diagnostics are invalid.");
  }
  const passed = REQUIRED_BOOLEAN_KEYS.every((key) => evidence[key]) &&
    evidence.route === "#/studio/slice" && Object.values(errors).every((value) => value === 0);
  return Object.freeze({
    schemaVersion: 1,
    check: "slice-source-browser",
    status: passed ? "pass" : "fail",
    metrics: Object.freeze({
      ...Object.fromEntries(REQUIRED_BOOLEAN_KEYS.map((key) => [key, evidence[key]])),
      route: evidence.route,
      errors: Object.freeze(errors),
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

async function clickButton(client, label) {
  const clicked = await client.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.replace(/\\s+/gu, " ").trim() === label);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.focus({ preventScroll: true });
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error(`Slice source action ${label} is unavailable.`);
}

async function clickDialogButton(client, label) {
  const clicked = await client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const button = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent?.replace(/\\s+/gu, " ").trim() === ${JSON.stringify(label)});
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error(`Slice source dialog action ${label} is unavailable.`);
}

async function selectPng(client, name, width, height) {
  const selected = await client.evaluate(`(async () => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const canvas = document.createElement("canvas");
    canvas.width = ${width};
    canvas.height = ${height};
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#22c55e";
    context.fillRect(0, 0, Math.floor(canvas.width / 2), canvas.height);
    context.fillStyle = "#38bdf8";
    context.fillRect(Math.floor(canvas.width / 2), 0, canvas.width, canvas.height);
    const blob = await new Promise((resolvePromise) => canvas.toBlob(resolvePromise, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], ${JSON.stringify(name)}, { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (selected !== true) throw new Error(`Slice source fixture ${name} is unavailable.`);
}

async function selectInvalidPng(client) {
  const selected = await client.evaluate(`(() => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["invalid source"], "replacement-invalid.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (selected !== true) throw new Error("Invalid Slice replacement fixture is unavailable.");
}

async function cancelPicker(client) {
  const cancelled = await client.evaluate(`(() => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    input.files = new DataTransfer().files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (cancelled !== true) throw new Error("Slice picker cancel fixture is unavailable.");
}

async function configureManualGrid(client) {
  const configured = await client.evaluate(`(() => {
    const manual = document.querySelector('input[type="radio"][value="manual"]');
    const rows = Array.from(document.querySelectorAll('input[type="number"]'))
      .find((input) => input.closest("label")?.textContent?.includes("Rows"));
    const columns = Array.from(document.querySelectorAll('input[type="number"]'))
      .find((input) => input.closest("label")?.textContent?.includes("Columns"));
    if (!(manual instanceof HTMLInputElement) ||
      !(rows instanceof HTMLInputElement) || !(columns instanceof HTMLInputElement)) return false;
    manual.click();
    const setValue = (input, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue(rows, "2");
    setValue(columns, "2");
    return manual.checked;
  })()`);
  if (configured !== true) throw new Error("Manual grid controls are unavailable.");
}

async function dragGridDivider(client, axis, sourcePosition) {
  const dragged = await client.evaluate(`(() => {
    const axis = ${JSON.stringify(axis)};
    const sourcePosition = ${JSON.stringify(sourcePosition)};
    const control = document.querySelector('[data-grid-resize-axis="' + axis + '"][data-grid-resize-index="0"]');
    const host = control?.closest("[data-slice-grid-overlay]");
    const canvas = host?.querySelector("[data-slice-grid-overlay-canvas]");
    if (!(control instanceof HTMLButtonElement) || !(host instanceof HTMLElement) ||
      !(canvas instanceof HTMLCanvasElement)) return false;
    const scale = Number(canvas.dataset.gridOverlayScale);
    const offsets = (canvas.dataset.gridOverlayOffset ?? "").split(",").map(Number);
    if (!Number.isFinite(scale) || scale <= 0 || offsets.length !== 2 || offsets.some((value) => !Number.isFinite(value))) {
      return false;
    }
    const hostBounds = host.getBoundingClientRect();
    const controlBounds = control.getBoundingClientRect();
    const targetX = axis === "column"
      ? hostBounds.left + offsets[0] + sourcePosition * scale
      : controlBounds.left + Math.max(1, controlBounds.width / 2);
    const targetY = axis === "row"
      ? hostBounds.top + offsets[1] + sourcePosition * scale
      : controlBounds.top + Math.max(1, controlBounds.height / 2);
    const startX = controlBounds.left + Math.max(1, controlBounds.width / 2);
    const startY = controlBounds.top + Math.max(1, controlBounds.height / 2);
    const pointerId = axis === "column" ? 701 : 702;
    const emit = (type, clientX, clientY, buttons) => control.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons,
      pointerId,
      pointerType: "mouse",
      clientX,
      clientY,
    }));
    emit("pointerdown", startX, startY, 1);
    emit("pointermove", targetX, targetY, 1);
    emit("pointerup", targetX, targetY, 0);
    return true;
  })()`);
  if (dragged !== true) throw new Error(`Manual ${axis} divider cannot be dragged.`);
}

async function nudgeGridColumn(client) {
  const nudged = await client.evaluate(`(() => {
    const control = document.querySelector('[data-grid-resize-axis="column"][data-grid-resize-index="0"]');
    if (!(control instanceof HTMLButtonElement)) return false;
    control.focus({ preventScroll: true });
    control.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    }));
    return document.activeElement === control;
  })()`);
  if (nudged !== true) throw new Error("Manual column divider cannot receive keyboard input.");
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
  let journeyStep = "browser startup";

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
    client = await connectToPage(await waitForDevToolsPort(profileDirectory, chrome));
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
        const nativeCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);
        if (!nativeCreateImageBitmap) return;
        globalThis.createImageBitmap = async (...args) => {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
          return nativeCreateImageBitmap(...args);
        };
      })();`,
    });

    journeyStep = "initial dropzone";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await waitForSliceSourceDropzone(client, 12_000, 3);
    await client.waitForNetworkIdle();

    journeyStep = "initial source import";
    await selectPng(client, "browser-source.png", 64, 32);
    await client.waitFor(`document.querySelector("[data-slice-source-dropzone]")?.getAttribute("aria-busy") === "true"`);
    await client.waitFor(`Boolean(document.querySelector('[aria-label="Canvas workspace"] canvas')) &&
      !document.querySelector("[data-slice-source-dropzone]")`);
    await client.waitFor(`document.body.innerText.includes("Imported browser-source.png")`);
    const initial = await client.evaluate(`(() => {
      const content = document.querySelector('[data-studio-workspace-content="slice"]');
      const canvas = document.querySelector('[aria-label="Canvas workspace"] canvas');
      const metadata = document.querySelector("[data-slice-source-metadata]");
      const actions = document.querySelector('[role="toolbar"][aria-label="Slice source actions"]');
      const bounds = canvas?.getBoundingClientRect();
      return {
        metadataVisible: Boolean(metadata?.textContent?.includes("browser-source.png") &&
          metadata.textContent.includes("64 × 32") && metadata.textContent.includes("PNG")),
        actionsVisible: Boolean(actions?.textContent?.includes("Replace source") &&
          actions.textContent.includes("Reset source")),
        canvasVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
        dropzoneRemoved: !document.querySelector("[data-slice-source-dropzone]"),
        focusRestored: document.activeElement === content,
      };
    })()`);

    journeyStep = "manual grid resize";
    await configureManualGrid(client);
    await client.waitFor(`document.querySelectorAll('[data-slice-grid-resize-controls] [data-grid-resize-axis="column"]').length === 1 &&
      document.querySelectorAll('[data-slice-grid-resize-controls] [data-grid-resize-axis="row"]').length === 1`);
    const manualGridControlsVisible = await client.evaluate(`(() => {
      const controls = document.querySelector("[data-slice-grid-resize-controls]");
      return Boolean(controls && document.body.innerText.includes("Drag the cyan dividers in the canvas"));
    })()`);
    await dragGridDivider(client, "column", 20);
    await client.waitFor(`document.querySelector('[data-grid-resize-axis="column"]')?.getAttribute("aria-label") ===
      "Resize column divider 1 at 20 pixels"`);
    const columnDividerResized = await client.evaluate(`document.querySelector('[data-grid-resize-axis="column"]')?.getAttribute("aria-label") ===
      "Resize column divider 1 at 20 pixels"`);
    await nudgeGridColumn(client);
    await client.waitFor(`document.querySelector('[data-grid-resize-axis="column"]')?.getAttribute("aria-label") ===
      "Resize column divider 1 at 21 pixels"`);
    const keyboardResizeWorks = await client.evaluate(`document.querySelector('[data-grid-resize-axis="column"]')?.getAttribute("aria-label") ===
      "Resize column divider 1 at 21 pixels"`);
    await dragGridDivider(client, "row", 10);
    await client.waitFor(`document.querySelector('[data-grid-resize-axis="row"]')?.getAttribute("aria-label") ===
      "Resize row divider 1 at 10 pixels"`);
    const rowDividerResized = await client.evaluate(`document.querySelector('[data-grid-resize-axis="row"]')?.getAttribute("aria-label") ===
      "Resize row divider 1 at 10 pixels"`);

    journeyStep = "picker cancel";
    await clickButton(client, "Replace source");
    await cancelPicker(client);
    await client.waitFor(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.trim() === "Replace source");
      return button === document.activeElement;
    })()`);
    const pickerCancel = await client.evaluate(`Boolean(
      document.querySelector('[aria-label="Canvas workspace"] canvas') &&
      document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("browser-source.png")
    )`);

    journeyStep = "invalid replacement";
    await clickButton(client, "Replace source");
    await selectInvalidPng(client);
    await client.waitFor(`(() => {
      const body = document.body.innerText;
      return body.includes("do not match") || body.includes("could not be read");
    })()`);
    const invalidReplacement = await client.evaluate(`Boolean(
      document.querySelector('[aria-label="Canvas workspace"] canvas') &&
      document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("browser-source.png")
    )`);

    journeyStep = "valid replacement";
    await clickButton(client, "Replace source");
    await selectPng(client, "replacement-source.png", 48, 24);
    await client.waitFor(`document.body.innerText.includes("Imported replacement-source.png")`);
    const replacementSucceeded = await client.evaluate(`Boolean(
      document.querySelector('[aria-label="Canvas workspace"] canvas') &&
      document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("replacement-source.png")
    )`);

    journeyStep = "reset cancel";
    await clickButton(client, "Reset source");
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]'))`);
    const resetConfirmationAccessible = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]');
      return Boolean(dialog?.querySelector("#slice-source-reset-title") &&
        dialog.textContent?.includes("replacement-source.png") && dialog.textContent.includes("Keep source"));
    })()`);
    await clickButton(client, "Keep source");
    await client.waitFor(`!document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]')`);
    const resetCancelPreserved = await client.evaluate(`Boolean(
      document.querySelector('[aria-label="Canvas workspace"] canvas') &&
      document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("replacement-source.png")
    )`);

    journeyStep = "reset confirmation";
    await clickButton(client, "Reset source");
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]'))`);
    await clickDialogButton(client, "Reset source");
    await client.waitFor(`Boolean(document.querySelector("[data-slice-source-dropzone]"))`);
    await client.waitFor(`document.querySelector("[data-slice-source-dropzone] button") === document.activeElement`);
    const finalPage = await client.evaluate(`(() => {
      const dropzone = document.querySelector("[data-slice-source-dropzone]");
      const browse = dropzone?.querySelector("button");
      return {
        resetCompleted: Boolean(dropzone) && !document.querySelector('[aria-label="Canvas workspace"] canvas'),
        resetFocusRestored: browse === document.activeElement,
        pageFits: document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
        route: location.hash,
      };
    })()`);
    await captureScreenshot(client, options.screenshotPath);

    return evaluateSliceSourceEvidence({
      busyAnnounced: true,
      ...initial,
      manualGridControlsVisible,
      columnDividerResized,
      rowDividerResized,
      keyboardResizeWorks,
      pickerCancelPreserved: pickerCancel,
      pickerCancelFocusRestored: true,
      replaceKeptCurrentSource: invalidReplacement,
      replacementSucceeded,
      resetConfirmationAccessible,
      resetCancelPreserved,
      ...finalPage,
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
  ), RUNTIME_DEADLINE_MS).catch((error) => {
    throw new Error(`Slice source journey failed during ${journeyStep}: ${
      error instanceof Error ? error.message : "unknown error"
    }`);
  });
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
