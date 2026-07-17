import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] ?? 9336);
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
    const details = message.params.exceptionDetails;
    exceptions.push({
      text: details.text,
      description: details.exception?.description,
      url: details.url,
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
      stackTrace: details.stackTrace,
    });
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing click target ${selector}.`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function key(key, code, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}

await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

try {
  await waitFor(
    `document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace === 'slice' && location.hash === '#/studio/slice'`,
    "Invalid route did not normalize to Slice.",
    30000,
  );
} catch (error) {
  const debug = await evaluate(`({
    href: location.href,
    readyState: document.readyState,
    title: document.title,
    body: document.body?.innerText?.slice(0, 1000),
    workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
  })`);
  process.stderr.write(`${JSON.stringify({ debug, consoleErrors, exceptions }, null, 2)}\n`);
  throw error;
}

const initial = await evaluate(`(() => ({
  hash: location.hash,
  workspace: document.querySelector('[data-studio-workspace]').dataset.studioWorkspace,
  nav: [...document.querySelectorAll('nav[aria-label="Studio workspaces"] a')].map((link) => ({
    label: link.textContent.trim(),
    href: link.getAttribute('href'),
    visible: Boolean(link.offsetWidth || link.offsetHeight || link.getClientRects().length),
    current: link.getAttribute('aria-current'),
  })),
}))()`);

if (initial.nav.length !== 5 || initial.nav.some((entry) => !entry.visible)) {
  throw new Error(`Workspace navigation is incomplete: ${JSON.stringify(initial.nav)}.`);
}

await click('[data-workspace-id="compose"]');
await waitFor(
  `location.hash === '#/studio/compose' && document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace === 'compose'`,
  "Compose navigation did not commit.",
);

await click('[data-workspace-id="collision"]');
await waitFor(
  `location.hash === '#/studio/collision' && document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace === 'collision'`,
  "Collision navigation did not commit.",
);

const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.writeFileSync(path.join(outputDir, "studio-shell-collision.png"), Buffer.from(screenshot.data, "base64"));

await evaluate("history.back()");
await waitFor(
  `location.hash === '#/studio/compose' && document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace === 'compose'`,
  "Browser back did not restore Compose.",
);

await send("Page.reload", { ignoreCache: true });
await waitFor(
  `document.readyState === 'complete' && location.hash === '#/studio/compose' && document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace === 'compose'`,
  "Reload did not preserve Compose.",
  15000,
);

await key("k", "KeyK", 2);
await waitFor(
  `Boolean(document.querySelector('section[aria-label="Command palette"] input[aria-label="Search commands"]'))`,
  "Ctrl+K did not open the registry command palette.",
);
await click('input[aria-label="Search commands"]');
await send("Input.insertText", { text: "export" });
await waitFor(
  `document.querySelectorAll('section[aria-label="Command palette"] button').length > 0`,
  "Command palette did not filter commands.",
);
await key("Enter", "Enter");
await waitFor(
  `location.hash === '#/studio/export' && document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace === 'export'`,
  "Palette execution did not route to Export.",
);

const final = await evaluate(`(() => ({
  hash: location.hash,
  workspace: document.querySelector('[data-studio-workspace]').dataset.studioWorkspace,
  currentLabel: document.querySelector('nav[aria-label="Studio workspaces"] a[aria-current="page"]')?.textContent.trim(),
  paletteOpen: Boolean(document.querySelector('section[aria-label="Command palette"]')),
}))()`);

const result = {
  status: "pass",
  viewport: [1440, 900],
  initial,
  routes: ["slice", "compose", "collision", "compose-back", "compose-reload", "export-palette"],
  final,
  consoleErrors,
  exceptions,
};

if (consoleErrors.length > 0 || exceptions.length > 0) {
  throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, exceptions })}`);
}

fs.writeFileSync(path.join(outputDir, "studio-shell-result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await send("Browser.close");
