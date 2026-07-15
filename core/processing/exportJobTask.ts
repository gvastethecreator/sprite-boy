import {
  isExportPortError,
  type ExportPort,
  type ExportPortErrorCode,
  type ExportRequest,
  type ExportResult,
} from "../export/contracts";
import { isEntityId } from "../project";
import { JobTaskError, type JobTask, type JobTaskContext } from "./jobRunner";

export type ExportJobRequest<TSource = unknown> = Omit<
  ExportRequest<TSource>,
  "requestId" | "signal"
>;

export interface CreateExportJobTaskOptions<TSource = unknown> {
  readonly port: ExportPort;
  readonly request: ExportJobRequest<TSource>;
}

interface ExportJobDiagnostic {
  readonly code: ConstructorParameters<typeof JobTaskError>[0];
  readonly message: string;
  readonly retryable: boolean;
}

const EXPORT_JOB_DIAGNOSTICS = Object.freeze({
  EXPORT_FORMAT_INVALID: Object.freeze({
    code: "export-failure",
    message: "Export format configuration is invalid.",
    retryable: false,
  }),
  EXPORT_FORMAT_CONFLICT: Object.freeze({
    code: "export-failure",
    message: "Export format configuration is conflicting.",
    retryable: false,
  }),
  EXPORT_INVALID_REQUEST: Object.freeze({
    code: "invalid-input",
    message: "Export request is invalid.",
    retryable: false,
  }),
  EXPORT_UNSUPPORTED_FORMAT: Object.freeze({
    code: "unsupported",
    message: "This export format is not supported.",
    retryable: false,
  }),
  EXPORT_PROVIDER_FAILED: Object.freeze({
    code: "provider-failure",
    message: "The export provider failed.",
    retryable: true,
  }),
  EXPORT_ARTIFACT_INVALID: Object.freeze({
    code: "export-failure",
    message: "The export provider returned an invalid artifact.",
    retryable: false,
  }),
  EXPORT_ARTIFACT_TOO_LARGE: Object.freeze({
    code: "export-failure",
    message: "The export artifact exceeds the allowed size.",
    retryable: false,
  }),
  EXPORT_QUOTA_EXCEEDED: Object.freeze({
    code: "quota-exceeded",
    message: "Storage quota was exceeded. Free space, then retry.",
    retryable: true,
  }),
  EXPORT_WRITER_FAILED: Object.freeze({
    code: "storage-failure",
    message: "The export destination could not save the artifact.",
    retryable: true,
  }),
  EXPORT_RECEIPT_INVALID: Object.freeze({
    code: "export-failure",
    message: "The export destination returned an invalid receipt.",
    retryable: false,
  }),
  EXPORT_ABORTED: Object.freeze({
    code: "export-failure",
    message: "Export stopped before completion.",
    retryable: true,
  }),
} as const satisfies Record<ExportPortErrorCode, ExportJobDiagnostic>);

const UNKNOWN_EXPORT_DIAGNOSTIC: ExportJobDiagnostic = Object.freeze({
  code: "export-failure",
  message: "Export failed.",
  retryable: true,
});

const REQUEST_KEYS = Object.freeze([
  "artifactId",
  "projectId",
  "revision",
  "formatId",
  "baseName",
  "source",
] as const);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function ownEnumerableDataValue(record: object, key: PropertyKey, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new TypeError(`${label} could not be read.`);
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function requireExactKeys(record: object, expected: readonly string[], label: string): void {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(record);
  } catch {
    throw new TypeError(`${label} fields could not be read.`);
  }
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    throw new TypeError(`${label} fields are invalid.`);
  }
}

function capturePort(value: unknown): ExportPort["run"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Export job port must be an object.");
  }
  const run = ownEnumerableDataValue(value, "run", "Export job port.run");
  if (typeof run !== "function") {
    throw new TypeError("Export job port.run must be a function.");
  }
  return ((request) => Reflect.apply(run, value, [request])) as ExportPort["run"];
}

function captureRequest<TSource>(value: unknown): ExportJobRequest<TSource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Export job request must be an object.");
  }
  requireExactKeys(value, REQUEST_KEYS, "Export job request");
  return Object.freeze({
    artifactId: ownEnumerableDataValue(value, "artifactId", "Export artifact ID"),
    projectId: ownEnumerableDataValue(value, "projectId", "Export project ID"),
    revision: ownEnumerableDataValue(value, "revision", "Export revision"),
    formatId: ownEnumerableDataValue(value, "formatId", "Export format ID"),
    baseName: ownEnumerableDataValue(value, "baseName", "Export base name"),
    source: ownEnumerableDataValue(value, "source", "Export source"),
  }) as ExportJobRequest<TSource>;
}

function captureContext(context: JobTaskContext): {
  readonly requestId: string;
  readonly signal: AbortSignal;
} {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new JobTaskError("invalid-input", "Export job context is invalid.", false);
  }
  let requestId: unknown;
  let signal: unknown;
  try {
    requestId = ownEnumerableDataValue(context, "requestId", "Export job request ID");
    signal = ownEnumerableDataValue(context, "signal", "Export job signal");
  } catch {
    throw new JobTaskError("invalid-input", "Export job context is invalid.", false);
  }
  if (!isEntityId(requestId)) {
    throw new JobTaskError("invalid-input", "Export job request identity is invalid.", false);
  }
  try {
    if (!signal || typeof signal !== "object" || !ABORTED_GETTER) throw new TypeError();
    Reflect.apply(ABORTED_GETTER, signal, []);
  } catch {
    throw new JobTaskError("invalid-input", "Export job signal is invalid.", false);
  }
  return Object.freeze({ requestId, signal: signal as AbortSignal });
}

export function toExportJobTaskError(error: unknown): JobTaskError {
  if (!isExportPortError(error)) {
    return new JobTaskError(
      UNKNOWN_EXPORT_DIAGNOSTIC.code,
      UNKNOWN_EXPORT_DIAGNOSTIC.message,
      UNKNOWN_EXPORT_DIAGNOSTIC.retryable,
    );
  }
  const diagnostic = EXPORT_JOB_DIAGNOSTICS[error.code];
  return new JobTaskError(diagnostic.code, diagnostic.message, diagnostic.retryable);
}

export function createExportJobTask<TSource>(
  options: CreateExportJobTaskOptions<TSource>,
): JobTask<ExportResult> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Export job task options must be an object.");
  }
  requireExactKeys(options, ["port", "request"], "Export job task options");
  const port = capturePort(
    ownEnumerableDataValue(options, "port", "Export job task port"),
  );
  const request = captureRequest<TSource>(
    ownEnumerableDataValue(options, "request", "Export job task request"),
  );

  const task: JobTask<ExportResult> = async (context) => {
    const { requestId, signal } = captureContext(context);
    const exportRequest = Object.freeze({
      ...request,
      requestId,
      signal,
    }) as ExportRequest<TSource>;
    try {
      return await port(exportRequest);
    } catch (error) {
      throw toExportJobTaskError(error);
    }
  };
  return Object.freeze(task);
}
