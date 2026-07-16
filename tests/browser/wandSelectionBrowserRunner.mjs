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
  waitForDevToolsPort,
  waitForPreview,
} from "../../scripts/studio-browser-smoke.mjs";

const SCREENSHOT_PATH = "artifacts/quality/GRID/2026-07-16/s1-02-wand-selection.png";

export async function runWandSelectionBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const screenshotPath = resolve(cwd, options.screenshotPath ?? SCREENSHOT_PATH);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-s102-browser-"));
  let vite;
  let chrome;
  let client;
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
      "--window-size=800,600",
      "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profile, chrome);
    client = await connectToPage(devToolsPort, 30_000);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
    ]);
    try {
      await client.send("Page.navigate", { url: `${baseUrl}/tests/browser/wandSelectionHarness.html` });
    } catch {
      // Cold Vite transforms can outlive the CDP command timeout; readiness below remains authoritative.
    }
    await client.waitFor("globalThis.__spriteBoyS102 instanceof Promise", 60_000);
    const journey = await client.evaluate(`(async () => {
      try { return { ok: true, value: await globalThis.__spriteBoyS102 }; }
      catch { return { ok: false }; }
    })()`);
    if (!journey?.ok || !journey.value || typeof journey.value !== "object") {
      throw new Error("S1-02 browser journey failed.");
    }
    const screenshot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const png = Buffer.from(screenshot.data, "base64");
    const runtime = {
      consoleErrorCount: client.consoleErrorCount,
      exceptionCount: client.exceptionCount,
      logErrorCount: client.logErrorCount,
      networkFailureCount: client.networkFailureCount,
      httpErrorCount: client.httpErrorCount,
    };
    if (
      journey.value.componentCount !== 1
      || journey.value.pixelCount !== 6
      || journey.value.bounds !== "1,0,3,4"
      || journey.value.path !== "M1 0h1v1h-1zM1 1h3v1h-3zM3 2h1v1h-1zM3 3h1v1h-1z"
      || journey.value.focusTargetCount !== 0
      || journey.value.sourcePoint !== "8,6"
      || Object.values(runtime).some((count) => count !== 0)
    ) throw new Error("S1-02 browser evidence failed closed.");
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, png);
    return Object.freeze({
      status: "pass",
      ...journey.value,
      screenshotPath: SCREENSHOT_PATH,
      screenshotBytes: png.byteLength,
      screenshotSha256: createHash("sha256").update(png).digest("hex"),
      ...runtime,
    });
  } finally {
    await cleanupBrowserRuntime(client, chrome, vite, profile, "S1-02 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runWandSelectionBrowserGate())}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({ status: "fail", check: "s1-02-wand-browser" })}\n`);
    process.exitCode = 1;
  }
}
