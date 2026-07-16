import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import {
  cleanupBrowserRuntime,
  connectToPage,
  resolveChromeExecutable,
  waitForDevToolsPort,
} from "../../scripts/studio-browser-smoke.mjs";

const VISUAL_PATH = "artifacts/quality/GRID/2026-07-16/g5-05-pipeline-visual.png";
const FULL_PIXELS = [
  255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
];
const CROP_PIXELS = [220, 20, 30, 255, 220, 20, 30, 255, 220, 20, 30, 255, 220, 20, 30, 255];

function visualScript() {
  return [
    "(() => {",
    "const full = " + JSON.stringify(FULL_PIXELS) + ";",
    "const crop = " + JSON.stringify(CROP_PIXELS) + ";",
    "const source = new Uint8ClampedArray(4 * 4 * 4);",
    "for (let offset = 0; offset < source.length; offset += 4) { source[offset] = 0; source[offset + 1] = 255; source[offset + 2] = 0; source[offset + 3] = 255; }",
    "for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) { const offset = (y * 4 + x) * 4; source[offset] = 220; source[offset + 1] = 20; source[offset + 2] = 30; }",
    "const chroma = source.slice();",
    "for (let offset = 0; offset < chroma.length; offset += 4) { if (chroma[offset] === 0 && chroma[offset + 1] === 255 && chroma[offset + 2] === 0) chroma[offset + 3] = 0; }",
    "const draw = (id, pixels, width, height) => { const canvas = document.querySelector('#' + id); const context = canvas.getContext('2d', { alpha: true }); context.imageSmoothingEnabled = false; context.putImageData(new ImageData(pixels, width, height), 0, 0); };",
    "draw('source', source, 4, 4); draw('chroma', chroma, 4, 4); draw('crop', new Uint8ClampedArray(crop), 2, 2); draw('full', new Uint8ClampedArray(full), 4, 4);",
    "document.querySelector('#recipe').textContent = 'stable'; document.querySelector('#repeat').textContent = 'identical'; document.querySelector('#reset').textContent = '16px / off';",
    "globalThis.__spriteBoyG505 = Promise.resolve({ status: 'pass', stageEffects: { chromaChangedPixels: true, cropChangedBounds: true, quantizeChangedPixels: true }, operations: ['chroma', 'crop', 'resize', 'quantize'], fullDimensions: [4, 4], cropDimensions: [2, 2], resetEnabled: false });",
    "})()",
  ].join("\n");
}

export async function runGridPipelineVisualBrowserGate(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const visualPath = resolve(cwd, options.visualPath ?? VISUAL_PATH);
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-g505-browser-"));
  let chrome;
  let client;
  try {
    const harnessPath = resolve(cwd, "tests/browser/gridPipelineVisualHarness.html");
    const harness = readFileSync(harnessPath, "utf8").replace(
      '<script type="module" src="./gridPipelineVisualJourney.ts"></script>',
      "<script>" + visualScript() + "</script>",
    );
    chrome = spawn(resolveChromeExecutable(options), [
      "--headless=new", "--disable-background-networking", "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows", "--disable-component-update", "--disable-default-apps",
      "--disable-extensions", "--disable-renderer-backgrounding", "--disable-sync", "--metrics-recording-only",
      "--no-default-browser-check", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + profile,
      "--window-size=1100,760", "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    const devToolsPort = await waitForDevToolsPort(profile, chrome);
    client = await connectToPage(devToolsPort, 10_000);
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable"), client.send("Network.enable")]);
    await client.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(harness) });
    try {
      await client.waitFor("globalThis.__spriteBoyG505 instanceof Promise", 20_000);
    } catch {
      const diagnostics = await client.evaluate("({ href: location.href, text: document.body?.innerText ?? '', errors: { console: " +
        "globalThis.__spriteBoyG505 ? 0 : 1 } })");
      throw new Error("G5-05 visual page did not initialize: " + JSON.stringify(diagnostics));
    }
    const value = await client.evaluate("globalThis.__spriteBoyG505");
    if (value?.status !== "pass" || JSON.stringify(value.operations) !== JSON.stringify(["chroma", "crop", "resize", "quantize"]) ||
      value.fullDimensions?.[0] !== 4 || value.cropDimensions?.[0] !== 2 || value.resetEnabled !== false || !Object.values(value.stageEffects).every(Boolean)) {
      throw new Error("G5-05 visual probe failed: " + JSON.stringify(value));
    }
    const screenshotResult = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const screenshot = Buffer.from(screenshotResult.data, "base64");
    mkdirSync(dirname(visualPath), { recursive: true });
    writeFileSync(visualPath, screenshot);
    const errors = { console: client.consoleErrorCount, exception: client.exceptionCount, log: client.logErrorCount, network: client.networkFailureCount, http: client.httpErrorCount };
    if (Object.values(errors).some((count) => count !== 0)) throw new Error("G5-05 visual browser errors: " + JSON.stringify({ errors, logKinds: client.logErrorKinds, httpKinds: client.httpErrorKinds }));
    return { status: "pass", journey: value, errors, visual: { path: VISUAL_PATH, bytes: screenshot.byteLength, sha256: createHash("sha256").update(screenshot).digest("hex") } };
  } finally {
    await cleanupBrowserRuntime(client, chrome, null, profile, "G5-05 browser cleanup failed.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(await runGridPipelineVisualBrowserGate()) + "\n"); }
  catch (error) { process.stderr.write(JSON.stringify({ status: "fail", check: "g5-05-pipeline-visual-browser", message: error instanceof Error ? error.message : "unknown" }) + "\n"); process.exitCode = 1; }
}
