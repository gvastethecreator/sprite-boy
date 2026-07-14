import JSZip from "jszip";
import {
  assertAssetRecordContentIdentity,
  computeAssetContentIdentity,
  inspectNativeAssetBlob,
} from "../assets";
import type { AssetOperationOptions } from "../assets";
import type { AssetRecord, StudioProjectV1 } from "../project";
import { projectCodec } from "./projectCodec";

export const SPRITEBOY_PACKAGE_FORMAT = "spriteboy-package" as const;
export const SPRITEBOY_PACKAGE_VERSION = 1 as const;
export const SPRITEBOY_PACKAGE_MIME = "application/vnd.spriteboy.project+zip" as const;

const MANIFEST_PATH = "manifest.json";
const PROJECT_PATH = "project.json";
const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0, 0);
const DEFAULT_MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

export interface SpriteBoyPackageProjectManifest {
  path: typeof PROJECT_PATH;
  schemaVersion: 1;
  sha256: string;
  byteSize: number;
}

export interface SpriteBoyPackageBlobManifest {
  path: string;
  blobKey: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  assetIds: readonly string[];
}

export interface SpriteBoyPackageManifestV1 {
  format: typeof SPRITEBOY_PACKAGE_FORMAT;
  formatVersion: typeof SPRITEBOY_PACKAGE_VERSION;
  project: SpriteBoyPackageProjectManifest;
  blobs: readonly SpriteBoyPackageBlobManifest[];
}

export interface SpriteBoyPackageAssetSource {
  getBlob(assetId: string, options?: AssetOperationOptions): Promise<Blob>;
}

export interface SpriteBoyPackageExportOptions extends AssetOperationOptions {
  compressionLevel?: number;
}

export interface SpriteBoyPackageImportOptions extends AssetOperationOptions {
  maxPackageBytes?: number;
  maxEntries?: number;
  maxUncompressedBytes?: number;
}

export interface ImportedSpriteBoyBlob extends SpriteBoyPackageBlobManifest {
  blob: Blob;
}

export interface ImportedSpriteBoyPackage {
  project: StudioProjectV1;
  manifest: SpriteBoyPackageManifestV1;
  blobs: readonly ImportedSpriteBoyBlob[];
}

export type SpriteBoyPackageOperation = "export" | "import";

export type SpriteBoyPackageErrorCode =
  | "SPRITEBOY_PACKAGE_INVALID_INPUT"
  | "SPRITEBOY_PACKAGE_INVALID_ARCHIVE"
  | "SPRITEBOY_PACKAGE_MANIFEST_INVALID"
  | "SPRITEBOY_PACKAGE_PROJECT_INVALID"
  | "SPRITEBOY_PACKAGE_ASSET_MISSING"
  | "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH"
  | "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED"
  | "SPRITEBOY_PACKAGE_ABORTED";

export interface SpriteBoyPackageErrorDiagnostic {
  code: SpriteBoyPackageErrorCode;
  operation: SpriteBoyPackageOperation;
  message: string;
  path?: string;
  assetId?: string;
}

interface SpriteBoyPackageErrorOptions {
  path?: string;
  assetId?: string;
  cause?: unknown;
}

export class SpriteBoyPackageError extends Error {
  readonly code: SpriteBoyPackageErrorCode;
  readonly operation: SpriteBoyPackageOperation;
  readonly path?: string;
  readonly assetId?: string;
  override readonly cause?: unknown;

  constructor(
    code: SpriteBoyPackageErrorCode,
    operation: SpriteBoyPackageOperation,
    message: string,
    options: SpriteBoyPackageErrorOptions = {},
  ) {
    super(message);
    this.name = "SpriteBoyPackageError";
    this.code = code;
    this.operation = operation;
    this.path = options.path;
    this.assetId = options.assetId;
    this.cause = options.cause;
  }

  toDiagnostic(): SpriteBoyPackageErrorDiagnostic {
    return {
      code: this.code,
      operation: this.operation,
      message: this.message,
      ...(this.path ? { path: this.path } : {}),
      ...(this.assetId ? { assetId: this.assetId } : {}),
    };
  }
}

export function isSpriteBoyPackageError(value: unknown): value is SpriteBoyPackageError {
  try {
    return value instanceof SpriteBoyPackageError;
  } catch {
    return false;
  }
}

function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageError(
  code: SpriteBoyPackageErrorCode,
  operation: SpriteBoyPackageOperation,
  message: string,
  options: SpriteBoyPackageErrorOptions = {},
): SpriteBoyPackageError {
  return new SpriteBoyPackageError(code, operation, message, options);
}

interface SignalLease {
  signal?: AbortSignal;
  release(): void;
}

interface NormalizedExportOptions extends SignalLease {
  compressionLevel: number;
}

interface NormalizedImportOptions extends SignalLease {
  maxPackageBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
}

interface NormalizedAssetSource {
  receiver: object;
  getBlob: SpriteBoyPackageAssetSource["getBlob"];
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
  let prototype: object | null = Object.getPrototypeOf(signal);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
      Reflect.apply(descriptor.value, signal, ["abort", listener]);
      return;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new TypeError(`AbortSignal.${method} is unavailable.`);
}

function signalLease(value: unknown, operation: SpriteBoyPackageOperation): SignalLease {
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
          // A validated native signal can only fail cleanup after host teardown.
        }
      },
    };
  } catch (cause) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      operation,
      "signal must be a native AbortSignal.",
      { cause },
    );
  }
}

function optionsRecord(
  value: unknown,
  allowedKeys: readonly string[],
  operation: SpriteBoyPackageOperation,
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Options must be a plain object.");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Options must be a plain object.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
      throw new TypeError("Options contain unsupported fields.");
    }
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`Option ${key} must be an enumerable data property.`);
      }
    }
    return value as Record<string, unknown>;
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      operation,
      `SpriteBoy package ${operation} options are invalid.`,
      { cause },
    );
  }
}

function ownOption(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function normalizeExportOptions(value: unknown): NormalizedExportOptions {
  const record = optionsRecord(value, ["signal", "compressionLevel"], "export");
  const compressionLevel = ownOption(record, "compressionLevel") ?? 6;
  if (!Number.isInteger(compressionLevel) || (compressionLevel as number) < 0 || (compressionLevel as number) > 9) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      "export",
      "compressionLevel must be an integer from 0 to 9.",
    );
  }
  return {
    ...signalLease(ownOption(record, "signal"), "export"),
    compressionLevel: compressionLevel as number,
  };
}

function normalizeImportOptions(value: unknown): NormalizedImportOptions {
  const record = optionsRecord(
    value,
    ["signal", "maxPackageBytes", "maxEntries", "maxUncompressedBytes"],
    "import",
  );
  const limits = {
    maxPackageBytes: normalizePositiveLimit(ownOption(record, "maxPackageBytes"), DEFAULT_MAX_PACKAGE_BYTES, "maxPackageBytes"),
    maxEntries: normalizePositiveLimit(ownOption(record, "maxEntries"), DEFAULT_MAX_ENTRIES, "maxEntries"),
    maxUncompressedBytes: normalizePositiveLimit(
      ownOption(record, "maxUncompressedBytes"),
      DEFAULT_MAX_UNCOMPRESSED_BYTES,
      "maxUncompressedBytes",
    ),
  };
  return { ...signalLease(ownOption(record, "signal"), "import"), ...limits };
}

function normalizeAssetSource(value: unknown): NormalizedAssetSource {
  try {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      throw new TypeError("Asset source must be an object.");
    }
    const receiver = value as object;
    const seen = new Set<object>();
    let current: object | null = receiver;
    while (current && !seen.has(current)) {
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, "getBlob");
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new TypeError("Asset source getBlob must be a data method.");
        }
        return { receiver, getBlob: descriptor.value as SpriteBoyPackageAssetSource["getBlob"] };
      }
      current = Object.getPrototypeOf(current);
    }
    throw new TypeError("Asset source getBlob method is missing.");
  } catch (cause) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      "export",
      "SpriteBoy package asset source is invalid.",
      { cause },
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined, operation: SpriteBoyPackageOperation): void {
  if (!signal || nativeSignalValue(signal, "aborted") !== true) return;
  throw packageError(
    "SPRITEBOY_PACKAGE_ABORTED",
    operation,
    `SpriteBoy package ${operation} was aborted.`,
    { cause: nativeSignalValue(signal, "reason") },
  );
}

function raceAbort<T>(
  work: PromiseLike<T>,
  signal: AbortSignal | undefined,
  operation: SpriteBoyPackageOperation,
): Promise<T> {
  if (!signal) return Promise.resolve(work);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => callNativeSignalListener(signal, "removeEventListener", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(packageError(
      "SPRITEBOY_PACKAGE_ABORTED",
      operation,
      `SpriteBoy package ${operation} was aborted.`,
      { cause: nativeSignalValue(signal, "reason") },
    )));
    callNativeSignalListener(signal, "addEventListener", onAbort);
    Promise.resolve(work).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (nativeSignalValue(signal, "aborted") === true) onAbort();
  });
}

function normalizePositiveLimit(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      "import",
      `${name} must be a positive safe integer.`,
    );
  }
  return value as number;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";", 1)[0].trim();
  const known: Readonly<Record<string, string>> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "application/json": "json",
  };
  return known[normalized] ?? "bin";
}

function assetPath(contentHash: string, mimeType: string): string {
  return `assets/${contentHash}.${extensionForMimeType(mimeType)}`;
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function binaryString(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let output = "";
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return output;
}

async function computeIdentity(
  blob: Blob,
  operation: SpriteBoyPackageOperation,
  signal: AbortSignal | undefined,
  assetId?: string,
) {
  try {
    return await computeAssetContentIdentity(blob, { signal });
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throwIfAborted(signal, operation);
    throw packageError(
      "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
      operation,
      assetId
        ? `Asset ${assetId} could not be hashed or did not match its metadata.`
        : "Package content could not be hashed.",
      { assetId, cause },
    );
  }
}

interface BlobGroup {
  record: AssetRecord;
  assetIds: string[];
}

function groupProjectAssets(
  project: StudioProjectV1,
  operation: SpriteBoyPackageOperation = "export",
): BlobGroup[] {
  const byBlobKey = new Map<string, BlobGroup>();
  const records = Object.values(project.assets).sort((left, right) => compareCodeUnit(left.id, right.id));
  for (const record of records) {
    if (!/^[0-9a-f]{64}$/.test(record.contentHash) || record.blobKey !== `sha256:${record.contentHash}`) {
      throw packageError(
        "SPRITEBOY_PACKAGE_PROJECT_INVALID",
        operation,
        `Asset ${record.id} does not have a canonical SHA-256 identity.`,
        { assetId: record.id },
      );
    }
    const existing = byBlobKey.get(record.blobKey);
    if (!existing) {
      byBlobKey.set(record.blobKey, { record, assetIds: [record.id] });
      continue;
    }
    if (
      existing.record.contentHash !== record.contentHash
      || existing.record.byteSize !== record.byteSize
      || existing.record.mimeType !== record.mimeType
      || existing.record.width !== record.width
      || existing.record.height !== record.height
    ) {
      throw packageError(
        "SPRITEBOY_PACKAGE_PROJECT_INVALID",
        operation,
        `Assets sharing ${record.blobKey} have contradictory metadata.`,
        { assetId: record.id },
      );
    }
    existing.assetIds.push(record.id);
  }
  return [...byBlobKey.values()].sort((left, right) => (
    compareCodeUnit(left.record.contentHash, right.record.contentHash)
  ));
}

function freezeBlobManifest(value: SpriteBoyPackageBlobManifest): SpriteBoyPackageBlobManifest {
  return Object.freeze({ ...value, assetIds: Object.freeze([...value.assetIds]) });
}

function freezeManifest(value: SpriteBoyPackageManifestV1): SpriteBoyPackageManifestV1 {
  return Object.freeze({
    format: value.format,
    formatVersion: value.formatVersion,
    project: Object.freeze({ ...value.project }),
    blobs: Object.freeze(value.blobs.map(freezeBlobManifest)),
  });
}

/** Create a deterministic portable package without mutating repository state. */
export async function exportSpriteBoyPackage(
  project: StudioProjectV1,
  source: SpriteBoyPackageAssetSource,
  options: SpriteBoyPackageExportOptions = {},
): Promise<Blob> {
  const normalizedOptions = normalizeExportOptions(options);
  try {
    return await exportSpriteBoyPackageNormalized(
      project,
      normalizeAssetSource(source),
      normalizedOptions,
    );
  } finally {
    normalizedOptions.release();
  }
}

async function exportSpriteBoyPackageNormalized(
  project: StudioProjectV1,
  source: NormalizedAssetSource,
  options: NormalizedExportOptions,
): Promise<Blob> {
  throwIfAborted(options.signal, "export");
  let encodedProject: string;
  try {
    encodedProject = projectCodec.encode(project);
  } catch (cause) {
    throw packageError(
      "SPRITEBOY_PACKAGE_PROJECT_INVALID",
      "export",
      "The project could not be encoded for a portable package.",
      { cause },
    );
  }
  const groups = groupProjectAssets(project);
  const projectBytes = textBytes(encodedProject);
  const projectIdentity = await computeIdentity(
    new Blob([ownedArrayBuffer(projectBytes)], { type: "application/json" }),
    "export",
    options.signal,
  );
  const zip = new JSZip();
  const blobEntries: SpriteBoyPackageBlobManifest[] = [];
  const blobBytes = new Map<string, Uint8Array>();
  for (const group of groups) {
    throwIfAborted(options.signal, "export");
    const assetId = group.assetIds[0];
    let blob: Blob;
    try {
      blob = await raceAbort(
        Promise.resolve().then(() => Reflect.apply(
          source.getBlob,
          source.receiver,
          [assetId, { signal: options.signal }],
        ) as Promise<Blob>),
        options.signal,
        "export",
      );
    } catch (cause) {
      if (isSpriteBoyPackageError(cause)) throw cause;
      throw packageError(
        "SPRITEBOY_PACKAGE_ASSET_MISSING",
        "export",
        `Asset payload ${assetId} could not be read.`,
        { assetId, cause },
      );
    }
    const nativeBlob = inspectNativeAssetBlob(blob);
    if (!nativeBlob) {
      throw packageError(
        "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        "export",
        `Asset payload ${assetId} is not a native Blob.`,
        { assetId },
      );
    }
    const identity = await computeIdentity(nativeBlob.blob, "export", options.signal, assetId);
    try {
      assertAssetRecordContentIdentity(group.record, nativeBlob.blob, identity, "verify");
    } catch (cause) {
      throw packageError(
        "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        "export",
        `Asset payload ${assetId} does not match its project metadata.`,
        { assetId, cause },
      );
    }
    const path = assetPath(identity.contentHash, group.record.mimeType);
    const bytes = new Uint8Array(await raceAbort(nativeBlob.blob.arrayBuffer(), options.signal, "export"));
    blobBytes.set(path, bytes);
    blobEntries.push(freezeBlobManifest({
      path,
      blobKey: identity.blobKey,
      contentHash: identity.contentHash,
      mimeType: group.record.mimeType,
      byteSize: identity.byteSize,
      assetIds: group.assetIds,
    }));
  }
  const manifest = freezeManifest({
    format: SPRITEBOY_PACKAGE_FORMAT,
    formatVersion: SPRITEBOY_PACKAGE_VERSION,
    project: {
      path: PROJECT_PATH,
      schemaVersion: 1,
      sha256: projectIdentity.contentHash,
      byteSize: projectBytes.byteLength,
    },
    blobs: blobEntries,
  });
  zip.file(MANIFEST_PATH, JSON.stringify(manifest), { date: FIXED_ZIP_DATE, createFolders: false });
  zip.file(PROJECT_PATH, encodedProject, { date: FIXED_ZIP_DATE, createFolders: false });
  for (const entry of manifest.blobs) {
    zip.file(entry.path, binaryString(blobBytes.get(entry.path)!), {
      date: FIXED_ZIP_DATE,
      createFolders: false,
      binary: true,
    });
  }
  const compressionLevel = options.compressionLevel;
  try {
    const bytes = await raceAbort(zip.generateAsync({
      type: "uint8array",
      compression: compressionLevel === 0 ? "STORE" : "DEFLATE",
      compressionOptions: { level: compressionLevel },
      platform: "DOS",
      streamFiles: false,
    }), options.signal, "export");
    throwIfAborted(options.signal, "export");
    return new Blob([ownedArrayBuffer(bytes)], { type: SPRITEBOY_PACKAGE_MIME });
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
      "export",
      "The portable ZIP archive could not be generated.",
      { cause },
    );
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path} must be an object.`,
      { path },
    );
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(record).sort(compareCodeUnit);
  const expected = [...keys].sort(compareCodeUnit);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path} fields do not match the V1 package contract.`,
      { path },
    );
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path} must be a non-empty string.`,
      { path },
    );
  }
  return value;
}

function requireSafeSize(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path} must be a non-negative safe integer.`,
      { path },
    );
  }
  return value as number;
}

function parseBlobManifest(value: unknown, index: number): SpriteBoyPackageBlobManifest {
  const path = `$.blobs[${index}]`;
  const record = requireRecord(value, path);
  requireExactKeys(record, ["path", "blobKey", "contentHash", "mimeType", "byteSize", "assetIds"], path);
  const contentHash = requireString(record.contentHash, `${path}.contentHash`);
  const blobKey = requireString(record.blobKey, `${path}.blobKey`);
  const mimeType = requireString(record.mimeType, `${path}.mimeType`);
  const entryPath = requireString(record.path, `${path}.path`);
  if (
    !/^[0-9a-f]{64}$/.test(contentHash)
    || blobKey !== `sha256:${contentHash}`
    || entryPath !== assetPath(contentHash, mimeType)
  ) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path} content identity/path is invalid.`,
      { path },
    );
  }
  if (!Array.isArray(record.assetIds) || record.assetIds.length === 0) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path}.assetIds must be a non-empty array.`,
      { path: `${path}.assetIds` },
    );
  }
  const assetIds = record.assetIds.map((value, assetIndex) => (
    requireString(value, `${path}.assetIds[${assetIndex}]`)
  ));
  const sorted = [...assetIds].sort(compareCodeUnit);
  if (
    new Set(assetIds).size !== assetIds.length
    || assetIds.some((assetId, assetIndex) => assetId !== sorted[assetIndex])
  ) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      `${path}.assetIds must be sorted and unique.`,
      { path: `${path}.assetIds` },
    );
  }
  return freezeBlobManifest({
    path: entryPath,
    blobKey,
    contentHash,
    mimeType,
    byteSize: requireSafeSize(record.byteSize, `${path}.byteSize`),
    assetIds,
  });
}

function parseManifest(value: unknown): SpriteBoyPackageManifestV1 {
  const record = requireRecord(value, "$manifest");
  requireExactKeys(record, ["format", "formatVersion", "project", "blobs"], "$manifest");
  if (record.format !== SPRITEBOY_PACKAGE_FORMAT || record.formatVersion !== 1) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      "Package format/version is unsupported.",
      { path: "$manifest" },
    );
  }
  const project = requireRecord(record.project, "$.project");
  requireExactKeys(project, ["path", "schemaVersion", "sha256", "byteSize"], "$.project");
  const sha256 = requireString(project.sha256, "$.project.sha256");
  if (project.path !== PROJECT_PATH || project.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      "Project manifest entry is invalid or unsupported.",
      { path: "$.project" },
    );
  }
  if (!Array.isArray(record.blobs)) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      "$.blobs must be an array.",
      { path: "$.blobs" },
    );
  }
  const blobs = record.blobs.map(parseBlobManifest);
  const sortedPaths = blobs.map(({ path }) => path).sort(compareCodeUnit);
  const allAssetIds = blobs.flatMap(({ assetIds }) => assetIds);
  if (
    new Set(blobs.map(({ path }) => path)).size !== blobs.length
    || new Set(blobs.map(({ blobKey }) => blobKey)).size !== blobs.length
    || new Set(allAssetIds).size !== allAssetIds.length
    || blobs.some((blob, index) => blob.path !== sortedPaths[index])
  ) {
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      "Blob entries must be sorted and have unique paths, identities and asset IDs.",
      { path: "$.blobs" },
    );
  }
  return freezeManifest({
    format: SPRITEBOY_PACKAGE_FORMAT,
    formatVersion: 1,
    project: {
      path: PROJECT_PATH,
      schemaVersion: 1,
      sha256,
      byteSize: requireSafeSize(project.byteSize, "$.project.byteSize"),
    },
    blobs,
  });
}

function invalidCentralDirectory(message: string, path?: string): never {
  throw packageError(
    "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
    "import",
    message,
    path ? { path } : {},
  );
}

function zipEntryName(bytes: Uint8Array, offset: number, length: number): string {
  const nameBytes = bytes.subarray(offset, offset + length);
  if (nameBytes.some((byte) => byte > 0x7f)) {
    invalidCentralDirectory("ZIP entry names must use the portable ASCII package path set.");
  }
  return String.fromCharCode(...nameBytes);
}

function assertSafePhysicalPath(name: string): void {
  const segments = name.split("/");
  if (
    name.length === 0
    || name.includes("\0")
    || name.includes("\\")
    || name.startsWith("/")
    || /^[A-Za-z]:/.test(name)
    || name.endsWith("/")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalidCentralDirectory(`Unsafe or directory ZIP entry ${name} is not allowed.`, name);
  }
}

/** Inspect every physical central-directory record before JSZip can inflate an entry. */
function preflightZipDirectory(
  bytes: ArrayBuffer,
  maxEntries: number,
  maxUncompressedBytes: number,
): void {
  const archive = new Uint8Array(bytes);
  if (archive.byteLength < 22) invalidCentralDirectory("ZIP end-of-directory record is missing.");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const earliestEnd = Math.max(0, archive.byteLength - 22 - ZIP_MAX_COMMENT_BYTES);
  let endOffset = -1;
  for (let offset = archive.byteLength - 22; offset >= earliestEnd; offset -= 1) {
    if (
      view.getUint32(offset, true) === ZIP_END_SIGNATURE
      && offset + 22 + view.getUint16(offset + 20, true) === archive.byteLength
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) invalidCentralDirectory("ZIP end-of-directory record is invalid.");

  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (
    disk !== 0
    || centralDisk !== 0
    || diskEntries !== entryCount
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || centralOffset + centralSize !== endOffset
  ) {
    invalidCentralDirectory("Multi-disk, ZIP64 or structurally inconsistent archives are not supported.");
  }
  if (entryCount > maxEntries) {
    throw packageError(
      "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED",
      "import",
      `Package exceeds the ${maxEntries}-entry limit.`,
    );
  }

  const names = new Set<string>();
  let position = centralOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (position + 46 > endOffset || view.getUint32(position, true) !== ZIP_CENTRAL_SIGNATURE) {
      invalidCentralDirectory("ZIP central directory contains a malformed entry.");
    }
    const flags = view.getUint16(position + 8, true);
    const compression = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const uncompressedSize = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const entryDisk = view.getUint16(position + 34, true);
    const localOffset = view.getUint32(position + 42, true);
    const recordEnd = position + 46 + nameLength + extraLength + commentLength;
    if (
      recordEnd > endOffset
      || entryDisk !== 0
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
      || (flags & 0x1) !== 0
      || (compression !== 0 && compression !== 8)
    ) {
      invalidCentralDirectory("ZIP central directory uses unsupported entry features.");
    }
    const name = zipEntryName(archive, position + 46, nameLength);
    assertSafePhysicalPath(name);
    if (names.has(name)) invalidCentralDirectory(`Duplicate physical ZIP entry ${name} is not allowed.`, name);
    names.add(name);

    uncompressedBytes += uncompressedSize;
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > maxUncompressedBytes) {
      throw packageError(
        "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED",
        "import",
        `Package exceeds the ${maxUncompressedBytes}-byte uncompressed limit.`,
      );
    }

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      invalidCentralDirectory(`ZIP entry ${name} has an invalid local header.`, name);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localDataEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    if (
      localDataEnd > centralOffset
      || localNameLength !== nameLength
      || zipEntryName(archive, localOffset + 30, localNameLength) !== name
    ) {
      invalidCentralDirectory(`ZIP entry ${name} local/central metadata is inconsistent.`, name);
    }
    position = recordEnd;
  }
  if (position !== endOffset) invalidCentralDirectory("ZIP central-directory size is inconsistent.");
}

interface ZipEntryWithInternals extends JSZip.JSZipObject {
  unsafeOriginalName?: string;
  _data?: { uncompressedSize?: number };
}

function entryUncompressedSize(entry: ZipEntryWithInternals): number | undefined {
  const size = entry._data?.uncompressedSize;
  return Number.isSafeInteger(size) && (size as number) >= 0 ? size : undefined;
}

async function readZipEntry(
  entry: JSZip.JSZipObject | undefined,
  path: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (!entry || entry.dir) {
    throw packageError(
      "SPRITEBOY_PACKAGE_ASSET_MISSING",
      "import",
      `Package entry ${path} is missing.`,
      { path },
    );
  }
  try {
    return await raceAbort(entry.async("uint8array"), signal, "import");
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
      "import",
      `Package entry ${path} could not be decompressed.`,
      { path, cause },
    );
  }
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
      "import",
      `${path} is not valid UTF-8.`,
      { path, cause },
    );
  }
}

function expectedBlobGroups(project: StudioProjectV1): Map<string, BlobGroup> {
  const groups = groupProjectAssets(project, "import");
  return new Map(groups.map((group) => [group.record.blobKey, group]));
}

function assertManifestMatchesProject(
  manifest: SpriteBoyPackageManifestV1,
  project: StudioProjectV1,
): void {
  const expected = expectedBlobGroups(project);
  if (expected.size !== manifest.blobs.length) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
      "import",
      "Manifest blob count does not match project asset identities.",
      { path: "$.blobs" },
    );
  }
  for (const entry of manifest.blobs) {
    const group = expected.get(entry.blobKey);
    if (
      !group
      || group.record.contentHash !== entry.contentHash
      || group.record.mimeType !== entry.mimeType
      || group.record.byteSize !== entry.byteSize
      || entry.path !== assetPath(entry.contentHash, entry.mimeType)
      || group.assetIds.length !== entry.assetIds.length
      || group.assetIds.some((assetId, index) => assetId !== entry.assetIds[index])
    ) {
      throw packageError(
        "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        "import",
        `Manifest blob ${entry.blobKey} does not match project metadata.`,
        { path: entry.path },
      );
    }
  }
}

/** Parse and verify a package completely before any caller persists it. */
export async function importSpriteBoyPackage(
  input: Blob,
  options: SpriteBoyPackageImportOptions = {},
): Promise<ImportedSpriteBoyPackage> {
  const normalizedOptions = normalizeImportOptions(options);
  try {
    return await importSpriteBoyPackageNormalized(input, normalizedOptions);
  } finally {
    normalizedOptions.release();
  }
}

async function importSpriteBoyPackageNormalized(
  input: Blob,
  options: NormalizedImportOptions,
): Promise<ImportedSpriteBoyPackage> {
  throwIfAborted(options.signal, "import");
  const nativeInput = inspectNativeAssetBlob(input);
  if (!nativeInput) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      "import",
      "SpriteBoy package import requires a native Blob.",
    );
  }
  const { maxPackageBytes, maxEntries, maxUncompressedBytes } = options;
  if (nativeInput.byteSize > maxPackageBytes) {
    throw packageError(
      "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED",
      "import",
      `Package exceeds the ${maxPackageBytes}-byte input limit.`,
    );
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await raceAbort(nativeInput.blob.arrayBuffer(), options.signal, "import");
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_INPUT",
      "import",
      "Package bytes could not be read.",
      { cause },
    );
  }
  preflightZipDirectory(bytes, maxEntries, maxUncompressedBytes);
  let zip: JSZip;
  try {
    zip = await raceAbort(JSZip.loadAsync(bytes, { createFolders: false }), options.signal, "import");
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
      "import",
      "Input is not a readable ZIP archive.",
      { cause },
    );
  }
  const entries = Object.values(zip.files) as ZipEntryWithInternals[];
  if (entries.length > maxEntries) {
    throw packageError(
      "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED",
      "import",
      `Package exceeds the ${maxEntries}-entry limit.`,
    );
  }
  let declaredUncompressedBytes = 0;
  for (const entry of entries) {
    const originalName = entry.unsafeOriginalName ?? entry.name;
    if (
      entry.dir
      || originalName !== entry.name
      || entry.name.includes("\\")
      || entry.name.startsWith("/")
      || entry.name.split("/").includes("..")
    ) {
      throw packageError(
        "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
        "import",
        `Unsafe or directory ZIP entry ${originalName} is not allowed.`,
        { path: originalName },
      );
    }
    const size = entryUncompressedSize(entry);
    if (size !== undefined) declaredUncompressedBytes += size;
    if (declaredUncompressedBytes > maxUncompressedBytes) {
      throw packageError(
        "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED",
        "import",
        `Package exceeds the ${maxUncompressedBytes}-byte uncompressed limit.`,
      );
    }
  }

  const manifestBytes = await readZipEntry(zip.file(MANIFEST_PATH) ?? undefined, MANIFEST_PATH, options.signal);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(decodeUtf8(manifestBytes, MANIFEST_PATH));
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_MANIFEST_INVALID",
      "import",
      "manifest.json is not valid JSON.",
      { path: MANIFEST_PATH, cause },
    );
  }
  const manifest = parseManifest(manifestValue);
  const expectedPaths = new Set([MANIFEST_PATH, PROJECT_PATH, ...manifest.blobs.map(({ path }) => path)]);
  if (
    entries.length !== expectedPaths.size
    || entries.some(({ name }) => !expectedPaths.has(name))
  ) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INVALID_ARCHIVE",
      "import",
      "ZIP entries do not exactly match the package manifest.",
    );
  }
  const totalManifestBytes = manifest.project.byteSize
    + manifest.blobs.reduce((total, entry) => total + entry.byteSize, 0)
    + manifestBytes.byteLength;
  if (totalManifestBytes > maxUncompressedBytes) {
    throw packageError(
      "SPRITEBOY_PACKAGE_LIMIT_EXCEEDED",
      "import",
      `Manifest content exceeds the ${maxUncompressedBytes}-byte uncompressed limit.`,
    );
  }

  const projectBytes = await readZipEntry(zip.file(PROJECT_PATH) ?? undefined, PROJECT_PATH, options.signal);
  if (projectBytes.byteLength !== manifest.project.byteSize) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
      "import",
      "project.json byte size does not match the manifest.",
      { path: PROJECT_PATH },
    );
  }
  const projectIdentity = await computeIdentity(
    new Blob([ownedArrayBuffer(projectBytes)], { type: "application/json" }),
    "import",
    options.signal,
  );
  if (projectIdentity.contentHash !== manifest.project.sha256) {
    throw packageError(
      "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
      "import",
      "project.json SHA-256 does not match the manifest.",
      { path: PROJECT_PATH },
    );
  }
  let project: StudioProjectV1;
  try {
    project = projectCodec.decode(decodeUtf8(projectBytes, PROJECT_PATH));
  } catch (cause) {
    if (isSpriteBoyPackageError(cause)) throw cause;
    throw packageError(
      "SPRITEBOY_PACKAGE_PROJECT_INVALID",
      "import",
      "project.json is not a valid supported Studio project.",
      { path: PROJECT_PATH, cause },
    );
  }
  assertManifestMatchesProject(manifest, project);

  const importedBlobs: ImportedSpriteBoyBlob[] = [];
  for (const entry of manifest.blobs) {
    throwIfAborted(options.signal, "import");
    const entryBytes = await readZipEntry(zip.file(entry.path) ?? undefined, entry.path, options.signal);
    if (entryBytes.byteLength !== entry.byteSize) {
      throw packageError(
        "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        "import",
        `Blob ${entry.blobKey} byte size does not match the manifest.`,
        { path: entry.path },
      );
    }
    const blob = new Blob([ownedArrayBuffer(entryBytes)], { type: entry.mimeType });
    const identity = await computeIdentity(blob, "import", options.signal, entry.assetIds[0]);
    if (
      identity.contentHash !== entry.contentHash
      || identity.blobKey !== entry.blobKey
      || identity.byteSize !== entry.byteSize
    ) {
      throw packageError(
        "SPRITEBOY_PACKAGE_INTEGRITY_MISMATCH",
        "import",
        `Blob ${entry.blobKey} SHA-256 does not match the manifest.`,
        { path: entry.path },
      );
    }
    importedBlobs.push(Object.freeze({ ...entry, blob }));
  }
  throwIfAborted(options.signal, "import");
  return Object.freeze({
    project,
    manifest,
    blobs: Object.freeze(importedBlobs),
  });
}
