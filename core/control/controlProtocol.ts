/**
 * SpriteBoy studio control protocol v1 — pure data-only request/response codec.
 * No I/O, no React, no side effects. Hostile input is rejected with generic errors.
 */

import { LOCAL_MODEL_IDS, type LocalModelId } from "../models/modelCatalog";

export const STUDIO_CONTROL_PROTOCOL_VERSION = 1 as const;
export const STUDIO_CONTROL_MAX_REQUEST_BYTES = 1_048_576 as const;

export const STUDIO_CONTROL_COMMANDS = Object.freeze([
  "capabilities.get",
  "project.get",
  "selection.get",
  "workspace.navigate",
  "asset.import",
  "video.import",
  "model.status",
  "model.setup",
  "jobs.list",
  "jobs.cancel",
  "export.run",
] as const);

export type StudioControlCommand = (typeof STUDIO_CONTROL_COMMANDS)[number];

export type StudioControlErrorCode =
  | "invalid-request"
  | "unsupported-command"
  | "revision-conflict"
  | "duplicate-request"
  | "not-found"
  | "busy"
  | "cancelled"
  | "timeout"
  | "internal";

type EmptyParams = Record<string, never>;

export type StudioControlRequest =
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "capabilities.get";
      expectedRevision: number | null;
      params: EmptyParams;
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "project.get";
      expectedRevision: number | null;
      params: EmptyParams;
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "selection.get";
      expectedRevision: number | null;
      params: EmptyParams;
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "workspace.navigate";
      expectedRevision: number | null;
      params: { workspaceId: "slice" | "compose" | "collision" | "export" };
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "asset.import";
      expectedRevision: number | null;
      params: { path: string };
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "video.import";
      expectedRevision: number | null;
      params: {
        path: string;
        startUs: number;
        endUs: number;
        sampling: { mode: "all" } | { mode: "fps"; fps: number };
      };
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "model.status";
      expectedRevision: number | null;
      params: { modelId: LocalModelId };
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "model.setup";
      expectedRevision: number | null;
      params: {
        modelId: LocalModelId;
        acceptLicense: boolean;
      };
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "jobs.list";
      expectedRevision: number | null;
      params: EmptyParams;
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "jobs.cancel";
      expectedRevision: number | null;
      params: { jobId: string };
    }
  | {
      version: 1;
      requestId: string;
      idempotencyKey: string;
      command: "export.run";
      expectedRevision: number | null;
      params: { format: "png" | "zip" | "gif" | "mp4" | "webm" };
    };

export type StudioControlSuccess = {
  version: 1;
  requestId: string;
  ok: true;
  revision: number;
  result: unknown;
};

export type StudioControlFailure = {
  version: 1;
  requestId: string;
  ok: false;
  revision: number;
  error: {
    code: StudioControlErrorCode;
    message: string;
    retryable: boolean;
  };
};

export type StudioControlResponse = StudioControlSuccess | StudioControlFailure;

const REQUEST_KEYS = Object.freeze([
  "version",
  "requestId",
  "idempotencyKey",
  "command",
  "expectedRevision",
  "params",
] as const);

const SUCCESS_KEYS = Object.freeze([
  "version",
  "requestId",
  "ok",
  "revision",
  "result",
] as const);

const FAILURE_KEYS = Object.freeze([
  "version",
  "requestId",
  "ok",
  "revision",
  "error",
] as const);

const ERROR_KEYS = Object.freeze(["code", "message", "retryable"] as const);

const ERROR_CODES = Object.freeze([
  "invalid-request",
  "unsupported-command",
  "revision-conflict",
  "duplicate-request",
  "not-found",
  "busy",
  "cancelled",
  "timeout",
  "internal",
] as const);

const WORKSPACE_IDS = Object.freeze([
  "slice",
  "compose",
  "collision",
  "export",
] as const);

const EXPORT_FORMATS = Object.freeze([
  "png",
  "zip",
  "gif",
  "mp4",
  "webm",
] as const);

const EMPTY_PARAM_COMMANDS = Object.freeze([
  "capabilities.get",
  "project.get",
  "selection.get",
  "jobs.list",
] as const);

const MAX_ID_LEN = 128;
const MAX_PATH_LEN = 4096;
const MAX_ERROR_MESSAGE_LEN = 512;
const MAX_JSON_SAFE_DEPTH = 32;

const INVALID_REQUEST = "Studio control request is invalid.";
const INVALID_JSON = "Studio control request JSON is invalid.";
const INVALID_SUCCESS = "Studio control success response is invalid.";
const INVALID_FAILURE = "Studio control failure response is invalid.";
const INVALID_RESPONSE = "Studio control response is invalid.";

function reflectOrThrow<T>(operation: () => T, label: string): T {
  try {
    return operation();
  } catch {
    throw new TypeError(label);
  }
}

function isPlainObject(
  value: unknown,
  label: string,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = reflectOrThrow(() => Object.getPrototypeOf(value), label);
  return proto === Object.prototype || proto === null;
}

function ownStringKeys(value: object, label: string): string[] {
  return reflectOrThrow(() => Object.getOwnPropertyNames(value), label);
}

function hasSymbolKeys(value: object, label: string): boolean {
  return reflectOrThrow(
    () => Object.getOwnPropertySymbols(value).length > 0,
    label,
  );
}

/**
 * Reject non-plain objects, symbol keys, and any accessor/non-data descriptors
 * before any property value is read. Does not invoke getters.
 */
function assertSafePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value, label)) {
    throw new TypeError(label);
  }
  if (hasSymbolKeys(value, label)) {
    throw new TypeError(label);
  }
  const names = ownStringKeys(value, label);
  for (const name of names) {
    const desc = reflectOrThrow(
      () => Object.getOwnPropertyDescriptor(value, name),
      label,
    );
    if (!desc || desc.get !== undefined || desc.set !== undefined || !("value" in desc)) {
      throw new TypeError(label);
    }
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const names = ownStringKeys(value, label);
  if (names.length !== expected.length) {
    throw new TypeError(label);
  }
  const set = new Set(names);
  for (const key of expected) {
    if (!set.has(key)) {
      throw new TypeError(label);
    }
  }
}

function readDataProp(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  const desc = reflectOrThrow(
    () => Object.getOwnPropertyDescriptor(obj, key),
    label,
  );
  if (!desc || desc.get !== undefined || desc.set !== undefined || !("value" in desc)) {
    throw new TypeError(label);
  }
  return desc.value;
}

function isNonemptyString(value: unknown, maxLen: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isCommand(value: unknown): value is StudioControlCommand {
  return (
    typeof value === "string" &&
    (STUDIO_CONTROL_COMMANDS as readonly string[]).includes(value)
  );
}

function freezeEmptyParams(): EmptyParams {
  return Object.freeze({});
}

function parseEmptyParams(params: unknown): EmptyParams {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, [], INVALID_REQUEST);
  return freezeEmptyParams();
}

function parseWorkspaceNavigateParams(params: unknown): {
  workspaceId: "slice" | "compose" | "collision" | "export";
} {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["workspaceId"], INVALID_REQUEST);
  const workspaceId = readDataProp(params, "workspaceId", INVALID_REQUEST);
  if (
    typeof workspaceId !== "string" ||
    !(WORKSPACE_IDS as readonly string[]).includes(workspaceId)
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({
    workspaceId: workspaceId as "slice" | "compose" | "collision" | "export",
  });
}

function parseAssetImportParams(params: unknown): { path: string } {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["path"], INVALID_REQUEST);
  const path = readDataProp(params, "path", INVALID_REQUEST);
  if (!isNonemptyString(path, MAX_PATH_LEN)) {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({ path });
}

function parseVideoSampling(
  sampling: unknown,
): { mode: "all" } | { mode: "fps"; fps: number } {
  assertSafePlainObject(sampling, INVALID_REQUEST);
  if (hasSymbolKeys(sampling, INVALID_REQUEST)) {
    throw new TypeError(INVALID_REQUEST);
  }
  const mode = readDataProp(
    sampling as Record<string, unknown>,
    "mode",
    INVALID_REQUEST,
  );
  if (mode === "all") {
    exactKeys(sampling as Record<string, unknown>, ["mode"], INVALID_REQUEST);
    return Object.freeze({ mode: "all" as const });
  }
  if (mode === "fps") {
    exactKeys(sampling as Record<string, unknown>, ["mode", "fps"], INVALID_REQUEST);
    const fps = readDataProp(
      sampling as Record<string, unknown>,
      "fps",
      INVALID_REQUEST,
    );
    if (
      typeof fps !== "number" ||
      !Number.isFinite(fps) ||
      fps < 0.1 ||
      fps > 120
    ) {
      throw new TypeError(INVALID_REQUEST);
    }
    return Object.freeze({ mode: "fps" as const, fps });
  }
  throw new TypeError(INVALID_REQUEST);
}

function parseVideoImportParams(params: unknown): {
  path: string;
  startUs: number;
  endUs: number;
  sampling: { mode: "all" } | { mode: "fps"; fps: number };
} {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["path", "startUs", "endUs", "sampling"], INVALID_REQUEST);
  const path = readDataProp(params, "path", INVALID_REQUEST);
  const startUs = readDataProp(params, "startUs", INVALID_REQUEST);
  const endUs = readDataProp(params, "endUs", INVALID_REQUEST);
  const samplingRaw = readDataProp(params, "sampling", INVALID_REQUEST);
  if (!isNonemptyString(path, MAX_PATH_LEN)) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (!isSafeInteger(startUs) || startUs < 0) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (!isSafeInteger(endUs) || endUs <= startUs) {
    throw new TypeError(INVALID_REQUEST);
  }
  const sampling = parseVideoSampling(samplingRaw);
  return Object.freeze({ path, startUs, endUs, sampling });
}

function parseModelStatusParams(params: unknown): {
  modelId: LocalModelId;
} {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["modelId"], INVALID_REQUEST);
  const modelId = readDataProp(params, "modelId", INVALID_REQUEST);
  if (
    typeof modelId !== "string" ||
    !(LOCAL_MODEL_IDS as readonly string[]).includes(modelId)
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({
    modelId: modelId as LocalModelId,
  });
}

function parseModelSetupParams(params: unknown): {
  modelId: LocalModelId;
  acceptLicense: boolean;
} {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["modelId", "acceptLicense"], INVALID_REQUEST);
  const modelId = readDataProp(params, "modelId", INVALID_REQUEST);
  const acceptLicense = readDataProp(params, "acceptLicense", INVALID_REQUEST);
  if (
    typeof modelId !== "string" ||
    !(LOCAL_MODEL_IDS as readonly string[]).includes(modelId)
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (typeof acceptLicense !== "boolean") {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({
    modelId: modelId as LocalModelId,
    acceptLicense,
  });
}

function parseJobsCancelParams(params: unknown): { jobId: string } {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["jobId"], INVALID_REQUEST);
  const jobId = readDataProp(params, "jobId", INVALID_REQUEST);
  if (!isNonemptyString(jobId, MAX_ID_LEN)) {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({ jobId });
}

function parseExportRunParams(params: unknown): {
  format: "png" | "zip" | "gif" | "mp4" | "webm";
} {
  assertSafePlainObject(params, INVALID_REQUEST);
  exactKeys(params, ["format"], INVALID_REQUEST);
  const format = readDataProp(params, "format", INVALID_REQUEST);
  if (
    typeof format !== "string" ||
    !(EXPORT_FORMATS as readonly string[]).includes(format)
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({
    format: format as "png" | "zip" | "gif" | "mp4" | "webm",
  });
}

function parseParams(
  command: StudioControlCommand,
  params: unknown,
): StudioControlRequest["params"] {
  if ((EMPTY_PARAM_COMMANDS as readonly string[]).includes(command)) {
    return parseEmptyParams(params);
  }
  switch (command) {
    case "workspace.navigate":
      return parseWorkspaceNavigateParams(params);
    case "asset.import":
      return parseAssetImportParams(params);
    case "video.import":
      return parseVideoImportParams(params);
    case "model.status":
      return parseModelStatusParams(params);
    case "model.setup":
      return parseModelSetupParams(params);
    case "jobs.cancel":
      return parseJobsCancelParams(params);
    case "export.run":
      return parseExportRunParams(params);
    default:
      throw new TypeError(INVALID_REQUEST);
  }
}

export function parseStudioControlRequest(value: unknown): StudioControlRequest {
  assertSafePlainObject(value, INVALID_REQUEST);
  exactKeys(value, REQUEST_KEYS as unknown as string[], INVALID_REQUEST);

  const version = readDataProp(value, "version", INVALID_REQUEST);
  const requestId = readDataProp(value, "requestId", INVALID_REQUEST);
  const idempotencyKey = readDataProp(value, "idempotencyKey", INVALID_REQUEST);
  const command = readDataProp(value, "command", INVALID_REQUEST);
  const expectedRevision = readDataProp(value, "expectedRevision", INVALID_REQUEST);
  const paramsRaw = readDataProp(value, "params", INVALID_REQUEST);

  if (version !== STUDIO_CONTROL_PROTOCOL_VERSION) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (!isNonemptyString(requestId, MAX_ID_LEN)) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (!isNonemptyString(idempotencyKey, MAX_ID_LEN)) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (!isCommand(command)) {
    throw new TypeError(INVALID_REQUEST);
  }
  if (
    expectedRevision !== null &&
    !isNonnegativeSafeInteger(expectedRevision)
  ) {
    throw new TypeError(INVALID_REQUEST);
  }

  const params = parseParams(command, paramsRaw);

  const request = Object.freeze({
    version: STUDIO_CONTROL_PROTOCOL_VERSION,
    requestId,
    idempotencyKey,
    command,
    expectedRevision,
    params,
  }) as StudioControlRequest;

  return request;
}

export function parseStudioControlRequestJson(text: string): StudioControlRequest {
  if (typeof text !== "string") {
    throw new TypeError(INVALID_JSON);
  }
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > STUDIO_CONTROL_MAX_REQUEST_BYTES) {
    throw new TypeError(INVALID_JSON);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(INVALID_JSON);
  }
  return parseStudioControlRequest(parsed);
}

function copyJsonSafe(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  label: string,
): unknown {
  if (depth > MAX_JSON_SAFE_DEPTH) {
    throw new TypeError(label);
  }
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(label);
    }
    return value;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError(label);
  }
  if (typeof value !== "object") {
    throw new TypeError(label);
  }
  if (seen.has(value)) {
    throw new TypeError(label);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    // Dense arrays only: reject holes and non-index own props beyond length contract.
    const lengthDescriptor = reflectOrThrow(
      () => Object.getOwnPropertyDescriptor(value, "length"),
      label,
    );
    if (
      !lengthDescriptor ||
      lengthDescriptor.get !== undefined ||
      lengthDescriptor.set !== undefined ||
      !("value" in lengthDescriptor)
    ) {
      throw new TypeError(label);
    }
    const len = lengthDescriptor.value;
    if (!Number.isSafeInteger(len) || len < 0) {
      throw new TypeError(label);
    }
    if (hasSymbolKeys(value, label)) {
      throw new TypeError(label);
    }
    const names = ownStringKeys(value, label);
    // Arrays may own "length" plus dense indices 0..len-1 only.
    const allowed = new Set<string>(["length"]);
    for (let i = 0; i < len; i++) {
      allowed.add(String(i));
    }
    for (const name of names) {
      if (!allowed.has(name)) {
        throw new TypeError(label);
      }
      if (name === "length") continue;
      const desc = reflectOrThrow(
        () => Object.getOwnPropertyDescriptor(value, name),
        label,
      );
      if (!desc || desc.get !== undefined || desc.set !== undefined || !("value" in desc)) {
        throw new TypeError(label);
      }
    }
    const values: unknown[] = Array.from({ length: len });
    for (let i = 0; i < len; i++) {
      const desc = reflectOrThrow(
        () => Object.getOwnPropertyDescriptor(value, String(i)),
        label,
      );
      if (!desc || desc.get !== undefined || desc.set !== undefined || !("value" in desc)) {
        // sparse hole or accessor
        throw new TypeError(label);
      }
      values[i] = desc.value;
    }
    const out: unknown[] = Array.from({ length: len });
    for (let i = 0; i < len; i++) {
      out[i] = copyJsonSafe(
        values[i],
        depth + 1,
        seen,
        label,
      );
    }
    seen.delete(value);
    return Object.freeze(out);
  }

  assertSafePlainObject(value, label);
  const names = ownStringKeys(value, label);
  // Reject prototype pollution keys as nested own properties that would be dangerous
  // if later merged; we still copy plain data under those names as own data keys only
  // when they are data descriptors — but reject "__proto__" entirely for nested safety.
  const out: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    if (name === "__proto__" || name === "prototype" || name === "constructor") {
      throw new TypeError(label);
    }
    const prop = readDataProp(value, name, label);
    out[name] = copyJsonSafe(prop, depth + 1, seen, label);
  }
  seen.delete(value);
  return Object.freeze(out);
}

function parseErrorObject(error: unknown): StudioControlFailure["error"] {
  assertSafePlainObject(error, INVALID_FAILURE);
  exactKeys(error, ERROR_KEYS as unknown as string[], INVALID_FAILURE);
  const code = readDataProp(error, "code", INVALID_FAILURE);
  const message = readDataProp(error, "message", INVALID_FAILURE);
  const retryable = readDataProp(error, "retryable", INVALID_FAILURE);
  if (
    typeof code !== "string" ||
    !(ERROR_CODES as readonly string[]).includes(code)
  ) {
    throw new TypeError(INVALID_FAILURE);
  }
  if (!isNonemptyString(message, MAX_ERROR_MESSAGE_LEN)) {
    throw new TypeError(INVALID_FAILURE);
  }
  if (typeof retryable !== "boolean") {
    throw new TypeError(INVALID_FAILURE);
  }
  return Object.freeze({
    code: code as StudioControlErrorCode,
    message,
    retryable,
  });
}

export function createStudioControlSuccess(input: unknown): StudioControlSuccess {
  assertSafePlainObject(input, INVALID_SUCCESS);
  exactKeys(input, SUCCESS_KEYS as unknown as string[], INVALID_SUCCESS);

  const version = readDataProp(input, "version", INVALID_SUCCESS);
  const requestId = readDataProp(input, "requestId", INVALID_SUCCESS);
  const ok = readDataProp(input, "ok", INVALID_SUCCESS);
  const revision = readDataProp(input, "revision", INVALID_SUCCESS);
  const resultRaw = readDataProp(input, "result", INVALID_SUCCESS);

  if (version !== STUDIO_CONTROL_PROTOCOL_VERSION) {
    throw new TypeError(INVALID_SUCCESS);
  }
  if (!isNonemptyString(requestId, MAX_ID_LEN)) {
    throw new TypeError(INVALID_SUCCESS);
  }
  if (ok !== true) {
    throw new TypeError(INVALID_SUCCESS);
  }
  if (!isNonnegativeSafeInteger(revision)) {
    throw new TypeError(INVALID_SUCCESS);
  }

  const result = copyJsonSafe(resultRaw, 1, new WeakSet(), INVALID_SUCCESS);

  return Object.freeze({
    version: STUDIO_CONTROL_PROTOCOL_VERSION,
    requestId,
    ok: true as const,
    revision,
    result,
  });
}

export function createStudioControlFailure(input: unknown): StudioControlFailure {
  assertSafePlainObject(input, INVALID_FAILURE);
  exactKeys(input, FAILURE_KEYS as unknown as string[], INVALID_FAILURE);

  const version = readDataProp(input, "version", INVALID_FAILURE);
  const requestId = readDataProp(input, "requestId", INVALID_FAILURE);
  const ok = readDataProp(input, "ok", INVALID_FAILURE);
  const revision = readDataProp(input, "revision", INVALID_FAILURE);
  const errorRaw = readDataProp(input, "error", INVALID_FAILURE);

  if (version !== STUDIO_CONTROL_PROTOCOL_VERSION) {
    throw new TypeError(INVALID_FAILURE);
  }
  if (!isNonemptyString(requestId, MAX_ID_LEN)) {
    throw new TypeError(INVALID_FAILURE);
  }
  if (ok !== false) {
    throw new TypeError(INVALID_FAILURE);
  }
  if (!isNonnegativeSafeInteger(revision)) {
    throw new TypeError(INVALID_FAILURE);
  }

  const error = parseErrorObject(errorRaw);

  return Object.freeze({
    version: STUDIO_CONTROL_PROTOCOL_VERSION,
    requestId,
    ok: false as const,
    revision,
    error,
  });
}

export function serializeStudioControlResponse(
  response: unknown,
): string {
  try {
    assertSafePlainObject(response, INVALID_RESPONSE);
    if (hasSymbolKeys(response, INVALID_RESPONSE)) {
      throw new TypeError(INVALID_RESPONSE);
    }
    // Peek ok only via data descriptor — never serialize invalid/hostile payloads.
    const okDesc = reflectOrThrow(
      () => Object.getOwnPropertyDescriptor(response, "ok"),
      INVALID_RESPONSE,
    );
    if (!okDesc || okDesc.get !== undefined || okDesc.set !== undefined || !("value" in okDesc)) {
      throw new TypeError(INVALID_RESPONSE);
    }
    let validated: StudioControlResponse;
    if (okDesc.value === true) {
      validated = createStudioControlSuccess(response);
    } else if (okDesc.value === false) {
      validated = createStudioControlFailure(response);
    } else {
      throw new TypeError(INVALID_RESPONSE);
    }
    // JSON.stringify on frozen plain data only — no secrets from invalid objects.
    return JSON.stringify(validated);
  } catch {
    throw new TypeError(INVALID_RESPONSE);
  }
}
