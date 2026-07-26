#!/usr/bin/env bun

import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import {
  createStudioControlFailure,
  parseStudioControlRequestJson,
  serializeStudioControlResponse,
  STUDIO_CONTROL_MAX_REQUEST_BYTES,
} from "../core/control/controlProtocol.ts";
import { isLocalModelId } from "../core/models/modelCatalog.ts";
import { LOCAL_MODEL_SERVICE_VERSION } from "../core/models/modelServiceProtocol.ts";
import { createNodeModelService, NodeModelServiceError } from "../core/models/nodeModelService.ts";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 43_119;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;
const MAX_QUEUE_SIZE = 64;
const POLL_TIMEOUT_MS = 25_000;
const SESSION_IDLE_MS = 45_000;
const BROWSER_PATHS = new Set([
  "/v1/browser/connect",
  "/v1/browser/disconnect",
  "/v1/browser/poll",
  "/v1/browser/respond",
]);
const DEFAULT_ORIGINS = Object.freeze([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const encoder = new TextEncoder();

function usage() {
  return [
    "Usage: bun scripts/studio-control-bridge.mjs [options]",
    "",
    "Options:",
    "  --port <0..65535>        Loopback port; 0 selects a free port",
    "  --origin <http-origin>   Allowed Studio origin; repeatable",
    "  --timeout-ms <100..120000>",
    "  --models-dir <path>      Local verified model store",
    "  --help",
    "",
    "SPRITEBOY_CONTROL_TOKEN may provide a 32+ character session token.",
  ].join("\n");
}

function parseInteger(value, min, max, label) {
  if (!/^(0|[1-9]\d*)$/.test(value ?? "")) throw new TypeError(`${label} is invalid.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${label} is invalid.`);
  }
  return parsed;
}

function parseOptions(argv) {
  let port = DEFAULT_PORT;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let modelsRoot = resolve(process.env.SPRITEBOY_MODELS_DIR ?? ".spriteboy/models");
  const origins = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (argument === "--port") {
      port = parseInteger(argv[index + 1], 0, 65_535, "Port");
      index += 1;
      continue;
    }
    if (argument === "--timeout-ms") {
      timeoutMs = parseInteger(argv[index + 1], MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "Timeout");
      index += 1;
      continue;
    }
    if (argument === "--origin") {
      const origin = argv[index + 1];
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new TypeError("Origin is invalid.");
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.origin !== origin ||
        parsed.username ||
        parsed.password
      ) {
        throw new TypeError("Origin is invalid.");
      }
      origins.push(origin);
      index += 1;
      continue;
    }
    if (argument === "--models-dir") {
      const path = argv[index + 1];
      if (typeof path !== "string" || path.trim().length === 0 || path.includes("\0")) {
        throw new TypeError("Models directory is invalid.");
      }
      modelsRoot = resolve(path);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown option: ${argument}`);
  }
  return Object.freeze({
    help: false,
    port,
    timeoutMs,
    modelsRoot,
    origins: Object.freeze(origins.length > 0 ? [...new Set(origins)] : [...DEFAULT_ORIGINS]),
  });
}

function safeTokenFromEnvironment() {
  const token = process.env.SPRITEBOY_CONTROL_TOKEN;
  if (token === undefined || token === "") return randomBytes(32).toString("base64url");
  if (token.length < 32 || token.length > 512) {
    throw new TypeError("SPRITEBOY_CONTROL_TOKEN must contain 32 to 512 characters.");
  }
  return token;
}

function sameToken(left, right) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice(7);
  return token.length > 0 ? token : undefined;
}

function securityHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: securityHeaders({ "Content-Type": "application/json; charset=utf-8", ...extraHeaders }),
  });
}

function emptyResponse(status, extraHeaders = {}) {
  return new Response(null, { status, headers: securityHeaders(extraHeaders) });
}

function protocolFailure(requestId, code, message, status = 200) {
  const response = createStudioControlFailure({
    version: 1,
    requestId,
    ok: false,
    revision: 0,
    error: { code, message, retryable: code === "busy" || code === "timeout" },
  });
  return new Response(serializeStudioControlResponse(response), {
    status,
    headers: securityHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

async function readBoundedText(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > STUDIO_CONTROL_MAX_REQUEST_BYTES) {
      return { ok: false, status: 413 };
    }
  }
  if (request.body === null) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > STUDIO_CONTROL_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, status: 400 };
  }
}

function parseExactObject(text, keys) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) return undefined;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) return undefined;
  }
  return value;
}

function startBridge(options, token) {
  const sessionId = randomBytes(12).toString("hex");
  const allowedOrigins = new Set(options.origins);
  const operations = new Map();
  const outbound = [];
  const modelService = createNodeModelService({ root: options.modelsRoot });
  let browserSession;
  let pollWaiter;

  const audit = (event, outcome) => {
    process.stderr.write(`${JSON.stringify({
      type: "spriteboy-control-audit",
      at: new Date().toISOString(),
      event,
      outcome,
    })}\n`);
  };

  const corsHeaders = (origin) => ({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });

  const browserOrigin = (request) => {
    const origin = request.headers.get("origin");
    return origin && allowedOrigins.has(origin) ? origin : undefined;
  };

  const authenticated = (request) => {
    const supplied = bearerToken(request);
    return supplied !== undefined && sameToken(supplied, token);
  };

  const activeBrowser = () => {
    if (!browserSession) return undefined;
    if (Date.now() - browserSession.lastSeen <= SESSION_IDLE_MS) return browserSession;
    invalidateBrowser("expired");
    return undefined;
  };

  const removeQueuedOperation = (operationId) => {
    const index = outbound.findIndex(
      (message) => message.type === "control.request" && message.operationId === operationId,
    );
    if (index >= 0) outbound.splice(index, 1);
  };

  const deliver = (message) => {
    if (pollWaiter) {
      const waiter = pollWaiter;
      pollWaiter = undefined;
      waiter.finish(message);
      if (message.type === "control.request") {
        const operation = operations.get(message.operationId);
        if (operation) operation.delivered = true;
      }
      return true;
    }
    if (outbound.length >= MAX_QUEUE_SIZE) return false;
    outbound.push(message);
    return true;
  };

  const finishOperation = (operationId, response) => {
    const operation = operations.get(operationId);
    if (!operation) return false;
    operations.delete(operationId);
    clearTimeout(operation.timer);
    operation.signal.removeEventListener("abort", operation.onAbort);
    operation.resolve(response);
    return true;
  };

  const cancelOperation = (operationId, kind) => {
    const operation = operations.get(operationId);
    if (!operation) return;
    removeQueuedOperation(operationId);
    if (operation.delivered) {
      deliver({ version: 1, type: "control.cancel", operationId });
    }
    const code = kind === "timeout" ? "timeout" : "cancelled";
    const message = kind === "timeout"
      ? "The control operation timed out."
      : "The control operation was cancelled.";
    finishOperation(operationId, protocolFailure(operation.requestId, code, message));
    audit("control-finished", kind);
  };

  const invalidateBrowser = (outcome) => {
    browserSession = undefined;
    if (pollWaiter) {
      const waiter = pollWaiter;
      pollWaiter = undefined;
      waiter.finish(undefined);
    }
    outbound.length = 0;
    for (const operationId of operations.keys()) cancelOperation(operationId, "cancelled");
    outbound.length = 0;
    audit("browser-session", outcome);
  };

  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: options.port,
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.hostname !== LOOPBACK_HOST && url.hostname !== "localhost") {
        audit("host-check", "rejected");
        return emptyResponse(403);
      }
      if (request.method === "OPTIONS" && url.pathname.startsWith("/v1/browser/")) {
        if (!BROWSER_PATHS.has(url.pathname)) return emptyResponse(404);
        const origin = browserOrigin(request);
        if (!origin) {
          audit("browser-origin", "rejected");
          return emptyResponse(403);
        }
        return emptyResponse(204, corsHeaders(origin));
      }
      if (request.method === "OPTIONS" && url.pathname.startsWith("/v1/models")) {
        const origin = browserOrigin(request);
        if (!origin) {
          audit("model-origin", "rejected");
          return emptyResponse(403);
        }
        return emptyResponse(204, corsHeaders(origin));
      }
      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse({ ok: true });
      }
      if (!authenticated(request)) {
        audit("authentication", "rejected");
        return jsonResponse({ error: "Unauthorized." }, 401);
      }

      if (url.pathname.startsWith("/v1/models")) {
        const origin = browserOrigin(request);
        if (!origin) {
          audit("model-origin", "rejected");
          return emptyResponse(403);
        }
        const cors = corsHeaders(origin);
        try {
          if (url.pathname === "/v1/models" && request.method === "GET") {
            return jsonResponse(await modelService.list(), 200, cors);
          }
          if (url.pathname === "/v1/models/setup" && request.method === "POST") {
            const body = await readBoundedText(request);
            if (!body.ok) return emptyResponse(body.status, cors);
            const input = parseExactObject(body.text, ["version", "modelId"]);
            if (
              !input ||
              input.version !== LOCAL_MODEL_SERVICE_VERSION ||
              typeof input.modelId !== "string" ||
              !isLocalModelId(input.modelId)
            ) {
              return jsonResponse({
                version: LOCAL_MODEL_SERVICE_VERSION,
                error: { code: "invalid-request", message: "Unknown local model." },
              }, 400, cors);
            }
            const result = await modelService.setup(input.modelId);
            audit("model-setup", result.outcome);
            return jsonResponse(result, result.outcome === "started" ? 202 : 200, cors);
          }
          const jobMatch = /^\/v1\/models\/jobs\/([^/]{1,200})$/u.exec(url.pathname);
          if (jobMatch && (request.method === "GET" || request.method === "DELETE")) {
            let jobId;
            try {
              jobId = decodeURIComponent(jobMatch[1]);
            } catch {
              return emptyResponse(400, cors);
            }
            const job = request.method === "DELETE"
              ? modelService.cancelJob(jobId)
              : modelService.getJob(jobId);
            if (!job) {
              return jsonResponse({
                version: LOCAL_MODEL_SERVICE_VERSION,
                error: { code: "not-found", message: "Model job not found." },
              }, 404, cors);
            }
            return jsonResponse({ version: LOCAL_MODEL_SERVICE_VERSION, job }, 200, cors);
          }
          const weightMatch = /^\/v1\/models\/weights\/([^/]{1,80})$/u.exec(url.pathname);
          if (weightMatch && request.method === "GET") {
            const modelId = decodeURIComponent(weightMatch[1]);
            if (!isLocalModelId(modelId)) {
              return jsonResponse({
                version: LOCAL_MODEL_SERVICE_VERSION,
                error: { code: "not-found", message: "Local model not found." },
              }, 404, cors);
            }
            const weights = await modelService.resolveWeights(modelId);
            if (!weights) return emptyResponse(404, cors);
            return new Response(Bun.file(weights.path), {
              status: 200,
              headers: securityHeaders({
                ...cors,
                "Content-Type": weights.contentType,
                "Content-Length": String(weights.byteSize),
              }),
            });
          }
          return emptyResponse(404, cors);
        } catch (error) {
          const known = error instanceof NodeModelServiceError;
          const code = known ? error.code : "setup-failed";
          const message = known ? error.message : "The local model service failed.";
          audit("model-service", code);
          return jsonResponse({
            version: LOCAL_MODEL_SERVICE_VERSION,
            error: { code, message },
          }, code === "license-required" || code === "model-not-ready" ? 409 : 500, cors);
        }
      }

      if (url.pathname.startsWith("/v1/browser/")) {
        if (!BROWSER_PATHS.has(url.pathname)) return emptyResponse(404);
        const origin = browserOrigin(request);
        if (!origin) {
          audit("browser-origin", "rejected");
          return emptyResponse(403);
        }
        const cors = corsHeaders(origin);
        if (request.method !== "POST") return emptyResponse(405, cors);
        const body = await readBoundedText(request);
        if (!body.ok) return emptyResponse(body.status, cors);

        if (url.pathname === "/v1/browser/connect") {
          const input = parseExactObject(body.text, ["version"]);
          if (!input || input.version !== 1) return jsonResponse({ error: "Invalid request." }, 400, cors);
          if (activeBrowser()) return jsonResponse({ error: "A browser session is active." }, 409, cors);
          const clientId = randomBytes(16).toString("hex");
          browserSession = { clientId, lastSeen: Date.now() };
          audit("browser-session", "connected");
          return jsonResponse({ version: 1, clientId }, 200, cors);
        }

        const inputKeys = url.pathname === "/v1/browser/respond"
          ? ["version", "clientId", "operationId", "response"]
          : ["version", "clientId"];
        const input = parseExactObject(body.text, inputKeys);
        const browser = activeBrowser();
        if (!input || input.version !== 1 || !browser || input.clientId !== browser.clientId) {
          return jsonResponse({ error: "Invalid browser session." }, 409, cors);
        }
        browser.lastSeen = Date.now();

        if (url.pathname === "/v1/browser/disconnect") {
          invalidateBrowser("disconnected");
          return emptyResponse(204, cors);
        }
        if (url.pathname === "/v1/browser/respond") {
          if (typeof input.operationId !== "string" || input.operationId.length === 0) {
            return jsonResponse({ error: "Invalid response." }, 400, cors);
          }
          const operation = operations.get(input.operationId);
          if (!operation) return jsonResponse({ error: "Operation not found." }, 404, cors);
          let serialized;
          try {
            serialized = serializeStudioControlResponse(input.response);
          } catch {
            return jsonResponse({ error: "Invalid response." }, 400, cors);
          }
          const response = JSON.parse(serialized);
          if (response.requestId !== operation.requestId) {
            return jsonResponse({ error: "Invalid response." }, 400, cors);
          }
          finishOperation(
            input.operationId,
            new Response(serialized, {
              status: 200,
              headers: securityHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            }),
          );
          audit("control-finished", "responded");
          return emptyResponse(204, cors);
        }
        if (url.pathname === "/v1/browser/poll") {
          if (outbound.length > 0) {
            const message = outbound.shift();
            if (message.type === "control.request") {
              const operation = operations.get(message.operationId);
              if (operation) operation.delivered = true;
            }
            return jsonResponse(message, 200, cors);
          }
          if (pollWaiter) return jsonResponse({ error: "A poll is already active." }, 409, cors);
          return new Promise((resolve) => {
            let settled = false;
            const finish = (message) => {
              if (settled) return;
              settled = true;
              if (pollWaiter?.finish === finish) pollWaiter = undefined;
              clearTimeout(timer);
              request.signal.removeEventListener("abort", onAbort);
              resolve(message === undefined
                ? emptyResponse(204, cors)
                : jsonResponse(message, 200, cors));
            };
            const onAbort = () => finish(undefined);
            const timer = setTimeout(() => finish(undefined), POLL_TIMEOUT_MS);
            pollWaiter = { finish };
            request.signal.addEventListener("abort", onAbort, { once: true });
          });
        }
        return emptyResponse(404, cors);
      }

      if (url.pathname === "/v1/status" && request.method === "GET") {
        return jsonResponse({
          version: 1,
          sessionId,
          browserConnected: activeBrowser() !== undefined,
          activeOperations: operations.size,
          queuedMessages: outbound.length,
        });
      }
      if (url.pathname !== "/v1/control") return emptyResponse(404);
      if (request.method !== "POST") return emptyResponse(405);
      const suppliedOrigin = request.headers.get("origin");
      if (suppliedOrigin && !allowedOrigins.has(suppliedOrigin)) {
        audit("controller-origin", "rejected");
        return emptyResponse(403);
      }
      const body = await readBoundedText(request);
      if (!body.ok) return emptyResponse(body.status);
      let controlRequest;
      try {
        controlRequest = parseStudioControlRequestJson(body.text);
      } catch {
        audit("control-parse", "rejected");
        return jsonResponse({ error: "Invalid control request." }, 400);
      }
      if (!activeBrowser()) {
        return protocolFailure(
          controlRequest.requestId,
          "busy",
          "No Studio browser session is connected.",
        );
      }
      if (operations.size >= MAX_QUEUE_SIZE) {
        return protocolFailure(controlRequest.requestId, "busy", "The control queue is full.");
      }
      const operationId = randomBytes(16).toString("hex");
      const responsePromise = new Promise((resolve) => {
        const onAbort = () => cancelOperation(operationId, "cancelled");
        const timer = setTimeout(() => cancelOperation(operationId, "timeout"), options.timeoutMs);
        operations.set(operationId, {
          requestId: controlRequest.requestId,
          resolve,
          timer,
          signal: request.signal,
          onAbort,
          delivered: false,
        });
        request.signal.addEventListener("abort", onAbort, { once: true });
      });
      if (!deliver({ version: 1, type: "control.request", operationId, request: controlRequest })) {
        finishOperation(
          operationId,
          protocolFailure(controlRequest.requestId, "busy", "The control queue is full."),
        );
      } else {
        audit("control-forwarded", "accepted");
      }
      return responsePromise;
    },
  });

  const stop = (signal) => {
    invalidateBrowser("bridge-stopped");
    modelService.dispose();
    server.stop(true);
    audit("bridge", signal);
    process.exit(0);
  };
  process.once("SIGINT", () => stop("sigint"));
  process.once("SIGTERM", () => stop("sigterm"));

  return Object.freeze({ server, sessionId });
}

let options;
try {
  options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const token = safeTokenFromEnvironment();
  const bridge = startBridge(options, token);
  process.stdout.write(`${JSON.stringify({
    type: "spriteboy-control-ready",
    version: 1,
    host: LOOPBACK_HOST,
    port: bridge.server.port,
    sessionId: bridge.sessionId,
    controlToken: process.env.SPRITEBOY_CONTROL_TOKEN ? undefined : token,
    allowedOrigins: options.origins,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Control bridge failed to start.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
