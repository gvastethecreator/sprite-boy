/** Production Chrome proof for the default grid-processing client and its bundled module Worker. */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const CANONICAL_PROGRESS_STAGES = Object.freeze([
  "decode",
  "detect",
  "chroma",
  "chroma",
  "crop",
  "crop",
  "resize",
  "resize",
  "quantize",
  "quantize",
  "finalize",
]);
const CANONICAL_DIMENSIONS = Object.freeze([[2, 2], [1, 1]]);
const CANONICAL_PIXELS = Object.freeze([
  [
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
  ],
  [0, 0, 0, 0],
]);

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isNumberMatrix(value) {
  return Array.isArray(value) && value.every((row) =>
    Array.isArray(row) && row.every((entry) => Number.isSafeInteger(entry)));
}

export function evaluateGridProcessingBrowserEvidence(evidence) {
  if (
    evidence === null || typeof evidence !== "object" ||
    typeof evidence.workerConstructed !== "boolean" ||
    (evidence.workerType !== null && typeof evidence.workerType !== "string") ||
    !Number.isSafeInteger(evidence.outputCount) || evidence.outputCount < 0 ||
    typeof evidence.sourceDetached !== "boolean" ||
    typeof evidence.progressMonotonic !== "boolean" ||
    !Array.isArray(evidence.progressStages) ||
    evidence.progressStages.some((stage) => typeof stage !== "string") ||
    !isNumberMatrix(evidence.outputDimensions) ||
    !isNumberMatrix(evidence.outputPixels)
  ) {
    throw new TypeError("Grid processing browser evidence is invalid.");
  }
  const errors = Object.freeze({
    console: evidence.consoleErrorCount,
    exception: evidence.exceptionCount,
    log: evidence.logErrorCount,
    network: evidence.networkFailureCount,
    http: evidence.httpErrorCount,
  });
  if (Object.values(errors).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("Grid processing browser diagnostics are invalid.");
  }
  const passed = evidence.workerConstructed && evidence.workerType === "module" &&
    evidence.outputCount === 2 && evidence.sourceDetached && evidence.progressMonotonic &&
    arraysEqual(evidence.progressStages, CANONICAL_PROGRESS_STAGES) &&
    arraysEqual(evidence.outputDimensions, CANONICAL_DIMENSIONS) &&
    arraysEqual(evidence.outputPixels, CANONICAL_PIXELS) &&
    Object.values(errors).every((value) => value === 0);
  return Object.freeze({
    schemaVersion: 1,
    check: "grid-processing-browser",
    status: passed ? "pass" : "fail",
    metrics: Object.freeze({
      workerConstructed: evidence.workerConstructed,
      workerType: evidence.workerType,
      outputCount: evidence.outputCount,
      sourceDetached: evidence.sourceDetached,
      progressMonotonic: evidence.progressMonotonic,
      progressStages: Object.freeze([...evidence.progressStages]),
      outputDimensions: Object.freeze(evidence.outputDimensions.map((row) => Object.freeze([...row]))),
      outputPixels: Object.freeze(evidence.outputPixels.map((row) => Object.freeze([...row]))),
      errors,
    }),
  });
}

export async function runGridProcessingBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-grid-worker-chrome-"));
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
    ]);
    await client.send("Page.navigate", {
      url: `${baseUrl}/?gridWorkerProbe=1#/studio/slice`,
    });
    await client.waitFor(`document.readyState === "complete" &&
      globalThis.__spriteBoyGridProcessingProbe instanceof Promise`);
    const probe = await client.evaluate(`(async () =>
      await globalThis.__spriteBoyGridProcessingProbe)()`);
    if (probe?.state !== "completed" || probe.evidence === null || typeof probe.evidence !== "object") {
      throw new Error("Grid processing browser probe did not complete.");
    }
    await client.evaluate("new Promise((resolvePromise) => setTimeout(resolvePromise, 500))");
    return evaluateGridProcessingBrowserEvidence({
      ...probe.evidence,
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
    "Grid processing browser runtime cleanup failed.",
  ), RUNTIME_DEADLINE_MS);
}

export async function runGridProcessingBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runGridProcessingBrowser();
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "grid-processing-browser",
      status: "fail",
      reason: "Production grid Worker browser proof failed.",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runGridProcessingBrowserCli();
