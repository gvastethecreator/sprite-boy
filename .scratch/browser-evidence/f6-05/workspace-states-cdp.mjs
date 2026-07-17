import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] ?? 9341);
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

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(capture.data, "base64"));
}

const expected = {
  slice: {
    title: "Bring in a spritesheet",
    commands: ["asset.import"],
  },
  compose: {
    title: "Start a composition",
    commands: ["asset.import", "workspace.open.slice"],
  },
  animate: {
    title: "Add artwork before animating",
    commands: ["asset.import", "workspace.open.compose"],
  },
  collision: {
    title: "Create frames before hitboxes",
    commands: ["workspace.open.slice", "asset.import"],
  },
  export: {
    title: "Build something to export",
    commands: ["asset.import", "workspace.open.compose"],
  },
};

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

const workspaces = [];
for (const [workspaceId, definition] of Object.entries(expected)) {
  await evaluate(`location.hash = ${JSON.stringify(`#/studio/${workspaceId}`)}`);
  await waitFor(
    `document.querySelector('[data-studio-workspace="${workspaceId}"]') && document.querySelector('[data-workspace-state="empty"][data-workspace-state-id="${workspaceId}"]')`,
    `${workspaceId} did not expose its empty state.`,
  );

  const snapshot = await evaluate(`(() => {
    const state = document.querySelector('[data-workspace-state="empty"][data-workspace-state-id="${workspaceId}"]');
    const heading = state?.querySelector('h1');
    const actions = [...(state?.querySelectorAll('button[data-command-id]') ?? [])].map((button) => ({
      commandId: button.dataset.commandId,
      label: button.textContent.trim(),
      disabled: button.disabled,
      title: button.title,
    }));
    return {
      workspaceId: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
      kind: state?.dataset.workspaceState,
      title: heading?.textContent.trim(),
      labelledBy: state?.getAttribute('aria-labelledby'),
      headingId: heading?.id,
      actions,
      canvasCount: document.querySelectorAll('canvas').length,
      pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
    };
  })()`);

  const actualCommands = snapshot.actions.map((action) => action.commandId);
  if (
    snapshot.workspaceId !== workspaceId ||
    snapshot.kind !== "empty" ||
    snapshot.title !== definition.title ||
    snapshot.labelledBy !== snapshot.headingId ||
    JSON.stringify(actualCommands) !== JSON.stringify(definition.commands) ||
    snapshot.actions.some((action) => action.disabled || !action.title) ||
    snapshot.canvasCount !== 0 ||
    !snapshot.pageFits
  ) {
    throw new Error(`Invalid ${workspaceId} empty state: ${JSON.stringify(snapshot)}`);
  }
  workspaces.push(snapshot);
  if (workspaceId === "animate") await screenshot("workspace-empty-animate.png");
}

await evaluate(`location.hash = '#/studio/compose'`);
await waitFor(
  `document.querySelector('[data-workspace-state-id="compose"] [data-command-id="workspace.open.slice"]')`,
  "Compose resolution action was not available.",
);
await evaluate(`(() => {
  const button = document.querySelector('[data-workspace-state-id="compose"] [data-command-id="workspace.open.slice"]');
  button?.focus();
  button?.click();
})()`);
await waitFor(
  `location.hash === '#/studio/slice' && document.querySelector('[data-workspace-state-id="slice"]')`,
  "The Compose recovery command did not navigate through the registry.",
);
const recoveryAction = await evaluate(`({
  hash: location.hash,
  focusWorkspace: document.activeElement?.dataset.studioWorkspaceContent ?? null,
  focusLabel: document.activeElement?.getAttribute('aria-label') ?? null,
  workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
})`);

await evaluate(`(() => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAQ3M3nAAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const file = new File([bytes], 'workspace-state-fixture.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('input[type="file"][accept^="image/"]');
  if (!input) throw new Error('Image input is missing.');
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(
  `!document.querySelector('[data-workspace-state]') && document.querySelector('canvas')`,
  "Slice did not transition from empty to ready after import.",
  30000,
);
const ready = await evaluate(`({
  workspace: document.querySelector('[data-studio-workspace]')?.dataset.studioWorkspace,
  stateCount: document.querySelectorAll('[data-workspace-state]').length,
  canvasCount: document.querySelectorAll('canvas').length,
  panelCount: document.querySelectorAll('[data-studio-panel-variant="sidebar"]').length,
  pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
})`);
await screenshot("workspace-ready-slice.png");

const result = {
  status: "pass",
  workspaces,
  recoveryAction,
  ready,
  consoleErrors,
  exceptions,
};

if (
  workspaces.length !== 5 ||
  recoveryAction.hash !== "#/studio/slice" ||
  recoveryAction.workspace !== "slice" ||
  recoveryAction.focusWorkspace !== "slice" ||
  recoveryAction.focusLabel !== "Slice workspace content" ||
  ready.workspace !== "slice" ||
  ready.stateCount !== 0 ||
  ready.canvasCount < 1 ||
  ready.panelCount !== 2 ||
  !ready.pageFits ||
  consoleErrors.length > 0 ||
  exceptions.length > 0
) {
  throw new Error(`Workspace-state journey failed: ${JSON.stringify(result)}`);
}

fs.writeFileSync(
  path.join(outputDir, "workspace-states-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await send("Browser.close");
