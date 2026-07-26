import { isLocalModelId, type LocalModelId } from "./modelCatalog";
import {
  LOCAL_MODEL_SERVICE_VERSION,
  type LocalModelServiceErrorCode,
  type LocalModelServiceSnapshot,
  type LocalModelSetupResponse,
} from "./modelServiceProtocol";
import type { JobSnapshot } from "../processing";

export interface LocalModelServiceClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface LocalModelServiceClient {
  list(signal?: AbortSignal): Promise<LocalModelServiceSnapshot>;
  setup(modelId: LocalModelId, signal?: AbortSignal): Promise<LocalModelSetupResponse>;
  getJob(jobId: string, signal?: AbortSignal): Promise<JobSnapshot>;
  cancelJob(jobId: string, signal?: AbortSignal): Promise<JobSnapshot>;
  getWeights(modelId: LocalModelId, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export class LocalModelServiceError extends Error {
  readonly code: LocalModelServiceErrorCode;

  constructor(code: LocalModelServiceErrorCode, message: string) {
    super(message);
    this.name = "LocalModelServiceError";
    this.code = code;
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Local model service URL is invalid.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) throw new TypeError("Local model service URL is invalid.");
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseError(value: unknown): { code: LocalModelServiceErrorCode; message: string } | null {
  if (!isRecord(value) || value.version !== LOCAL_MODEL_SERVICE_VERSION || !isRecord(value.error)) return null;
  const code = value.error.code;
  const message = value.error.message;
  return typeof code === "string" && typeof message === "string" && message.length > 0
    ? { code: code as LocalModelServiceErrorCode, message }
    : null;
}

function parseSnapshot(value: unknown): LocalModelServiceSnapshot {
  if (!isRecord(value) || value.version !== LOCAL_MODEL_SERVICE_VERSION || !Array.isArray(value.models)) {
    throw new LocalModelServiceError("invalid-response", "The local model service returned invalid data.");
  }
  for (const model of value.models) {
    if (!isRecord(model) || typeof model.id !== "string" || !isLocalModelId(model.id)) {
      throw new LocalModelServiceError("invalid-response", "The local model service returned invalid data.");
    }
  }
  return value as unknown as LocalModelServiceSnapshot;
}

function parseSetup(value: unknown): LocalModelSetupResponse {
  if (
    !isRecord(value) ||
    value.version !== LOCAL_MODEL_SERVICE_VERSION ||
    typeof value.modelId !== "string" ||
    !isLocalModelId(value.modelId) ||
    !["started", "already-running", "ready"].includes(String(value.outcome))
  ) throw new LocalModelServiceError("invalid-response", "The local model service returned invalid data.");
  return value as unknown as LocalModelSetupResponse;
}

function parseJob(value: unknown): JobSnapshot {
  if (!isRecord(value) || value.version !== LOCAL_MODEL_SERVICE_VERSION || !isRecord(value.job)) {
    throw new LocalModelServiceError("invalid-response", "The local model service returned invalid job data.");
  }
  return value.job as unknown as JobSnapshot;
}

export function createLocalModelServiceClient(
  options: LocalModelServiceClientOptions,
): LocalModelServiceClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (typeof options.token !== "string" || options.token.length < 32 || options.token.length > 512) {
    throw new TypeError("Local model service token is invalid.");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("Fetch is unavailable.");

  const request = async (
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> => {
    let response: Response;
    try {
      response = await Reflect.apply(fetchImpl, globalThis, [`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...init.headers,
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      } satisfies RequestInit]);
    } catch {
      throw new LocalModelServiceError("connection", "The local model service could not be reached.");
    }
    if (response.status === 401) {
      throw new LocalModelServiceError("authentication", "The local model service rejected the session token.");
    }
    if (!response.ok) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      const failure = parseError(parsed);
      throw new LocalModelServiceError(
        failure?.code ?? "invalid-response",
        failure?.message ?? "The local model service rejected the request.",
      );
    }
    return response;
  };

  const json = async (path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    const response = await request(path, init, signal);
    try {
      return await response.json();
    } catch {
      throw new LocalModelServiceError("invalid-response", "The local model service returned invalid data.");
    }
  };

  const client: LocalModelServiceClient = {
    async list(signal?: AbortSignal) {
      return parseSnapshot(await json("/v1/models", { method: "GET" }, signal));
    },
    async setup(modelId: LocalModelId, signal?: AbortSignal) {
      if (!isLocalModelId(modelId)) throw new TypeError("Unknown local model ID.");
      return parseSetup(await json("/v1/models/setup", {
        method: "POST",
        body: JSON.stringify({ version: LOCAL_MODEL_SERVICE_VERSION, modelId }),
      }, signal));
    },
    async getJob(jobId: string, signal?: AbortSignal) {
      if (typeof jobId !== "string" || jobId.length === 0) throw new TypeError("Job ID is invalid.");
      return parseJob(await json(`/v1/models/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, signal));
    },
    async cancelJob(jobId: string, signal?: AbortSignal) {
      if (typeof jobId !== "string" || jobId.length === 0) throw new TypeError("Job ID is invalid.");
      return parseJob(await json(`/v1/models/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, signal));
    },
    async getWeights(modelId: LocalModelId, signal?: AbortSignal) {
      if (!isLocalModelId(modelId)) throw new TypeError("Unknown local model ID.");
      const response = await request(`/v1/models/weights/${encodeURIComponent(modelId)}`, { method: "GET" }, signal);
      try {
        return await response.arrayBuffer();
      } catch {
        throw new LocalModelServiceError("invalid-response", "The local model weights could not be read.");
      }
    },
  };
  return Object.freeze(client);
}
