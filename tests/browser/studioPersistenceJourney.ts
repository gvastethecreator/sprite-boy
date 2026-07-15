import {
  computeAssetContentIdentity,
  IndexedDbAssetRepository,
} from "../../core/assets";
import type { AssetIntegrityScan, AssetMetadata } from "../../core/assets";
import type { AssetRecord, StudioProjectV1 } from "../../core/project";
import {
  exportSpriteBoyPackage,
  importSpriteBoyPackage,
  IndexedDbAutosaveStorage,
  migrateLegacyProjectV0,
  ProjectAutosaveJournal,
  projectCodec,
} from "../../core/persistence";
import { validateStudioProject } from "../../core/project";
import {
  legacyProjectV0Ambiguity,
  legacyProjectV0Fixture,
} from "../contract/fixtures/legacyProjectV0";

const STATE_KEY = "sprite-boy:f3-07:persistence-journey";
const PROJECT_ID = "project-f3-07-browser";

interface JourneyState {
  assetDatabaseName: string;
  autosaveDatabaseName: string;
  documentInstanceId: string;
  projectJson: string;
  packageBase64: string;
  packageSha256: string;
  assetHashes: Record<string, string>;
  uniqueBlobCount: number;
  checkpointRevision: number;
  preparePagehideDisposed: boolean;
  importPagehideDisposed: boolean;
  stage: "prepared" | "imported";
}

interface JourneyWindow extends Window {
  __spriteBoyF307DocumentInstanceId?: string;
}

class StudioPersistenceJourneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioPersistenceJourneyError";
  }
}

function createDocumentInstanceId(): string {
  const host = window as JourneyWindow;
  if (host.__spriteBoyF307DocumentInstanceId) return host.__spriteBoyF307DocumentInstanceId;
  const words = crypto.getRandomValues(new Uint32Array(4));
  const value = [...words].map((word) => word.toString(16).padStart(8, "0")).join("");
  Object.defineProperty(host, "__spriteBoyF307DocumentInstanceId", { value });
  return value;
}

const DOCUMENT_INSTANCE_ID = createDocumentInstanceId();

function fail(message: string): never {
  throw new StudioPersistenceJourneyError(message);
}

function redactFailure(error: unknown, stage: string): never {
  if (error instanceof StudioPersistenceJourneyError) throw error;
  fail(`F3-07 ${stage} failed without exposing private storage details.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail("F3-07 browser journey state is invalid.");
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail("F3-07 browser journey state is invalid.");
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("F3-07 browser journey state is invalid.");
  }
  return value as number;
}

function validateDatabaseNames(assetDatabaseName: string, autosaveDatabaseName: string): void {
  if (
    assetDatabaseName.length === 0
    || autosaveDatabaseName.length === 0
    || assetDatabaseName === autosaveDatabaseName
  ) {
    fail("F3-07 requires two distinct non-empty database names.");
  }
}

function readState(): JourneyState {
  const raw = sessionStorage.getItem(STATE_KEY);
  if (!raw) fail("F3-07 browser journey state is missing.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("F3-07 browser journey state is invalid.");
  }
  if (!isRecord(value)) fail("F3-07 browser journey state is invalid.");
  const expectedKeys = [
    "assetDatabaseName",
    "autosaveDatabaseName",
    "documentInstanceId",
    "projectJson",
    "packageBase64",
    "packageSha256",
    "assetHashes",
    "uniqueBlobCount",
    "checkpointRevision",
    "preparePagehideDisposed",
    "importPagehideDisposed",
    "stage",
  ].sort();
  const keys = Object.keys(value).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail("F3-07 browser journey state is invalid.");
  }
  const assetDatabaseName = requireNonEmptyString(value.assetDatabaseName);
  const autosaveDatabaseName = requireNonEmptyString(value.autosaveDatabaseName);
  validateDatabaseNames(assetDatabaseName, autosaveDatabaseName);
  const packageSha256 = requireNonEmptyString(value.packageSha256);
  if (!/^[0-9a-f]{64}$/.test(packageSha256) || !isRecord(value.assetHashes)) {
    fail("F3-07 browser journey state is invalid.");
  }
  const assetHashes = Object.fromEntries(Object.entries(value.assetHashes).map(([assetId, hash]) => {
    if (assetId.length === 0 || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      fail("F3-07 browser journey state is invalid.");
    }
    return [assetId, hash];
  }));
  if (Object.keys(assetHashes).length === 0 || (value.stage !== "prepared" && value.stage !== "imported")) {
    fail("F3-07 browser journey state is invalid.");
  }
  return {
    assetDatabaseName,
    autosaveDatabaseName,
    documentInstanceId: requireNonEmptyString(value.documentInstanceId),
    projectJson: requireNonEmptyString(value.projectJson),
    packageBase64: requireNonEmptyString(value.packageBase64),
    packageSha256,
    assetHashes,
    uniqueBlobCount: requirePositiveInteger(value.uniqueBlobCount),
    checkpointRevision: requirePositiveInteger(value.checkpointRevision),
    preparePagehideDisposed: requireBoolean(value.preparePagehideDisposed),
    importPagehideDisposed: requireBoolean(value.importPagehideDisposed),
    stage: value.stage,
  };
}

function writeState(state: JourneyState): void {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    fail("F3-07 browser journey state could not be stored.");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    fail("F3-07 portable package state is invalid.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deleteDatabase(databaseName: string): Promise<"deleted" | "blocked"> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(databaseName);
    } catch {
      reject(new StudioPersistenceJourneyError("F3-07 database cleanup failed."));
      return;
    }
    request.onsuccess = () => resolve("deleted");
    request.onerror = () => reject(new StudioPersistenceJourneyError("F3-07 database cleanup failed."));
    request.onblocked = () => resolve("blocked");
  });
}

async function cleanDatabases(assetDatabaseName: string, autosaveDatabaseName: string): Promise<void> {
  const [assetResult, autosaveResult] = await Promise.all([
    deleteDatabase(assetDatabaseName),
    deleteDatabase(autosaveDatabaseName),
  ]);
  if (assetResult !== "deleted" || autosaveResult !== "deleted") {
    fail("F3-07 database cleanup was blocked.");
  }
}

async function assertRepositoryExact(
  repository: IndexedDbAssetRepository,
  project: StudioProjectV1,
  integrity: AssetIntegrityScan,
): Promise<Record<string, string>> {
  const expectedIds = Object.keys(project.assets).sort(compareCodeUnit);
  const storedMetadata = [...await repository.list()].sort((left, right) => (
    compareCodeUnit(left.id, right.id)
  ));
  if (
    storedMetadata.length !== expectedIds.length
    || storedMetadata.some((record, index) => (
      record.id !== expectedIds[index]
      || stableJson(record) !== stableJson(project.assets[record.id])
    ))
    || integrity.storageIssues.length !== 0
    || integrity.garbageCollection.candidates.length !== 0
    || integrity.summary.assetCount !== expectedIds.length
    || integrity.summary.okCount !== expectedIds.length
    || integrity.summary.assetIssueCount !== 0
    || integrity.summary.storageIssueCount !== 0
    || integrity.summary.orphanBlobCount !== 0
    || integrity.assets.length !== expectedIds.length
  ) {
    fail("F3-07 durable asset metadata or storage inventory changed.");
  }
  const hashes: Record<string, string> = {};
  const assets = [...integrity.assets].sort((left, right) => (
    compareCodeUnit(left.assetId, right.assetId)
  ));
  for (let index = 0; index < expectedIds.length; index += 1) {
    const expected = project.assets[expectedIds[index]];
    const actual = assets[index];
    if (
      actual.assetId !== expected.id
      || actual.status !== "ok"
      || actual.expectedHash !== expected.contentHash
      || actual.actualHash !== expected.contentHash
      || actual.expectedByteSize !== expected.byteSize
      || actual.actualByteSize !== expected.byteSize
      || actual.expectedMimeType !== expected.mimeType
      || actual.actualMimeType !== expected.mimeType
    ) {
      fail("F3-07 durable asset bytes changed.");
    }
    hashes[actual.assetId] = actual.actualHash;
  }
  return hashes;
}

async function verifyDatabaseCleanup(assetDatabaseName: string, autosaveDatabaseName: string) {
  if (typeof indexedDB.databases !== "function") {
    fail("F3-07 cannot verify database cleanup in this browser.");
  }
  let listedDatabases: IDBDatabaseInfo[];
  try {
    listedDatabases = await indexedDB.databases();
  } catch {
    fail("F3-07 database cleanup verification failed.");
  }
  const remainingTargetNames = listedDatabases.flatMap(({ name }) => (
    name === assetDatabaseName || name === autosaveDatabaseName ? [name] : []
  ));
  const databasesRemain = remainingTargetNames.length > 0;
  if (databasesRemain) fail("F3-07 databases remain after cleanup.");
  return {
    databasesRemain,
    remainingTargetNames,
  };
}

function assetMetadata(record: AssetRecord): AssetMetadata {
  return {
    id: record.id,
    name: record.name,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    provenance: structuredClone(record.provenance),
    declaredMimeType: record.mimeType,
    expectedContentHash: record.contentHash,
  };
}

async function createJourneyProject(
  repository: IndexedDbAssetRepository,
): Promise<{
  project: StudioProjectV1;
  migration: {
    legacyExpiredBlobUrlCount: number;
    legacyPreviewBlockingIssueCount: number;
    legacyMigrationApplied: boolean;
    legacyMigrationIssueCount: number;
  };
}> {
  const sourceCanvas = new OffscreenCanvas(192, 64);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) fail("F3-07 alpha PNG fixture could not be created.");
  const sourcePixels = sourceContext.createImageData(192, 64);
  sourcePixels.data.set([255, 32, 64, 128], 0);
  sourceContext.putImageData(sourcePixels, 0, 0);
  const sharedBlob = await sourceCanvas.convertToBlob({ type: "image/png" });
  const decoded = await createImageBitmap(sharedBlob);
  const verificationCanvas = new OffscreenCanvas(decoded.width, decoded.height);
  const verificationContext = verificationCanvas.getContext("2d", { willReadFrequently: true });
  if (!verificationContext || decoded.width !== 192 || decoded.height !== 64) {
    decoded.close();
    fail("F3-07 alpha PNG fixture dimensions changed.");
  }
  verificationContext.drawImage(decoded, 0, 0);
  decoded.close();
  const decodedPixels = verificationContext.getImageData(0, 0, 2, 1).data;
  if (decodedPixels[3] !== 128 || decodedPixels[7] !== 0) {
    fail("F3-07 alpha PNG fixture lost transparency.");
  }
  const blobIdentity = await computeAssetContentIdentity(sharedBlob);
  const sourceReference = "blob:https://expired.invalid/f3-07-source";
  const builderReference = "blob:https://expired.invalid/f3-07-builder";
  const legacy = structuredClone(legacyProjectV0Fixture) as unknown as {
    project: {
      imageMeta: { src: string; fileSize: number };
      builderAssets: Array<{ src: string; width: number; height: number }>;
    };
  };
  legacy.project.imageMeta.src = sourceReference;
  legacy.project.imageMeta.fileSize = blobIdentity.byteSize;
  legacy.project.builderAssets[0].src = builderReference;
  legacy.project.builderAssets[0].width = 192;
  legacy.project.builderAssets[0].height = 64;
  const migrationBase = {
    projectId: PROJECT_ID,
    projectName: "F3-07 migrated browser persistence journey",
    timestamp: "2026-07-14T12:45:00.000Z",
  };
  const preview = await migrateLegacyProjectV0(legacy, {
    ...migrationBase,
    assetResolutions: {},
  });
  const previewBlockingIssues = preview.report.issues.filter(({ blocking }) => blocking);
  if (
    preview.report.status !== "needs-input" || preview.report.reachedVersion !== 0 ||
    previewBlockingIssues.length !== 3 ||
    previewBlockingIssues.filter(({ code }) => code === "LEGACY_ASSET_NEEDS_RELINK").length !== 2 ||
    previewBlockingIssues.filter(({ code }) => code === "AMBIGUOUS_LEGACY_CEL_SOURCE").length !== 1
  ) {
    fail("F3-07 legacy migration preview did not require relink and ambiguity input.");
  }
  const resolution = (assetId: string) => ({
    assetId,
    contentHash: blobIdentity.contentHash,
    blobKey: `sha256:${blobIdentity.contentHash}`,
    mimeType: sharedBlob.type,
    byteSize: blobIdentity.byteSize,
  });
  const migrated = await migrateLegacyProjectV0(legacy, {
    ...migrationBase,
    assetResolutions: {
      [sourceReference]: resolution("asset-source-sheet"),
      [builderReference]: resolution("asset-builder-piece"),
    },
    celSourceResolutions: {
      [legacyProjectV0Ambiguity.keyframeUid]: { type: "frame", frameId: 0 },
    },
  });
  if (
    migrated.report.status !== "migrated" || migrated.report.reachedVersion !== 1 ||
    migrated.report.appliedSteps.length !== 1 ||
    migrated.report.issues.some(({ blocking }) => blocking)
  ) {
    fail("F3-07 resolved legacy migration did not reach V1.");
  }
  const project = structuredClone(migrated.document as StudioProjectV1);
  const canonicalAsset = Object.values(project.assets)[0];
  if (!canonicalAsset || Object.keys(project.assets).length !== 1) {
    fail("F3-07 legacy content deduplication did not produce one canonical asset.");
  }
  const portableAlias: AssetRecord = {
    ...structuredClone(canonicalAsset),
    id: "asset-portable-dedupe-alias",
    name: "Portable dedupe alias",
    provenance: {
      source: "legacy",
      sourceId: "portable-dedupe-alias",
      importedAt: migrationBase.timestamp,
    },
  };
  project.assets[portableAlias.id] = portableAlias;
  project.rootOrder.assetIds.push(portableAlias.id);
  const validation = validateStudioProject(project);
  if (!validation.valid || validation.diagnostics.length !== 0) {
    fail("F3-07 migrated legacy graph is invalid.");
  }
  for (const record of Object.values(project.assets)) {
    const stored = await repository.put(sharedBlob, assetMetadata(record));
    if (stableJson(stored) !== stableJson(record)) {
      fail("F3-07 migrated asset metadata changed while persisting.");
    }
  }
  return {
    project,
    migration: {
      legacyExpiredBlobUrlCount: 2,
      legacyPreviewBlockingIssueCount: previewBlockingIssues.length,
      legacyMigrationApplied: true,
      legacyMigrationIssueCount: migrated.report.issues.length,
    },
  };
}

function packageSource(repository: IndexedDbAssetRepository) {
  return {
    getBlob(assetId: string, options?: { signal?: AbortSignal }) {
      return repository.getBlob(assetId, options);
    },
  };
}

function openJourneyPersistence(assetDatabaseName: string, autosaveDatabaseName: string) {
  let repository: IndexedDbAssetRepository | undefined;
  let autosaveStorage: IndexedDbAutosaveStorage | undefined;
  try {
    repository = new IndexedDbAssetRepository(PROJECT_ID, { databaseName: assetDatabaseName });
    autosaveStorage = new IndexedDbAutosaveStorage({ databaseName: autosaveDatabaseName });
    return {
      repository,
      autosaveStorage,
      autosave: new ProjectAutosaveJournal(autosaveStorage),
    };
  } catch {
    repository?.dispose();
    autosaveStorage?.close();
    fail("F3-07 durable storage boundaries could not be opened.");
  }
}

function registerPagehideCleanup(
  repository: IndexedDbAssetRepository,
  autosaveStorage: IndexedDbAutosaveStorage,
  stateKey: "preparePagehideDisposed" | "importPagehideDisposed",
): void {
  window.addEventListener("pagehide", (event) => {
    if (!event.isTrusted) return;
    repository.dispose();
    autosaveStorage.close();
    const state = readState();
    state[stateKey] = true;
    writeState(state);
  }, { once: true });
}

/** Stage one: write assets/checkpoint and retain a portable package across a real reload. */
export async function prepareStudioPersistenceJourney(
  assetDatabaseName: string,
  autosaveDatabaseName: string,
) {
  validateDatabaseNames(assetDatabaseName, autosaveDatabaseName);
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    fail("F3-07 browser journey state could not be reset.");
  }
  await cleanDatabases(assetDatabaseName, autosaveDatabaseName);
  const { repository, autosaveStorage, autosave } = openJourneyPersistence(
    assetDatabaseName,
    autosaveDatabaseName,
  );
  let handedToPagehide = false;
  try {
    const { project, migration } = await createJourneyProject(repository);
    const checkpoint = await autosave.checkpoint(project);
    const portable = await exportSpriteBoyPackage(project, packageSource(repository));
    const portableBytes = new Uint8Array(await portable.arrayBuffer());
    const packageIdentity = await computeAssetContentIdentity(portable);
    const uniqueBlobCount = new Set(Object.values(project.assets).map(({ blobKey }) => blobKey)).size;
    if (uniqueBlobCount >= Object.keys(project.assets).length) {
      fail("F3-07 fixture did not exercise package blob deduplication.");
    }
    const state: JourneyState = {
      assetDatabaseName,
      autosaveDatabaseName,
      documentInstanceId: DOCUMENT_INSTANCE_ID,
      projectJson: projectCodec.encode(project),
      packageBase64: bytesToBase64(portableBytes),
      packageSha256: packageIdentity.contentHash,
      assetHashes: Object.fromEntries(
        Object.values(project.assets).map(({ id, contentHash }) => [id, contentHash]),
      ),
      uniqueBlobCount,
      checkpointRevision: checkpoint.record.revision,
      preparePagehideDisposed: false,
      importPagehideDisposed: false,
      stage: "prepared",
    };
    writeState(state);
    registerPagehideCleanup(repository, autosaveStorage, "preparePagehideDisposed");
    handedToPagehide = true;
    return {
      checkpointRevision: checkpoint.record.revision,
      projectBytes: new TextEncoder().encode(state.projectJson).byteLength,
      packageBytes: portable.size,
      packageSha256: state.packageSha256,
      assetHashes: state.assetHashes,
      uniqueBlobCount,
      ...migration,
    };
  } catch (error) {
    redactFailure(error, "prepare");
  } finally {
    if (!handedToPagehide) {
      repository.dispose();
      autosaveStorage.close();
      try {
        await cleanDatabases(assetDatabaseName, autosaveDatabaseName);
      } catch {
        // The public failure remains redacted; the next run performs a fresh cleanup gate.
      }
    }
  }
}

/** Stage two: reload durable state, then erase both DBs and import the package into clean storage. */
export async function resumeStudioPersistenceJourney() {
  const state = readState();
  if (
    state.stage !== "prepared"
    || !state.preparePagehideDisposed
    || state.documentInstanceId === DOCUMENT_INSTANCE_ID
  ) {
    fail("F3-07 prepare stage did not cross a real pagehide/reload boundary.");
  }
  const {
    repository: existingRepository,
    autosaveStorage: existingAutosaveStorage,
    autosave: existingAutosave,
  } = openJourneyPersistence(state.assetDatabaseName, state.autosaveDatabaseName);
  let imported: Awaited<ReturnType<typeof importSpriteBoyPackage>>;
  let integrityBeforeImport: AssetIntegrityScan;
  let reloadedJson: string;
  try {
    const inspection = await existingAutosave.inspect(PROJECT_ID);
    if (
      !inspection.confirmed
      || inspection.confirmed.record.revision !== state.checkpointRevision
    ) {
      fail("F3-07 prepared checkpoint is missing or changed after reload.");
    }
    reloadedJson = projectCodec.encode(inspection.confirmed.project);
    if (reloadedJson !== state.projectJson) {
      fail("F3-07 document identity changed before clean import.");
    }
    integrityBeforeImport = await existingRepository.scanIntegrity();
    const reloadedHashes = await assertRepositoryExact(
      existingRepository,
      inspection.confirmed.project,
      integrityBeforeImport,
    );
    if (stableJson(reloadedHashes) !== stableJson(state.assetHashes)) {
      fail("F3-07 prepared asset hashes changed after reload.");
    }
    const portableBytes = base64ToBytes(state.packageBase64);
    const portableBlob = new Blob([ownedBuffer(portableBytes)]);
    const portableIdentity = await computeAssetContentIdentity(portableBlob);
    if (portableIdentity.contentHash !== state.packageSha256) {
      fail("F3-07 retained portable package hash changed after reload.");
    }
    imported = await importSpriteBoyPackage(portableBlob);
    if (projectCodec.encode(imported.project) !== state.projectJson) {
      fail("F3-07 package document identity changed before clean import.");
    }
    if (
      imported.blobs.length !== state.uniqueBlobCount
      || imported.blobs.length >= Object.keys(imported.project.assets).length
      || !imported.blobs.some(({ assetIds }) => assetIds.length > 1)
    ) {
      fail("F3-07 portable package did not preserve blob deduplication.");
    }
  } catch (error) {
    redactFailure(error, "reload verification");
  } finally {
    existingRepository.dispose();
    existingAutosaveStorage.close();
  }
  await cleanDatabases(state.assetDatabaseName, state.autosaveDatabaseName);

  const {
    repository: cleanRepository,
    autosaveStorage: cleanAutosaveStorage,
    autosave: cleanAutosave,
  } = openJourneyPersistence(state.assetDatabaseName, state.autosaveDatabaseName);
  let handedToPagehide = false;
  try {
    for (const importedBlob of imported.blobs) {
      for (const assetId of importedBlob.assetIds) {
        const expected = imported.project.assets[assetId];
        const stored = await cleanRepository.put(importedBlob.blob, assetMetadata(expected));
        if (stableJson(stored) !== stableJson(expected)) {
          fail("F3-07 imported asset metadata changed.");
        }
      }
    }
    const importedIntegrity = await cleanRepository.scanIntegrity();
    const importedHashes = await assertRepositoryExact(
      cleanRepository,
      imported.project,
      importedIntegrity,
    );
    if (stableJson(importedHashes) !== stableJson(state.assetHashes)) {
      fail("F3-07 imported asset hashes changed while persisting.");
    }
    const importedCheckpoint = await cleanAutosave.checkpoint(imported.project);
    state.stage = "imported";
    state.documentInstanceId = DOCUMENT_INSTANCE_ID;
    state.checkpointRevision = importedCheckpoint.record.revision;
    writeState(state);
    registerPagehideCleanup(cleanRepository, cleanAutosaveStorage, "importPagehideDisposed");
    handedToPagehide = true;
    return {
      preparePagehideDisposed: state.preparePagehideDisposed,
      reloadDocumentExact: true,
      reloadIntegrity: integrityBeforeImport.assets.map(({ assetId, status }) => ({ assetId, status })),
      importedBlobCount: imported.blobs.length,
      importedAssetCount: Object.keys(imported.project.assets).length,
      importedCheckpointRevision: importedCheckpoint.record.revision,
      deduplicated: imported.blobs.length < Object.keys(imported.project.assets).length,
    };
  } catch (error) {
    redactFailure(error, "clean import");
  } finally {
    if (!handedToPagehide) {
      cleanRepository.dispose();
      cleanAutosaveStorage.close();
      try {
        await cleanDatabases(state.assetDatabaseName, state.autosaveDatabaseName);
      } catch {
        // Preserve the redacted import failure; the next run performs a fresh cleanup gate.
      }
    }
  }
}

/** Stage three: prove clean-import state survives another reload and reproduces the exact ZIP. */
export async function finishStudioPersistenceJourney() {
  const state = readState();
  if (
    state.stage !== "imported"
    || !state.importPagehideDisposed
    || state.documentInstanceId === DOCUMENT_INSTANCE_ID
  ) {
    fail("F3-07 clean import did not cross a real pagehide/reload boundary.");
  }
  const { repository, autosaveStorage, autosave } = openJourneyPersistence(
    state.assetDatabaseName,
    state.autosaveDatabaseName,
  );
  let outcome: {
    finalIntegrity: { assetId: string; status: string }[];
    finalSha256: string;
    byteSize: number;
  } | undefined;
  let failed = false;
  let privateFailure: unknown;
  try {
    const inspection = await autosave.inspect(PROJECT_ID);
    if (
      !inspection.confirmed
      || inspection.confirmed.record.revision !== state.checkpointRevision
    ) {
      fail("F3-07 imported checkpoint is missing or changed after reload.");
    }
    const finalJson = projectCodec.encode(inspection.confirmed.project);
    if (finalJson !== state.projectJson) fail("F3-07 final document identity changed.");
    const integrity = await repository.scanIntegrity();
    const hashIdentity = await assertRepositoryExact(
      repository,
      inspection.confirmed.project,
      integrity,
    );
    if (stableJson(hashIdentity) !== stableJson(state.assetHashes)) {
      fail("F3-07 final asset hashes changed.");
    }
    const portable = await exportSpriteBoyPackage(inspection.confirmed.project, packageSource(repository));
    const portableBytes = new Uint8Array(await portable.arrayBuffer());
    const originalBytes = base64ToBytes(state.packageBase64);
    const finalIdentity = await computeAssetContentIdentity(portable);
    const exactPackage = portableBytes.byteLength === originalBytes.byteLength
      && portableBytes.every((byte, index) => byte === originalBytes[index]);
    if (!exactPackage || finalIdentity.contentHash !== state.packageSha256) {
      fail("F3-07 final portable package bytes or hash changed.");
    }
    outcome = {
      finalIntegrity: integrity.assets.map(({ assetId, status }) => ({ assetId, status })),
      finalSha256: finalIdentity.contentHash,
      byteSize: portable.size,
    };
  } catch (error) {
    failed = true;
    privateFailure = error;
  } finally {
    repository.dispose();
    autosaveStorage.close();
  }

  let cleanup: Awaited<ReturnType<typeof verifyDatabaseCleanup>> | undefined;
  try {
    await cleanDatabases(state.assetDatabaseName, state.autosaveDatabaseName);
    cleanup = await verifyDatabaseCleanup(state.assetDatabaseName, state.autosaveDatabaseName);
  } catch (error) {
    if (!failed) {
      failed = true;
      privateFailure = error;
    }
  }
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch (error) {
    if (!failed) {
      failed = true;
      privateFailure = error;
    }
  }
  if (failed) redactFailure(privateFailure, "final verification or cleanup");
  if (!outcome || !cleanup) fail("F3-07 final verification did not produce evidence.");
  return {
    preparePagehideDisposed: state.preparePagehideDisposed,
    importPagehideDisposed: state.importPagehideDisposed,
    finalDocumentExact: true,
    finalIntegrity: outcome.finalIntegrity,
    assetHashesExact: true,
    package: {
      exactBytes: true,
      originalSha256: state.packageSha256,
      finalSha256: outcome.finalSha256,
      hashExact: true,
      byteSize: outcome.byteSize,
    },
    cleanup,
  };
}
