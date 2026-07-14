import type { AssetIntegrity, AssetIntegrityStatus, AssetOperationOptions } from "../assets";
import type { AssetRecord, EntityId, StudioProjectV1 } from "../project";
import {
  isProjectCodecError,
  projectCodec,
} from "./projectCodec";

export const PROJECT_RECOVERY_REPORT_FORMAT = "spriteboy-project-recovery" as const;
export const PROJECT_RECOVERY_REPORT_VERSION = 1 as const;

export type ProjectRecoverySource =
  | "autosave-checkpoint"
  | "autosave-journal"
  | "portable-package"
  | "legacy-import"
  | "project-file"
  | "unknown";

export type ProjectRecoveryDisposition = "ready" | "recoverable" | "blocked";

export type ProjectRecoveryIssueCode =
  | "PROJECT_FUTURE_VERSION"
  | "PROJECT_JSON_INVALID"
  | "PROJECT_DOCUMENT_INVALID"
  | "ASSET_VERIFIER_UNAVAILABLE"
  | "ASSET_CHECK_FAILED"
  | "ASSET_METADATA_MISSING"
  | "ASSET_BLOB_MISSING"
  | "ASSET_SIZE_MISMATCH"
  | "ASSET_HASH_MISMATCH"
  | "ASSET_MIME_MISMATCH";

export type ProjectRecoveryActionType =
  | "upgrade-studio"
  | "export-backup"
  | "restore-checkpoint"
  | "import-backup"
  | "retry-asset-scan"
  | "relink-asset"
  | "remove-corrupt-asset";

export interface ProjectRecoveryIssue {
  code: ProjectRecoveryIssueCode;
  severity: "error" | "blocker";
  message: string;
  path?: string;
  assetId?: EntityId;
  assetStatus?: AssetIntegrityStatus;
}

export interface ProjectRecoveryAction {
  type: ProjectRecoveryActionType;
  assetId?: EntityId;
}

export interface ProjectRecoveryReport {
  format: typeof PROJECT_RECOVERY_REPORT_FORMAT;
  formatVersion: typeof PROJECT_RECOVERY_REPORT_VERSION;
  source: ProjectRecoverySource;
  disposition: ProjectRecoveryDisposition;
  canActivate: boolean;
  schemaVersion?: number;
  projectId?: EntityId;
  issues: readonly ProjectRecoveryIssue[];
  actions: readonly ProjectRecoveryAction[];
}

/**
 * A decoded project stays quarantined even when ready. The recovery boundary
 * deliberately exposes no active-project setter or persistence callback.
 */
export interface ProjectRecoveryAssessment {
  report: ProjectRecoveryReport;
  quarantinedProject?: StudioProjectV1;
}

export interface ProjectRecoveryAssetVerifier {
  verify(assetId: EntityId, options?: AssetOperationOptions): PromiseLike<AssetIntegrity>;
}

export interface AssessProjectRecoveryOptions extends AssetOperationOptions {
  source?: ProjectRecoverySource;
  assetVerifier?: ProjectRecoveryAssetVerifier;
}

export type ProjectRecoveryOperation = "assess";

export type ProjectRecoveryErrorCode =
  | "PROJECT_RECOVERY_INVALID_INPUT"
  | "PROJECT_RECOVERY_ABORTED";

export interface ProjectRecoveryDiagnostic {
  code: ProjectRecoveryErrorCode;
  operation: ProjectRecoveryOperation;
  message: string;
}

export class ProjectRecoveryError extends Error {
  readonly code: ProjectRecoveryErrorCode;
  readonly operation = "assess" as const;
  override readonly cause?: unknown;

  constructor(code: ProjectRecoveryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ProjectRecoveryError";
    this.code = code;
    this.cause = cause;
  }

  toDiagnostic(): ProjectRecoveryDiagnostic {
    return { code: this.code, operation: this.operation, message: this.message };
  }
}

export function isProjectRecoveryError(value: unknown): value is ProjectRecoveryError {
  try {
    return value instanceof ProjectRecoveryError;
  } catch {
    return false;
  }
}

interface NormalizedVerifier {
  receiver: object;
  verify: ProjectRecoveryAssetVerifier["verify"];
}

interface NormalizedOptions {
  source: ProjectRecoverySource;
  verifier?: NormalizedVerifier;
  signal?: AbortSignal;
  release(): void;
}

interface DataPromiseLike<T> {
  receiver: object;
  then: (onFulfilled: (value: T) => unknown, onRejected: (error: unknown) => unknown) => unknown;
}

interface DataPromiseBox<T> {
  value: T;
}

const SOURCES: readonly ProjectRecoverySource[] = Object.freeze([
  "autosave-checkpoint",
  "autosave-journal",
  "portable-package",
  "legacy-import",
  "project-file",
  "unknown",
]);

const ASSET_STATUS_KEYS: Readonly<Record<AssetIntegrityStatus, readonly string[]>> = {
  ok: [
    "assetId",
    "status",
    "expectedHash",
    "actualHash",
    "expectedByteSize",
    "actualByteSize",
    "expectedMimeType",
    "actualMimeType",
  ],
  "metadata-missing": ["assetId", "status"],
  "blob-missing": ["assetId", "status", "expectedHash", "expectedByteSize", "expectedMimeType"],
  "size-mismatch": [
    "assetId",
    "status",
    "expectedHash",
    "actualHash",
    "expectedByteSize",
    "actualByteSize",
    "expectedMimeType",
    "actualMimeType",
  ],
  "hash-mismatch": [
    "assetId",
    "status",
    "expectedHash",
    "actualHash",
    "expectedByteSize",
    "actualByteSize",
    "expectedMimeType",
    "actualMimeType",
  ],
  "mime-mismatch": [
    "assetId",
    "status",
    "expectedHash",
    "actualHash",
    "expectedByteSize",
    "actualByteSize",
    "expectedMimeType",
    "actualMimeType",
  ],
};

function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must be a plain data object.`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
      throw new TypeError(`${label} contains unsupported fields.`);
    }
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${label}.${key} must be an enumerable data property.`);
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: descriptor.value,
      });
    }
    return result;
  } catch (cause) {
    throw new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      `${label} is invalid.`,
      cause,
    );
  }
}

function nativeSignalValue(signal: AbortSignal, key: "aborted" | "reason"): unknown {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, key)?.get;
  if (!getter) throw new TypeError(`AbortSignal.${key} is unavailable.`);
  return Reflect.apply(getter, signal, []);
}

function callNativeSignalListener(
  signal: AbortSignal,
  method: "addEventListener" | "removeEventListener",
  listener: EventListener,
): void {
  let current: object | null = Object.getPrototypeOf(signal) as object | null;
  const seen = new Set<object>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, method);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
      Reflect.apply(descriptor.value, signal, ["abort", listener]);
      return;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new TypeError(`AbortSignal.${method} is unavailable.`);
}

function normalizeSignal(value: unknown): Pick<NormalizedOptions, "signal" | "release"> {
  if (value === undefined) return { release() {} };
  try {
    const source = value as AbortSignal;
    const controller = new AbortController();
    if (nativeSignalValue(source, "aborted") === true) {
      controller.abort(nativeSignalValue(source, "reason"));
      return { signal: controller.signal, release() {} };
    }
    const onAbort: EventListener = () => controller.abort(nativeSignalValue(source, "reason"));
    callNativeSignalListener(source, "addEventListener", onAbort);
    if (nativeSignalValue(source, "aborted") === true) onAbort(new Event("abort"));
    return {
      signal: controller.signal,
      release() {
        try {
          callNativeSignalListener(source, "removeEventListener", onAbort);
        } catch {
          // A native signal may only fail cleanup during host teardown.
        }
      },
    };
  } catch (cause) {
    throw new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      "Project recovery signal must be a native AbortSignal.",
      cause,
    );
  }
}

function readMethod<T extends (...args: never[]) => unknown>(value: object, key: string): T {
  let current: object | null = value;
  const seen = new Set<object>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(`${key} must be a data method.`);
      }
      return descriptor.value as T;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new TypeError(`${key} is missing.`);
}

function normalizeVerifier(value: unknown): NormalizedVerifier {
  try {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      throw new TypeError("Asset verifier must be an object.");
    }
    const receiver = value as object;
    return { receiver, verify: readMethod(receiver, "verify") };
  } catch (cause) {
    throw new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      "Project recovery asset verifier is invalid.",
      cause,
    );
  }
}

function normalizeOptions(value: unknown): NormalizedOptions {
  if (value === undefined) return { source: "unknown", release() {} };
  const record = readDataRecord(value, ["source", "assetVerifier", "signal"], "Project recovery options");
  const source = record.source ?? "unknown";
  if (typeof source !== "string" || !SOURCES.includes(source as ProjectRecoverySource)) {
    throw new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      "Project recovery source is invalid.",
    );
  }
  const signal = normalizeSignal(record.signal);
  try {
    return {
      source: source as ProjectRecoverySource,
      ...(record.assetVerifier !== undefined
        ? { verifier: normalizeVerifier(record.assetVerifier) }
        : {}),
      ...signal,
    };
  } catch (cause) {
    signal.release();
    throw cause;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal || nativeSignalValue(signal, "aborted") !== true) return;
  throw new ProjectRecoveryError(
    "PROJECT_RECOVERY_ABORTED",
    "Project recovery assessment was aborted.",
    nativeSignalValue(signal, "reason"),
  );
}

function dataPromiseLike<T>(value: unknown): DataPromiseLike<T> | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  const receiver = value as object;
  try {
    // oxlint-disable-next-line unicorn/no-thenable -- explicit hostile-safe PromiseLike adoption
    return { receiver, then: readMethod(receiver, "then") };
  } catch {
    return undefined;
  }
}

function adoptDataPromise<T>(value: unknown): Promise<DataPromiseBox<T>> {
  const promiseLike = dataPromiseLike<T>(value);
  if (!promiseLike) {
    return Promise.reject(new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      "Asset verifier must return a Promise-like value with a data method then.",
    ));
  }
  return new Promise<DataPromiseBox<T>>((resolve, reject) => {
    try {
      Reflect.apply(promiseLike.then, promiseLike.receiver, [
        (result: T) => resolve({ value: result }),
        reject,
      ]);
    } catch (cause) {
      reject(cause);
    }
  });
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => callNativeSignalListener(signal, "removeEventListener", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(new ProjectRecoveryError(
      "PROJECT_RECOVERY_ABORTED",
      "Project recovery assessment was aborted.",
      nativeSignalValue(signal, "reason"),
    )));
    callNativeSignalListener(signal, "addEventListener", onAbort);
    work.then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (nativeSignalValue(signal, "aborted") === true) onAbort();
  });
}

function deepFreezeData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreezeData(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function issue(
  code: ProjectRecoveryIssueCode,
  severity: ProjectRecoveryIssue["severity"],
  message: string,
  extras: Pick<ProjectRecoveryIssue, "path" | "assetId" | "assetStatus"> = {},
): ProjectRecoveryIssue {
  return Object.freeze({ code, severity, message, ...extras });
}

function action(type: ProjectRecoveryActionType, assetId?: EntityId): ProjectRecoveryAction {
  return Object.freeze({ type, ...(assetId ? { assetId } : {}) });
}

function uniqueActions(actions: readonly ProjectRecoveryAction[]): readonly ProjectRecoveryAction[] {
  const byKey = new Map<string, ProjectRecoveryAction>();
  for (const candidate of actions) {
    byKey.set(`${candidate.type}\u0000${candidate.assetId ?? ""}`, candidate);
  }
  return Object.freeze([...byKey.values()].sort((left, right) => (
    compareCodeUnit(left.type, right.type)
      || compareCodeUnit(left.assetId ?? "", right.assetId ?? "")
  )));
}

function report(
  source: ProjectRecoverySource,
  disposition: ProjectRecoveryDisposition,
  issues: readonly ProjectRecoveryIssue[],
  actions: readonly ProjectRecoveryAction[],
  identity: { schemaVersion?: number; projectId?: EntityId } = {},
): ProjectRecoveryReport {
  return Object.freeze({
    format: PROJECT_RECOVERY_REPORT_FORMAT,
    formatVersion: PROJECT_RECOVERY_REPORT_VERSION,
    source,
    disposition,
    canActivate: disposition === "ready",
    ...identity,
    issues: Object.freeze([...issues]),
    actions: uniqueActions(actions),
  });
}

function documentFailure(
  error: unknown,
  source: ProjectRecoverySource,
): ProjectRecoveryAssessment {
  if (!isProjectCodecError(error)) {
    return Object.freeze({
      report: report(source, "blocked", [issue(
        "PROJECT_DOCUMENT_INVALID",
        "blocker",
        "Project document could not be decoded safely.",
      )], [action("restore-checkpoint"), action("import-backup")]),
    });
  }
  if (error.code === "PROJECT_CODEC_UNSUPPORTED_VERSION") {
    return Object.freeze({
      report: report(source, "blocked", [issue(
        "PROJECT_FUTURE_VERSION",
        "blocker",
        `Project schema version ${error.schemaVersion ?? "unknown"} is newer than this Studio build.`,
      )], [action("upgrade-studio"), action("export-backup")], {
        schemaVersion: error.schemaVersion,
      }),
    });
  }
  if (error.code === "PROJECT_CODEC_INVALID_JSON") {
    return Object.freeze({
      report: report(source, "blocked", [issue(
        "PROJECT_JSON_INVALID",
        "blocker",
        "Project file is not valid JSON.",
      )], [action("restore-checkpoint"), action("import-backup")]),
    });
  }
  const diagnostics = error.projectDiagnostics.length > 0
    ? error.projectDiagnostics.map((diagnostic) => issue(
        "PROJECT_DOCUMENT_INVALID",
        "blocker",
        diagnostic.message,
        { path: diagnostic.path },
      ))
    : [issue(
        "PROJECT_DOCUMENT_INVALID",
        "blocker",
        "Project document does not satisfy the supported Studio schema.",
      )];
  return Object.freeze({
    report: report(source, "blocked", diagnostics, [
      action("restore-checkpoint"),
      action("import-backup"),
    ], {
      schemaVersion: error.schemaVersion,
    }),
  });
}

function requireString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string.`);
  return value;
}

function requireNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${key} must be a non-negative safe integer.`);
  }
  return value as number;
}

function normalizeIntegrity(value: unknown, expectedAsset: AssetRecord): AssetIntegrity {
  const assetId = expectedAsset.id;
  let status: unknown;
  try {
    if (value !== null && typeof value === "object") {
      const descriptor = Object.getOwnPropertyDescriptor(value, "status");
      status = descriptor && "value" in descriptor ? descriptor.value : undefined;
    }
    if (typeof status !== "string" || !(status in ASSET_STATUS_KEYS)) {
      throw new TypeError("Asset integrity status is invalid.");
    }
    const record = readDataRecord(value, ASSET_STATUS_KEYS[status as AssetIntegrityStatus], "Asset integrity result");
    if (requireString(record, "assetId") !== assetId || record.status !== status) {
      throw new TypeError("Asset integrity identity is invalid.");
    }
    if (status === "metadata-missing") return Object.freeze({ assetId, status });
    requireString(record, "expectedHash");
    requireNumber(record, "expectedByteSize");
    requireString(record, "expectedMimeType");
    if (status === "blob-missing") {
      return Object.freeze({
        assetId,
        status,
        expectedHash: expectedAsset.contentHash,
        expectedByteSize: expectedAsset.byteSize,
        expectedMimeType: expectedAsset.mimeType,
      });
    }
    const observed = Object.freeze({
      assetId,
      expectedHash: expectedAsset.contentHash,
      actualHash: requireString(record, "actualHash"),
      expectedByteSize: expectedAsset.byteSize,
      actualByteSize: requireNumber(record, "actualByteSize"),
      expectedMimeType: expectedAsset.mimeType,
      actualMimeType: requireString(record, "actualMimeType"),
    });
    if (observed.actualByteSize !== expectedAsset.byteSize) {
      return Object.freeze({
        ...observed,
        status: "size-mismatch" as const,
      });
    }
    if (observed.actualHash !== expectedAsset.contentHash) {
      return Object.freeze({
        ...observed,
        status: "hash-mismatch" as const,
      });
    }
    if (observed.actualMimeType !== expectedAsset.mimeType) {
      return Object.freeze({
        ...observed,
        status: "mime-mismatch" as const,
      });
    }
    return Object.freeze({
      ...observed,
      status: "ok" as const,
    });
  } catch (cause) {
    if (isProjectRecoveryError(cause)) throw cause;
    throw new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      `Asset verifier returned an invalid result for ${assetId}.`,
      cause,
    );
  }
}

function integrityIssue(integrity: AssetIntegrity): {
  issue: ProjectRecoveryIssue;
  actions: readonly ProjectRecoveryAction[];
} | undefined {
  if (integrity.status === "ok") return undefined;
  const mapping: Readonly<Record<Exclude<AssetIntegrityStatus, "ok">, {
    code: ProjectRecoveryIssueCode;
    message: string;
    corrupt: boolean;
  }>> = {
    "metadata-missing": {
      code: "ASSET_METADATA_MISSING",
      message: "Asset metadata is missing from durable storage.",
      corrupt: false,
    },
    "blob-missing": {
      code: "ASSET_BLOB_MISSING",
      message: "Asset binary is missing from durable storage.",
      corrupt: false,
    },
    "size-mismatch": {
      code: "ASSET_SIZE_MISMATCH",
      message: "Asset binary size does not match project metadata.",
      corrupt: true,
    },
    "hash-mismatch": {
      code: "ASSET_HASH_MISMATCH",
      message: "Asset binary hash does not match project metadata.",
      corrupt: true,
    },
    "mime-mismatch": {
      code: "ASSET_MIME_MISMATCH",
      message: "Asset binary MIME type does not match project metadata.",
      corrupt: true,
    },
  };
  const current = mapping[integrity.status];
  return {
    issue: issue(current.code, "error", current.message, {
      assetId: integrity.assetId,
      assetStatus: integrity.status,
    }),
    actions: Object.freeze([
      action("relink-asset", integrity.assetId),
      ...(current.corrupt ? [action("remove-corrupt-asset", integrity.assetId)] : []),
    ]),
  };
}

/** Analyze a candidate without mutating storage or the active project. */
export async function assessProjectRecovery(
  serialized: string,
  options?: AssessProjectRecoveryOptions,
): Promise<ProjectRecoveryAssessment> {
  if (typeof serialized !== "string") {
    throw new ProjectRecoveryError(
      "PROJECT_RECOVERY_INVALID_INPUT",
      "Project recovery input must be a JSON string.",
    );
  }
  const normalized = normalizeOptions(options);
  try {
    throwIfAborted(normalized.signal);
    let project: StudioProjectV1;
    try {
      project = projectCodec.decode(serialized);
    } catch (error) {
      return documentFailure(error, normalized.source);
    }
    const quarantinedProject = deepFreezeData(project);
    const assetIds = Object.keys(project.assets).sort(compareCodeUnit);
    if (assetIds.length > 0 && !normalized.verifier) {
      return Object.freeze({
        report: report(normalized.source, "blocked", [issue(
          "ASSET_VERIFIER_UNAVAILABLE",
          "blocker",
          "Project assets cannot be verified in this environment.",
        )], [action("retry-asset-scan")], {
          schemaVersion: project.schemaVersion,
          projectId: project.id,
        }),
        quarantinedProject,
      });
    }

    const issues: ProjectRecoveryIssue[] = [];
    const actions: ProjectRecoveryAction[] = [];
    for (const assetId of assetIds) {
      throwIfAborted(normalized.signal);
      try {
        const raw = Reflect.apply(normalized.verifier!.verify, normalized.verifier!.receiver, [
          assetId,
          normalized.signal ? { signal: normalized.signal } : undefined,
        ]) as unknown;
        const boxedIntegrity = await raceAbort(
          adoptDataPromise<AssetIntegrity>(raw),
          normalized.signal,
        );
        const integrity = normalizeIntegrity(boxedIntegrity.value, project.assets[assetId]);
        const finding = integrityIssue(integrity);
        if (finding) {
          issues.push(finding.issue);
          actions.push(...finding.actions);
        }
      } catch (error) {
        if (isProjectRecoveryError(error) && error.code === "PROJECT_RECOVERY_ABORTED") throw error;
        issues.push(issue(
          "ASSET_CHECK_FAILED",
          "blocker",
          "Asset integrity check failed without changing the active project.",
          { assetId },
        ));
        actions.push(action("retry-asset-scan", assetId));
      }
    }
    const hasBlockingIssue = issues.some(({ severity }) => severity === "blocker");
    const disposition: ProjectRecoveryDisposition = issues.length === 0
      ? "ready"
      : hasBlockingIssue
        ? "blocked"
        : "recoverable";
    return Object.freeze({
      report: report(normalized.source, disposition, issues, actions, {
        schemaVersion: project.schemaVersion,
        projectId: project.id,
      }),
      quarantinedProject,
    });
  } finally {
    normalized.release();
  }
}
