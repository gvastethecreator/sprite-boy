import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] ?? 9337);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
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

async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing visible click target ${selector}.`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

async function key(keyValue, code, modifiers = 0, shift = false) {
  const effectiveModifiers = modifiers | (shift ? 8 : 0);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: keyValue, code, modifiers: effectiveModifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code, modifiers: effectiveModifiers });
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(capture.data, "base64"));
}

await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${page.url.split("#")[0]}#/studio/slice` });
await new Promise((resolve) => setTimeout(resolve, 500));

try {
  await waitFor(
    `document.readyState === 'complete' && document.querySelector('[data-studio-workspace="slice"]')`,
    "Studio shell did not load.",
    30000,
  );
} catch (error) {
  const debug = await evaluate(`({
    href: location.href,
    readyState: document.readyState,
    body: document.body?.innerText?.slice(0, 1200),
    html: document.body?.innerHTML?.slice(0, 1200),
  })`);
  process.stderr.write(`${JSON.stringify({ debug, consoleErrors, exceptions }, null, 2)}\n`);
  throw error;
}

await waitFor(
  `(() => { const button = document.querySelector('[data-command-id="app.openPreferences"]'); return button && !button.disabled && button.getClientRects().length > 0; })()`,
  "Preferences command did not become available.",
);
await evaluate(`(() => {
  const button = document.querySelector('[data-command-id="app.openPreferences"]');
  button?.focus();
  button?.click();
})()`);
await waitFor(`document.querySelector('[role="dialog"][aria-labelledby="studio-settings-title"]')`, "Settings dialog did not open.");
const settings = await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"][aria-labelledby="studio-settings-title"]');
  return {
    reducedMotion: dialog?.dataset.reducedMotion,
    focusInside: Boolean(dialog?.contains(document.activeElement)),
    focusLabel: document.activeElement?.getAttribute('aria-label'),
  };
})()`);
await key("Escape", "Escape");
await waitFor(`!document.querySelector('[role="dialog"][aria-labelledby="studio-settings-title"]')`, "Escape did not close Settings.");
const settingsRestored = await evaluate(`document.activeElement?.dataset.commandId === 'app.openPreferences'`);

await evaluate(`(() => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAQ3M3nAAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const file = new File([bytes], 'compact-fixture.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('input[type="file"][accept^="image/"]');
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(
  `document.querySelectorAll('[data-studio-panel-variant="sidebar"]').length === 2`,
  "Desktop panels did not mount after asset import.",
  30000,
);

const desktop = await evaluate(`(() => ({
  viewport: [innerWidth, innerHeight],
  visibleWorkspaceLinks: [...document.querySelectorAll('nav[aria-label="Studio workspaces"] a')]
    .filter((item) => item.getClientRects().length > 0).map((item) => item.textContent.trim()),
  visiblePanels: [...document.querySelectorAll('[data-studio-panel-variant="sidebar"]')]
    .filter((item) => item.getClientRects().length > 0).map((item) => item.getAttribute('aria-label')),
  pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
}))()`);
await screenshot("studio-accessibility-desktop.png");

await send("Emulation.setDeviceMetricsOverride", {
  width: 1024,
  height: 768,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor(`document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]')`, "Compact panel toolbar did not appear.");

await evaluate(`document.querySelector('button[aria-controls="studio-workspace-menu"]')?.click()`);
await waitFor(`document.querySelectorAll('#studio-workspace-menu [role="menuitem"]').length === 5`, "Compact workspace menu is incomplete.");
const compactWorkspaceItems = await evaluate(`[...document.querySelectorAll('#studio-workspace-menu [role="menuitem"]')].map((item) => item.textContent.trim())`);
await evaluate(`document.querySelector('#studio-workspace-menu [data-workspace-id="collision"]')?.click()`);
await waitFor(`location.hash === '#/studio/collision'`, "Compact workspace navigation did not reach Collision.");
await waitFor(
  `document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]')?.textContent.includes('Collision workspace')`,
  "Compact layout did not settle on Collision.",
);

await evaluate(`(() => {
  const button = document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"] button[aria-haspopup="dialog"]');
  button?.focus();
  button?.click();
})()`);
try {
  await waitFor(`document.querySelector('[role="dialog"][aria-label="Tools panel"]')`, "Tools drawer did not open.");
} catch (error) {
  const debug = await evaluate(`(() => ({
    toolbar: document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]')?.outerHTML,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => ({ label: item.getAttribute('aria-label'), labelledBy: item.getAttribute('aria-labelledby') })),
    workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
  }))()`);
  process.stderr.write(`${JSON.stringify({ debug, consoleErrors, exceptions }, null, 2)}\n`);
  throw error;
}
const drawerBeforeTab = await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="Tools panel"]');
  return { focusInside: dialog.contains(document.activeElement), panel: dialog.querySelector('[data-studio-panel="true"]')?.getAttribute('aria-label') };
})()`);
await key("Tab", "Tab");
const drawerAfterTab = await evaluate(`document.querySelector('[role="dialog"][aria-label="Tools panel"]')?.contains(document.activeElement)`);
await key("Escape", "Escape");
await waitFor(`!document.querySelector('[role="dialog"][aria-label="Tools panel"]')`, "Escape did not close Tools drawer.");
const drawerRestored = await evaluate(`document.activeElement?.textContent?.trim() === 'Tools'`);

await key("k", "KeyK", 2);
await waitFor(`document.querySelector('[role="dialog"][aria-label="Command palette"]')`, "Ctrl+K did not open Command palette.");
const palette = await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="Command palette"]');
  return {
    reducedMotion: dialog?.dataset.reducedMotion,
    searchFocused: document.activeElement?.getAttribute('aria-label') === 'Search commands',
  };
})()`);
await key("Escape", "Escape");
await waitFor(`!document.querySelector('[role="dialog"][aria-label="Command palette"]')`, "Escape did not close Command palette.");

const compact = await evaluate(`(() => ({
  viewport: [innerWidth, innerHeight],
  workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
  workspaceItems: ${JSON.stringify([])},
  desktopNavVisible: Boolean(document.querySelector('nav[aria-label="Studio workspaces"]')?.getClientRects().length),
  toolbarVisible: Boolean(document.querySelector('[role="toolbar"][aria-label="Compact Studio panels"]')?.getClientRects().length),
  sidebarCount: document.querySelectorAll('[data-studio-panel-variant="sidebar"]').length,
  pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
}))()`);
compact.workspaceItems = compactWorkspaceItems;
await screenshot("studio-accessibility-compact.png");

const result = {
  status: "pass",
  settings,
  settingsRestored,
  desktop,
  compact,
  drawerBeforeTab,
  drawerAfterTab,
  drawerRestored,
  palette,
  consoleErrors,
  exceptions,
};

if (
  settings.reducedMotion !== "true" ||
  !settings.focusInside ||
  !settingsRestored ||
  desktop.visibleWorkspaceLinks.length !== 5 ||
  desktop.visiblePanels.length !== 2 ||
  !desktop.pageFits ||
  compactWorkspaceItems.length !== 5 ||
  compact.workspace !== "collision" ||
  compact.desktopNavVisible ||
  !compact.toolbarVisible ||
  compact.sidebarCount !== 0 ||
  !compact.pageFits ||
  !drawerBeforeTab.focusInside ||
  drawerBeforeTab.panel !== "Tools" ||
  !drawerAfterTab ||
  !drawerRestored ||
  palette.reducedMotion !== "true" ||
  !palette.searchFocused ||
  consoleErrors.length > 0 ||
  exceptions.length > 0
) {
  throw new Error(`Accessibility journey failed: ${JSON.stringify(result)}`);
}

fs.writeFileSync(path.join(outputDir, "studio-accessibility-result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await send("Browser.close");
