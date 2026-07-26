import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { LOCAL_MODEL_CATALOG, isLocalModelId } from "../core/models/modelCatalog.ts";
import { inspectLocalModel } from "../core/models/nodeModelInventory.ts";

export function parseModelStatusArguments(args) {
  if (args.length === 0) return Object.freeze({ modelId: null });
  if (args.length !== 2 || args[0] !== "--model" || typeof args[1] !== "string" || !isLocalModelId(args[1])) {
    throw new TypeError("Use --model with a known local model ID.");
  }
  return Object.freeze({ modelId: args[1] });
}

export async function runStudioModelStatus(options = {}) {
  const root = resolve(options.root ?? process.env.SPRITEBOY_MODELS_DIR ?? ".spriteboy/models");
  const ids = options.modelId === null || options.modelId === undefined
    ? Object.keys(LOCAL_MODEL_CATALOG)
    : [options.modelId];
  const models = [];
  for (const id of ids) {
    if (!isLocalModelId(id)) throw new TypeError("Unknown local model ID.");
    models.push(await inspectLocalModel(id, { root, now: options.now }));
  }
  return Object.freeze({
    schemaVersion: 1,
    check: "model-status",
    models: Object.freeze(models),
  });
}

export async function runStudioModelStatusCli(args = process.argv.slice(2), io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const parsed = parseModelStatusArguments(args);
    const result = await (dependencies.run ?? runStudioModelStatus)(parsed);
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "model-status",
      status: "fail",
      reason: "model-status-unavailable",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runStudioModelStatusCli();
