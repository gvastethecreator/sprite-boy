import type { StudioProjectV1 } from "../project/schema";
import {
  validateStudioProject,
} from "../project/validation";
import type {
  ProjectDiagnostic,
  ProjectValidationResult,
} from "../project/validation";

export const STUDIO_PROJECT_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_STUDIO_PROJECT_SCHEMA_VERSIONS = Object.freeze([1] as const);

export type ProjectCodecOperation = "encode" | "decode";

export type ProjectCodecErrorCode =
  | "PROJECT_CODEC_INVALID_INPUT"
  | "PROJECT_CODEC_INVALID_JSON"
  | "PROJECT_CODEC_INVALID_DOCUMENT"
  | "PROJECT_CODEC_UNSUPPORTED_VERSION"
  | "PROJECT_CODEC_ENCODE_FAILED";

export interface ProjectCodecDiagnostic {
  code: ProjectCodecErrorCode;
  operation: ProjectCodecOperation;
  message: string;
  schemaVersion?: number;
  projectDiagnostics: readonly ProjectDiagnostic[];
}

interface ProjectCodecErrorOptions {
  operation: ProjectCodecOperation;
  schemaVersion?: number;
  diagnostics?: readonly ProjectDiagnostic[];
  cause?: unknown;
}

export class ProjectCodecError extends Error {
  readonly code: ProjectCodecErrorCode;
  readonly operation: ProjectCodecOperation;
  readonly schemaVersion?: number;
  readonly projectDiagnostics: readonly ProjectDiagnostic[];
  override readonly cause?: unknown;

  constructor(
    code: ProjectCodecErrorCode,
    message: string,
    options: ProjectCodecErrorOptions,
  ) {
    super(message);
    this.name = "ProjectCodecError";
    this.code = code;
    this.operation = options.operation;
    this.schemaVersion = options.schemaVersion;
    this.projectDiagnostics = Object.freeze(
      (options.diagnostics ?? []).map((diagnostic) => Object.freeze({ ...diagnostic })),
    );
    this.cause = options.cause;
  }

  toDiagnostic(): ProjectCodecDiagnostic {
    return {
      code: this.code,
      operation: this.operation,
      message: this.message,
      ...(this.schemaVersion !== undefined ? { schemaVersion: this.schemaVersion } : {}),
      projectDiagnostics: this.projectDiagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
  }
}

export function isProjectCodecError(value: unknown): value is ProjectCodecError {
  try {
    return value instanceof ProjectCodecError;
  } catch {
    return false;
  }
}

type CanonicalJson = null | string | number | boolean | CanonicalJson[] | {
  [key: string]: CanonicalJson;
};

function readSchemaVersion(value: unknown): number | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
    return descriptor && "value" in descriptor && typeof descriptor.value === "number"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function canonicalSnapshot(value: unknown, ancestors = new WeakSet<object>()): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Only canonical finite JSON numbers can be encoded.");
    }
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Value is not canonical JSON data.");
  if (ancestors.has(value)) throw new TypeError("Cyclic values cannot be encoded.");

  if (Array.isArray(value)) {
    ancestors.add(value);
    try {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
      if (!Number.isSafeInteger(length) || (length as number) < 0) {
        throw new TypeError("Array length is invalid.");
      }
      const result: CanonicalJson[] = [];
      for (let index = 0; index < (length as number); index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("Sparse/accessor arrays are not canonical JSON.");
        }
        result.push(canonicalSnapshot(descriptor.value, ancestors));
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Only plain objects can be encoded.");
  }
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError("Symbol keys cannot be encoded.");
    }
    const result: Record<string, CanonicalJson> = {};
    for (const key of (keys as string[]).sort((left, right) => (
      left < right ? -1 : left > right ? 1 : 0
    ))) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Non-enumerable/accessor properties cannot be encoded.");
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: canonicalSnapshot(descriptor.value, ancestors),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function invalidDocument(
  operation: ProjectCodecOperation,
  validation: ProjectValidationResult,
  schemaVersion?: number,
): ProjectCodecError {
  const unsupported = Number.isSafeInteger(schemaVersion)
    && (schemaVersion as number) >= 1
    && !SUPPORTED_STUDIO_PROJECT_SCHEMA_VERSIONS.includes(schemaVersion as 1)
    && validation.diagnostics.some((diagnostic) => (
      diagnostic.code === "UNSUPPORTED_SCHEMA_VERSION"
    ));
  return new ProjectCodecError(
    unsupported ? "PROJECT_CODEC_UNSUPPORTED_VERSION" : "PROJECT_CODEC_INVALID_DOCUMENT",
    unsupported
      ? `Studio project schema version ${schemaVersion ?? "unknown"} is not supported.`
      : `Studio project document is invalid for ${operation}.`,
    {
      operation,
      ...(schemaVersion !== undefined ? { schemaVersion } : {}),
      diagnostics: validation.diagnostics,
    },
  );
}

function validateV1(value: unknown, operation: ProjectCodecOperation): StudioProjectV1 {
  const validation = validateStudioProject(value);
  if (!validation.valid || !validation.project) {
    throw invalidDocument(operation, validation, readSchemaVersion(value));
  }
  return validation.project;
}

type VersionDecoder = (value: unknown) => StudioProjectV1;

const VERSION_DECODERS: ReadonlyMap<number, VersionDecoder> = new Map([
  [STUDIO_PROJECT_SCHEMA_VERSION, (value) => validateV1(value, "decode")],
]);

/** Canonical StudioProject JSON codec. Migrations are deliberately a later boundary. */
export class ProjectCodec {
  readonly supportedVersions = SUPPORTED_STUDIO_PROJECT_SCHEMA_VERSIONS;

  encode(project: StudioProjectV1): string {
    const version = readSchemaVersion(project);
    const initialValidation = validateStudioProject(project);
    if (!initialValidation.valid || !initialValidation.project) {
      throw invalidDocument("encode", initialValidation, version);
    }
    let snapshot: CanonicalJson;
    try {
      snapshot = canonicalSnapshot(initialValidation.project);
    } catch (cause) {
      throw new ProjectCodecError(
        "PROJECT_CODEC_ENCODE_FAILED",
        "Studio project could not be copied into a canonical JSON snapshot.",
        { operation: "encode", schemaVersion: version, cause },
      );
    }
    const snapshotValidation = validateStudioProject(snapshot);
    if (!snapshotValidation.valid || !snapshotValidation.project) {
      throw invalidDocument("encode", snapshotValidation, readSchemaVersion(snapshot));
    }
    try {
      return JSON.stringify(snapshot);
    } catch (cause) {
      throw new ProjectCodecError(
        "PROJECT_CODEC_ENCODE_FAILED",
        "Studio project canonical JSON encoding failed.",
        { operation: "encode", schemaVersion: version, cause },
      );
    }
  }

  decode(serialized: string): StudioProjectV1 {
    if (typeof serialized !== "string") {
      throw new ProjectCodecError(
        "PROJECT_CODEC_INVALID_INPUT",
        "Studio project decode input must be a JSON string.",
        { operation: "decode" },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch (cause) {
      throw new ProjectCodecError(
        "PROJECT_CODEC_INVALID_JSON",
        "Studio project JSON could not be parsed.",
        { operation: "decode", cause },
      );
    }
    const version = readSchemaVersion(parsed);
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
      const validation = validateStudioProject(parsed);
      throw invalidDocument("decode", validation, version);
    }
    const decoder = VERSION_DECODERS.get(version as number);
    if (!decoder) {
      throw new ProjectCodecError(
        "PROJECT_CODEC_UNSUPPORTED_VERSION",
        `Studio project schema version ${version} is not supported.`,
        { operation: "decode", schemaVersion: version },
      );
    }
    const project = decoder(parsed);
    let snapshot: CanonicalJson;
    try {
      snapshot = canonicalSnapshot(project);
    } catch (cause) {
      throw new ProjectCodecError(
        "PROJECT_CODEC_INVALID_DOCUMENT",
        "Decoded Studio project could not be normalized.",
        { operation: "decode", schemaVersion: version, cause },
      );
    }
    return validateV1(snapshot, "decode");
  }
}

export const projectCodec = new ProjectCodec();
