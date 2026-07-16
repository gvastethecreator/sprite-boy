/** G2-05 production-Chrome journey: controller -> recipe -> source canvas overlay. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const DEADLINE_MS = 75_000;
const mark = (value) => { if (process.env.G205_DEBUG) process.stderr.write(`[g205] ${value}\n`); };

async function selectGridSource(client) {
  return client.evaluate(`(async () => {
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.clearRect(0, 0, 400, 200);
    const colors = ["#f43f5e", "#22c55e", "#38bdf8", "#f59e0b"];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        context.fillStyle = colors[(row + col) % colors.length];
        context.fillRect(10 + col * 100, 10 + row * 100, 80, 80);
      }
    }
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (!(blob instanceof Blob)) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "g2-05-grid.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function setManual(client, rows, cols) {
  return client.evaluate(`(() => {
    const inspector = document.querySelector("[data-slice-grid-inspector]");
    const manual = inspector?.querySelector('input[type="radio"][value="manual"]');
    if (!(manual instanceof HTMLInputElement)) return false;
    manual.click();
    const inputs = inspector.querySelectorAll('input[type="number"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (inputs.length !== 2 || !setter) return false;
    setter.call(inputs[0], ${JSON.stringify(String(rows))});
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(inputs[1], ${JSON.stringify(String(cols))});
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
}

async function resetSource(client) {
  const opened = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === "Reset source");
    button?.click();
    return button instanceof HTMLButtonElement;
  })()`);
  if (!opened) return false;
  await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]'))`);
  return client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="slice-source-reset-title"]');
    const button = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent?.trim() === "Reset source");
    button?.click();
    return button instanceof HTMLButtonElement;
  })()`);
}

async function screenshot(client, outputPath) {
  const path = resolve(outputPath);
  const capture = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(capture.data, "base64"));
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function runGridIntegrationBrowser(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const chromePath = resolveChromeExecutable(options);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const profileDirectory = mkdtempSync(join(tmpdir(), "sprite-boy-grid-integration-chrome-"));
  let server;
  let chrome;
  let client;

  return runWithBrowserRuntimeDeadline(async () => {
    server = spawnViteServer(cwd, port, "preview");
    await waitForPreview(baseUrl, server);
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
    const logErrorTexts = [];
    client.socket?.addEventListener?.("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
          logErrorTexts.push(String(message.params.entry.text ?? "browser-log-error").slice(0, 500));
        }
      } catch {
        // Diagnostic capture must not affect the browser journey.
      }
    });
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
        const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
        const blobs = new Map();
        const nativeClick = HTMLAnchorElement.prototype.click;
        const nativeStroke = CanvasRenderingContext2D.prototype.stroke;
        const nativeStrokeRect = CanvasRenderingContext2D.prototype.strokeRect;
        const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
        globalThis.__g205 = {
          savedProject: null,
          originalProject: null,
          interactionBeforeProject: null,
          interactionAfterProject: null,
          mismatchedProject: null,
          exportKeyboardBeforeProject: null,
          exportKeyboardAfterProject: null,
          sliceTransitionBeforeProject: null,
          sliceTransitionAfterProject: null,
          downloadedPng: null,
          legacyGridDraws: 0,
          legacyWorkspaceGridDraws: 0,
          overlayDraws: 0,
          canonicalExportDraws: 0,
          canonicalExportStrokes: 0,
          unownedOffscreenStrokes: 0,
          canonicalSourceDrawSize: null,
        };
        const countDraw = (context) => {
          const canvas = context.canvas;
          if (canvas?.hasAttribute?.("data-studio-source-canvas")) {
            if (canvas.dataset?.canonicalCanvasOwnership === "true") {
              globalThis.__g205.legacyGridDraws += 1;
            } else {
              globalThis.__g205.legacyWorkspaceGridDraws += 1;
            }
          }
          if (canvas?.hasAttribute?.("data-slice-grid-overlay-canvas")) globalThis.__g205.overlayDraws += 1;
          if (canvas?.dataset?.canonicalSliceExport === "source-only") {
            globalThis.__g205.canonicalExportStrokes += 1;
          } else if (canvas instanceof HTMLCanvasElement && !canvas.isConnected) {
            globalThis.__g205.unownedOffscreenStrokes += 1;
          }
        };
        CanvasRenderingContext2D.prototype.stroke = function stroke(...args) {
          countDraw(this);
          return nativeStroke.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.strokeRect = function strokeRect(...args) {
          countDraw(this);
          return nativeStrokeRect.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.drawImage = function drawImage(...args) {
          if (this.canvas?.dataset?.canonicalSliceExport === "source-only") {
            globalThis.__g205.canonicalExportDraws += 1;
          }
          if (
            this.canvas?.dataset?.canonicalCanvasOwnership === "true" &&
            this.canvas?.hasAttribute?.("data-studio-source-canvas") && args.length === 5
          ) {
            globalThis.__g205.canonicalSourceDrawSize = args[3] + "x" + args[4];
          }
          return nativeDrawImage.apply(this, args);
        };
        URL.createObjectURL = (blob) => {
          const url = nativeCreateObjectURL(blob);
          blobs.set(url, blob);
          return url;
        };
        HTMLAnchorElement.prototype.click = function click() {
          if (typeof this.download === "string" && this.download.endsWith(".json") && blobs.has(this.href)) {
            blobs.get(this.href).text().then((text) => { globalThis.__g205.savedProject = text; });
            return;
          }
          if (typeof this.download === "string" && this.download.endsWith(".png") && blobs.has(this.href)) {
            const blob = blobs.get(this.href);
            globalThis.__g205.downloadedPng = { size: blob.size, type: blob.type, width: null, height: null };
            createImageBitmap(blob).then((bitmap) => {
              globalThis.__g205.downloadedPng = {
                size: blob.size,
                type: blob.type,
                width: bitmap.width,
                height: bitmap.height,
              };
              bitmap.close();
            }).catch(() => {
              globalThis.__g205.downloadedPng.decodeError = true;
            });
            return;
          }
          return nativeClick.call(this);
        };
      })();`,
    });
    await client.send("Page.navigate", { url: `${baseUrl}/#/studio/slice` });
    await client.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("[data-slice-source-dropzone]"))`);
    mark("ready");
    await client.waitForNetworkIdle();
    if (await selectGridSource(client) !== true) throw new Error("G2-05 source fixture could not load.");
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "8"`);
    mark("auto-overlay");

    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    await client.evaluate(`(() => {
      const parsed = JSON.parse(globalThis.__g205.savedProject);
      parsed.project.builderCanvas = { width: 1024, height: 1024 };
      globalThis.__g205.mismatchedProject = JSON.stringify(parsed);
      const input = document.querySelector('input[accept="application/json,.json"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([globalThis.__g205.mismatchedProject], "g2-05-unequal-dimensions.json", {
        type: "application/json",
      }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await client.waitFor(`document.querySelector("[data-studio-source-canvas]")?.dataset.canvasContentSize === "400x200" &&
      document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlaySourceSize === "400x200" &&
      globalThis.__g205.canonicalSourceDrawSize === "400x200"`);
    mark("unequal-dimensions");

    const initial = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-slice-grid-overlay-canvas]");
      const sourceCanvas = document.querySelector("[data-studio-source-canvas]");
      const inspector = document.querySelector("[data-slice-grid-inspector]");
      return {
        cells: canvas?.dataset.gridOverlayCells,
        scale: canvas?.dataset.gridOverlayScale,
        offset: canvas?.dataset.gridOverlayOffset,
        recipe: inspector?.getAttribute("data-grid-recipe-layout"),
        sourceCanvasSibling: canvas?.closest("[data-slice-grid-overlay]")?.parentElement
          ?.querySelector("[data-studio-source-canvas]") instanceof HTMLCanvasElement,
        legacyGridDraws: globalThis.__g205.legacyGridDraws,
        overlayDraws: globalThis.__g205.overlayDraws,
        sourceContentSize: sourceCanvas?.dataset.canvasContentSize,
        overlaySourceSize: canvas?.dataset.gridOverlaySourceSize,
        sourceDrawSize: globalThis.__g205.canonicalSourceDrawSize,
        builderContentSize: (() => {
          const parsed = JSON.parse(globalThis.__g205.mismatchedProject);
          return parsed.project.builderCanvas.width + "x" + parsed.project.builderCanvas.height;
        })(),
      };
    })()`);

    if (await setManual(client, 3, 2) !== true) throw new Error("Manual grid controls unavailable.");
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "6" &&
      document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-recipe-layout") === "3x2"`);
    mark("manual-overlay");
    const manual = true;

    await client.evaluate(`(() => {
      const input = document.querySelector('[data-slice-grid-inspector] input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "0");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await client.waitFor(`document.querySelector('[data-slice-grid-inspector] input[type="number"]')
      ?.getAttribute("aria-invalid") === "true"`);
    mark("invalid-stable");
    const invalidStable = await client.evaluate(`(() => ({
      cells: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells,
      recipe: document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-recipe-layout"),
    }))()`);
    await client.evaluate(`(() => {
      const input = document.querySelector('[data-slice-grid-inspector] input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "3");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('[data-slice-grid-inspector] input[type="radio"][value="auto"]')?.click();
    })()`);
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "8" &&
      document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-manual-draft") === "3x2"`);
    mark("auto-retain");

    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    await client.evaluate(`globalThis.__g205.interactionBeforeProject = globalThis.__g205.savedProject`);
    const mixedInteractionDispatched = await client.evaluate(`(async () => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const host = canvas?.parentElement;
      const dropHost = canvas?.closest('section[aria-label="Canvas workspace"]');
      const bounds = host?.getBoundingClientRect();
      if (!canvas || !host || !dropHost || !bounds) return false;
      const x = bounds.left + bounds.width * 0.25;
      const y = bounds.top + bounds.height * 0.25;
      host.dispatchEvent(new MouseEvent("mousedown", {
        button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      const move = new MouseEvent("mousemove", {
        button: 0, buttons: 1, clientX: x + 24, clientY: y + 12, bubbles: true,
      });
      Object.defineProperty(move, "movementX", { value: 24 });
      Object.defineProperty(move, "movementY", { value: 12 });
      host.dispatchEvent(move);
      host.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
      const transfer = new DataTransfer();
      transfer.items.add(new File(["not-a-source-replacement"], "legacy-drop.png", { type: "image/png" }));
      dropHost.dispatchEvent(new DragEvent("dragover", {
        dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      dropHost.dispatchEvent(new DragEvent("drop", {
        dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      for (const init of [
        { key: "ArrowRight", code: "ArrowRight" },
        { key: "Delete", code: "Delete" },
      ]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
      }
      await new Promise((done) => setTimeout(done, 100));
      return true;
    })()`);
    if (!mixedInteractionDispatched) throw new Error("Canonical interaction seam unavailable.");
    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    const interactionIsolation = await client.evaluate(`(() => {
      globalThis.__g205.interactionAfterProject = globalThis.__g205.savedProject;
      const before = JSON.parse(globalThis.__g205.interactionBeforeProject).project;
      const after = JSON.parse(globalThis.__g205.interactionAfterProject).project;
      return {
        projectUnchanged: JSON.stringify(before) === JSON.stringify(after),
        sourceStillMounted: document.querySelector("[data-studio-source-canvas]") instanceof HTMLCanvasElement,
      };
    })()`);
    mark("interaction-isolation");

    await client.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true }))`);
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "6"`);
    mark("undo");
    const undoRestoredManual = true;
    await client.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true, bubbles: true }))`);
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "8"`);
    mark("redo");
    const redoRestoredAuto = true;
    const finalManualClick = await client.evaluate(`(() => {
      const input = document.querySelector('[data-slice-grid-inspector] input[type="radio"][value="manual"]');
      input?.click();
      return input instanceof HTMLInputElement;
    })()`);
    if (!finalManualClick) throw new Error("Manual mode was unavailable after redo.");
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "6"`);
    mark("manual-after-redo");

    await client.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
    }))`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string" && globalThis.__g205.savedProject.length > 100`);
    await client.evaluate(`globalThis.__g205.originalProject = globalThis.__g205.savedProject`);
    mark("saved");
    if (await resetSource(client) !== true) throw new Error("G2-05 source reset unavailable.");
    await client.waitFor(`Boolean(document.querySelector("[data-slice-source-dropzone]"))`);
    await client.evaluate(`(async () => {
      const input = document.querySelector('input[accept="application/json,.json"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([globalThis.__g205.savedProject], "g2-05-project.json", { type: "application/json" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "6" &&
      document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-recipe-layout") === "3x2"`);
    mark("reloaded");
    const reloadRestoredManual = true;

    const composeOpened = await client.evaluate(`(() => {
      const route = document.querySelector('[data-workspace-id="compose"]');
      route?.click();
      return route instanceof HTMLElement;
    })()`);
    if (!composeOpened) throw new Error("Compose selection fixture unavailable.");
    await client.waitFor(`document.querySelector('[data-studio-workspace-content]')
      ?.getAttribute('data-studio-workspace-content') === 'compose' &&
      document.querySelector("[data-studio-source-canvas]")?.dataset.canonicalCanvasOwnership === "false" &&
      Boolean(document.querySelector(".cursor-grab"))`);
    mark("compose-selection-ready");
    const legacySelectionPrepared = await client.evaluate(`(() => {
      const entry = document.querySelector(".cursor-grab");
      entry?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return entry instanceof HTMLElement;
    })()`);
    if (!legacySelectionPrepared) throw new Error("Legacy selection fixture unavailable.");
    await client.waitFor(`document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex !== "none"`);
    mark("legacy-selected");
    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    await client.evaluate(`globalThis.__g205.sliceTransitionBeforeProject = globalThis.__g205.savedProject`);
    const sliceTransitionOpened = await client.evaluate(`(() => {
      const route = document.querySelector('[data-workspace-id="slice"]');
      route?.click();
      return route instanceof HTMLElement;
    })()`);
    if (!sliceTransitionOpened) throw new Error("Canonical Slice transition unavailable.");
    await client.waitFor(`document.querySelector('[data-studio-workspace-content]')
      ?.getAttribute('data-studio-workspace-content') === 'slice' &&
      document.querySelector("[data-studio-source-canvas]")?.dataset.canonicalCanvasOwnership === "true" &&
      document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex === "none"`);
    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    const sliceTransitionIsolation = await client.evaluate(`(() => {
      globalThis.__g205.sliceTransitionAfterProject = globalThis.__g205.savedProject;
      const before = JSON.parse(globalThis.__g205.sliceTransitionBeforeProject).project;
      const after = JSON.parse(globalThis.__g205.sliceTransitionAfterProject).project;
      return {
        projectUnchanged: JSON.stringify(before) === JSON.stringify(after),
        selectedIndex: document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex,
      };
    })()`);
    await client.evaluate(`document.querySelector('[data-workspace-id="compose"]')?.click()`);
    await client.waitFor(`document.querySelector('[data-studio-workspace-content]')
      ?.getAttribute('data-studio-workspace-content') === 'compose' &&
      document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex === "none" &&
      Boolean(document.querySelector(".cursor-grab"))`);
    await client.evaluate(`document.querySelector(".cursor-grab")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))`);
    await client.waitFor(`document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex !== "none"`);
    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    await client.evaluate(`globalThis.__g205.exportKeyboardBeforeProject = globalThis.__g205.savedProject`);
    mark("canonical-transition-quarantine");

    const exportOpened = await client.evaluate(`(() => {
      const route = document.querySelector('a[aria-label="Export"]');
      route?.click();
      return route instanceof HTMLAnchorElement;
    })()`);
    if (!exportOpened) throw new Error("Canonical export workspace unavailable.");
    await client.waitFor(`document.querySelector('[data-studio-workspace-content]')?.getAttribute('data-studio-workspace-content') === 'export' &&
      document.querySelector("[data-studio-source-canvas]")?.dataset.canonicalCanvasOwnership === "true" &&
      document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex === "none" &&
      Boolean(document.querySelector('[data-studio-action="export-snapshot"]'))`);
    mark("export-owned-selected");
    await client.evaluate(`(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true,
      }));
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Delete", code: "Delete", bubbles: true, cancelable: true,
      }));
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string"`);
    mark("export-keyboard-saved");
    const exportKeyboardIsolation = await client.evaluate(`(() => {
      globalThis.__g205.exportKeyboardAfterProject = globalThis.__g205.savedProject;
      const before = JSON.parse(globalThis.__g205.exportKeyboardBeforeProject).project;
      const after = JSON.parse(globalThis.__g205.exportKeyboardAfterProject).project;
      return {
        projectUnchanged: JSON.stringify(before) === JSON.stringify(after),
        selectedIndex: document.querySelector("[data-studio-source-canvas]")?.dataset.legacySelectedIndex,
        canonicalOwnership: document.querySelector("[data-studio-source-canvas]")?.dataset.canonicalCanvasOwnership,
        contentSize: document.querySelector("[data-studio-source-canvas]")?.dataset.canvasContentSize,
      };
    })()`);
    mark("export-keyboard-isolation");
    const snapshotOpened = await client.evaluate(`(() => {
      const button = document.querySelector('[data-studio-action="export-snapshot"]');
      button?.click();
      return button instanceof HTMLButtonElement;
    })()`);
    if (!snapshotOpened) throw new Error("Canonical snapshot action unavailable.");
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="studio-export-title"]'))`);
    const exportTriggered = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="studio-export-title"]');
      const button = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent?.includes("Download Spritesheet"));
      button?.click();
      return button instanceof HTMLButtonElement;
    })()`);
    if (!exportTriggered) throw new Error("Canonical snapshot download unavailable.");
    await client.waitFor(`globalThis.__g205.downloadedPng?.width === 400 &&
      globalThis.__g205.downloadedPng?.height === 200`);
    const exportIsolation = await client.evaluate(`(() => ({
      downloadedPng: globalThis.__g205.downloadedPng,
      canonicalExportDraws: globalThis.__g205.canonicalExportDraws,
      canonicalExportStrokes: globalThis.__g205.canonicalExportStrokes,
      unownedOffscreenStrokes: globalThis.__g205.unownedOffscreenStrokes,
    }))()`);
    mark("source-only-export");
    await client.evaluate(`document.querySelector('[data-workspace-id="slice"]')?.click()`);
    await client.waitFor(`document.querySelector('[data-studio-workspace-content]')?.getAttribute('data-studio-workspace-content') === 'slice' &&
      document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "6"`);

    await client.evaluate(`(() => {
      const parsed = JSON.parse(globalThis.__g205.originalProject);
      parsed.project.sliceGrid = { version: 1, recipe: null, manual: { rows: 4, cols: 4 } };
      const input = document.querySelector('input[accept="application/json,.json"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(parsed)], "g2-05-malformed.json", { type: "application/json" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await client.waitFor(`document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-recipe-layout") === "auto" &&
      document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "8"`);
    await client.evaluate(`(() => {
      globalThis.__g205.savedProject = null;
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
      }));
    })()`);
    await client.waitFor(`typeof globalThis.__g205.savedProject === "string" && globalThis.__g205.savedProject.length > 100`);
    const malformedQuarantinedBeforeSave = await client.evaluate(`(() => {
      const saved = JSON.parse(globalThis.__g205.savedProject);
      return saved.project?.sliceGrid?.version === 1 &&
        saved.project?.sliceGrid?.recipe?.kind === "grid-split" &&
        saved.project?.sliceGrid?.recipe?.layout?.mode === "auto";
    })()`);
    await client.evaluate(`(() => {
      const input = document.querySelector('input[accept="application/json,.json"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([globalThis.__g205.originalProject], "g2-05-project.json", { type: "application/json" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await client.waitFor(`document.querySelector("[data-slice-grid-inspector]")?.getAttribute("data-grid-recipe-layout") === "3x2" &&
      document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells === "6"`);

    const zoomed = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const host = canvas?.parentElement;
      const bounds = host?.getBoundingClientRect();
      if (!host || !bounds) return null;
      host.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240, ctrlKey: true, clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2, bubbles: true, cancelable: true,
      }));
      return true;
    })()`);
    if (!zoomed) throw new Error("G2-05 source canvas zoom seam unavailable.");
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayScale !== ${JSON.stringify(initial.scale)}`);
    const zoomViewport = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-slice-grid-overlay-canvas]");
      return { scale: canvas?.dataset.gridOverlayScale, offset: canvas?.dataset.gridOverlayOffset };
    })()`);
    const panned = await client.evaluate(`(async () => {
      const canvas = document.querySelector("[data-studio-source-canvas]");
      const host = canvas?.parentElement;
      const bounds = host?.getBoundingClientRect();
      if (!host || !bounds) return null;
      host.dispatchEvent(new MouseEvent("mousedown", {
        button: 1, buttons: 4, clientX: bounds.left + 100, clientY: bounds.top + 100, bubbles: true,
      }));
      await new Promise((done) => setTimeout(done, 50));
      const move = new MouseEvent("mousemove", {
        button: 1, buttons: 4, clientX: bounds.left + 130, clientY: bounds.top + 120, bubbles: true,
      });
      Object.defineProperty(move, "movementX", { value: 30 });
      Object.defineProperty(move, "movementY", { value: 20 });
      host.dispatchEvent(move);
      await new Promise((done) => setTimeout(done, 50));
      host.dispatchEvent(new MouseEvent("mouseup", { button: 1, bubbles: true }));
      return true;
    })()`);
    if (!panned) throw new Error("G2-05 source canvas pan seam unavailable.");
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayOffset !== ${JSON.stringify(zoomViewport.offset)}`);
    mark("transform");
    const viewport = await client.evaluate(`(() => {
      const canvas = document.querySelector("[data-slice-grid-overlay-canvas]");
      return { scale: canvas?.dataset.gridOverlayScale, offset: canvas?.dataset.gridOverlayOffset };
    })()`);

    await client.evaluate(`(() => {
      for (const button of document.querySelectorAll("button")) {
        const toast = button.closest(".pointer-events-auto");
        if (toast && /Imported|Project saved|Project loaded|Slice source reset/.test(toast.textContent ?? "")) {
          toast.click();
        }
      }
    })()`);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 760,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await client.waitFor(`document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayDpr === "2"`);
    mark("dpr");
    await client.evaluate(`Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Properties")?.click()`);
    await client.waitFor(`Boolean(document.querySelector('[role="dialog"] [data-slice-grid-inspector]'))`);
    const compact = await client.evaluate(`(() => ({
      recipe: document.querySelector('[role="dialog"] [data-slice-grid-inspector]')?.getAttribute("data-grid-recipe-layout"),
      cells: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayCells,
      dpr: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayDpr,
      backing: document.querySelector("[data-slice-grid-overlay-canvas]")?.dataset.gridOverlayBacking,
      pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
    }))()`);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await client.waitFor(`Boolean(document.querySelector("[data-slice-grid-inspector]")) &&
      !document.querySelector('[role="dialog"] [data-slice-grid-inspector]')`);
    await client.evaluate(`(() => {
      for (const button of document.querySelectorAll("button")) {
        const toast = button.closest(".pointer-events-auto");
        if (toast && /Imported|Project saved|Project loaded|Slice source reset/.test(toast.textContent ?? "")) {
          toast.click();
        }
      }
    })()`);
    await client.evaluate("new Promise((done) => setTimeout(done, 200))");

    const screenshotPath = options.screenshotPath ?? "artifacts/quality/GRID/2026-07-16/g2-05-grid-integration.png";
    const screenshotSha256 = await screenshot(client, screenshotPath);
    const errors = {
      console: client.consoleErrorCount,
      exception: client.exceptionCount,
      log: client.logErrorCount,
      network: client.networkFailureCount,
      http: client.httpErrorCount,
    };
    const rendererOwnership = await client.evaluate(`(() => ({
      legacyGridDraws: globalThis.__g205.legacyGridDraws,
      legacyWorkspaceGridDraws: globalThis.__g205.legacyWorkspaceGridDraws,
      overlayDraws: globalThis.__g205.overlayDraws,
    }))()`);
    const passed = initial.cells === "8" && initial.recipe === "auto" && initial.sourceCanvasSibling &&
      initial.sourceContentSize === "400x200" && initial.overlaySourceSize === "400x200" &&
      initial.sourceDrawSize === "400x200" && initial.builderContentSize === "1024x1024" &&
      initial.legacyGridDraws === 0 && initial.overlayDraws > 0 &&
      manual && invalidStable.cells === "6" && invalidStable.recipe === "3x2" &&
      interactionIsolation.projectUnchanged && interactionIsolation.sourceStillMounted &&
      sliceTransitionIsolation.projectUnchanged && sliceTransitionIsolation.selectedIndex === "none" &&
      undoRestoredManual && redoRestoredAuto && reloadRestoredManual && malformedQuarantinedBeforeSave &&
      exportKeyboardIsolation.projectUnchanged && exportKeyboardIsolation.selectedIndex === "none" &&
      exportKeyboardIsolation.canonicalOwnership === "true" && exportKeyboardIsolation.contentSize === "400x200" &&
      exportIsolation.downloadedPng?.size > 0 && exportIsolation.downloadedPng?.type === "image/png" &&
      exportIsolation.downloadedPng?.width === 400 && exportIsolation.downloadedPng?.height === 200 &&
      exportIsolation.canonicalExportDraws === 1 && exportIsolation.canonicalExportStrokes === 0 &&
      exportIsolation.unownedOffscreenStrokes === 0 &&
      zoomViewport.scale !== initial.scale && viewport.offset !== zoomViewport.offset &&
      compact.recipe === "3x2" && compact.cells === "6" && compact.dpr === "2" && compact.pageFits &&
      rendererOwnership.legacyGridDraws === 0 && rendererOwnership.overlayDraws > 0 &&
      Object.values(errors).every((value) => value === 0);
    return {
      schemaVersion: 1,
      check: "slice-grid-production-integration",
      status: passed ? "pass" : "fail",
      metrics: {
        initial,
        manual,
        invalidStable,
        interactionIsolation,
        sliceTransitionIsolation,
        undoRestoredManual,
        redoRestoredAuto,
        reloadRestoredManual,
        exportKeyboardIsolation,
        malformedQuarantinedBeforeSave,
        exportIsolation,
        rendererOwnership,
        viewport: { zoom: zoomViewport, pan: viewport },
        compact,
        screenshotPath,
        screenshotSha256,
        errors,
        logErrorTexts,
      },
    };
  }, () => cleanupBrowserRuntime(
    client,
    chrome,
    server,
    profileDirectory,
    "Grid integration browser cleanup failed.",
  ), DEADLINE_MS);
}

export async function runGridIntegrationBrowserCli(io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await runGridIntegrationBrowser({
      screenshotPath: process.env.STUDIO_GRID_INTEGRATION_SCREENSHOT,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "pass" ? 0 : 1;
  } catch (error) {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "slice-grid-production-integration",
      status: "fail",
      reason: error instanceof Error ? error.message : "browser-journey-unavailable",
    })}\n`);
    return 1;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) process.exitCode = await runGridIntegrationBrowserCli();
