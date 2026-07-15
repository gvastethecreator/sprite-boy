/** F3-07 real-Chrome persistence and portable package journey. */
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
  spawnViteServer,
  waitForDevToolsPort,
  waitForPreview,
} from "./studio-browser-smoke.mjs";

const HOST = "127.0.0.1";
const HARNESS_PATH = "/tests/browser/studioPersistenceHarness.html";
const API_NAME = "__spriteBoyF307";
const COMMAND_TIMEOUT_MS = 30_000;
const HARNESS_TIMEOUT_MS = 60_000;
const INTERNAL_RUNTIME_DEADLINE_MS = 130_000;
export const PERSISTENCE_BROWSER_SCHEMA_VERSION = 1;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hasExactHealthyAssets(value, expectedIds) {
  if (!Array.isArray(value) || value.length !== expectedIds.length) return false;
  const actual = value.map(({ assetId, status }) => status === "ok" ? assetId : "").sort();
  return actual.every((assetId, index) => assetId === expectedIds[index]);
}

export function evaluatePersistenceJourneyEvidence(prepare, resume, finish, diagnostics) {
  const hashes = prepare?.assetHashes;
  const assetIds = isRecord(hashes) ? Object.keys(hashes).sort() : [];
  const uniqueHashCount = isRecord(hashes) ? new Set(Object.values(hashes)).size : 0;
  const hashesValid = assetIds.length === 2 && assetIds.every(
    (assetId) => assetId.length > 0 && /^[0-9a-f]{64}$/u.test(hashes[assetId]),
  );
  const packageHash = prepare?.packageSha256;
  const checks = {
    checkpoint: prepare?.checkpointRevision === 1,
    projectBytes: isPositiveInteger(prepare?.projectBytes),
    packageBytes: isPositiveInteger(prepare?.packageBytes),
    packageHash: typeof packageHash === "string" && /^[0-9a-f]{64}$/u.test(packageHash),
    assetIdentity: prepare?.uniqueBlobCount === 1 && hashesValid &&
      uniqueHashCount === prepare.uniqueBlobCount,
    legacyPreview: prepare?.legacyExpiredBlobUrlCount === 2 &&
      prepare?.legacyPreviewBlockingIssueCount === 3,
    legacyMigration: prepare?.legacyMigrationApplied === true &&
      isPositiveInteger(prepare?.legacyMigrationIssueCount),
    preparePagehide: resume?.preparePagehideDisposed === true,
    reloadDocument: resume?.reloadDocumentExact === true,
    reloadAssets: hasExactHealthyAssets(resume?.reloadIntegrity, assetIds),
    importCounts: resume?.importedBlobCount === 1 && resume?.importedAssetCount === 2,
    importDeduplication: resume?.deduplicated === true,
    importCheckpoint: resume?.importedCheckpointRevision === prepare?.checkpointRevision,
    importPagehide: finish?.preparePagehideDisposed === true && finish?.importPagehideDisposed === true,
    finalDocument: finish?.finalDocumentExact === true && finish?.assetHashesExact === true,
    finalAssets: hasExactHealthyAssets(finish?.finalIntegrity, assetIds),
    finalPackageFlags: finish?.package?.exactBytes === true && finish?.package?.hashExact === true,
    finalPackageHash: finish?.package?.originalSha256 === packageHash &&
      finish?.package?.finalSha256 === packageHash,
    finalPackageBytes: finish?.package?.byteSize === prepare?.packageBytes,
    databaseCleanup: finish?.cleanup?.databasesRemain === false &&
      Array.isArray(finish?.cleanup?.remainingTargetNames) &&
      finish.cleanup.remainingTargetNames.length === 0,
    consoleErrors: diagnostics?.consoleErrorCount === 0,
    runtimeExceptions: diagnostics?.exceptionCount === 0,
    browserLogErrors: diagnostics?.logErrorCount === 0,
    networkFailures: diagnostics?.networkFailureCount === 0,
    httpErrors: diagnostics?.httpErrorCount === 0,
  };
  const failedChecks = Object.entries(checks).flatMap(([name, passed]) => passed ? [] : [name]);
  if (failedChecks.length > 0) {
    throw new TypeError(`F3-07 browser journey evidence is invalid: ${failedChecks.join(",")}.`);
  }
  return Object.freeze({
    schemaVersion: PERSISTENCE_BROWSER_SCHEMA_VERSION,
    check: "persistence-browser",
    status: "pass",
    metrics: Object.freeze({
      reloadCount: 2,
      checkpointRevision: prepare.checkpointRevision,
      importedCheckpointRevision: resume.importedCheckpointRevision,
      projectBytes: prepare.projectBytes,
      packageBytes: prepare.packageBytes,
      assetCount: assetIds.length,
      uniqueBlobCount: prepare.uniqueBlobCount,
      legacyExpiredBlobUrlCount: prepare.legacyExpiredBlobUrlCount,
      legacyPreviewBlockingIssueCount: prepare.legacyPreviewBlockingIssueCount,
      legacyMigrationApplied: true,
      legacyMigrationIssueCount: prepare.legacyMigrationIssueCount,
      deduplicated: true,
      documentExact: true,
      assetHashesExact: true,
      packageBytesExact: true,
      packageHashExact: true,
      pagehideCleanupCount: 2,
      databasesRemain: false,
      consoleErrorCount: 0,
      exceptionCount: 0,
      logErrorCount: 0,
      networkFailureCount: 0,
      httpErrorCount: 0,
    }),
  });
}

const PUBLIC_METRIC_KEYS = Object.freeze([
  "reloadCount",
  "checkpointRevision",
  "importedCheckpointRevision",
  "projectBytes",
  "packageBytes",
  "assetCount",
  "uniqueBlobCount",
  "legacyExpiredBlobUrlCount",
  "legacyPreviewBlockingIssueCount",
  "legacyMigrationApplied",
  "legacyMigrationIssueCount",
  "deduplicated",
  "documentExact",
  "assetHashesExact",
  "packageBytesExact",
  "packageHashExact",
  "pagehideCleanupCount",
  "databasesRemain",
  "consoleErrorCount",
  "exceptionCount",
  "logErrorCount",
  "networkFailureCount",
  "httpErrorCount",
]);

export function normalizePersistenceBrowserResult(result) {
  const metrics = result?.metrics;
  const keys = isRecord(metrics) ? Object.keys(metrics).sort() : [];
  const expectedKeys = [...PUBLIC_METRIC_KEYS].sort();
  if (
    result?.schemaVersion !== PERSISTENCE_BROWSER_SCHEMA_VERSION ||
    result?.check !== "persistence-browser" || result?.status !== "pass" ||
    keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) ||
    metrics.reloadCount !== 2 || metrics.checkpointRevision !== 1 ||
    metrics.importedCheckpointRevision !== 1 || !isPositiveInteger(metrics.projectBytes) ||
    !isPositiveInteger(metrics.packageBytes) || metrics.assetCount !== 2 ||
    metrics.uniqueBlobCount !== 1 || metrics.legacyExpiredBlobUrlCount !== 2 ||
    metrics.legacyPreviewBlockingIssueCount !== 3 || metrics.legacyMigrationApplied !== true ||
    !isPositiveInteger(metrics.legacyMigrationIssueCount) || metrics.deduplicated !== true ||
    metrics.documentExact !== true || metrics.assetHashesExact !== true ||
    metrics.packageBytesExact !== true || metrics.packageHashExact !== true ||
    metrics.pagehideCleanupCount !== 2 || metrics.databasesRemain !== false ||
    [
      metrics.consoleErrorCount,
      metrics.exceptionCount,
      metrics.logErrorCount,
      metrics.networkFailureCount,
      metrics.httpErrorCount,
    ].some((value) => value !== 0)
  ) {
    throw new TypeError("F3-07 public browser result is invalid.");
  }
  return Object.freeze({
    schemaVersion: PERSISTENCE_BROWSER_SCHEMA_VERSION,
    check: "persistence-browser",
    status: "pass",
    metrics: Object.freeze(Object.fromEntries(PUBLIC_METRIC_KEYS.map((key) => [key, metrics[key]]))),
  });
}

function browserDiagnostics(client) {
  return {
    consoleErrorCount: client.consoleErrorCount,
    exceptionCount: client.exceptionCount,
    logErrorCount: client.logErrorCount,
    networkFailureCount: client.networkFailureCount,
    httpErrorCount: client.httpErrorCount,
  };
}

async function waitForHarness(client, previousDocumentId = null) {
  const previous = JSON.stringify(previousDocumentId);
  await client.waitFor(`(() => {
    const api = globalThis.${API_NAME};
    return document.readyState === "complete" && api?.ready === true &&
      (api.documentId !== ${previous});
  })()`, HARNESS_TIMEOUT_MS);
  await client.waitForNetworkIdle();
  const documentId = await client.evaluate(`globalThis.${API_NAME}.documentId`);
  if (typeof documentId !== "string" || documentId.length < 16 || documentId === previousDocumentId) {
    throw new Error("F3-07 harness document identity is invalid.");
  }
  return documentId;
}

async function reloadHarness(client, documentId) {
  await client.send("Page.reload", { ignoreCache: true });
  return waitForHarness(client, documentId);
}

async function runJourneyStage(client, stage, invocation) {
  const outcome = await client.evaluate(`Promise.resolve().then(() => ${invocation}).then(
    (value) => ({ ok: true, value }),
    (error) => ({
      ok: false,
      name: typeof error?.name === "string" ? error.name : "unknown",
      message: typeof error?.message === "string" ? error.message : "",
    }),
  )`);
  if (outcome?.ok === true) return outcome.value;
  const controlledMessage = outcome?.name === "StudioPersistenceJourneyError" &&
    typeof outcome.message === "string" && outcome.message.startsWith("F3-07 ")
    ? outcome.message
    : `F3-07 ${stage} failed without exposing private browser details.`;
  throw new Error(controlledMessage);
}

export async function runWithPersistenceDeadline(
  operation,
  cleanup,
  timeoutMs = INTERNAL_RUNTIME_DEADLINE_MS,
) {
  if (typeof operation !== "function" || typeof cleanup !== "function") {
    throw new TypeError("F3-07 runtime operation and cleanup must be functions.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("F3-07 runtime deadline is invalid.");
  }
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error("F3-07 internal browser runtime deadline exceeded.")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timeoutHandle);
    await cleanup();
  }
}

export async function runStudioPersistenceBrowser(options = {}) {
  const runtimeDeadlineMs = options.runtimeDeadlineMs ?? INTERNAL_RUNTIME_DEADLINE_MS;
  if (
    !Number.isSafeInteger(runtimeDeadlineMs) || runtimeDeadlineMs <= 0 ||
    runtimeDeadlineMs > INTERNAL_RUNTIME_DEADLINE_MS
  ) {
    throw new TypeError("F3-07 runtime deadline cannot exceed its cleanup-safe maximum.");
  }
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-f3-07-chrome-"));
  const runIdentity = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  const assetDatabaseName = `sprite-boy-f3-07-assets-${runIdentity}`;
  const autosaveDatabaseName = `sprite-boy-f3-07-autosave-${runIdentity}`;
  let server;
  let chrome;
  let client;
  return runWithPersistenceDeadline(async () => {
    server = spawnViteServer(cwd, port);
    await waitForPreview(`${baseUrl}${HARNESS_PATH}`, server);
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
    client = await connectToPage(devToolsPort, COMMAND_TIMEOUT_MS);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
    ]);
    await client.send("Page.navigate", { url: `${baseUrl}${HARNESS_PATH}` });
    let documentId = await waitForHarness(client);
    const prepare = await runJourneyStage(client, "prepare",
      `globalThis.${API_NAME}.prepare(${JSON.stringify(assetDatabaseName)}, ${JSON.stringify(autosaveDatabaseName)})`,
    );
    documentId = await reloadHarness(client, documentId);
    const resume = await runJourneyStage(client, "resume", `globalThis.${API_NAME}.resume()`);
    await reloadHarness(client, documentId);
    const finish = await runJourneyStage(client, "finish", `globalThis.${API_NAME}.finish()`);
    return normalizePersistenceBrowserResult(
      evaluatePersistenceJourneyEvidence(prepare, resume, finish, browserDiagnostics(client)),
    );
  }, () => cleanupBrowserRuntime(
    client,
    chrome,
    server,
    profileDirectory,
    "F3-07 browser runtime cleanup failed.",
  ),
  runtimeDeadlineMs,
  );
}

export async function runStudioPersistenceBrowserCli(
  args = process.argv.slice(2),
  io = {},
  dependencies = {},
) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  if (args.length !== 0) {
    stderr.write("Persistence browser gate accepts no arguments.\n");
    return 2;
  }
  try {
    const result = normalizePersistenceBrowserResult(
      await (dependencies.runJourney ?? runStudioPersistenceBrowser)(),
    );
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    stdout.write(`${JSON.stringify({
      schemaVersion: PERSISTENCE_BROWSER_SCHEMA_VERSION,
      check: "persistence-browser",
      status: "fail",
      reason: "persistence-browser-unavailable",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runStudioPersistenceBrowserCli();
