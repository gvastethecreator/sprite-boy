import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
} from "./studio-browser-smoke.mjs";

const DEFAULT_ASSET = "artifacts/quality/UI/2026-07-26/spritesheet-forest-scout-4x2.png";
const DEFAULT_SCREENSHOT = "artifacts/quality/WORKFLOWS/2026-07-27/slice-compose-real.png";

function assert(value, message, detail) {
  if (value) return;
  throw new Error(detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`);
}

async function clickButton(client, label) {
  return client.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function setLocalImageFile(client, selector, filePath) {
  const document = await client.send("DOM.getDocument", { depth: 0, pierce: true });
  const input = await client.send("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector,
  });
  if (!Number.isSafeInteger(input.nodeId) || input.nodeId < 1) return false;
  await client.send("DOM.setFileInputFiles", {
    files: [filePath],
    nodeId: input.nodeId,
  });
  return client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.files?.length === 1) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
}

async function readCanvasPixels(client, selector) {
  return client.evaluate(`(() => {
    const canvas = document.querySelector(${JSON.stringify(selector)});
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparent = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    const colors = new Set();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue;
      nonTransparent += 1;
      const pixelIndex = offset / 4;
      const x = pixelIndex % canvas.width;
      const y = Math.floor(pixelIndex / canvas.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (colors.size < 256) colors.add([
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
      ].join(","));
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonTransparent,
      distinctColors: colors.size,
      bounds: maxX < minX ? null : {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
    };
  })()`);
}

async function waitForPaint(client, selector, minimumPixels = 100) {
  await client.waitFor(`(() => {
    const canvas = document.querySelector(${JSON.stringify(selector)});
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) return false;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] > 0 && ++painted >= ${minimumPixels}) return true;
    }
    return false;
  })()`, 60_000);
}

async function setManualGrid(client, rows, columns) {
  return client.evaluate(`(() => {
    const inspector = document.querySelector("[data-slice-grid-inspector]");
    const manual = inspector?.querySelector('input[type="radio"][value="manual"]');
    const inputs = inspector?.querySelectorAll('input[type="number"]');
    if (!(manual instanceof HTMLInputElement) || !inputs || inputs.length < 2) return false;
    manual.click();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const setValue = (input, value) => {
      setter?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue(inputs[0], ${rows});
    setValue(inputs[1], ${columns});
    return true;
  })()`);
}

async function createNewProject(client) {
  assert(await client.evaluate(`(() => {
    const project = document.querySelector('button[aria-label="Project"]');
    project?.click();
    return project instanceof HTMLButtonElement;
  })()`), "Project menu unavailable");
  await client.waitFor(`Boolean(document.querySelector('[data-command-id="project.new"]:not(:disabled)'))`);
  assert(await client.evaluate(`(() => {
    const button = document.querySelector('[data-command-id="project.new"]');
    button?.click();
    return button instanceof HTMLButtonElement;
  })()`), "New project command unavailable");
  await client.waitFor(`location.hash === "#/studio/slice" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`, 60_000);
}

export async function runCriticalWorkflowsBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const assetPath = resolve(cwd, options.assetPath ?? DEFAULT_ASSET);
  const screenshotPath = resolve(cwd, options.screenshotPath ?? DEFAULT_SCREENSHOT);
  const assetBytes = readFileSync(assetPath);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "sprite-boy-critical-workflows-"));
  let server;
  let chrome;
  let client;
  let stage = "launch";

  try {
    server = spawnViteServer(cwd, port, "preview");
    await waitForPreview(baseUrl, server, 30_000);
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
      "--window-size=1440,900",
      "about:blank",
    ], { cwd, env: process.env, shell: false, stdio: "ignore", windowsHide: true });
    client = await connectToPage(await waitForDevToolsPort(profile, chrome), 30_000);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("DOM.enable"),
    ]);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    stage = "direct Compose import";
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/compose` });
    await client.waitFor(`Boolean(document.querySelector('[data-compose-canvas-first]'))`, 60_000);
    stage = "direct Compose file injection";
    assert(await setLocalImageFile(
      client,
      'input[aria-label="Import images into Compose"]',
      assetPath,
    ), "Compose real image input unavailable");
    stage = "direct Compose layer import";
    await client.waitFor(`document.querySelectorAll('[data-compose-layers] [aria-label^="Select "]').length === 1`, 60_000);
    stage = "direct Compose canvas mount";
    await client.waitFor(`Boolean(document.querySelector("[data-compose-canvas]"))`, 60_000);
    stage = "direct Compose canvas paint";
    await waitForPaint(client, '[data-compose-canvas] canvas[aria-label="Compose canvas"]', 5_000);
    const directCompose = await readCanvasPixels(client, '[data-compose-canvas] canvas[aria-label="Compose canvas"]');
    assert(directCompose?.distinctColors > 8, "Direct Compose import rendered no useful image", directCompose);
    assert(directCompose?.bounds?.width > 300, "Direct Compose image did not fit the workspace", directCompose);

    stage = "new project";
    await createNewProject(client);

    stage = "Slice source import";
    assert(await setLocalImageFile(
      client,
      'input[type="file"][accept*="image/png"]',
      assetPath,
    ), "Slice real image input unavailable");
    await client.waitFor(`Boolean(document.querySelector('[data-studio-source-canvas][data-canonical-canvas-ownership="true"]'))`, 60_000);
    await waitForPaint(client, '[data-studio-source-canvas][data-canonical-canvas-ownership="true"]', 5_000);
    const sliceSource = await readCanvasPixels(client, '[data-studio-source-canvas][data-canonical-canvas-ownership="true"]');
    assert(sliceSource?.distinctColors > 8, "Slice source canvas rendered no useful image", sliceSource);

    stage = "Slice manual grid";
    assert(await setManualGrid(client, 2, 4), "Slice manual grid inputs unavailable");
    await client.waitFor(`document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-recipe-layout") === "2x4"`);
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.getAttribute("data-grid-overlay-cells") === "8"`);

    stage = "Slice process";
    assert(await clickButton(client, "Process slices"), "Slice Process action unavailable");
    await client.waitFor(`document.querySelectorAll('[data-staged-grid-result]').length === 8 || document.body.innerText.includes("8 staged slices ready")`, 60_000);
    const staged = await client.evaluate(`document.querySelectorAll('[data-staged-grid-result]').length || document.querySelectorAll('[aria-label^="Select slice"]').length`);
    assert(staged === 8, "Slice did not stage eight frames", { staged });

    stage = "Slice commit";
    assert(await clickButton(client, "Commit slices"), "Slice Commit action unavailable");
    await client.waitFor(`document.body.innerText.includes("8 slices committed to the project.")`, 60_000);

    stage = "Export handoff";
    assert(await client.evaluate(`(() => {
      const link = document.querySelector('[data-workspace-id="export"]');
      link?.click();
      return link instanceof HTMLElement;
    })()`), "Export workspace unavailable");
    await client.waitFor(`Boolean(document.querySelector("[data-grid-export-center]"))`, 60_000);
    await client.waitFor(`document.querySelectorAll('[aria-label^="Export region "]').length === 8`, 60_000);
    assert(await clickButton(client, "Open in Compose"), "Export to Compose action unavailable");

    stage = "Region Compose render";
    await client.waitFor(`location.hash === "#/studio/compose" && Boolean(document.querySelector("[data-compose-canvas]"))`, 60_000);
    await waitForPaint(client, '[data-compose-canvas] canvas[aria-label="Compose canvas"]', 1_000);
    const regionCompose = await readCanvasPixels(client, '[data-compose-canvas] canvas[aria-label="Compose canvas"]');
    const regionHeading = await client.evaluate(`document.querySelector("#compose-bootstrap-title")?.textContent?.trim() ?? null`);
    assert(regionCompose?.distinctColors > 8, "Slice Region rendered blank in Compose", regionCompose);
    assert(regionCompose?.bounds?.width > 200, "Slice Region did not fit the Compose workspace", regionCompose);

    stage = "Compose reload";
    await client.send("Page.reload", { ignoreCache: false });
    await client.waitFor(`Boolean(document.querySelector("[data-compose-canvas]"))`, 60_000);
    await waitForPaint(client, '[data-compose-canvas] canvas[aria-label="Compose canvas"]', 1_000);
    const reloadedCompose = await readCanvasPixels(client, '[data-compose-canvas] canvas[aria-label="Compose canvas"]');
    assert(reloadedCompose?.distinctColors > 8, "Compose reload rendered blank", reloadedCompose);

    stage = "Slice reload restoration";
    assert(await client.evaluate(`(() => {
      const link = document.querySelector('[data-workspace-id="slice"]');
      link?.click();
      return link instanceof HTMLElement;
    })()`), "Slice workspace unavailable after reload");
    await client.waitFor(`Boolean(document.querySelector('[data-studio-source-canvas][data-canonical-canvas-ownership="true"]'))`, 60_000);
    await waitForPaint(client, '[data-studio-source-canvas][data-canonical-canvas-ownership="true"]', 5_000);
    const restoredSlice = await readCanvasPixels(client, '[data-studio-source-canvas][data-canonical-canvas-ownership="true"]');
    assert(restoredSlice?.distinctColors > 8, "Slice reload rendered blank", restoredSlice);

    const nonEnglishSurface = await client.evaluate(`(() => {
      const terms = /[¿¡]|\\b(?:Configuración|Guardar|Cargar|Cancelar|Eliminar|Exportar|Importar|Selecciona|Aplicar|Procesando|Falló)\\b/giu;
      return document.body.innerText.match(terms) ?? [];
    })()`);
    assert(nonEnglishSurface.length === 0, "Non-English application copy found", nonEnglishSurface);

    const capture = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const screenshotBytes = Buffer.from(capture.data, "base64");
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, screenshotBytes);

    const runtime = {
      console: client.consoleErrorCount,
      exception: client.exceptionCount,
      log: client.logErrorCount,
      network: client.networkFailureCount,
      http: client.httpErrorCount,
    };
    assert(Object.values(runtime).every((count) => count === 0), "Runtime errors found", runtime);
    return {
      schemaVersion: 1,
      check: "critical-slice-compose-workflows",
      status: "pass",
      asset: {
        path: assetPath,
        bytes: assetBytes.byteLength,
        sha256: createHash("sha256").update(assetBytes).digest("hex"),
      },
      directCompose,
      sliceSource,
      staged,
      regionHeading,
      regionCompose,
      reloadedCompose,
      restoredSlice,
      nonEnglishSurface,
      runtime,
      screenshot: {
        path: screenshotPath,
        bytes: screenshotBytes.byteLength,
        sha256: createHash("sha256").update(screenshotBytes).digest("hex"),
      },
    };
  } catch (error) {
    throw new Error(`Critical workflow failed during ${stage}: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    await cleanupBrowserRuntime(
      client,
      chrome,
      server,
      profile,
      "Critical workflow browser cleanup failed.",
    );
  }
}

export async function runCriticalWorkflowsBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runCriticalWorkflowsBrowser();
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "critical-slice-compose-workflows",
      status: "fail",
      reason: error instanceof Error ? error.message : "unknown error",
    })}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) process.exitCode = await runCriticalWorkflowsBrowserCli();
