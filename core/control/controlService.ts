import {
  createStudioControlFailure,
  createStudioControlSuccess,
  parseStudioControlRequest,
  STUDIO_CONTROL_COMMANDS,
  STUDIO_CONTROL_MAX_REQUEST_BYTES,
  STUDIO_CONTROL_PROTOCOL_VERSION,
  type StudioControlCommand,
  type StudioControlErrorCode,
  type StudioControlRequest,
  type StudioControlResponse,
} from "./controlProtocol";

const OPTIONS_ERROR = "Studio control service options are invalid.";
const INTERNAL_MESSAGE = "The control operation failed.";
const CANCELLED_MESSAGE = "The control operation was cancelled.";
const REVISION_CONFLICT_MESSAGE = "The project revision changed.";
const DUPLICATE_REQUEST_MESSAGE = "The idempotency key is already in use.";
const NORMALIZATION_REQUEST_ID = "control-normalize";
const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 256;
const MAX_IDEMPOTENCY_ENTRIES = 4096;

type RequestFor<TCommand extends StudioControlCommand> = Extract<
  StudioControlRequest,
  { readonly command: TCommand }
>;
type ParamsFor<TCommand extends StudioControlCommand> = RequestFor<TCommand>["params"];
type MaybePromise<T> = T | Promise<T>;

export interface StudioControlPortContext {
  readonly signal: AbortSignal;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly expectedRevision: number | null;
}

export interface StudioControlPortSuccess {
  readonly ok: true;
  readonly revision: number;
  readonly result: unknown;
}

export interface StudioControlPortFailure {
  readonly ok: false;
  readonly revision: number;
  readonly error: {
    readonly code: StudioControlErrorCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type StudioControlPortResult =
  | StudioControlPortSuccess
  | StudioControlPortFailure;

export interface StudioControlPorts {
  getRevision(): number;
  getProject(context: StudioControlPortContext): MaybePromise<StudioControlPortResult>;
  getSelection(context: StudioControlPortContext): MaybePromise<StudioControlPortResult>;
  navigate(
    params: ParamsFor<"workspace.navigate">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
  importAsset(
    params: ParamsFor<"asset.import">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
  importVideo(
    params: ParamsFor<"video.import">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
  getModelStatus(
    params: ParamsFor<"model.status">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
  setupModel(
    params: ParamsFor<"model.setup">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
  listJobs(context: StudioControlPortContext): MaybePromise<StudioControlPortResult>;
  cancelJob(
    params: ParamsFor<"jobs.cancel">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
  runExport(
    params: ParamsFor<"export.run">,
    context: StudioControlPortContext,
  ): MaybePromise<StudioControlPortResult>;
}

export interface StudioControlServiceOptions {
  readonly ports: StudioControlPorts;
  readonly maxIdempotencyEntries?: number;
}

export interface StudioControlService {
  readonly disposed: boolean;
  execute(request: StudioControlRequest): Promise<StudioControlResponse>;
  dispose(): void;
}

type NormalizedOutcome =
  | Omit<StudioControlPortSuccess, "result"> & { readonly result: unknown }
  | StudioControlPortFailure;

interface ActiveEntry {
  readonly status: "active";
  readonly fingerprint: string;
  readonly controller: AbortController;
  readonly outcome: Promise<NormalizedOutcome>;
}

interface CompletedEntry {
  readonly status: "completed";
  readonly fingerprint: string;
  readonly outcome: NormalizedOutcome;
}

type IdempotencyEntry = ActiveEntry | CompletedEntry;

const PORT_METHODS = Object.freeze([
  "getRevision",
  "getProject",
  "getSelection",
  "navigate",
  "importAsset",
  "importVideo",
  "getModelStatus",
  "setupModel",
  "listJobs",
  "cancelJob",
  "runExport",
] as const);

type NormalizedPorts = Readonly<StudioControlPorts>;

function reflectOrThrow<T>(operation: () => T, message: string): T {
  try {
    return operation();
  } catch {
    throw new TypeError(message);
  }
}

function readExactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  message: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
  const prototype = reflectOrThrow(() => Object.getPrototypeOf(value), message);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(message);
  }
  const keys = reflectOrThrow(() => Reflect.ownKeys(value), message);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(message);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    keys.length < requiredKeys.length ||
    keys.length > requiredKeys.length + optionalKeys.length ||
    keys.some((key) => !allowed.has(key as string)) ||
    requiredKeys.some((key) => !keys.includes(key))
  ) {
    throw new TypeError(message);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = reflectOrThrow(
      () => Object.getOwnPropertyDescriptor(value, key),
      message,
    );
    if (
      !descriptor ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      throw new TypeError(message);
    }
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

function normalizePorts(value: unknown): NormalizedPorts {
  const record = readExactRecord(value, PORT_METHODS, [], OPTIONS_ERROR);
  for (const method of PORT_METHODS) {
    if (typeof record[method] !== "function") {
      throw new TypeError(OPTIONS_ERROR);
    }
  }
  const call = <T>(method: (typeof PORT_METHODS)[number], args: readonly unknown[]): T =>
    Reflect.apply(record[method] as (...values: unknown[]) => T, value, args);
  const normalized: StudioControlPorts = {
    getRevision: () => call<number>("getRevision", []),
    getProject: (context) => call("getProject", [context]),
    getSelection: (context) => call("getSelection", [context]),
    navigate: (params, context) => call("navigate", [params, context]),
    importAsset: (params, context) => call("importAsset", [params, context]),
    importVideo: (params, context) => call("importVideo", [params, context]),
    getModelStatus: (params, context) => call("getModelStatus", [params, context]),
    setupModel: (params, context) => call("setupModel", [params, context]),
    listJobs: (context) => call("listJobs", [context]),
    cancelJob: (params, context) => call("cancelJob", [params, context]),
    runExport: (params, context) => call("runExport", [params, context]),
  };
  return Object.freeze(normalized);
}

function normalizeOptions(options: unknown): {
  readonly ports: NormalizedPorts;
  readonly maxIdempotencyEntries: number;
} {
  const record = readExactRecord(
    options,
    ["ports"],
    ["maxIdempotencyEntries"],
    OPTIONS_ERROR,
  );
  const max = record.maxIdempotencyEntries ?? DEFAULT_MAX_IDEMPOTENCY_ENTRIES;
  if (!Number.isSafeInteger(max) || (max as number) < 1 || (max as number) > MAX_IDEMPOTENCY_ENTRIES) {
    throw new TypeError(OPTIONS_ERROR);
  }
  return Object.freeze({
    ports: normalizePorts(record.ports),
    maxIdempotencyEntries: max as number,
  });
}

function frozenFailure(
  revision: number,
  code: StudioControlErrorCode,
  message: string,
): StudioControlPortFailure {
  return Object.freeze({
    ok: false,
    revision,
    error: Object.freeze({ code, message, retryable: false }),
  });
}

function internalOutcome(revision = 0): StudioControlPortFailure {
  return frozenFailure(revision, "internal", INTERNAL_MESSAGE);
}

function cancelledOutcome(revision = 0): StudioControlPortFailure {
  return frozenFailure(revision, "cancelled", CANCELLED_MESSAGE);
}

function normalizePortResult(value: unknown): NormalizedOutcome | undefined {
  try {
    const outer = readExactRecord(value, ["ok", "revision"], ["result", "error"], INTERNAL_MESSAGE);
    if (outer.ok === true) {
      if (!("result" in outer) || "error" in outer) return undefined;
      const response = createStudioControlSuccess({
        version: STUDIO_CONTROL_PROTOCOL_VERSION,
        requestId: NORMALIZATION_REQUEST_ID,
        ok: true,
        revision: outer.revision,
        result: outer.result,
      });
      return Object.freeze({ ok: true, revision: response.revision, result: response.result });
    }
    if (outer.ok === false) {
      if (!("error" in outer) || "result" in outer) return undefined;
      const error = readExactRecord(
        outer.error,
        ["code", "message", "retryable"],
        [],
        INTERNAL_MESSAGE,
      );
      const response = createStudioControlFailure({
        version: STUDIO_CONTROL_PROTOCOL_VERSION,
        requestId: NORMALIZATION_REQUEST_ID,
        ok: false,
        revision: outer.revision,
        error,
      });
      return Object.freeze({
        ok: false,
        revision: response.revision,
        error: response.error,
      });
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function outcomeToResponse(
  outcome: NormalizedOutcome,
  requestId: string,
): StudioControlResponse {
  try {
    return outcome.ok
      ? createStudioControlSuccess({
          version: STUDIO_CONTROL_PROTOCOL_VERSION,
          requestId,
          ok: true,
          revision: outcome.revision,
          result: outcome.result,
        })
      : createStudioControlFailure({
          version: STUDIO_CONTROL_PROTOCOL_VERSION,
          requestId,
          ok: false,
          revision: outcome.revision,
          error: outcome.error,
        });
  } catch {
    return createStudioControlFailure({
      version: STUDIO_CONTROL_PROTOCOL_VERSION,
      requestId,
      ok: false,
      revision: 0,
      error: {
        code: "internal",
        message: INTERNAL_MESSAGE,
        retryable: false,
      },
    });
  }
}

function requestFingerprint(request: StudioControlRequest): string {
  return JSON.stringify([
    request.version,
    request.command,
    request.expectedRevision,
    request.params,
  ]);
}

function portContext(request: StudioControlRequest, signal: AbortSignal): StudioControlPortContext {
  return Object.freeze({
    signal,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    expectedRevision: request.expectedRevision,
  });
}

function dispatchPort(
  ports: NormalizedPorts,
  request: Exclude<RequestFor<StudioControlCommand>, RequestFor<"capabilities.get">>,
  context: StudioControlPortContext,
): MaybePromise<StudioControlPortResult> {
  switch (request.command) {
    case "project.get": return ports.getProject(context);
    case "selection.get": return ports.getSelection(context);
    case "workspace.navigate": return ports.navigate(request.params, context);
    case "asset.import": return ports.importAsset(request.params, context);
    case "video.import": return ports.importVideo(request.params, context);
    case "model.status": return ports.getModelStatus(request.params, context);
    case "model.setup": return ports.setupModel(request.params, context);
    case "jobs.list": return ports.listJobs(context);
    case "jobs.cancel": return ports.cancelJob(request.params, context);
    case "export.run": return ports.runExport(request.params, context);
    default: return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported control request: ${String(value)}`);
}

type PortSettlement =
  | { readonly kind: "resolved"; readonly value: unknown }
  | { readonly kind: "rejected" }
  | { readonly kind: "aborted" };

function settlePort(
  operation: Promise<StudioControlPortResult>,
  signal: AbortSignal,
): Promise<PortSettlement> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PortSettlement): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      finish({ kind: "aborted" });
      return;
    }
    operation.then(
      (value) => finish({ kind: "resolved", value }),
      () => finish({ kind: "rejected" }),
    );
  });
}

export function createStudioControlService(options: StudioControlServiceOptions): StudioControlService {
  const { ports, maxIdempotencyEntries } = normalizeOptions(options);
  const entries = new Map<string, IdempotencyEntry>();
  const completedOrder: string[] = [];
  let disposed = false;

  const currentRevision = (): number | undefined => {
    try {
      const revision = ports.getRevision();
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
    } catch {
      return undefined;
    }
  };

  const complete = (key: string, fingerprint: string, outcome: NormalizedOutcome): void => {
    if (disposed) return;
    entries.set(key, Object.freeze({ status: "completed", fingerprint, outcome }));
    completedOrder.push(key);
    while (completedOrder.length > maxIdempotencyEntries) {
      const oldest = completedOrder.shift();
      if (oldest === undefined) break;
      if (entries.get(oldest)?.status === "completed") entries.delete(oldest);
    }
  };

  const run = async (
    request: StudioControlRequest,
    controller: AbortController,
  ): Promise<NormalizedOutcome> => {
    const revision = currentRevision();
    if (revision === undefined) return internalOutcome();
    if (disposed || controller.signal.aborted) return cancelledOutcome(revision);
    if (request.expectedRevision !== null && request.expectedRevision !== revision) {
      return frozenFailure(revision, "revision-conflict", REVISION_CONFLICT_MESSAGE);
    }
    if (request.command === "capabilities.get") {
      const normalized = normalizePortResult({
        ok: true,
        revision,
        result: {
          protocolVersion: STUDIO_CONTROL_PROTOCOL_VERSION,
          maxRequestBytes: STUDIO_CONTROL_MAX_REQUEST_BYTES,
          commands: STUDIO_CONTROL_COMMANDS,
          transport: "session",
        },
      });
      return normalized ?? internalOutcome(revision);
    }
    const context = portContext(request, controller.signal);
    let operation: Promise<StudioControlPortResult>;
    try {
      operation = Promise.resolve(dispatchPort(ports, request, context));
    } catch {
      return disposed || controller.signal.aborted
        ? cancelledOutcome(revision)
        : internalOutcome(revision);
    }
    const settlement = await settlePort(operation, controller.signal);
    if (disposed || settlement.kind === "aborted") return cancelledOutcome(revision);
    if (settlement.kind === "rejected") return internalOutcome(revision);
    return normalizePortResult(settlement.value) ?? internalOutcome(revision);
  };

  const service: StudioControlService = {
    get disposed(): boolean {
      return disposed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        if (entry.status === "active") entry.controller.abort();
      }
      entries.clear();
      completedOrder.length = 0;
    },
    async execute(input: StudioControlRequest): Promise<StudioControlResponse> {
      const request = parseStudioControlRequest(input);
      if (disposed) return outcomeToResponse(cancelledOutcome(), request.requestId);
      const key = request.idempotencyKey;
      const fingerprint = requestFingerprint(request);
      const existing = entries.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return outcomeToResponse(
            frozenFailure(
              currentRevision() ?? 0,
              "duplicate-request",
              DUPLICATE_REQUEST_MESSAGE,
            ),
            request.requestId,
          );
        }
        const outcome = existing.status === "completed"
          ? existing.outcome
          : await existing.outcome;
        return outcomeToResponse(outcome, request.requestId);
      }

      const controller = new AbortController();
      let resolveOutcome!: (outcome: NormalizedOutcome) => void;
      const sharedOutcome = new Promise<NormalizedOutcome>((resolve) => {
        resolveOutcome = resolve;
      });
      entries.set(key, Object.freeze({
        status: "active",
        fingerprint,
        controller,
        outcome: sharedOutcome,
      }));
      void run(request, controller).then(
        (outcome) => {
          const finalOutcome = disposed || controller.signal.aborted
            ? cancelledOutcome(outcome.revision)
            : outcome;
          complete(key, fingerprint, finalOutcome);
          resolveOutcome(finalOutcome);
        },
        () => {
          const outcome = disposed || controller.signal.aborted
            ? cancelledOutcome()
            : internalOutcome();
          complete(key, fingerprint, outcome);
          resolveOutcome(outcome);
        },
      );
      return outcomeToResponse(await sharedOutcome, request.requestId);
    },
  };
  return Object.freeze(service);
}
