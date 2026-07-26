import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isLocalModelId } from "../core/models/modelCatalog.ts";
import { createModelSetupJobTask } from "../core/models/modelSetupJobTask.ts";
import { createNodeModelSetupPort } from "../core/models/nodeModelSetup.ts";
import { createNodeOnnxSmokeRunner } from "../core/models/nodeOnnxSmoke.ts";
import { createJobRunner, createQueuedJob } from "../core/processing/index.ts";
import { createJobStore } from "../core/stores/index.ts";

export function parseModelSetupArguments(args) {
  if (args.length !== 2 || args[0] !== "--model" || !isLocalModelId(args[1])) {
    throw new TypeError("Use --model with a known local model ID.");
  }
  return Object.freeze({ modelId: args[1] });
}

export async function runStudioModelSetup(options, dependencies = {}) {
  const root = resolve(dependencies.root ?? process.env.SPRITEBOY_MODELS_DIR ?? ".spriteboy/models");
  const store = dependencies.store ?? createJobStore();
  const runner = dependencies.runner ?? createJobRunner({ store });
  const port = dependencies.port ?? createNodeModelSetupPort({
    root,
    smoke: createNodeOnnxSmokeRunner(),
  });
  const id = `model-setup-${randomUUID()}`;
  const requestId = `${id}-request`;
  const createdAt = new Date().toISOString();
  const job = createQueuedJob({
    id,
    requestId,
    kind: "model.setup",
    label: `Preparar ${options.modelId}`,
    createdAt,
    timeoutMs: 45 * 60 * 1_000,
  });
  const controller = new AbortController();
  const signal = dependencies.signal ?? controller.signal;
  const handle = runner.run(job, createModelSetupJobTask({ modelId: options.modelId, port }), {
    signal,
  });
  return Object.freeze({ handle, controller, result: await handle.result });
}

export async function runStudioModelSetupCli(args = process.argv.slice(2), io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let interrupted = false;
  let activeController = null;
  const interrupt = () => {
    interrupted = true;
    activeController?.abort(new DOMException("Interrupted", "AbortError"));
  };
  process.once("SIGINT", interrupt);
  try {
    const parsed = parseModelSetupArguments(args);
    const controller = new AbortController();
    activeController = controller;
    const execution = await (dependencies.run ?? ((value) => runStudioModelSetup(value, {
      ...dependencies,
      signal: controller.signal,
    })))(parsed);
    const result = execution.result ?? execution;
    const payload = {
      schemaVersion: 1,
      check: "model-setup",
      modelId: parsed.modelId,
      status: result.status,
      ...(result.status === "succeeded" ? { manifest: result.value } : { error: result.job?.error ?? null }),
    };
    (result.status === "succeeded" ? stdout : stderr).write(`${JSON.stringify(payload)}\n`);
    return result.status === "succeeded" ? 0 : interrupted ? 130 : 1;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      check: "model-setup",
      status: "failed",
      reason: "model-setup-unavailable",
    })}\n`);
    return interrupted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runStudioModelSetupCli();
