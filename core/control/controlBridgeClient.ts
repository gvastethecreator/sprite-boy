import {
  parseStudioControlRequest,
  type StudioControlRequest,
  type StudioControlResponse,
} from "./controlProtocol";
import type { StudioControlService } from "./controlService";

export type StudioControlBridgeClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "stopping"
  | "error";

export interface StudioControlBridgeClientSnapshot {
  readonly status: StudioControlBridgeClientStatus;
  readonly message: string;
  readonly clientId: string | null;
  readonly activeOperations: number;
}

export interface StudioControlBridgeClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly service: StudioControlService;
  readonly fetch?: typeof globalThis.fetch;
}

export interface StudioControlBridgeClient {
  getSnapshot(): StudioControlBridgeClientSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const INVALID_OPTIONS = "Studio control bridge client options are invalid.";
const CONNECTION_FAILED = "The local control bridge could not connect.";
const AUTHENTICATION_FAILED = "The local control bridge rejected the session token.";
const SESSION_FAILED = "The local control bridge session ended.";

interface ControlRequestMessage {
  readonly version: 1;
  readonly type: "control.request";
  readonly operationId: string;
  readonly request: StudioControlRequest;
}

interface ControlCancelMessage {
  readonly version: 1;
  readonly type: "control.cancel";
  readonly operationId: string;
}

type ControlBridgeMessage = ControlRequestMessage | ControlCancelMessage;

class BridgeClientError extends Error {
  readonly kind: "authentication" | "session" | "connection";

  constructor(kind: "authentication" | "session" | "connection") {
    super(kind);
    this.name = "BridgeClientError";
    this.kind = kind;
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") throw new TypeError(INVALID_OPTIONS);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(INVALID_OPTIONS);
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  return url.origin;
}

function parseRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeClientError("session");
  }
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) {
      throw new BridgeClientError("session");
    }
    const record: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
        throw new BridgeClientError("session");
      }
      record[key] = descriptor.value;
    }
    return Object.freeze(record);
  } catch (error) {
    if (error instanceof BridgeClientError) throw error;
    throw new BridgeClientError("session");
  }
}

function parseMessage(value: unknown): ControlBridgeMessage {
  const header = parseRecord(value, ["version", "type", "operationId", ...(isRequest(value) ? ["request"] : [])]);
  if (header.version !== 1 || typeof header.operationId !== "string" || header.operationId.length === 0) {
    throw new BridgeClientError("session");
  }
  if (header.type === "control.cancel" && !("request" in header)) {
    return Object.freeze({ version: 1, type: "control.cancel", operationId: header.operationId });
  }
  if (header.type === "control.request" && "request" in header) {
    return Object.freeze({
      version: 1,
      type: "control.request",
      operationId: header.operationId,
      request: parseStudioControlRequest(header.request),
    });
  }
  throw new BridgeClientError("session");
}

function isRequest(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "type");
    return Boolean(descriptor && "value" in descriptor && descriptor.value === "control.request");
  } catch {
    return false;
  }
}

function snapshot(
  status: StudioControlBridgeClientStatus,
  message: string,
  clientId: string | null,
  activeOperations: number,
): StudioControlBridgeClientSnapshot {
  return Object.freeze({ status, message, clientId, activeOperations });
}

export function createStudioControlBridgeClient(
  options: StudioControlBridgeClientOptions,
): StudioControlBridgeClient {
  if (options === null || typeof options !== "object") throw new TypeError(INVALID_OPTIONS);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (typeof options.token !== "string" || options.token.length < 32 || options.token.length > 512) {
    throw new TypeError(INVALID_OPTIONS);
  }
  if (
    options.service === null ||
    typeof options.service !== "object" ||
    typeof options.service.execute !== "function" ||
    typeof options.service.cancel !== "function"
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError(INVALID_OPTIONS);
  const token = options.token;
  const service = options.service;
  const listeners = new Set<() => void>();
  const operations = new Map<string, string>();
  let state = snapshot("idle", "Control bridge is disconnected.", null, 0);
  let controller: AbortController | undefined;
  let generation = 0;

  const publish = (
    status: StudioControlBridgeClientStatus,
    message: string,
    clientId = state.clientId,
  ): void => {
    state = snapshot(status, message, clientId, operations.size);
    const currentListeners: Array<() => void> = [];
    listeners.forEach((listener) => currentListeners.push(listener));
    for (const listener of currentListeners) {
      try {
        listener();
      } catch {
        // Subscribers cannot break transport state.
      }
    }
  };

  const request = async (
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> => {
    try {
      return await Reflect.apply(fetchImplementation, globalThis, [
        `${baseUrl}${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal,
        } satisfies RequestInit,
      ]);
    } catch {
      if (signal?.aborted) throw new BridgeClientError("session");
      throw new BridgeClientError("connection");
    }
  };

  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch {
      throw new BridgeClientError("session");
    }
  };

  const respond = async (
    clientId: string,
    operationId: string,
    response: StudioControlResponse,
    signal: AbortSignal,
  ): Promise<void> => {
    const result = await request(
      "/v1/browser/respond",
      { version: 1, clientId, operationId, response },
      signal,
    );
    if (result.status === 204 || result.status === 404) return;
    if (result.status === 401) throw new BridgeClientError("authentication");
    throw new BridgeClientError("session");
  };

  const execute = (
    message: ControlRequestMessage,
    clientId: string,
    activeGeneration: number,
    signal: AbortSignal,
  ): void => {
    if (operations.has(message.operationId)) throw new BridgeClientError("session");
    operations.set(message.operationId, message.request.idempotencyKey);
    publish("connected", "Control bridge is connected.", clientId);
    void service.execute(message.request).then(async (response) => {
      if (
        activeGeneration !== generation ||
        signal.aborted ||
        !operations.has(message.operationId)
      ) return;
      operations.delete(message.operationId);
      publish("connected", "Control bridge is connected.", clientId);
      await respond(clientId, message.operationId, response, signal);
    }).catch(() => {
      if (activeGeneration !== generation || signal.aborted) return;
      publish("error", SESSION_FAILED, null);
      controller?.abort();
    });
  };

  const pollLoop = async (
    clientId: string,
    activeGeneration: number,
    signal: AbortSignal,
  ): Promise<void> => {
    try {
      while (!signal.aborted && activeGeneration === generation) {
        const response = await request(
          "/v1/browser/poll",
          { version: 1, clientId },
          signal,
        );
        if (response.status === 204) continue;
        if (response.status === 401) throw new BridgeClientError("authentication");
        if (response.status !== 200) throw new BridgeClientError("session");
        const message = parseMessage(await readJson(response));
        if (message.type === "control.cancel") {
          const idempotencyKey = operations.get(message.operationId);
          if (idempotencyKey) service.cancel(idempotencyKey);
          operations.delete(message.operationId);
          publish("connected", "Control bridge is connected.", clientId);
          continue;
        }
        execute(message, clientId, activeGeneration, signal);
      }
    } catch (error) {
      if (signal.aborted || activeGeneration !== generation) return;
      const message = error instanceof BridgeClientError && error.kind === "authentication"
        ? AUTHENTICATION_FAILED
        : SESSION_FAILED;
      for (const idempotencyKey of operations.values()) service.cancel(idempotencyKey);
      operations.clear();
      publish("error", message, null);
      controller?.abort();
    }
  };

  const client: StudioControlBridgeClient = {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start(): Promise<void> {
      if (state.status === "connecting" || state.status === "connected") return;
      generation += 1;
      const activeGeneration = generation;
      controller?.abort();
      controller = new AbortController();
      publish("connecting", "Connecting to the local control bridge…", null);
      let response: Response;
      try {
        response = await request("/v1/browser/connect", { version: 1 }, controller.signal);
        if (response.status === 401) throw new BridgeClientError("authentication");
        if (response.status !== 200) throw new BridgeClientError("session");
        const body = parseRecord(await readJson(response), ["version", "clientId"]);
        if (body.version !== 1 || typeof body.clientId !== "string" || body.clientId.length === 0) {
          throw new BridgeClientError("session");
        }
        if (controller.signal.aborted || activeGeneration !== generation) return;
        publish("connected", "Control bridge is connected.", body.clientId);
        void pollLoop(body.clientId, activeGeneration, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || activeGeneration !== generation) return;
        const message = error instanceof BridgeClientError && error.kind === "authentication"
          ? AUTHENTICATION_FAILED
          : CONNECTION_FAILED;
        publish("error", message, null);
        controller.abort();
        throw new Error(message);
      }
    },
    async stop(): Promise<void> {
      if (state.status === "idle") return;
      const clientId = state.clientId;
      generation += 1;
      publish("stopping", "Disconnecting the local control bridge…", clientId);
      controller?.abort();
      for (const idempotencyKey of operations.values()) service.cancel(idempotencyKey);
      operations.clear();
      if (clientId) {
        const disconnectController = new AbortController();
        const timeout = globalThis.setTimeout(() => disconnectController.abort(), 1_000);
        try {
          await request(
            "/v1/browser/disconnect",
            { version: 1, clientId },
            disconnectController.signal,
          );
        } catch {
          // Local session shutdown is best-effort after the poll is aborted.
        } finally {
          globalThis.clearTimeout(timeout);
        }
      }
      publish("idle", "Control bridge is disconnected.", null);
    },
  };
  return Object.freeze(client);
}
