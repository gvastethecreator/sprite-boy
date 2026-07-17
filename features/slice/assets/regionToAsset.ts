import {
  computeAssetContentIdentity,
  isAssetRepositoryError,
  withAssetRepositoryMutation,
  type AssetContentIdentity,
  type AssetMetadata,
  type AssetRepository,
} from "../../../core/assets";
import {
  isEntityId,
  isISO8601Timestamp,
  type AssetRecord,
  type Rect,
  type StudioProjectV1,
} from "../../../core/project";
import { cloneDataOnly } from "../../../core/project/dataBoundary";
import { validateStudioProject } from "../../../core/project/validation";
import type { ProjectStore } from "../../../core/stores";
import type { RegionCropPort, RegionCropRequest } from "./browserRegionCrop";

const NOTE_PREFIX = "sprite-boy.region-to-asset/v2:";
const HASH = /^[0-9a-f]{64}$/u;
const ASSET_OPERATION_QUEUES = new Map<string, Promise<void>>();

async function withAssetOperationQueue<T>(assetId: string, work: () => Promise<T>): Promise<T> {
  const previous = ASSET_OPERATION_QUEUES.get(assetId) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => turn);
  ASSET_OPERATION_QUEUES.set(assetId, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (ASSET_OPERATION_QUEUES.get(assetId) === tail) ASSET_OPERATION_QUEUES.delete(assetId);
  }
}

export interface RegionGridGeometryV1 {
  readonly marginX: number;
  readonly marginY: number;
  readonly gapX: number;
  readonly gapY: number;
}

export interface RegionAssetProvenanceNoteV2 {
  readonly kind: "region-to-asset";
  readonly version: 2;
  readonly sourceAssetId: string;
  readonly sourceContentHash: string;
  readonly sourceRegionId: string;
  readonly sourceBounds: Readonly<Rect>;
  readonly grid: Readonly<RegionGridGeometryV1>;
}

export interface ConvertRegionToAssetRequest {
  readonly regionId: string;
  readonly name: string;
  readonly timestamp: string;
  readonly grid: Readonly<RegionGridGeometryV1>;
}

export interface RegionToAssetOptions {
  readonly signal?: AbortSignal;
}

export interface RegionToAssetResult {
  readonly asset: Readonly<AssetRecord>;
  readonly reused: boolean;
  readonly initialRevision: number;
  readonly committedRevision: number;
}

export interface RegionToAssetCleanupDebt {
  readonly kind: "region-to-asset-cleanup";
  readonly orphanAssetId: string;
  readonly expectedContentHash: string;
  readonly expectedRecordFingerprint: string;
  readonly createdByAttempt: true;
  readonly graphOwnership: "absent";
  readonly retryable: true;
}

export interface RegionToAssetOwnershipDebt {
  readonly kind: "region-to-asset-ownership-uncertain";
  readonly assetId: string;
  readonly expectedContentHash: string;
  readonly expectedRecordFingerprint: string;
  readonly createdByAttempt: true;
  readonly graphOwnership: "unknown";
  readonly retryable: true;
}

export const REGION_TO_ASSET_ERROR_CODES = [
  "INVALID_INPUT",
  "REGION_NOT_FOUND",
  "SOURCE_ASSET_NOT_FOUND",
  "SOURCE_BLOB_FAILED",
  "SOURCE_INTEGRITY_MISMATCH",
  "CROP_FAILED",
  "OUTPUT_IDENTITY_FAILED",
  "OUTPUT_ASSET_CONFLICT",
  "DESTINATION_PREFLIGHT_FAILED",
  "CANCELLED",
  "STALE_PROJECT",
  "REPOSITORY_PUT_FAILED",
  "PROJECT_DISPATCH_FAILED",
  "OWNERSHIP_UNCERTAIN",
  "CLEANUP_DEBT",
] as const;

export type RegionToAssetErrorCode = (typeof REGION_TO_ASSET_ERROR_CODES)[number];

export class RegionToAssetError extends Error {
  readonly code: RegionToAssetErrorCode;
  readonly cleanupDebt?: RegionToAssetCleanupDebt;
  readonly ownershipDebt?: RegionToAssetOwnershipDebt;

  constructor(
    code: RegionToAssetErrorCode,
    message: string,
    debts: { cleanupDebt?: RegionToAssetCleanupDebt; ownershipDebt?: RegionToAssetOwnershipDebt } = {},
  ) {
    super(message);
    this.name = "RegionToAssetError";
    this.code = code;
    this.cleanupDebt = debts.cleanupDebt;
    this.ownershipDebt = debts.ownershipDebt;
  }
}

export interface RegionToAssetDependencies {
  readonly store: ProjectStore;
  readonly repository: AssetRepository;
  readonly cropper: RegionCropPort;
}

interface PreparedRequest {
  readonly regionId: string;
  readonly name: string;
  readonly timestamp: string;
  readonly grid: Readonly<RegionGridGeometryV1>;
}

interface Ports {
  readonly repository: AssetRepository;
  readonly projectId: string;
  readonly getSnapshot: () => unknown;
  readonly dispatch: (envelope: unknown) => unknown;
  readonly getMetadata: (assetId: string, options?: unknown) => Promise<unknown>;
  readonly getBlob: (assetId: string, options?: unknown) => Promise<unknown>;
  readonly put: (blob: Blob, metadata: AssetMetadata, options?: unknown) => Promise<unknown>;
  readonly remove: (assetId: string, policy: "release-and-remove", options?: unknown) => Promise<unknown>;
  readonly crop: (blob: Blob, request: RegionCropRequest) => Promise<unknown>;
}

interface Snapshot {
  readonly project: StudioProjectV1;
  readonly revision: number;
}

type Ownership =
  | { readonly kind: "exact"; readonly revision: number; readonly asset: AssetRecord }
  | { readonly kind: "absent"; readonly revision: number }
  | { readonly kind: "conflict"; readonly revision: number }
  | { readonly kind: "unknown" };

function fail(code: RegionToAssetErrorCode, message: string): never {
  throw new RegionToAssetError(code, message);
}

function dataProperty(value: unknown, key: PropertyKey): { ok: true; value: unknown } | { ok: false } {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return { ok: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor
      ? { ok: true, value: descriptor.value }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function callable(value: unknown, key: PropertyKey): ((...args: unknown[]) => unknown) | null {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  try {
    let target: object | null = value;
    while (target) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") return null;
        const method = descriptor.value;
        return (...args: unknown[]) => Reflect.apply(method, value, args);
      }
      target = Object.getPrototypeOf(target) as object | null;
    }
  } catch {
    return null;
  }
  return null;
}

function preparePorts(value: unknown): Ports {
  const storeValue = dataProperty(value, "store");
  const repositoryValue = dataProperty(value, "repository");
  const cropperValue = dataProperty(value, "cropper");
  if (!storeValue.ok || !repositoryValue.ok || !cropperValue.ok) {
    fail("INVALID_INPUT", "Region-to-Asset dependencies are invalid.");
  }
  const projectIdValue = dataProperty(repositoryValue.value, "projectId");
  const getSnapshot = callable(storeValue.value, "getSnapshot");
  const dispatch = callable(storeValue.value, "dispatch");
  const getMetadata = callable(repositoryValue.value, "getMetadata");
  const getBlob = callable(repositoryValue.value, "getBlob");
  const put = callable(repositoryValue.value, "put");
  const remove = callable(repositoryValue.value, "remove");
  const crop = callable(cropperValue.value, "crop");
  if (!projectIdValue.ok || !isEntityId(projectIdValue.value) || !getSnapshot || !dispatch
    || !getMetadata || !getBlob || !put || !remove || !crop) {
    fail("INVALID_INPUT", "Region-to-Asset dependencies are invalid.");
  }
  return Object.freeze({
    repository: repositoryValue.value as AssetRepository,
    projectId: projectIdValue.value,
    getSnapshot: () => getSnapshot(),
    dispatch: (envelope: unknown) => dispatch(envelope),
    getMetadata: (assetId: string, options?: unknown) => Promise.resolve(getMetadata(assetId, options)),
    getBlob: (assetId: string, options?: unknown) => Promise.resolve(getBlob(assetId, options)),
    put: (blob: Blob, metadata: AssetMetadata, options?: unknown) => Promise.resolve(put(blob, metadata, options)),
    remove: (assetId: string, policy: "release-and-remove", options?: unknown) => Promise.resolve(remove(assetId, policy, options)),
    crop: (blob: Blob, request: RegionCropRequest) => Promise.resolve(crop(blob, request)),
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length
      && ownKeys.every((key) => typeof key === "string" && keys.includes(key));
  } catch {
    return false;
  }
}

function readRequest(value: unknown): PreparedRequest {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || cloned.value === null || typeof cloned.value !== "object" || Array.isArray(cloned.value)) {
    fail("INVALID_INPUT", "Region-to-Asset request must be a data-only record.");
  }
  const request = cloned.value as Record<string, unknown>;
  if (!exactKeys(request, ["regionId", "name", "timestamp", "grid"])
    || !isEntityId(request.regionId) || typeof request.name !== "string"
    || request.name.trim().length === 0 || !isISO8601Timestamp(request.timestamp)) {
    fail("INVALID_INPUT", "Region-to-Asset request shape is invalid.");
  }
  if (request.grid === null || typeof request.grid !== "object" || Array.isArray(request.grid)) {
    fail("INVALID_INPUT", "Region-to-Asset grid geometry is invalid.");
  }
  const grid = request.grid as Record<string, unknown>;
  const gridKeys = ["marginX", "marginY", "gapX", "gapY"] as const;
  if (!exactKeys(grid, gridKeys)
    || gridKeys.some((key) => !Number.isSafeInteger(grid[key]) || (grid[key] as number) < 0)) {
    fail("INVALID_INPUT", "Region-to-Asset margins and gaps are invalid.");
  }
  return Object.freeze({
    regionId: request.regionId,
    name: request.name.trim(),
    timestamp: request.timestamp,
    grid: Object.freeze({
      marginX: grid.marginX as number,
      marginY: grid.marginY as number,
      gapX: grid.gapX as number,
      gapY: grid.gapY as number,
    }),
  });
}

function trySnapshot(ports: Pick<Ports, "getSnapshot">): Snapshot | null {
  try {
    const snapshot = ports.getSnapshot();
    const revision = dataProperty(snapshot, "revision");
    const project = dataProperty(snapshot, "project");
    if (!revision.ok || !Number.isSafeInteger(revision.value) || (revision.value as number) < 0 || !project.ok) return null;
    const cloned = cloneDataOnly(project.value);
    if (!cloned.ok) return null;
    const validation = validateStudioProject(cloned.value);
    if (!validation.valid) return null;
    return Object.freeze({ project: cloned.value as StudioProjectV1, revision: revision.value as number });
  } catch {
    return null;
  }
}

function requiredSnapshot(ports: Pick<Ports, "getSnapshot">): Snapshot {
  const snapshot = trySnapshot(ports);
  if (!snapshot) fail("INVALID_INPUT", "ProjectStore snapshot is unavailable or invalid.");
  return snapshot;
}

function own<T>(record: Record<string, T>, id: string): T | undefined {
  const property = dataProperty(record, id);
  return property.ok ? property.value as T : undefined;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  try {
    return signal.aborted === true;
  } catch {
    return true;
  }
}

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
}

function stableNote(note: RegionAssetProvenanceNoteV2): string {
  return `${NOTE_PREFIX}${JSON.stringify(note)}`;
}

export function parseRegionAssetProvenanceNote(value: unknown): RegionAssetProvenanceNoteV2 | null {
  if (typeof value !== "string" || !value.startsWith(NOTE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(NOTE_PREFIX.length)) as unknown;
    const cloned = cloneDataOnly(parsed);
    if (!cloned.ok || cloned.value === null || typeof cloned.value !== "object" || Array.isArray(cloned.value)) return null;
    const note = cloned.value as Record<string, unknown>;
    if (!exactKeys(note, ["kind", "version", "sourceAssetId", "sourceContentHash", "sourceRegionId", "sourceBounds", "grid"])
      || note.kind !== "region-to-asset" || note.version !== 2
      || !isEntityId(note.sourceAssetId) || !HASH.test(String(note.sourceContentHash)) || !isEntityId(note.sourceRegionId)
      || note.sourceBounds === null || typeof note.sourceBounds !== "object" || Array.isArray(note.sourceBounds)
      || note.grid === null || typeof note.grid !== "object" || Array.isArray(note.grid)) return null;
    const bounds = note.sourceBounds as Record<string, unknown>;
    const grid = note.grid as Record<string, unknown>;
    if (!exactKeys(bounds, ["x", "y", "width", "height"])
      || !exactKeys(grid, ["marginX", "marginY", "gapX", "gapY"])
      || ![bounds.x, bounds.y].every((entry) => Number.isSafeInteger(entry) && (entry as number) >= 0)
      || ![bounds.width, bounds.height].every((entry) => Number.isSafeInteger(entry) && (entry as number) > 0)
      || ![grid.marginX, grid.marginY, grid.gapX, grid.gapY].every((entry) => Number.isSafeInteger(entry) && (entry as number) >= 0)) return null;
    return Object.freeze({
      kind: "region-to-asset",
      version: 2,
      sourceAssetId: note.sourceAssetId,
      sourceContentHash: note.sourceContentHash as string,
      sourceRegionId: note.sourceRegionId,
      sourceBounds: Object.freeze({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }) as Readonly<Rect>,
      grid: Object.freeze({ marginX: grid.marginX, marginY: grid.marginY, gapX: grid.gapX, gapY: grid.gapY }) as Readonly<RegionGridGeometryV1>,
    });
  } catch {
    return null;
  }
}

function sameProvenance(actual: AssetRecord["provenance"], expected: AssetRecord["provenance"]): boolean {
  return actual.source === expected.source && actual.sourceId === expected.sourceId
    && actual.importedAt === expected.importedAt && actual.note === expected.note
    && actual.parentAssetId === expected.parentAssetId
    && actual.recipeId === expected.recipeId && actual.artifactId === expected.artifactId;
}

function sameAsset(actual: Readonly<AssetRecord>, expected: Readonly<AssetRecord>): boolean {
  return actual.id === expected.id && actual.name === expected.name
    && actual.blobKey === expected.blobKey && actual.contentHash === expected.contentHash
    && actual.mimeType === expected.mimeType && actual.width === expected.width
    && actual.height === expected.height && actual.byteSize === expected.byteSize
    && actual.createdAt === expected.createdAt && actual.updatedAt === expected.updatedAt
    && sameProvenance(actual.provenance, expected.provenance);
}

function readExactAsset(value: unknown, expected: Readonly<AssetRecord>): AssetRecord | null {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || cloned.value === null || typeof cloned.value !== "object" || Array.isArray(cloned.value)) return null;
  const record = cloned.value as Record<string, unknown>;
  if (!exactKeys(record, ["id", "name", "blobKey", "contentHash", "mimeType", "width", "height", "byteSize", "createdAt", "updatedAt", "provenance"])) return null;
  if (record.provenance === null || typeof record.provenance !== "object" || Array.isArray(record.provenance)) return null;
  const provenance = record.provenance as Record<string, unknown>;
  if (!exactKeys(provenance, ["source", "sourceId", "importedAt", "parentAssetId", "note"])) return null;
  const asset = record as unknown as AssetRecord;
  return sameAsset(asset, expected) && parseRegionAssetProvenanceNote(asset.provenance.note) !== null ? asset : null;
}

function readAssetRecord(value: unknown): AssetRecord | null {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || cloned.value === null || typeof cloned.value !== "object" || Array.isArray(cloned.value)) return null;
  const record = cloned.value as Record<string, unknown>;
  if (!exactKeys(record, ["id", "name", "blobKey", "contentHash", "mimeType", "width", "height", "byteSize", "createdAt", "updatedAt", "provenance"])
    || !isEntityId(record.id) || typeof record.name !== "string" || typeof record.blobKey !== "string"
    || !HASH.test(String(record.contentHash)) || typeof record.mimeType !== "string"
    || !Number.isSafeInteger(record.width) || (record.width as number) < 1
    || !Number.isSafeInteger(record.height) || (record.height as number) < 1
    || !Number.isSafeInteger(record.byteSize) || (record.byteSize as number) < 1
    || !isISO8601Timestamp(record.createdAt) || !isISO8601Timestamp(record.updatedAt)
    || record.provenance === null || typeof record.provenance !== "object" || Array.isArray(record.provenance)) return null;
  return record as unknown as AssetRecord;
}

async function blobIdentity(value: unknown, signal?: AbortSignal): Promise<AssetContentIdentity | null> {
  try {
    if (!(value instanceof Blob)) return null;
    return await computeAssetContentIdentity(value, { signal });
  } catch {
    return null;
  }
}

function matchesBlob(record: Readonly<AssetRecord>, blob: Blob, identity: AssetContentIdentity): boolean {
  return record.blobKey === identity.blobKey && record.contentHash === identity.contentHash
    && record.byteSize === identity.byteSize && record.byteSize === blob.size
    && record.mimeType === blob.type;
}

function repositoryNotFound(error: unknown): boolean {
  if (!isAssetRepositoryError(error)) return false;
  try {
    return error.code === "ASSET_NOT_FOUND" || error.code === "ASSET_BLOB_MISSING";
  } catch {
    return false;
  }
}

function readSignal(value: unknown): AbortSignal | undefined {
  const signal = dataProperty(value, "signal");
  if (!signal.ok) return undefined;
  if (signal.value === undefined) return undefined;
  if (signal.value === null || typeof signal.value !== "object") {
    fail("INVALID_INPUT", "Region-to-Asset cancellation options are invalid.");
  }
  return signal.value as AbortSignal;
}

async function inspectDestination(
  ports: Ports,
  expected: Readonly<AssetRecord>,
  signal?: AbortSignal,
): Promise<{ kind: "absent" } | { kind: "exact"; record: AssetRecord }> {
  let rawMetadata: unknown;
  try {
    rawMetadata = await ports.getMetadata(expected.id, signal ? { signal } : undefined);
  } catch (error) {
    if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
    if (repositoryNotFound(error)) {
      try {
        await ports.getBlob(expected.id, signal ? { signal } : undefined);
      } catch (blobError) {
        if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
        if (repositoryNotFound(blobError)) return { kind: "absent" };
        fail("DESTINATION_PREFLIGHT_FAILED", "Destination Blob preflight failed.");
      }
      fail("OUTPUT_ASSET_CONFLICT", "Destination Blob exists without exact metadata.");
    }
    fail("DESTINATION_PREFLIGHT_FAILED", "Destination Asset preflight failed.");
  }
  const record = readExactAsset(rawMetadata, expected);
  if (!record) fail("OUTPUT_ASSET_CONFLICT", "Destination Asset metadata conflicts with expected identity.");
  let rawBlob: unknown;
  try {
    rawBlob = await ports.getBlob(expected.id, signal ? { signal } : undefined);
  } catch {
    if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
    fail("OUTPUT_ASSET_CONFLICT", "Destination Asset Blob is unavailable.");
  }
  const identity = await blobIdentity(rawBlob, signal);
  if (!(rawBlob instanceof Blob) || !identity || !matchesBlob(record, rawBlob, identity)
    || identity.contentHash !== expected.contentHash) {
    fail("OUTPUT_ASSET_CONFLICT", "Destination Asset Blob conflicts with expected identity.");
  }
  return { kind: "exact", record };
}

function ownership(ports: Ports, expected: Readonly<AssetRecord>): Ownership {
  const snapshot = trySnapshot(ports);
  if (!snapshot) return { kind: "unknown" };
  const visible = own(snapshot.project.assets, expected.id);
  if (!visible) return { kind: "absent", revision: snapshot.revision };
  return sameAsset(visible, expected)
    ? { kind: "exact", revision: snapshot.revision, asset: visible }
    : { kind: "conflict", revision: snapshot.revision };
}

async function assetRecordFingerprint(record: Readonly<AssetRecord>): Promise<string> {
  const payload = JSON.stringify({
    version: 1,
    id: record.id,
    name: record.name,
    blobKey: record.blobKey,
    contentHash: record.contentHash,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    byteSize: record.byteSize,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    provenance: {
      source: record.provenance.source,
      sourceId: record.provenance.sourceId ?? null,
      importedAt: record.provenance.importedAt ?? null,
      note: record.provenance.note ?? null,
      recipeId: record.provenance.recipeId ?? null,
      artifactId: record.provenance.artifactId ?? null,
      parentAssetId: record.provenance.parentAssetId ?? null,
    },
  });
  return (await computeAssetContentIdentity(new Blob([payload], { type: "application/json" }))).contentHash;
}

function cleanupDebt(
  expected: Readonly<AssetRecord>,
  expectedRecordFingerprint: string,
): RegionToAssetCleanupDebt {
  return Object.freeze({
    kind: "region-to-asset-cleanup",
    orphanAssetId: expected.id,
    expectedContentHash: expected.contentHash,
    expectedRecordFingerprint,
    createdByAttempt: true,
    graphOwnership: "absent",
    retryable: true,
  });
}

function ownershipDebt(
  expected: Readonly<AssetRecord>,
  expectedRecordFingerprint: string,
): RegionToAssetOwnershipDebt {
  return Object.freeze({
    kind: "region-to-asset-ownership-uncertain",
    assetId: expected.id,
    expectedContentHash: expected.contentHash,
    expectedRecordFingerprint,
    createdByAttempt: true,
    graphOwnership: "unknown",
    retryable: true,
  });
}

async function reconcileFailure(
  ports: Ports,
  expected: Readonly<AssetRecord>,
  expectedRecordFingerprint: string,
  initialRevision: number,
  createdByAttempt: boolean,
  code: RegionToAssetErrorCode,
  message: string,
  allowOwnedSuccess: boolean,
): Promise<RegionToAssetResult> {
  const graph = ownership(ports, expected);
  if (graph.kind === "exact") {
    if (allowOwnedSuccess) {
      return Object.freeze({ asset: graph.asset, reused: !createdByAttempt, initialRevision, committedRevision: graph.revision });
    }
    throw new RegionToAssetError(code, message);
  }
  if (graph.kind === "conflict") {
    throw new RegionToAssetError("OUTPUT_ASSET_CONFLICT", "Project graph owns a conflicting destination Asset.");
  }
  if (graph.kind === "unknown") {
    throw new RegionToAssetError(
      "OWNERSHIP_UNCERTAIN",
      "Project ownership could not be reconciled; binary storage was preserved.",
      createdByAttempt ? { ownershipDebt: ownershipDebt(expected, expectedRecordFingerprint) } : {},
    );
  }
  if (!createdByAttempt) throw new RegionToAssetError(code, message);
  throw new RegionToAssetError(
    "CLEANUP_DEBT",
    "Graph is absent; conditional cleanup is required for the attempt-owned binary.",
    { cleanupDebt: cleanupDebt(expected, expectedRecordFingerprint) },
  );
}

function readCleanupDebt(value: unknown): RegionToAssetCleanupDebt {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || cloned.value === null || typeof cloned.value !== "object" || Array.isArray(cloned.value)) {
    fail("INVALID_INPUT", "Region-to-Asset cleanup debt is invalid.");
  }
  const debt = cloned.value as Record<string, unknown>;
  if (!exactKeys(debt, ["kind", "orphanAssetId", "expectedContentHash", "expectedRecordFingerprint", "createdByAttempt", "graphOwnership", "retryable"])
    || debt.kind !== "region-to-asset-cleanup" || !isEntityId(debt.orphanAssetId)
    || !HASH.test(String(debt.expectedContentHash)) || !HASH.test(String(debt.expectedRecordFingerprint))
    || debt.createdByAttempt !== true
    || debt.graphOwnership !== "absent" || debt.retryable !== true) {
    fail("INVALID_INPUT", "Region-to-Asset cleanup debt is invalid.");
  }
  return debt as unknown as RegionToAssetCleanupDebt;
}

export async function retryRegionToAssetCleanup(
  dependencies: Pick<RegionToAssetDependencies, "store" | "repository">,
  debtValue: RegionToAssetCleanupDebt,
): Promise<void> {
  const debt = readCleanupDebt(debtValue);
  const store = dataProperty(dependencies, "store");
  const repository = dataProperty(dependencies, "repository");
  if (!store.ok || !repository.ok) fail("INVALID_INPUT", "Region-to-Asset cleanup dependencies are invalid.");
  const ports = preparePorts({
    store: store.value,
    repository: repository.value,
    cropper: { crop: async () => new Blob() },
  });
  return withAssetOperationQueue(debt.orphanAssetId, () => conditionalCleanup(ports, debt));
}

type CleanupStorage =
  | { readonly kind: "absent" }
  | { readonly kind: "exact"; readonly record: AssetRecord; readonly blob: Blob };

async function inspectCleanupStorage(ports: Ports, debt: RegionToAssetCleanupDebt): Promise<CleanupStorage> {
  let rawRecord: unknown;
  try {
    rawRecord = await ports.getMetadata(debt.orphanAssetId);
  } catch (error) {
    if (!repositoryNotFound(error)) {
      throw new RegionToAssetError("CLEANUP_DEBT", "Cleanup metadata is unavailable; binary storage was preserved.", { cleanupDebt: debt });
    }
    try {
      await ports.getBlob(debt.orphanAssetId);
    } catch (blobError) {
      if (repositoryNotFound(blobError)) return { kind: "absent" };
      throw new RegionToAssetError("CLEANUP_DEBT", "Cleanup Blob state is unavailable; binary storage was preserved.", { cleanupDebt: debt });
    }
    throw new RegionToAssetError("CLEANUP_DEBT", "Cleanup Blob exists without exact metadata; binary storage was preserved.", { cleanupDebt: debt });
  }
  const record = readAssetRecord(rawRecord);
  if (!record || record.id !== debt.orphanAssetId || record.contentHash !== debt.expectedContentHash
    || await assetRecordFingerprint(record) !== debt.expectedRecordFingerprint) {
    throw new RegionToAssetError("OUTPUT_ASSET_CONFLICT", "Cleanup target identity changed; binary storage was preserved.");
  }
  let rawBlob: unknown;
  try {
    rawBlob = await ports.getBlob(debt.orphanAssetId);
  } catch {
    throw new RegionToAssetError("CLEANUP_DEBT", "Cleanup Blob is unavailable; binary storage was preserved.", { cleanupDebt: debt });
  }
  const identity = await blobIdentity(rawBlob);
  if (!(rawBlob instanceof Blob) || !identity || !matchesBlob(record, rawBlob, identity)) {
    throw new RegionToAssetError("OUTPUT_ASSET_CONFLICT", "Cleanup Blob identity changed; binary storage was preserved.");
  }
  return { kind: "exact", record, blob: rawBlob };
}

async function cleanupGraphState(
  ports: Ports,
  debt: RegionToAssetCleanupDebt,
): Promise<"absent" | "exact" | "conflict" | "unknown"> {
  const snapshot = trySnapshot(ports);
  if (!snapshot) return "unknown";
  const visible = own(snapshot.project.assets, debt.orphanAssetId);
  if (!visible) return "absent";
  if (visible.contentHash !== debt.expectedContentHash
    || await assetRecordFingerprint(visible) !== debt.expectedRecordFingerprint) return "conflict";
  return "exact";
}

function restoreMetadata(record: Readonly<AssetRecord>): AssetMetadata {
  return Object.freeze({
    id: record.id,
    name: record.name,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    provenance: Object.freeze({ ...record.provenance }),
    declaredMimeType: record.mimeType,
    expectedContentHash: record.contentHash,
  });
}

async function restoreCleanupStorage(
  ports: Ports,
  debt: RegionToAssetCleanupDebt,
  record: AssetRecord,
  blob: Blob,
): Promise<void> {
  try {
    const restored = await ports.put(blob, restoreMetadata(record));
    if (readExactAsset(restored, record)) return;
  } catch {
    // Exact destination inspection below is authoritative.
  }
  try {
    const destination = await inspectDestination(ports, record);
    if (destination.kind === "exact") return;
  } catch {
    // Stable uncertainty below never leaks adapter payloads.
  }
  throw new RegionToAssetError(
    "OWNERSHIP_UNCERTAIN",
    "Graph ownership may require the removed binary; restore could not be confirmed.",
    { ownershipDebt: ownershipDebt(record, debt.expectedRecordFingerprint) },
  );
}

async function conditionalCleanup(ports: Ports, debt: RegionToAssetCleanupDebt): Promise<void> {
  const initialGraph = await cleanupGraphState(ports, debt);
  if (initialGraph === "exact") return;
  if (initialGraph === "conflict") throw new RegionToAssetError("OUTPUT_ASSET_CONFLICT", "Project graph owns a changed destination Asset.");
  if (initialGraph === "unknown") {
    throw new RegionToAssetError("OWNERSHIP_UNCERTAIN", "Project ownership is unavailable; binary storage was preserved.");
  }
  const first = await inspectCleanupStorage(ports, debt);
  if (first.kind === "absent") return;
  const finalStorage = await inspectCleanupStorage(ports, debt);
  if (finalStorage.kind === "absent") return;
  const beforeRemove = await cleanupGraphState(ports, debt);
  if (beforeRemove === "exact") return;
  if (beforeRemove === "conflict") throw new RegionToAssetError("OUTPUT_ASSET_CONFLICT", "Project graph acquired a changed destination Asset.");
  if (beforeRemove === "unknown") {
    throw new RegionToAssetError("OWNERSHIP_UNCERTAIN", "Project ownership changed during cleanup preflight; binary storage was preserved.");
  }
  let removeFailed = false;
  try {
    await ports.remove(debt.orphanAssetId, "release-and-remove");
  } catch (error) {
    removeFailed = !repositoryNotFound(error);
  }
  const afterRemove = await cleanupGraphState(ports, debt);
  if (afterRemove === "absent") {
    if (!removeFailed) return;
    const remaining = await inspectCleanupStorage(ports, debt);
    if (remaining.kind === "absent") return;
    throw new RegionToAssetError("CLEANUP_DEBT", "Conditional cleanup still requires retry.", { cleanupDebt: debt });
  }
  if (afterRemove === "conflict") {
    throw new RegionToAssetError("OWNERSHIP_UNCERTAIN", "A changed graph Asset appeared during cleanup; storage state is uncertain.");
  }
  await restoreCleanupStorage(ports, debt, finalStorage.record, finalStorage.blob);
  if (afterRemove === "unknown") {
    throw new RegionToAssetError(
      "OWNERSHIP_UNCERTAIN",
      "Graph ownership is uncertain after cleanup; exact binary storage was restored.",
      { ownershipDebt: ownershipDebt(finalStorage.record, debt.expectedRecordFingerprint) },
    );
  }
}

async function convertRegionToAssetUnlocked(
  dependencies: RegionToAssetDependencies,
  requestValue: unknown,
  options: RegionToAssetOptions = {},
): Promise<RegionToAssetResult> {
  const request = readRequest(requestValue);
  const ports = preparePorts(dependencies);
  const signal = readSignal(options);
  abortIfNeeded(signal);
  const initial = requiredSnapshot(ports);
  if (ports.projectId !== initial.project.id) fail("INVALID_INPUT", "AssetRepository project does not match ProjectStore.");
  const region = own(initial.project.regions, request.regionId);
  if (!region) fail("REGION_NOT_FOUND", "Canonical Region was not found.");
  const source = own(initial.project.assets, region.assetId);
  if (!source) fail("SOURCE_ASSET_NOT_FOUND", "Canonical source Asset was not found.");
  if (region.bounds.x > source.width - region.bounds.width || region.bounds.y > source.height - region.bounds.height) {
    fail("INVALID_INPUT", "Canonical Region bounds exceed the source Asset.");
  }

  let rawSourceBlob: unknown;
  try {
    rawSourceBlob = await ports.getBlob(source.id, signal ? { signal } : undefined);
  } catch {
    if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
    fail("SOURCE_BLOB_FAILED", "Canonical source Asset bytes are unavailable.");
  }
  const sourceIdentity = await blobIdentity(rawSourceBlob, signal);
  if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
  if (!(rawSourceBlob instanceof Blob) || !sourceIdentity || !matchesBlob(source, rawSourceBlob, sourceIdentity)) {
    fail("SOURCE_INTEGRITY_MISMATCH", "Canonical source Asset bytes do not match project metadata.");
  }

  let rawCrop: unknown;
  try {
    rawCrop = await ports.crop(rawSourceBlob, {
      bounds: region.bounds,
      sourceWidth: source.width,
      sourceHeight: source.height,
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
    fail("CROP_FAILED", "Region-to-Asset pixel crop failed.");
  }
  abortIfNeeded(signal);
  if (!(rawCrop instanceof Blob) || rawCrop.size < 1 || rawCrop.type !== "image/png") {
    fail("CROP_FAILED", "Region-to-Asset crop must produce a non-empty PNG Blob.");
  }
  const outputIdentity = await blobIdentity(rawCrop, signal);
  if (!outputIdentity) {
    if (isAborted(signal)) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
    fail("OUTPUT_IDENTITY_FAILED", "Region-to-Asset output identity could not be computed.");
  }
  const assetId = `asset:region:${region.id}:sha256:${outputIdentity.contentHash}`;
  const note: RegionAssetProvenanceNoteV2 = Object.freeze({
    kind: "region-to-asset",
    version: 2,
    sourceAssetId: source.id,
    sourceContentHash: sourceIdentity.contentHash,
    sourceRegionId: region.id,
    sourceBounds: Object.freeze({ ...region.bounds }),
    grid: request.grid,
  });
  const provenance = Object.freeze({
    source: "derived",
    sourceId: region.id,
    importedAt: request.timestamp,
    parentAssetId: source.id,
    note: stableNote(note),
  });
  const metadata: AssetMetadata = Object.freeze({
    id: assetId,
    name: request.name,
    width: region.bounds.width,
    height: region.bounds.height,
    createdAt: request.timestamp,
    updatedAt: request.timestamp,
    provenance,
    declaredMimeType: "image/png",
    expectedContentHash: outputIdentity.contentHash,
  });
  const expected: AssetRecord = Object.freeze({
    id: assetId,
    name: request.name,
    blobKey: outputIdentity.blobKey,
    contentHash: outputIdentity.contentHash,
    mimeType: "image/png",
    width: region.bounds.width,
    height: region.bounds.height,
    byteSize: outputIdentity.byteSize,
    createdAt: request.timestamp,
    updatedAt: request.timestamp,
    provenance,
  });
  const expectedRecordFingerprint = await assetRecordFingerprint(expected);

  return withAssetOperationQueue(assetId, async () => {
  const beforeDestination = requiredSnapshot(ports);
  if (beforeDestination.revision !== initial.revision) fail("STALE_PROJECT", "Project changed before destination preflight.");
  const visible = own(beforeDestination.project.assets, assetId);
  const destination = await inspectDestination(ports, expected, signal);
  if (visible) {
    if (!sameAsset(visible, expected) || destination.kind !== "exact") {
      fail("OUTPUT_ASSET_CONFLICT", "Existing graph Asset conflicts with destination storage.");
    }
    const afterReuse = requiredSnapshot(ports);
    if (afterReuse.revision !== initial.revision) fail("STALE_PROJECT", "Project changed during destination preflight.");
    return Object.freeze({ asset: destination.record, reused: true, initialRevision: initial.revision, committedRevision: initial.revision });
  }

  let stored = destination.kind === "exact" ? destination.record : null;
  const createdByAttempt = destination.kind === "absent";
  if (createdByAttempt) {
    let rawStored: unknown;
    try {
      rawStored = await ports.put(rawCrop, metadata, signal ? { signal } : undefined);
    } catch (error) {
      const errorCode = dataProperty(error, "code");
      const cancelled = isAborted(signal)
        || (isAssetRepositoryError(error) && errorCode.ok && errorCode.value === "ASSET_TRANSACTION_ABORTED");
      let afterRejectedPut: Awaited<ReturnType<typeof inspectDestination>>;
      try {
        afterRejectedPut = await inspectDestination(ports, expected);
      } catch {
        return reconcileFailure(
          ports,
          expected,
          expectedRecordFingerprint,
          initial.revision,
          true,
          cancelled ? "CANCELLED" : "REPOSITORY_PUT_FAILED",
          cancelled ? "Region-to-Asset conversion was cancelled." : "Region-to-Asset binary persistence failed.",
          false,
        );
      }
      if (afterRejectedPut.kind === "exact") {
        return reconcileFailure(
          ports,
          expected,
          expectedRecordFingerprint,
          initial.revision,
          true,
          cancelled ? "CANCELLED" : "REPOSITORY_PUT_FAILED",
          cancelled ? "Region-to-Asset conversion was cancelled." : "Region-to-Asset binary persistence failed.",
          false,
        );
      }
      if (cancelled) fail("CANCELLED", "Region-to-Asset conversion was cancelled.");
      fail("REPOSITORY_PUT_FAILED", "Region-to-Asset binary persistence failed.");
    }
    stored = readExactAsset(rawStored, expected);
    if (!stored) {
      return reconcileFailure(ports, expected, expectedRecordFingerprint, initial.revision, true, "REPOSITORY_PUT_FAILED", "AssetRepository returned invalid destination metadata.", false);
    }
  }

  if (!stored) fail("DESTINATION_PREFLIGHT_FAILED", "Destination Asset state is unavailable.");
  if (isAborted(signal)) {
    return reconcileFailure(ports, expected, expectedRecordFingerprint, initial.revision, createdByAttempt, "CANCELLED", "Region-to-Asset conversion was cancelled.", false);
  }
  const beforeDispatch = trySnapshot(ports);
  if (!beforeDispatch) {
    return reconcileFailure(ports, expected, expectedRecordFingerprint, initial.revision, createdByAttempt, "OWNERSHIP_UNCERTAIN", "Project ownership is unavailable before commit.", false);
  }
  if (beforeDispatch.revision !== initial.revision) {
    return reconcileFailure(ports, expected, expectedRecordFingerprint, initial.revision, createdByAttempt, "STALE_PROJECT", "Project changed before Region-to-Asset commit.", false);
  }

  try {
    ports.dispatch({
      command: { type: "asset.import", asset: stored },
      metadata: {
        commandId: `region-to-asset:${region.id}:${outputIdentity.contentHash}`,
        origin: "user",
        history: "record",
        issuedAt: request.timestamp,
      },
    });
  } catch {
    return reconcileFailure(ports, expected, expectedRecordFingerprint, initial.revision, createdByAttempt, "PROJECT_DISPATCH_FAILED", "Project Asset import failed.", true);
  }
  return reconcileFailure(ports, expected, expectedRecordFingerprint, initial.revision, createdByAttempt, "PROJECT_DISPATCH_FAILED", "Project Asset import was not committed.", true);
  });
}

export function convertRegionToAsset(
  dependencies: RegionToAssetDependencies,
  requestValue: unknown,
  options: RegionToAssetOptions = {},
): Promise<RegionToAssetResult> {
  return withAssetRepositoryMutation(
    dependencies.repository,
    () => convertRegionToAssetUnlocked(dependencies, requestValue, options),
  );
}
