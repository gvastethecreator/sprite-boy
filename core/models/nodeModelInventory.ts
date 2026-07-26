import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, statfs } from "node:fs/promises";
import { freemem } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

import {
  assessModelCapacity,
  deriveLocalModelStatus,
  type LocalModelStatus,
  type ModelCapacityAssessment,
  type ModelFileEvidence,
} from "./modelReadiness";
import {
  getLocalModelDefinition,
  modelCatalogFingerprint,
  type LocalModelDefinition,
  type LocalModelId,
  type ModelDigestAlgorithm,
} from "./modelCatalog";
import { parseModelInstallManifest } from "./modelInstallManifest";

export const MODEL_DOWNLOAD_MARKER = ".download.json";
export const MODEL_ERROR_MARKER = ".error.json";
export const MODEL_INSTALL_MANIFEST = "install-manifest.json";
export const MODEL_LICENSE_ACCEPTANCE = "license-acceptance.json";

export interface InspectedLocalModel {
  readonly modelId: LocalModelId;
  readonly revision: string;
  readonly catalogFingerprint: string;
  readonly status: LocalModelStatus;
  readonly capacity: ModelCapacityAssessment;
}

function safeChildPath(root: string, path: string): string {
  const target = resolve(root, path);
  const child = relative(root, target);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || resolve(target) !== target) {
    throw new TypeError("Model catalog path escapes its installation directory.");
  }
  return target;
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return null;
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function digestFile(path: string, byteSize: number, algorithm: ModelDigestAlgorithm): Promise<string> {
  const hash = createHash(algorithm === "sha256" ? "sha256" : "sha1");
  if (algorithm === "git-sha1") hash.update(`blob ${byteSize}\0`);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function inspectFile(modelRoot: string, model: LocalModelDefinition, index: number) {
  const expected = model.files[index]!;
  const path = safeChildPath(modelRoot, expected.path);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return { evidence: null, errorCode: "unsafe-model-file" };
    const evidence: ModelFileEvidence = {
      path: expected.path,
      byteSize: info.size,
      digest: {
        algorithm: expected.digest.algorithm,
        value: info.size === expected.byteSize
          ? await digestFile(path, info.size, expected.digest.algorithm)
          : "",
      },
    };
    return { evidence, errorCode: null };
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { evidence: null, errorCode: null };
    }
    return { evidence: null, errorCode: "model-file-read-failed" };
  }
}

function validLicenseAcceptance(value: unknown, model: LocalModelDefinition): boolean {
  const item = record(value);
  return item?.schemaVersion === 1
    && item.modelId === model.id
    && item.revision === model.revision
    && item.licenseId === model.license.id
    && typeof item.acceptedAt === "string"
    && !Number.isNaN(Date.parse(item.acceptedAt));
}

function parseManifest(value: unknown, model: LocalModelDefinition) {
  if (value === null) return null;
  try {
    return parseModelInstallManifest(value, model);
  } catch {
    return null;
  }
}

function activeDownload(value: unknown, now: number): boolean {
  const marker = record(value);
  return marker?.schemaVersion === 1
    && typeof marker.expiresAt === "string"
    && Date.parse(marker.expiresAt) > now;
}

function errorCode(value: unknown): string | null {
  const marker = record(value);
  return marker?.schemaVersion === 1 && typeof marker.code === "string" && /^[a-z0-9-]{1,64}$/u.test(marker.code)
    ? marker.code
    : null;
}

async function availableStorageBytes(path: string): Promise<number | null> {
  let candidate = resolve(path);
  for (;;) {
    try {
      const stats = await statfs(candidate);
      const value = Number(stats.bavail) * Number(stats.bsize);
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch (error) {
      if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        return null;
      }
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

export async function inspectLocalModel(
  id: LocalModelId,
  options: { readonly root: string; readonly now?: number } ,
): Promise<InspectedLocalModel> {
  const model = getLocalModelDefinition(id);
  const root = resolve(options.root);
  const modelRoot = safeChildPath(root, id);
  const inspectedFiles = await Promise.all(model.files.map((_, index) => inspectFile(modelRoot, model, index)));
  const files = inspectedFiles.flatMap(({ evidence }) => evidence ? [evidence] : []);
  const markerError = inspectedFiles.find(({ errorCode: code }) => code !== null)?.errorCode ?? null;
  const [download, storedError, manifest, acceptance] = await Promise.all([
    readJson(safeChildPath(modelRoot, MODEL_DOWNLOAD_MARKER)),
    readJson(safeChildPath(modelRoot, MODEL_ERROR_MARKER)),
    readJson(safeChildPath(modelRoot, MODEL_INSTALL_MANIFEST)),
    readJson(safeChildPath(modelRoot, MODEL_LICENSE_ACCEPTANCE)),
  ]);
  const staleDownload = download !== null && !activeDownload(download, options.now ?? Date.now());
  const parsedManifest = parseManifest(manifest, model);
  const manifestProblem = files.length === 0
    ? (manifest !== null ? "manifest-without-files" : null)
    : manifest === null
      ? "install-manifest-missing"
      : parsedManifest === null
        ? "install-manifest-invalid"
        : null;
  const status = deriveLocalModelStatus(model, {
    licenseAccepted: !model.gated || validLicenseAcceptance(acceptance, model),
    activeDownload: activeDownload(download, options.now ?? Date.now()),
    files,
    smoke: parsedManifest?.smoke ?? null,
    errorCode: markerError
      ?? errorCode(storedError)
      ?? (staleDownload ? "stale-download" : null)
      ?? manifestProblem,
  });
  const storageProbePath = files.length > 0 ? modelRoot : root;
  const capacity = assessModelCapacity(model, {
    availableStorageBytes: await availableStorageBytes(storageProbePath),
    availableMemoryBytes: freemem(),
    backends: null,
  });
  return Object.freeze({
    modelId: model.id,
    revision: model.revision,
    catalogFingerprint: modelCatalogFingerprint(model),
    status,
    capacity,
  });
}
