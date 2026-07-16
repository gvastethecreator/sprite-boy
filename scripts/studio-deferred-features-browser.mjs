/** Production Chrome journey proving the Export modal and optional AI/ZIP/GIF chunks load on demand. */
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cleanupBrowserRuntime,
  connectToPage,
  allocatePort,
  resolveChromeExecutable,
  runWithBrowserRuntimeDeadline,
  spawnViteServer,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";
import {
  DEFERRED_FEATURE_CHUNK_PATTERNS,
  extractInitialJsPaths,
  validateDeferredFeatureChunks,
} from "./studio-quality-policy.mjs";

const HOST = "127.0.0.1";
const RUNTIME_DEADLINE_MS = 70_000;

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function deferredChunkMap(cwd) {
  const indexHtml = readFileSync(resolve(cwd, "dist/index.html"), "utf8");
  const initialPaths = extractInitialJsPaths(indexHtml);
  const assetNames = readdirSync(resolve(cwd, "dist/assets"))
    .filter((name) => name.endsWith(".js"));
  return Object.freeze(Object.fromEntries(
    validateDeferredFeatureChunks(assetNames, initialPaths)
      .map(({ feature, path }) => [feature, path]),
  ));
}

function installRequestPathCollector(client, origin, requestedPaths) {
  client.socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.method !== "Network.requestWillBeSent") return;
    try {
      const url = new URL(message.params.request.url);
      if (url.origin === origin) requestedPaths.push(url.pathname);
    } catch {
      // Only same-origin, parseable paths are retained as evidence.
    }
  });
}

function countPath(paths, target) {
  return paths.filter((path) => path === target).length;
}

export function evaluateDeferredFeatureEvidence(evidence, chunkPaths) {
  const features = Object.keys(DEFERRED_FEATURE_CHUNK_PATTERNS);
  if (
    evidence === null || typeof evidence !== "object" ||
    chunkPaths === null || typeof chunkPaths !== "object" ||
    !Array.isArray(evidence.initialRequestPaths) || !Array.isArray(evidence.finalRequestPaths) ||
    evidence.initialRequestPaths.some((path) => typeof path !== "string") ||
    evidence.finalRequestPaths.some((path) => typeof path !== "string") ||
    features.some((feature) => typeof chunkPaths[feature] !== "string")
  ) {
    throw new TypeError("Deferred browser evidence is invalid.");
  }
  const initialFeatureRequests = Object.fromEntries(features.map((feature) => [
    feature,
    countPath(evidence.initialRequestPaths, chunkPaths[feature]),
  ]));
  const finalFeatureRequests = Object.fromEntries(features.map((feature) => [
    feature,
    countPath(evidence.finalRequestPaths, chunkPaths[feature]),
  ]));
  const errors = {
    console: evidence.consoleErrorCount,
    exception: evidence.exceptionCount,
    log: evidence.logErrorCount,
    network: evidence.networkFailureCount,
    http: evidence.httpErrorCount,
  };
  if (
    Object.values(errors).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    typeof evidence.pageFits !== "boolean" || typeof evidence.dialogVisible !== "boolean" ||
    typeof evidence.finalRoute !== "string"
  ) {
    throw new TypeError("Deferred browser metrics are invalid.");
  }
  const passed = Object.values(initialFeatureRequests).every((count) => count === 0) &&
    Object.values(finalFeatureRequests).every((count) => count === 1) &&
    Object.values(errors).every((count) => count === 0) &&
    evidence.zipSucceeded === true && evidence.gifSucceeded === true &&
    evidence.aiFailureContained === true && evidence.pageFits && evidence.dialogVisible &&
    evidence.finalRoute === "#/studio/export";
  return Object.freeze({
    schemaVersion: 1,
    check: "deferred-feature-browser",
    status: passed ? "pass" : "fail",
    metrics: Object.freeze({
      initialFeatureRequests: Object.freeze(initialFeatureRequests),
      finalFeatureRequests: Object.freeze(finalFeatureRequests),
      zipSucceeded: evidence.zipSucceeded === true,
      gifSucceeded: evidence.gifSucceeded === true,
      aiFailureContained: evidence.aiFailureContained === true,
      pageFits: evidence.pageFits,
      dialogVisible: evidence.dialogVisible,
      finalRoute: evidence.finalRoute,
      errors: Object.freeze(errors),
    }),
  });
}

function clickButtonExpression(label) {
  return `(() => {
    const label = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.replace(/\\s+/gu, " ").trim().includes(label),
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`;
}

async function clickButton(client, label) {
  if (await client.evaluate(clickButtonExpression(label)) !== true) {
    throw new Error(`Browser action ${label} is unavailable.`);
  }
}

async function waitForText(client, text, timeoutMs = 20_000) {
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, timeoutMs);
}

async function seedExportFixture(client) {
  const loaded = await client.evaluate(`(() => {
    const input = document.querySelector('input[accept*="application/json"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const payload = {
      project: {
        imageMeta: null,
        builderCanvas: { width: 16, height: 16 },
        frames: [{ id: 1, x: 0, y: 0, w: 16, h: 16, hidden: false }],
        builderSlots: {},
        builderFreeObjects: [],
        animations: [{
          id: "browser-walk",
          name: "Browser walk",
          fps: 12,
          loop: true,
          keyframes: [{
            uid: "browser-keyframe",
            sourceIndex: 1,
            pivotX: 0.5,
            pivotY: 0.5,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          }],
        }],
        builderAssets: [],
        aspectRatio: "1:1",
      },
      ui: { currentMode: "TEMPLATE" },
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(payload)], "deferred-browser.json", {
      type: "application/json",
    }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!loaded) throw new Error("Browser fixture input is unavailable.");
  await waitForText(client, "Project loaded");
}

async function navigateWorkspace(client, workspaceId) {
  const changed = await client.evaluate(`(() => {
    const target = document.querySelector('[data-workspace-id=${JSON.stringify(workspaceId)}]');
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
  if (!changed) throw new Error("Browser workspace target is unavailable.");
  await client.waitFor(`location.hash === ${JSON.stringify(`#/studio/${workspaceId}`)} && Boolean(
    document.querySelector(${JSON.stringify(`[data-studio-workspace-content="${workspaceId}"]`)}),
  )`);
}

async function captureScreenshot(client, screenshotPath) {
  if (!screenshotPath) return;
  const outputPath = resolve(screenshotPath);
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, Buffer.from(result.data, "base64"));
}

export async function runDeferredFeatureBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runtimeDeadlineMs = options.runtimeDeadlineMs ?? RUNTIME_DEADLINE_MS;
  if (!Number.isSafeInteger(runtimeDeadlineMs) || runtimeDeadlineMs <= 0 || runtimeDeadlineMs > RUNTIME_DEADLINE_MS) {
    throw new TypeError("Deferred browser runtime deadline is invalid.");
  }
  const chunkPaths = deferredChunkMap(cwd);
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-deferred-chrome-"));
  const requestedPaths = [];
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
    ], {
      cwd,
      env: process.env,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const devToolsPort = await waitForDevToolsPort(profileDirectory, chrome);
    client = await connectToPage(devToolsPort);
    installRequestPathCollector(client, baseUrl, requestedPaths);
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
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/export` });
    await client.waitFor(`document.readyState === "complete" && Boolean(
      document.querySelector('[data-studio-workspace-content="export"]'),
    )`);
    await client.waitForNetworkIdle();
    const initialRequestPaths = requestedPaths.slice();

    await seedExportFixture(client);
    await clickButton(client, "Individual PNGs (.zip)");
    await waitForText(client, "Generate & Download ZIP");
    await clickButton(client, "Generate & Download ZIP");
    await client.waitFor(`document.body.innerText.includes("ZIP downloaded")`);
    await delay(250);

    await clickButton(client, "Animation Sequence (.gif)");
    await waitForText(client, "Export GIF");
    await clickButton(client, "Export GIF");
    await client.waitFor(`document.body.innerText.includes("GIF Exported")`, 30_000);
    await delay(250);

    await navigateWorkspace(client, "slice");
    const preparedAi = await client.evaluate(`(() => {
      sessionStorage.setItem("sprite-boy-gemini-api-key", "browser-fixture-key");
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("generativelanguage.googleapis.com")) {
          return Promise.reject(new Error("Browser fixture provider unavailable."));
        }
        return nativeFetch(input, init);
      };
      const aiTab = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("AI Creator"),
      );
      if (!(aiTab instanceof HTMLButtonElement)) return false;
      aiTab.click();
      return true;
    })()`);
    if (!preparedAi) throw new Error("AI Creator browser tab is unavailable.");
    await waitForText(client, "Run Generator");
    const prompted = await client.evaluate(`(() => {
      const prompt = document.querySelector("textarea");
      if (!(prompt instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(prompt, "Browser deferred feature proof");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    if (!prompted) throw new Error("AI prompt browser control is unavailable.");
    await clickButton(client, "Run Generator");
    await client.waitFor(`document.body.innerText.includes("Gen error:")`, 30_000);
    await delay(250);

    await navigateWorkspace(client, "export");
    await clickButton(client, "Individual PNGs (.zip)");
    await waitForText(client, "Generate & Download ZIP");
    await client.waitFor(`(() => {
      const title = document.querySelector("#studio-export-title");
      const rect = title?.getBoundingClientRect();
      return title?.textContent?.includes("Export Individual Frames") &&
        Boolean(rect && rect.width > 0 && rect.height > 0);
    })()`);
    await delay(600);
    await captureScreenshot(client, options.screenshotPath);

    const finalPage = await client.evaluate(`({
      finalRoute: location.hash,
      pageFits: document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
      dialogVisible: Boolean(document.querySelector('[role="dialog"]')),
    })`);
    return evaluateDeferredFeatureEvidence({
      initialRequestPaths,
      finalRequestPaths: requestedPaths.slice(),
      zipSucceeded: true,
      gifSucceeded: true,
      aiFailureContained: true,
      ...finalPage,
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    }, chunkPaths);
  }, () => cleanupBrowserRuntime(
    client,
    chrome,
    preview,
    profileDirectory,
    "Deferred browser runtime cleanup failed.",
  ), runtimeDeadlineMs);
}

export async function runDeferredFeatureBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runDeferredFeatureBrowser({
      screenshotPath: process.env.STUDIO_DEFERRED_SCREENSHOT,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "deferred-feature-browser",
      status: "fail",
      reason: "browser-journey-unavailable",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runDeferredFeatureBrowserCli();
