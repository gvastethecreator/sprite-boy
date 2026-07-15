/** Production build smoke using Chrome DevTools Protocol and no browser dependency. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const BROWSER_SMOKE_RUNTIME_DEADLINE_MS = 40_000;
const BROWSER_BUDGET_RUNTIME_DEADLINE_MS = 70_000;

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function withTimeout(promise, milliseconds, message) {
  let handle;
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle);
  }
}

export async function runWithBrowserRuntimeDeadline(
  operation,
  cleanup,
  timeoutMs,
  message = "Browser internal runtime deadline exceeded.",
) {
  if (typeof operation !== "function" || typeof cleanup !== "function") {
    throw new TypeError("Browser runtime operation and cleanup must be functions.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Browser runtime deadline is invalid.");
  }
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timeoutHandle);
    await cleanup();
  }
}

export function chromeExecutableCandidates(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    return [
      env.STUDIO_CHROME_PATH,
      env.PROGRAMFILES && win32.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      env["PROGRAMFILES(X86)"] && win32.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ].filter(Boolean);
  }
  if (platform === "darwin") {
    return [
      env.STUDIO_CHROME_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ].filter(Boolean);
  }
  return [
    env.STUDIO_CHROME_PATH,
    posix.join("/usr/bin", "google-chrome"),
    posix.join("/usr/bin", "google-chrome-stable"),
    posix.join("/usr/bin", "chromium"),
    posix.join("/usr/bin", "chromium-browser"),
  ].filter(Boolean);
}

export function resolveChromeExecutable(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? existsSync;
  const candidates = chromeExecutableCandidates(platform, env);
  const direct = candidates.find((candidate) => exists(candidate));
  if (direct) return direct;

  const command = platform === "win32" ? "where" : "which";
  const names = platform === "win32"
    ? ["chrome.exe", "chrome"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const lookup = options.spawnSync ?? spawnSync;
  for (const name of names) {
    const result = lookup(command, [name], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    const candidate = result.status === 0
      ? String(result.stdout).split(/\r?\n/u).map((value) => value.trim()).find(Boolean)
      : undefined;
    if (candidate && exists(candidate)) return candidate;
  }
  throw new Error("Chrome executable is unavailable.");
}

export async function allocatePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  if (port === 0) throw new Error("Preview port allocation failed.");
  return port;
}

export function resolveViteCliEntry(cwd = process.cwd(), dependencies = {}) {
  const requireFromProject = (dependencies.createRequire ?? createRequire)(
    join(resolve(cwd), "package.json"),
  );
  const packagePath = requireFromProject.resolve("vite/package.json");
  const cliPath = join(dirname(packagePath), "bin", "vite.js");
  if (!(dependencies.existsSync ?? existsSync)(cliPath)) {
    throw new Error("Vite CLI entry is unavailable.");
  }
  return cliPath;
}

export function resolveNodeExecutable(options = {}) {
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? existsSync;
  if (env.STUDIO_NODE_PATH && exists(env.STUDIO_NODE_PATH)) return env.STUDIO_NODE_PATH;

  const currentExecutable = options.execPath ?? process.execPath;
  const runtimeIsBun = options.runtimeIsBun ?? Boolean(process.versions.bun);
  if (!runtimeIsBun && exists(currentExecutable)) return currentExecutable;

  const command = (options.platform ?? process.platform) === "win32" ? "where" : "which";
  const result = (options.spawnSync ?? spawnSync)(command, ["node"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const candidate = result.status === 0
    ? String(result.stdout).split(/\r?\n/u).map((value) => value.trim()).find(Boolean)
    : undefined;
  if (candidate && exists(candidate)) return candidate;
  throw new Error("Node executable is unavailable.");
}

export function spawnViteServer(cwd, port, mode = "dev", dependencies = {}) {
  if (mode !== "dev" && mode !== "preview") {
    throw new TypeError("Vite server mode is invalid.");
  }
  const cliPath = resolveViteCliEntry(cwd, dependencies);
  const args = [
    cliPath,
    ...(mode === "preview" ? ["preview"] : []),
    "--host", HOST,
    "--port", String(port),
    "--strictPort",
  ];
  return (dependencies.spawn ?? spawn)(resolveNodeExecutable(dependencies), args, {
    cwd: resolve(cwd),
    env: dependencies.env ?? process.env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
}

export async function waitForPreview(url, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Preview process exited before readiness.");
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.min(1_000, deadline - Date.now()))),
      });
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await delay(80);
  }
  throw new Error("Preview readiness timed out.");
}

export async function waitForDevToolsPort(profileDirectory, child, timeoutMs = 20_000) {
  const filePath = join(profileDirectory, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Chrome exited before DevTools readiness.");
    if (existsSync(filePath)) {
      try {
        const [portText] = readFileSync(filePath, "utf8").split(/\r?\n/u);
        const port = Number(portText);
        if (Number.isSafeInteger(port) && port > 0) return port;
      } catch {
        // Chrome can briefly hold the file while publishing the selected port.
      }
    }
    await delay(50);
  }
  throw new Error("Chrome DevTools readiness timed out.");
}

export class CdpClient {
  constructor(socket, commandTimeoutMs = 10_000) {
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
    this.consoleErrorCount = 0;
    this.exceptionCount = 0;
    this.logErrorCount = 0;
    this.logErrorKinds = [];
    this.networkFailureCount = 0;
    this.httpErrorCount = 0;
    this.networkFailureKinds = [];
    this.httpErrorKinds = [];
    this.networkInFlight = new Set();
    this.lastNetworkActivity = Date.now();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timeoutHandle);
        if (message.error) pending.reject(new Error(`Chrome command ${pending.method} failed.`));
        else pending.resolve(message.result);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        this.consoleErrorCount += 1;
      } else if (message.method === "Runtime.exceptionThrown") {
        this.exceptionCount += 1;
      } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
        this.logErrorCount += 1;
        const entry = message.params.entry;
        let path = null;
        try {
          path = entry.url ? new URL(entry.url).pathname : null;
        } catch {
          // Do not retain a malformed or potentially private URL.
        }
        this.logErrorKinds.push({ source: String(entry.source ?? "unknown"), path });
      } else if (message.method === "Network.requestWillBeSent") {
        this.lastNetworkActivity = Date.now();
        this.networkInFlight.add(message.params.requestId);
      } else if (message.method === "Network.loadingFinished") {
        this.lastNetworkActivity = Date.now();
        this.networkInFlight.delete(message.params.requestId);
      } else if (message.method === "Network.loadingFailed") {
        this.lastNetworkActivity = Date.now();
        this.networkInFlight.delete(message.params.requestId);
        this.networkFailureCount += 1;
        this.networkFailureKinds.push({
          type: String(message.params.type ?? "Other"),
          canceled: message.params.canceled === true,
          blocked: message.params.blockedReason !== undefined,
        });
      } else if (
        message.method === "Network.responseReceived" &&
        Number(message.params?.response?.status) >= 400
      ) {
        this.httpErrorCount += 1;
        this.httpErrorKinds.push({
          type: String(message.params.type ?? "Other"),
          status: Number(message.params.response.status),
        });
      }
    });
    const disconnect = () => this.handleDisconnect();
    socket.addEventListener("close", disconnect, { once: true });
    socket.addEventListener("error", disconnect, { once: true });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Chrome connection closed."));
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Chrome command ${method} timed out.`));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, method, timeoutHandle });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timeoutHandle);
        this.pending.delete(id);
        reject(new Error(`Chrome command ${method} could not be sent.`));
      }
    });
  }

  handleDisconnect() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error("Chrome connection closed."));
    }
    this.pending.clear();
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error("Browser evaluation failed.");
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.closed) throw new Error("Chrome connection closed.");
      try {
        if (await this.evaluate(expression)) return;
      } catch {
        if (this.closed) throw new Error("Chrome connection closed.");
        // Navigation can destroy the prior execution context before the new
        // document is ready to evaluate the predicate.
      }
      await delay(80);
    }
    throw new Error("Browser application readiness timed out.");
  }

  async waitForNetworkIdle(idleMs = 300, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.closed) throw new Error("Chrome connection closed.");
      if (this.networkInFlight.size === 0 && Date.now() - this.lastNetworkActivity >= idleMs) return;
      await delay(50);
    }
    throw new Error("Browser network idle timed out.");
  }

  close() {
    const alreadyClosed = this.closed;
    this.handleDisconnect();
    if (!alreadyClosed) {
      try {
        this.socket.close();
      } catch {
        // The transport can already be gone after Chrome exits.
      }
    }
  }
}

export async function connectToPage(port, commandTimeoutMs = 10_000) {
  const targets = await fetch(`http://${HOST}:${port}/json/list`, {
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json());
  const page = targets.find((candidate) => candidate.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("Chrome page target is unavailable.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await withTimeout(
    new Promise((resolvePromise, reject) => {
      socket.addEventListener("open", resolvePromise, { once: true });
      socket.addEventListener("error", () => reject(new Error("Chrome connection failed.")), { once: true });
    }),
    10_000,
    "Chrome connection timed out.",
  );
  return new CdpClient(socket, commandTimeoutMs);
}

export function processHasExited(child, dependencies = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return false;
  try {
    (dependencies.kill ?? process.kill)(child.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

export async function waitForExit(child, timeoutMs = 5_000, dependencies = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processHasExited(child, dependencies)) return;
    await delay(50);
  }
  if (!processHasExited(child, dependencies)) throw new Error("Process exit timed out.");
}

export async function terminateChildProcess(child, timeoutMs = 5_000, dependencies = {}) {
  if (!child || processHasExited(child, dependencies)) return;
  try {
    child.kill();
  } catch {
    // Escalation below remains authoritative.
  }
  try {
    await waitForExit(child, timeoutMs, dependencies);
    return;
  } catch {
    if (!processHasExited(child, dependencies)) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The verified wait below decides whether cleanup succeeded.
      }
    }
  }
  await waitForExit(child, timeoutMs, dependencies);
}

export async function safeRemoveProfile(profileDirectory, dependencies = {}) {
  if (!profileDirectory) return;
  const temporaryRoot = resolve(tmpdir());
  const resolvedProfile = resolve(profileDirectory);
  if (!resolvedProfile.startsWith(`${temporaryRoot}${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Temporary Chrome profile path is invalid.");
  }
  const remove = dependencies.rm ?? rm;
  const wait = dependencies.delay ?? delay;
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await remove(resolvedProfile, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 39) await wait(500);
    }
  }
  throw lastError;
}

export async function cleanupBrowserRuntime(
  client,
  chrome,
  server,
  profileDirectory,
  failureMessage = "Browser runtime cleanup failed.",
) {
  const cleanupFailures = [];
  if (client) {
    try {
      await withTimeout(client.send("Browser.close"), 2_000, "Browser close timed out.");
    } catch {
      // The process termination check below remains authoritative.
    }
    client.close();
  }
  try {
    await terminateChildProcess(chrome);
  } catch {
    cleanupFailures.push("chrome");
  }
  try {
    await terminateChildProcess(server);
  } catch {
    cleanupFailures.push("server");
  }
  if (!chrome || processHasExited(chrome)) {
    try {
      await safeRemoveProfile(profileDirectory);
    } catch {
      cleanupFailures.push("profile");
    }
  } else {
    cleanupFailures.push("profile-in-use");
  }
  if (cleanupFailures.length > 0) {
    throw new Error(`${failureMessage} (${cleanupFailures.join(",")}).`);
  }
}

const BUDGET_INSTRUMENTATION_SOURCE = `(() => {
  const state = {
    rafRequests: 0,
    longTaskCount: 0,
    longTaskMaxMs: 0,
    longTaskTotalMs: 0,
    longTaskObserverAvailable: false,
    longTaskObserver: null,
  };
  Object.defineProperty(globalThis, "__spriteBoyBudget", { value: state });
  const nativeRequestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (callback) => {
    state.rafRequests += 1;
    return nativeRequestAnimationFrame(callback);
  };
  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTaskCount += 1;
          state.longTaskMaxMs = Math.max(state.longTaskMaxMs, entry.duration);
          state.longTaskTotalMs += entry.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      state.longTaskObserver = observer;
      state.longTaskObserverAvailable = true;
    } catch {
      // Long Task API can be unavailable without invalidating other metrics.
    }
  }
})()`;

const INTERACTIVE_AX_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "gridcell",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

export function summarizeAccessibilityTree(nodes) {
  const unlabeledRoles = {};
  let exposedNodeCount = 0;
  let interactiveNodeCount = 0;
  let mainLandmarkCount = 0;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.ignored === true) continue;
    exposedNodeCount += 1;
    const role = typeof node?.role?.value === "string" ? node.role.value : "unknown";
    if (role === "main") mainLandmarkCount += 1;
    const focusable = Array.isArray(node?.properties) && node.properties.some(
      (property) => property?.name === "focusable" && property?.value?.value === true,
    );
    if (!INTERACTIVE_AX_ROLES.has(role) && !focusable) continue;
    interactiveNodeCount += 1;
    const name = typeof node?.name?.value === "string" ? node.name.value.trim() : "";
    if (name.length === 0) unlabeledRoles[role] = (unlabeledRoles[role] ?? 0) + 1;
  }
  return Object.freeze({
    exposedNodeCount,
    interactiveNodeCount,
    unlabeledInteractiveCount: Object.values(unlabeledRoles).reduce((sum, count) => sum + count, 0),
    unlabeledRoles: Object.freeze(unlabeledRoles),
    mainLandmarkCount,
  });
}

function percentile95(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  const sorted = samples.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

async function collectBrowserBudgetEvidence(client, idleWindowMs, settleMs) {
  await delay(settleMs);
  const idleStart = await client.evaluate(`(() => {
    const state = globalThis.__spriteBoyBudget;
    if (!state) return -1;
    state.longTaskObserver?.takeRecords();
    state.longTaskCount = 0;
    state.longTaskMaxMs = 0;
    state.longTaskTotalMs = 0;
    return state.rafRequests;
  })()`);
  if (!Number.isSafeInteger(idleStart) || idleStart < 0) throw new Error("Browser budget instrumentation is unavailable.");
  await delay(idleWindowMs);
  const idleEnd = await client.evaluate("globalThis.__spriteBoyBudget?.rafRequests ?? -1");
  const interactionEvidence = await client.evaluate(`(async () => {
    const samples = [];
    const transitions = [];
    const workspaceIds = ["compose", "animate", "collision", "export", "slice"];
    for (let run = 0; run < 4; run += 1) {
      for (const workspaceId of workspaceIds) {
        const target = document.querySelector('[data-workspace-id="' + workspaceId + '"]');
        if (!(target instanceof HTMLElement)) throw new Error("Workspace target is unavailable.");
        const startedAt = performance.now();
        target.click();
        const transition = await new Promise((resolveTransition, rejectTransition) => {
          const deadline = performance.now() + 2_000;
          let paintedFrames = 0;
          const observeTransition = () => {
            paintedFrames += 1;
            const activeTarget = document.querySelector(
              '[data-workspace-id="' + workspaceId + '"][aria-current="page"]',
            );
            const content = document.querySelector(
              '[data-studio-workspace-content="' + workspaceId + '"]',
            );
            const contentIsVisible = content instanceof HTMLElement && Array.from(content.getClientRects())
              .some((rect) => rect.width > 0 && rect.height > 0);
            if (
              location.hash === "#/studio/" + workspaceId &&
              activeTarget === target &&
              contentIsVisible &&
              paintedFrames >= 2
            ) {
              resolveTransition({
                paintedAt: performance.now(),
                finalHash: location.hash,
                active: true,
                contentActive: true,
              });
              return;
            }
            if (performance.now() >= deadline) {
              rejectTransition(new Error("Workspace transition did not become active."));
              return;
            }
            requestAnimationFrame(observeTransition);
          };
          requestAnimationFrame(observeTransition);
        });
        samples.push(transition.paintedAt - startedAt);
        transitions.push({
          run,
          workspaceId,
          finalHash: transition.finalHash,
          active: transition.active,
          contentActive: transition.contentActive,
        });
      }
    }
    return { samples, transitions };
  })()`);
  await client.waitForNetworkIdle();
  const instrumentation = await client.evaluate(`(() => {
    const state = globalThis.__spriteBoyBudget;
    for (const entry of state?.longTaskObserver?.takeRecords?.() ?? []) {
      state.longTaskCount += 1;
      state.longTaskMaxMs = Math.max(state.longTaskMaxMs, entry.duration);
      state.longTaskTotalMs += entry.duration;
    }
    return {
      longTaskCount: state?.longTaskCount ?? -1,
      longTaskMaxMs: state?.longTaskMaxMs ?? -1,
      longTaskTotalMs: state?.longTaskTotalMs ?? -1,
      longTaskObserverAvailable: state?.longTaskObserverAvailable === true,
      route: location.hash,
    };
  })()`);
  const [axTree, performanceMetrics] = await Promise.all([
    client.send("Accessibility.getFullAXTree"),
    client.send("Performance.getMetrics"),
  ]);
  const metrics = {};
  for (const metric of performanceMetrics.metrics ?? []) {
    if (["TaskDuration", "JSHeapUsedSize", "Nodes", "LayoutCount", "RecalcStyleCount"].includes(metric.name)) {
      metrics[metric.name] = metric.value;
    }
  }
  const interactionSamplesMs = interactionEvidence.samples;
  return Object.freeze({
    idleWindowMs,
    idleRafRequests: idleEnd - idleStart,
    interactionSamplesMs: Object.freeze(interactionSamplesMs.map((value) => Number(value))),
    interactionTransitions: Object.freeze(interactionEvidence.transitions.map(
      (transition) => Object.freeze({ ...transition }),
    )),
    inputToPaintP95Ms: percentile95(interactionSamplesMs),
    longTaskCount: instrumentation.longTaskCount,
    longTaskMaxMs: instrumentation.longTaskMaxMs,
    longTaskTotalMs: instrumentation.longTaskTotalMs,
    longTaskObserverAvailable: instrumentation.longTaskObserverAvailable,
    finalRoute: instrumentation.route,
    performanceMetrics: Object.freeze(metrics),
    accessibility: summarizeAccessibilityTree(axTree.nodes),
  });
}

export async function runBrowserSmoke(options = {}) {
  const collectBudgets = options.collectBudgets === true;
  const maximumRuntimeDeadlineMs = collectBudgets
    ? BROWSER_BUDGET_RUNTIME_DEADLINE_MS
    : BROWSER_SMOKE_RUNTIME_DEADLINE_MS;
  const runtimeDeadlineMs = options.runtimeDeadlineMs ?? maximumRuntimeDeadlineMs;
  if (
    !Number.isSafeInteger(runtimeDeadlineMs) || runtimeDeadlineMs <= 0 ||
    runtimeDeadlineMs > maximumRuntimeDeadlineMs
  ) {
    throw new TypeError("Browser runtime deadline cannot exceed its cleanup-safe maximum.");
  }
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-chrome-"));
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
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      ...(collectBudgets ? [client.send("Performance.enable"), client.send("Accessibility.enable")] : []),
      client.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    ]);
    if (collectBudgets) {
      await client.send("Page.addScriptToEvaluateOnNewDocument", {
        source: BUDGET_INSTRUMENTATION_SOURCE,
      });
    }
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    try {
      await client.waitFor(`(() => {
        const shell = document.querySelector('[data-studio-workspace="slice"]');
        const content = document.querySelector('[data-studio-workspace-content="slice"]');
        const active = document.querySelector('[data-workspace-id="slice"][aria-current="page"]');
        return document.readyState === 'complete' && Boolean(shell && content && active);
      })()`);
    } catch {
      let readiness = { state: "unavailable" };
      try {
        readiness = await client.evaluate(`({
          state: document.readyState,
          hash: location.hash,
          workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace ?? null,
          hasContent: Boolean(document.querySelector('[data-studio-workspace-content]')),
          hasActiveRoute: Boolean(document.querySelector('[data-workspace-id][aria-current="page"]')),
        })`);
      } catch {
        // Keep the diagnostic structural when the page has no live context.
      }
      throw new Error(`Browser application readiness failed: ${JSON.stringify(readiness)}`);
    }
    await client.waitForNetworkIdle();
    const budgets = collectBudgets
      ? await collectBrowserBudgetEvidence(
        client,
        options.idleWindowMs ?? 5_000,
        options.settleMs ?? 1_000,
      )
      : null;
    const page = await client.evaluate(`(() => {
      const content = document.querySelector('[data-studio-workspace-content="slice"]');
      const rect = content?.getBoundingClientRect();
      return {
        hash: location.hash,
        workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
        contentVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
        activeRoute: Boolean(document.querySelector('[data-workspace-id="slice"][aria-current="page"]')),
        pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
      };
    })()`);
    const passed = page.hash === "#/studio/slice" &&
      page.workspace === "slice" &&
      page.contentVisible &&
      page.activeRoute &&
      page.pageFits &&
      client.consoleErrorCount === 0 &&
      client.exceptionCount === 0 &&
      client.logErrorCount === 0 &&
      client.networkFailureCount === 0 &&
      client.httpErrorCount === 0;
    if (!passed) {
      throw new Error(`Production browser smoke assertions failed: ${JSON.stringify({
        ...page,
        consoleErrorCount: client.consoleErrorCount,
        exceptionCount: client.exceptionCount,
        logErrorCount: client.logErrorCount,
        logErrorKinds: client.logErrorKinds,
        networkFailureCount: client.networkFailureCount,
        networkFailureKinds: client.networkFailureKinds,
        httpErrorCount: client.httpErrorCount,
        httpErrorKinds: client.httpErrorKinds,
      })}`);
    }
    return Object.freeze({
      schemaVersion: 1,
      status: "pass",
      route: page.hash,
      workspace: page.workspace,
      contentVisible: page.contentVisible,
      activeRoute: page.activeRoute,
      pageFits: page.pageFits,
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
      ...(budgets ? { budgets } : {}),
    });
  }, () => cleanupBrowserRuntime(client, chrome, preview, profileDirectory), runtimeDeadlineMs);
}

export async function runBrowserSmokeCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runBrowserSmoke();
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    stderr.write(`${JSON.stringify({ schemaVersion: 1, status: "fail", message: "Production browser smoke failed." })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runBrowserSmokeCli();
