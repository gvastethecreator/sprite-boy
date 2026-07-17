import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] ?? 9342);
const outputDir = process.argv[3];
if (!outputDir) throw new Error("Output directory is required.");

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page");
if (!page) throw new Error("Chrome exposed no page target.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const consoleErrors = [];
const exceptions = [];
let nextId = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined) {
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map((argument) => argument.value ?? argument.description).join(" "));
  }
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function key(code, keyValue, modifiers = 0) {
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    code,
    key: keyValue,
    modifiers,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    code,
    key: keyValue,
    modifiers,
  });
}

async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing visible click target ${selector}.`);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  });
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(capture.data, "base64"));
}

const CTRL = 2;
const SHIFT = 8;
const workspaceIds = ["slice", "compose", "animate", "collision", "export"];

await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${page.url.split("#")[0]}#/studio/slice` });
await new Promise((resolve) => setTimeout(resolve, 500));
await waitFor(
  `document.readyState === 'complete' && document.querySelector('[data-studio-workspace="slice"]')`,
  "Studio shell did not load.",
  30000,
);

const routes = [];
for (let index = 0; index < workspaceIds.length; index += 1) {
  const workspaceId = workspaceIds[index];
  await key(`Digit${index + 1}`, String(index + 1), CTRL);
  await waitFor(
    `location.hash === '#/studio/${workspaceId}' && document.activeElement?.dataset.studioWorkspaceContent === '${workspaceId}'`,
    `Ctrl+${index + 1} did not navigate/focus ${workspaceId}.`,
  );
  routes.push(await evaluate(`({
    workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
    hash: location.hash,
    focusWorkspace: document.activeElement?.dataset.studioWorkspaceContent ?? null,
  })`));
}

await key("Comma", ",", CTRL);
await waitFor(
  `document.querySelector('[role="dialog"][aria-labelledby="studio-settings-title"]')`,
  "Ctrl+, did not open Preferences.",
);
await key("Digit1", "1", CTRL);
await new Promise((resolve) => setTimeout(resolve, 250));
const modalGuard = await evaluate(`({
  hash: location.hash,
  settingsOpen: Boolean(document.querySelector('[role="dialog"][aria-labelledby="studio-settings-title"]')),
})`);
await key("Escape", "Escape");
await waitFor(
  `!document.querySelector('[role="dialog"][aria-labelledby="studio-settings-title"]')`,
  "Escape did not close Preferences.",
);

await key("Slash", "?", SHIFT);
await waitFor(
  `document.querySelector('[role="dialog"][aria-labelledby="studio-help-title"]')`,
  "Shift+/ did not open Help.",
);
const help = await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"][aria-labelledby="studio-help-title"]');
  return {
    collisionDocumented: dialog?.textContent.includes('Open Collision') ?? false,
    preferencesDocumented: dialog?.textContent.includes('Preferences') ?? false,
    inertHitboxClipboardDocumented: /Copy Hitboxes|Paste Hitboxes/.test(dialog?.textContent ?? ''),
    primaryLabels: [...dialog.querySelectorAll('kbd')].filter((item) => item.textContent.trim() === 'Ctrl/Cmd').length,
  };
})()`);
await screenshot("shell-keyboard-help.png");
await key("Escape", "Escape");
await waitFor(
  `!document.querySelector('[role="dialog"][aria-labelledby="studio-help-title"]')`,
  "Escape did not close Help.",
);

await key("KeyK", "k", CTRL);
await waitFor(
  `document.querySelector('[role="dialog"][aria-label="Command palette"]') && document.activeElement?.getAttribute('aria-label') === 'Search commands'`,
  "Ctrl+K did not open/focus Command palette.",
);
const paletteCount = await evaluate(`document.querySelectorAll('#studio-command-results button[data-command-id], #studio-command-results button').length`);
await key("Digit1", "1", CTRL);
await new Promise((resolve) => setTimeout(resolve, 250));
const paletteGuard = await evaluate(`({
  hash: location.hash,
  paletteOpen: Boolean(document.querySelector('[role="dialog"][aria-label="Command palette"]')),
  inputFocused: document.activeElement?.getAttribute('aria-label') === 'Search commands',
})`);
await key("Escape", "Escape");
await waitFor(
  `!document.querySelector('[role="dialog"][aria-label="Command palette"]')`,
  "Escape did not close Command palette.",
);

await key("Digit1", "1", CTRL);
await waitFor(
  `location.hash === '#/studio/slice' && document.activeElement?.dataset.studioWorkspaceContent === 'slice'`,
  "Ctrl+1 did not return to Slice.",
);
await evaluate(`(() => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAQ3M3nAAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const file = new File([bytes], 'keyboard-fixture.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('input[type="file"][accept^="image/"]');
  if (!input) throw new Error('Image input is missing.');
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(
  `document.querySelector('canvas') && !document.querySelector('[data-workspace-state]')`,
  "Imported project did not become ready.",
  30000,
);

const editableTarget = await evaluate(`(() => {
  const input = [...document.querySelectorAll('input:not([type="file"])')]
    .find((candidate) => candidate.getClientRects().length > 0 && !candidate.disabled);
  if (!input) return null;
  input.focus();
  return { type: input.type, focused: document.activeElement === input };
})()`);
if (!editableTarget?.focused) throw new Error("No visible editable input was available for the guard proof.");
await key("Digit5", "5", CTRL);
await new Promise((resolve) => setTimeout(resolve, 250));
const editableGuard = await evaluate(`({
  hash: location.hash,
  tag: document.activeElement?.tagName,
  type: document.activeElement?.getAttribute('type'),
})`);

await click("canvas");
await waitFor(
  `document.activeElement?.dataset.studioWorkspaceContent === 'slice'`,
  "Canvas pointer interaction did not focus workspace content.",
);
await click('button[title="Zoom In"]');
await waitFor(
  `document.querySelector('button[title="Zoom In"]')?.previousElementSibling?.textContent.trim() === '125%'`,
  "Zoom In did not change the visible scale.",
);
const zoomBeforeReset = await evaluate(`document.querySelector('button[title="Zoom In"]')?.previousElementSibling?.textContent.trim()`);
await key("Digit0", "0", CTRL);
await waitFor(
  `document.querySelector('button[title="Zoom In"]')?.previousElementSibling?.textContent.trim() === '100%'`,
  "Ctrl+0 did not execute Reset canvas view.",
);
const zoomAfterReset = await evaluate(`document.querySelector('button[title="Zoom In"]')?.previousElementSibling?.textContent.trim()`);

await key("Digit5", "5", CTRL);
await waitFor(
  `location.hash === '#/studio/export' && document.activeElement?.dataset.studioWorkspaceContent === 'export'`,
  "Ctrl+5 did not navigate to Export after canvas focus.",
);
await waitFor(
  `(() => { const button = document.querySelector('[data-studio-action="export-snapshot"]'); return button && button.getClientRects().length > 0; })()`,
  "Export snapshot action did not mount.",
);
await new Promise((resolve) => setTimeout(resolve, 300));
await evaluate(`(() => {
  const button = document.querySelector('[data-studio-action="export-snapshot"]');
  button?.focus();
  button?.click();
})()`);
await waitFor(
  `document.querySelector('[role="dialog"][aria-labelledby="studio-export-title"]')?.textContent.includes('Export Spritesheet')`,
  "Snapshot action did not open the real PNG export modal.",
);
const snapshot = await evaluate(`({
  title: document.querySelector('#studio-export-title')?.textContent.trim(),
  dialogOpen: Boolean(document.querySelector('[role="dialog"][aria-labelledby="studio-export-title"]')),
})`);
await screenshot("shell-keyboard-snapshot.png");
await key("Escape", "Escape");

const result = {
  status: "pass",
  routes,
  modalGuard,
  help,
  palette: { count: paletteCount, ...paletteGuard },
  editableGuard,
  canvas: {
    focusWorkspace: "slice",
    zoomBeforeReset,
    zoomAfterReset,
  },
  snapshot,
  consoleErrors,
  exceptions,
};

if (
  routes.length !== 5 ||
  routes.some((route, index) => route.workspace !== workspaceIds[index] || route.focusWorkspace !== workspaceIds[index]) ||
  modalGuard.hash !== "#/studio/export" ||
  !modalGuard.settingsOpen ||
  !help.collisionDocumented ||
  !help.preferencesDocumented ||
  help.inertHitboxClipboardDocumented ||
  help.primaryLabels < 6 ||
  paletteCount !== 15 ||
  paletteGuard.hash !== "#/studio/export" ||
  !paletteGuard.paletteOpen ||
  !paletteGuard.inputFocused ||
  editableGuard.hash !== "#/studio/slice" ||
  editableGuard.tag !== "INPUT" ||
  zoomBeforeReset !== "125%" ||
  zoomAfterReset !== "100%" ||
  snapshot.title !== "Export Spritesheet" ||
  !snapshot.dialogOpen ||
  consoleErrors.length > 0 ||
  exceptions.length > 0
) {
  throw new Error(`Shell keyboard journey failed: ${JSON.stringify(result)}`);
}

fs.writeFileSync(
  path.join(outputDir, "shell-keyboard-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
socket.close();
