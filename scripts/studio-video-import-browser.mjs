/** Production-Chrome proof for Slice video import, close and durable reload. */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { cfrMp4Blob } from "../tests/contract/fixtures/videoFixtures.ts";
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
const RUNTIME_DEADLINE_MS = 120_000;

async function captureOptional(client, outputPath) {
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) return;
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const resolved = resolve(outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, Buffer.from(result.data, "base64"));
}
const BOOLEAN_KEYS = Object.freeze([
  "malformedRejected",
  "malformedNoJob",
  "malformedProjectEmpty",
  "malformedCloseFocusRestored",
  "preflightMetadataVisible",
  "rangeControlsVisible",
  "samplingControlsVisible",
  "exactFrameCountVisible",
  "closeNoJob",
  "closeFocusRestored",
  "closeObjectUrlsBalanced",
  "importCompleted",
  "jobRecorded",
  "noActiveJobs",
  "firstFrameOpened",
  "frameAlignmentOpened",
  "frameControlsVisible",
  "onionControlsVisible",
  "frameTransformApplied",
  "frameSelectionChanged",
  "frameReloadRestored",
  "animateMobileFits",
  "durableReloadRestored",
  "mobilePageFits",
  "finalObjectUrlsBounded",
]);
const DIAGNOSTIC_KEYS = Object.freeze([
  "consoleErrorCount",
  "exceptionCount",
  "logErrorCount",
  "networkFailureCount",
  "httpErrorCount",
]);

function dataRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateObjectUrlStats(value, label) {
  const stats = dataRecord(value, label);
  for (const key of ["created", "revoked", "live"]) {
    if (!Number.isSafeInteger(stats[key]) || stats[key] < 0) {
      throw new TypeError(`${label} ${key} must be a nonnegative integer.`);
    }
  }
  if (stats.created - stats.revoked !== stats.live) {
    throw new TypeError(`${label} counters are inconsistent.`);
  }
  return stats;
}

export function evaluateVideoImportEvidence(value) {
  const evidence = dataRecord(value, "Video import browser evidence");
  for (const key of BOOLEAN_KEYS) {
    if (typeof evidence[key] !== "boolean") {
      throw new TypeError(`Video import browser evidence ${key} must be boolean.`);
    }
  }
  for (const key of DIAGNOSTIC_KEYS) {
    if (!Number.isSafeInteger(evidence[key]) || evidence[key] < 0) {
      throw new TypeError(`Video import browser evidence ${key} must be a nonnegative integer.`);
    }
  }
  if (typeof evidence.route !== "string" || !Number.isSafeInteger(evidence.frameCount)
    || typeof evidence.dimensions !== "string") {
    throw new TypeError("Video import browser scalar evidence is invalid.");
  }
  const initialObjectUrlStats = validateObjectUrlStats(evidence.initialObjectUrlStats, "Initial object URL stats");
  const closeObjectUrlStats = validateObjectUrlStats(evidence.closeObjectUrlStats, "Close object URL stats");
  const preReloadObjectUrlStats = validateObjectUrlStats(evidence.preReloadObjectUrlStats, "Pre-reload object URL stats");
  const finalObjectUrlStats = validateObjectUrlStats(evidence.finalObjectUrlStats, "Final object URL stats");
  const errors = Object.fromEntries(DIAGNOSTIC_KEYS.map((key) => [
    key.replace(/Count$/u, ""),
    evidence[key],
  ]));
  const passed = BOOLEAN_KEYS.every((key) => evidence[key] === true)
    && evidence.route === "#/studio/slice"
    && evidence.frameCount === 4
    && evidence.dimensions === "16x16"
    && Object.values(errors).every((count) => count === 0);
  return deepFreeze({
    schemaVersion: 1,
    check: "video-import-browser",
    status: passed ? "pass" : "fail",
    metrics: {
      ...Object.fromEntries(BOOLEAN_KEYS.map((key) => [key, evidence[key]])),
      route: evidence.route,
      frameCount: evidence.frameCount,
      dimensions: evidence.dimensions,
      objectUrls: {
        initial: initialObjectUrlStats,
        close: closeObjectUrlStats,
        preReload: preReloadObjectUrlStats,
        final: finalObjectUrlStats,
      },
      errors,
    },
  });
}

async function clickTextButton(client, label) {
  const clicked = await client.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.replace(/\\s+/gu, " ").trim() === label);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.focus({ preventScroll: true });
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error("Required video import action is unavailable.");
}

async function clickAriaButton(client, label) {
  const clicked = await client.evaluate(`(() => {
    const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error("Required video import control is unavailable.");
}

async function openJobCenter(client) {
  const clicked = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Open Job Center"));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error("Job Center is unavailable.");
}

async function selectVideo(client, base64, name) {
  const selected = await client.evaluate(`(() => {
    const input = document.querySelector('input[type="file"][accept*="video/mp4"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const binary = atob(${JSON.stringify(base64)});
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(name)}, { type: "video/mp4" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (selected !== true) throw new Error("Video import fixture could not be selected.");
}

function browserInitScript() {
  return `(() => {
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    const live = new Set();
    globalThis.__spriteBoyVideoUrlStats = { created: 0, revoked: 0, live: 0 };
    URL.createObjectURL = (...args) => {
      const url = originalCreate(...args);
      live.add(url);
      globalThis.__spriteBoyVideoUrlStats.created += 1;
      globalThis.__spriteBoyVideoUrlStats.live = live.size;
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (live.delete(url)) globalThis.__spriteBoyVideoUrlStats.revoked += 1;
      globalThis.__spriteBoyVideoUrlStats.live = live.size;
      return originalRevoke(url);
    };
  })();`;
}

function validateOptions(options) {
  const source = dataRecord(options, "Video import browser options");
  const serverMode = source.serverMode ?? "preview";
  if (serverMode !== "preview" && serverMode !== "dev") {
    throw new TypeError("Video import browser server mode is invalid.");
  }
  const externalBaseUrl = typeof source.baseUrl === "string" && source.baseUrl.trim().length > 0
    ? new URL(source.baseUrl)
    : null;
  if (externalBaseUrl && externalBaseUrl.protocol !== "http:" && externalBaseUrl.protocol !== "https:") {
    throw new TypeError("Video import browser base URL is invalid.");
  }
  return { serverMode, externalBaseUrl };
}

export async function runStudioVideoImportBrowser(options = {}) {
  const { serverMode, externalBaseUrl } = validateOptions(options);
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options.chromeOptions);
  const fixtureBase64 = Buffer.from(await cfrMp4Blob().arrayBuffer()).toString("base64");
  const malformedBase64 = Buffer.from("not a video", "utf8").toString("base64");
  const port = externalBaseUrl ? null : await allocatePort();
  const baseUrl = externalBaseUrl?.origin ?? `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-video-import-chrome-"));
  let preview;
  let chrome;
  let client;
  let journeyStep = "browser startup";

  return runWithBrowserRuntimeDeadline(async () => {
    if (port !== null) {
      preview = spawnViteServer(cwd, port, serverMode);
      await waitForPreview(baseUrl, preview);
    }
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
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: browserInitScript() });

    journeyStep = "initial Slice state";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await waitForSliceSourceDropzone(client, 15_000, 3);
    if (serverMode === "preview") await client.waitForNetworkIdle();
    const initialObjectUrlStats = await client.evaluate("({ ...globalThis.__spriteBoyVideoUrlStats })");

    journeyStep = "malformed video";
    await clickTextButton(client, "Choose image or video");
    await selectVideo(client, malformedBase64, "malformed.mp4");
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-label="Extract video frames"] [role="alert"]'))`);
    const malformed = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Extract video frames"]');
      const alert = dialog?.querySelector('[role="alert"]');
      const jobs = Array.from(document.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label")?.startsWith("Open Job Center"));
      return {
        malformedRejected: Boolean(alert && alert.textContent && alert.textContent.trim().length <= 160),
        malformedNoJob: jobs?.getAttribute("aria-label")?.includes("0 visible jobs") === true,
        malformedProjectEmpty: Boolean(document.querySelector("[data-slice-source-dropzone]")),
      };
    })()`);
    await clickAriaButton(client, "Close video import");
    await client.waitFor(`!document.querySelector('[role="dialog"][aria-label="Extract video frames"]')`);
    const malformedCloseFocusRestored = await client.evaluate(`(() => {
      const active = document.activeElement;
      return active instanceof HTMLButtonElement && active.textContent?.trim() === "Choose image or video";
    })()`);

    journeyStep = "valid preflight and close";
    await clickTextButton(client, "Choose image or video");
    await selectVideo(client, fixtureBase64, "browser-video.mp4");
    await client.waitFor(`document.body.innerText.includes("Import 4 frames")`);
    const preflight = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Extract video frames"]');
      const text = dialog?.textContent?.replace(/\\s+/gu, " ") ?? "";
      const ranges = dialog?.querySelectorAll('input[type="range"][aria-label^="Time range"]') ?? [];
      const radios = dialog?.querySelectorAll('input[type="radio"]') ?? [];
      return {
        preflightMetadataVisible: text.includes("Duration") && text.includes("16×16") &&
          text.includes("Codec") && text.includes("Constant rate"),
        rangeControlsVisible: ranges.length === 2,
        samplingControlsVisible: radios.length === 2 && text.includes("Every frame") && text.includes("Target FPS"),
        exactFrameCountVisible: text.includes("Import 4 frames") && text.includes("4 frames will be stored as PNG assets."),
      };
    })()`);
    await clickAriaButton(client, "Close video import");
    await client.waitFor(`!document.querySelector('[role="dialog"][aria-label="Extract video frames"]')`);
    const closed = await client.evaluate(`(() => {
      const active = document.activeElement;
      const jobs = Array.from(document.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label")?.startsWith("Open Job Center"));
      return {
        closeNoJob: jobs?.getAttribute("aria-label")?.includes("0 visible jobs") === true,
        closeFocusRestored: active instanceof HTMLButtonElement && active.textContent?.trim() === "Choose image or video",
        closeObjectUrlsBalanced:
          globalThis.__spriteBoyVideoUrlStats?.live === ${JSON.stringify(initialObjectUrlStats.live)} &&
          globalThis.__spriteBoyVideoUrlStats.created - ${JSON.stringify(initialObjectUrlStats.created)} ===
            globalThis.__spriteBoyVideoUrlStats.revoked - ${JSON.stringify(initialObjectUrlStats.revoked)},
        closeObjectUrlStats: { ...globalThis.__spriteBoyVideoUrlStats },
      };
    })()`);

    journeyStep = "successful import";
    await clickTextButton(client, "Choose image or video");
    await selectVideo(client, fixtureBase64, "browser-video.mp4");
    await client.waitFor(`document.body.innerText.includes("Import 4 frames")`);
    await clickTextButton(client, "Import 4 frames");
    await client.waitFor(`document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("browser-video.mp4-0001.png")`, 30_000);
    const imported = await client.evaluate(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]")?.textContent ?? "";
      const jobs = Array.from(document.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label")?.startsWith("Open Job Center"));
      return {
        importCompleted: jobs?.getAttribute("aria-label")?.includes("1 visible job") === true,
        noActiveJobs: jobs?.getAttribute("aria-label")?.includes("0 active jobs") === true,
        firstFrameOpened: metadata.includes("browser-video.mp4-0001.png") &&
          metadata.includes("16 × 16") && metadata.includes("PNG"),
      };
    })()`);
    await openJobCenter(client);
    await client.waitFor(`document.querySelector('[role="dialog"][aria-label="Job Center"]')?.textContent?.includes("Completed")`);
    const jobRecorded = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Job Center"]');
      const text = dialog?.textContent?.replace(/\\s+/gu, " ") ?? "";
      return text.includes("video.import") && text.includes("attempt 1") && text.includes("Completed") &&
        text.includes("No active jobs. 1 job in history.");
    })()`);
    await clickAriaButton(client, "Close Job Center");
    await client.waitFor(`!document.querySelector('[role="dialog"][aria-label="Job Center"]')`);

    journeyStep = "frame alignment";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/animate` });
    await client.waitFor(`document.querySelector('section[aria-label="Frame alignment"] h1')?.textContent?.includes("Frame alignment")`, 15_000);
    const alignment = await client.evaluate(`(() => {
      const workspace = document.querySelector('section[aria-label="Frame alignment"]');
      const frameButtons = workspace?.querySelectorAll('nav[aria-label="Sequence frames"] button') ?? [];
      const xLabel = Array.from(workspace?.querySelectorAll("label") ?? [])
        .find((label) => label.firstChild?.textContent?.trim() === "X");
      const xInput = xLabel?.querySelector('input[type="number"]');
      const opacity = workspace?.querySelector('input[type="range"][aria-label="Frame opacity"]');
      const onion = workspace?.querySelector('input[type="range"][aria-label="Onion opacity"]');
      const guides = Array.from(workspace?.querySelectorAll("label") ?? [])
        .some((label) => label.textContent?.includes("Center and thirds guides"));
      if (!(xInput instanceof HTMLInputElement) || !(frameButtons[1] instanceof HTMLButtonElement)) {
        return { frameAlignmentOpened: false, frameControlsVisible: false, onionControlsVisible: false,
          frameTransformApplied: false };
      }
      xInput.value = "3";
      xInput.dispatchEvent(new Event("input", { bubbles: true }));
      xInput.dispatchEvent(new Event("change", { bubbles: true }));
      xInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      frameButtons[1].click();
      return {
        frameAlignmentOpened: frameButtons.length === 4 && Boolean(workspace?.querySelector('canvas[aria-label="Current animation frame"]')),
        frameControlsVisible: xInput instanceof HTMLInputElement && opacity instanceof HTMLInputElement &&
          Boolean(workspace?.querySelector('button[aria-label="Lock frame"]')),
        onionControlsVisible: onion instanceof HTMLInputElement && guides,
        frameTransformApplied: xInput.value === "3",
      };
    })()`);
    await client.waitFor(`document.querySelector('nav[aria-label="Sequence frames"] button[aria-current="true"]')?.textContent?.includes("02")`);
    await client.evaluate(`document.querySelector('section[aria-label="Frame alignment"] [role="application"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
    await client.waitFor(`(() => {
      const workspace = document.querySelector('section[aria-label="Frame alignment"]');
      const xLabel = Array.from(workspace?.querySelectorAll("label") ?? [])
        .find((label) => label.firstChild?.textContent?.trim() === "X");
      const input = xLabel?.querySelector('input[type="number"]');
      return input instanceof HTMLInputElement && input.value === "1";
    })()`);
    const frameSelectionChanged = await client.evaluate(`(() => {
      const workspace = document.querySelector('section[aria-label="Frame alignment"]');
      const buttons = workspace?.querySelectorAll('nav[aria-label="Sequence frames"] button') ?? [];
      return buttons[1]?.getAttribute("aria-current") === "true";
    })()`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    await captureOptional(client, options.animateDesktopScreenshot);

    journeyStep = "frame alignment reload";
    await client.send("Page.reload", { ignoreCache: true });
    await client.waitFor(`document.querySelector('section[aria-label="Frame alignment"] h1')?.textContent?.includes("Frame alignment")`, 30_000);
    const frameReloadRestored = await client.evaluate(`(() => {
      const workspace = document.querySelector('section[aria-label="Frame alignment"]');
      const selected = workspace?.querySelector('nav[aria-label="Sequence frames"] button[aria-current="true"]');
      const xLabel = Array.from(workspace?.querySelectorAll("label") ?? [])
        .find((label) => label.firstChild?.textContent?.trim() === "X");
      const xInput = xLabel?.querySelector('input[type="number"]');
      return selected?.textContent?.includes("02") === true && xInput instanceof HTMLInputElement && xInput.value === "1";
    })()`);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const animateMobileFits = await client.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight`);
    await captureOptional(client, options.animateCompactScreenshot);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("browser-video.mp4-0001.png")`, 30_000);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
    const urlsBeforeReload = await client.evaluate("({ ...globalThis.__spriteBoyVideoUrlStats })");

    journeyStep = "durable reload";
    await client.send("Page.reload", { ignoreCache: true });
    await client.waitFor(`document.querySelector("[data-slice-source-metadata]")?.textContent?.includes("browser-video.mp4-0001.png")`, 30_000);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const finalPage = await client.evaluate(`(() => {
      const metadata = document.querySelector("[data-slice-source-metadata]")?.textContent ?? "";
      return {
        durableReloadRestored: metadata.includes("browser-video.mp4-0001.png") &&
          metadata.includes("16 × 16") && metadata.includes("PNG"),
        mobilePageFits: document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
        finalObjectUrlsBounded:
          ${JSON.stringify(urlsBeforeReload.live)} <= ${JSON.stringify(initialObjectUrlStats.live + 1)} &&
          globalThis.__spriteBoyVideoUrlStats?.live <= ${JSON.stringify(initialObjectUrlStats.live + 1)},
        preReloadObjectUrlStats: ${JSON.stringify(urlsBeforeReload)},
        finalObjectUrlStats: { ...globalThis.__spriteBoyVideoUrlStats },
        route: location.hash,
        frameCount: 4,
        dimensions: "16x16",
      };
    })()`);

    return evaluateVideoImportEvidence({
      ...malformed,
      malformedCloseFocusRestored,
      ...preflight,
      ...closed,
      ...imported,
      jobRecorded,
      ...alignment,
      frameSelectionChanged,
      frameReloadRestored,
      animateMobileFits,
      ...finalPage,
      initialObjectUrlStats,
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
    "Video import browser runtime cleanup failed.",
  ), RUNTIME_DEADLINE_MS).catch((error) => {
    throw new Error(`Video import journey failed during ${journeyStep}.`, { cause: error });
  });
}

export async function runStudioVideoImportBrowserCli(io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const run = dependencies.run ?? runStudioVideoImportBrowser;
  try {
    const result = await run({
      baseUrl: process.env.STUDIO_VIDEO_IMPORT_BASE_URL,
      serverMode: process.env.STUDIO_VIDEO_IMPORT_SERVER_MODE,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "video-import-browser",
      status: "fail",
      reason: "video-import-browser-unavailable",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runStudioVideoImportBrowserCli();
