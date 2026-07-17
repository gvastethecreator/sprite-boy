import fs from "node:fs";
import path from "node:path";

const debugPort = Number(process.argv[2] ?? 9344);
const outputDir = process.argv[3];
const appUrl = process.argv[4] ?? "http://127.0.0.1:4187/#/studio/slice";
if (!outputDir) throw new Error("Output directory is required.");

const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
  .then((response) => response.json());
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
    consoleErrors.push(
      message.params.args.map((argument) => argument.value ?? argument.description).join(" "),
    );
  }
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(
      message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text,
    );
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
    throw new Error(
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function waitFor(expression, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function key(keyValue, code, modifiers = 0) {
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: keyValue,
    code,
    modifiers,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: keyValue,
    code,
    modifiers,
  });
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(capture.data, "base64"));
}

async function openJobCenter() {
  await evaluate(`(() => {
    const trigger = document.querySelector('button[aria-label^="Open Job Center"]');
    trigger?.focus();
    trigger?.click();
  })()`);
  await waitFor(
    `document.querySelector('[role="dialog"][aria-label="Job Center"]')`,
    "Job Center did not open.",
  );
}

async function inspectDrawer() {
  return evaluate(`(() => {
    const trigger = document.querySelector('button[aria-label^="Open Job Center"]');
    const dialog = document.querySelector('[role="dialog"][aria-label="Job Center"]');
    const panel = dialog?.querySelector('[data-studio-panel-variant="drawer"]');
    const bounds = dialog?.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      triggerExpanded: trigger?.getAttribute('aria-expanded'),
      focusInside: Boolean(dialog?.contains(document.activeElement)),
      activeLabel: document.activeElement?.getAttribute('aria-label'),
      dialogModal: dialog?.getAttribute('aria-modal'),
      panelLabel: panel?.getAttribute('aria-label'),
      width: bounds?.width,
      height: bounds?.height,
      rightGap: bounds ? Math.round(innerWidth - bounds.right) : null,
      topGap: bounds ? Math.round(bounds.top) : null,
      emptyHeading: dialog?.querySelector('h3')?.textContent?.trim(),
      summary: dialog?.querySelector('[role="status"]')?.textContent?.trim(),
      actionCount: dialog?.querySelectorAll('button:not([aria-label="Close Job Center"])').length,
      pageFits:
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    };
  })()`);
}

await Promise.all([
  send("Page.enable"),
  send("Runtime.enable"),
  send("Log.enable"),
]);
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: appUrl });
await waitFor(
  `document.readyState === 'complete' &&
    document.querySelector('[data-studio-workspace="slice"]') &&
    document.querySelector('button[aria-label^="Open Job Center"]')`,
  "Studio shell and Job Center trigger did not load.",
  30_000,
);

await openJobCenter();
const desktop = await inspectDrawer();
await key("Tab", "Tab");
const desktopFocusAfterTab = await evaluate(
  `document.querySelector('[role="dialog"][aria-label="Job Center"]')?.contains(document.activeElement)`,
);
await screenshot("job-center-desktop.png");
await key("Escape", "Escape");
await waitFor(
  `!document.querySelector('[role="dialog"][aria-label="Job Center"]')`,
  "Escape did not close the desktop Job Center.",
);
const desktopRestored = await evaluate(
  `document.activeElement?.matches('button[aria-label^="Open Job Center"]') &&
    document.activeElement?.getAttribute('aria-expanded') === 'false'`,
);

await send("Emulation.setDeviceMetricsOverride", {
  width: 1024,
  height: 768,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor(
  `document.querySelector('button[aria-label^="Open Job Center"]')?.getClientRects().length > 0`,
  "Compact Job Center trigger is not visible.",
);
await openJobCenter();
const compact = await inspectDrawer();
await screenshot("job-center-compact.png");
await evaluate(
  `document.querySelector('[role="dialog"][aria-label="Job Center"] button[aria-label="Close Job Center"]')?.click()`,
);
await waitFor(
  `!document.querySelector('[role="dialog"][aria-label="Job Center"]')`,
  "Close control did not close the compact Job Center.",
);
const compactRestored = await evaluate(
  `document.activeElement?.matches('button[aria-label^="Open Job Center"]')`,
);

const result = {
  status: "pass",
  desktop,
  desktopFocusAfterTab,
  desktopRestored,
  compact,
  compactRestored,
  consoleErrors,
  exceptions,
};

const drawerIsValid = (snapshot, expectedHeight) =>
  snapshot.triggerExpanded === "true" &&
  snapshot.focusInside &&
  snapshot.dialogModal === "true" &&
  snapshot.panelLabel === "Job Center" &&
  snapshot.width > 300 &&
  snapshot.width <= 420 &&
  snapshot.height === expectedHeight &&
  snapshot.rightGap === 0 &&
  snapshot.topGap === 0 &&
  snapshot.emptyHeading === "No jobs yet" &&
  snapshot.summary === "Job Center is empty." &&
  snapshot.actionCount === 0 &&
  snapshot.pageFits;

if (
  !drawerIsValid(desktop, 900) ||
  !desktopFocusAfterTab ||
  !desktopRestored ||
  !drawerIsValid(compact, 768) ||
  !compactRestored ||
  consoleErrors.length > 0 ||
  exceptions.length > 0
) {
  throw new Error(`Job Center browser journey failed: ${JSON.stringify(result)}`);
}

fs.writeFileSync(
  path.join(outputDir, "job-center-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await send("Browser.close");
