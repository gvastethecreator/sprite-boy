import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import {
  getLocalModelDefinition,
  modelCatalogFingerprint,
  modelInstallByteSize,
  type LocalModelDefinition,
  type LocalModelId,
  type ModelDigestAlgorithm,
} from "./modelCatalog";
import { createModelInstallManifest, type ModelInstallManifest } from "./modelInstallManifest";
import { ModelSetupPortError, type ModelSetupPort, type ModelSetupProgress } from "./modelSetupJobTask";
import type { ModelFileEvidence, ModelSmokeEvidence } from "./modelReadiness";
import {
  MODEL_DOWNLOAD_MARKER,
  MODEL_ERROR_MARKER,
  MODEL_INSTALL_MANIFEST,
  MODEL_LICENSE_ACCEPTANCE,
} from "./nodeModelInventory";

const MARKER_LIFETIME_MS = 30 * 60 * 1_000;
const MAX_JSON_BYTES = 16_384;

export interface NodeModelSmokeRunner {
  run(options: {
    readonly model: LocalModelDefinition;
    readonly modelsRoot: string;
    readonly signal: AbortSignal;
  }): Promise<ModelSmokeEvidence>;
}

export interface NodeModelSetupOptions {
  readonly root: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly smoke: NodeModelSmokeRunner;
  readonly resolveModel?: (id: LocalModelId) => LocalModelDefinition;
}

function portError(
  code: ModelSetupPortError["code"],
  message: string,
  retryable: boolean,
): ModelSetupPortError {
  return new ModelSetupPortError(code, message, retryable);
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

function safePath(root: string, path: string): string {
  const target = resolve(root, path);
  if (!contained(root, target)) throw portError("invalid-input", "La ruta del modelo no es segura.", false);
  return target;
}

async function ensureDirectory(root: string, relativePath: string): Promise<string> {
  let current = root;
  for (const segment of relativePath.split(/[\\/]/u).filter(Boolean)) {
    current = safePath(root, relative(root, resolve(current, segment)));
    await mkdir(current).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw portError("storage-failed", "El directorio del modelo no es seguro.", false);
    }
  }
  return current;
}

async function prepareRoot(root: string, model: LocalModelDefinition): Promise<{ root: string; modelRoot: string }> {
  await mkdir(root, { recursive: true });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw portError("storage-failed", "El directorio de modelos no es seguro.", false);
  }
  const canonicalRoot = await realpath(root);
  const modelRoot = await ensureDirectory(canonicalRoot, model.id);
  const canonicalModelRoot = await realpath(modelRoot);
  if (!contained(canonicalRoot, canonicalModelRoot)) {
    throw portError("storage-failed", "El directorio del modelo sale del almacén local.", false);
  }
  return { root: canonicalRoot, modelRoot: canonicalModelRoot };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rm(path, { force: true });
  await rename(temporary, path);
}

async function readSmallJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) return null;
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function hasLicense(model: LocalModelDefinition, modelRoot: string): Promise<boolean> {
  if (!model.gated) return true;
  const value = await readSmallJson(safePath(modelRoot, MODEL_LICENSE_ACCEPTANCE));
  return value?.schemaVersion === 1
    && value.modelId === model.id
    && value.revision === model.revision
    && value.licenseId === model.license.id
    && typeof value.acceptedAt === "string"
    && !Number.isNaN(Date.parse(value.acceptedAt));
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

async function validFile(path: string, expected: LocalModelDefinition["files"][number]): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile()
      && !info.isSymbolicLink()
      && info.size === expected.byteSize
      && await digestFile(path, info.size, expected.digest.algorithm) === expected.digest.value;
  } catch {
    return false;
  }
}

function responseStart(response: Response): number | null {
  const value = response.headers.get("content-range");
  const match = value ? /^bytes (\d+)-\d+\/\d+$/u.exec(value) : null;
  return match ? Number(match[1]) : null;
}

async function partSize(path: string, maximum: number): Promise<number> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) {
      await rm(path, { force: true });
      return 0;
    }
    return info.size;
  } catch {
    return 0;
  }
}

async function downloadFile(options: {
  readonly modelRoot: string;
  readonly file: LocalModelDefinition["files"][number];
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
  readonly baseBytes: number;
  readonly totalBytes: number;
  readonly onProgress: (progress: ModelSetupProgress) => void;
}): Promise<ModelFileEvidence> {
  const target = safePath(options.modelRoot, options.file.path);
  await ensureDirectory(options.modelRoot, relative(options.modelRoot, dirname(target)));
  if (await validFile(target, options.file)) {
    options.onProgress({
      ratio: 0.05 + (options.baseBytes + options.file.byteSize) / options.totalBytes * 0.8,
      phase: "verify",
      message: `Verificado ${options.file.path}`,
    });
    return { path: options.file.path, byteSize: options.file.byteSize, digest: { ...options.file.digest } };
  }

  const partial = `${target}.part`;
  let offset = await partSize(partial, options.file.byteSize);
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : undefined;
  let response: Response;
  try {
    response = await options.fetch(options.file.downloadUrl, { headers, signal: options.signal });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw portError("download-failed", `Falló la descarga de ${options.file.path}.`, true);
  }
  if (!response.ok || !response.body) {
    throw portError("download-failed", `El servidor rechazó ${options.file.path}.`, response.status >= 500);
  }
  if (offset > 0 && (response.status !== 206 || responseStart(response) !== offset)) {
    offset = 0;
  }
  const handle = await open(partial, offset > 0 ? "a" : "w", 0o600);
  let downloaded = offset;
  try {
    const reader = response.body.getReader();
    for (;;) {
      if (options.signal.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (options.signal.aborted) throw error;
        throw portError("download-failed", `Se cortó la descarga de ${options.file.path}.`, true);
      }
      const { done, value } = chunk;
      if (done) break;
      if (downloaded + value.byteLength > options.file.byteSize) {
        throw portError("verification-failed", `El tamaño de ${options.file.path} no coincide.`, true);
      }
      await handle.write(value);
      downloaded += value.byteLength;
      options.onProgress({
        ratio: Math.min(0.85, 0.05 + (options.baseBytes + downloaded) / options.totalBytes * 0.8),
        phase: "download",
        message: `Descargando ${options.file.path}`,
      });
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const info = await stat(partial);
  if (info.size !== options.file.byteSize) {
    throw portError("download-failed", `La descarga de ${options.file.path} quedó incompleta.`, true);
  }
  const digest = await digestFile(partial, info.size, options.file.digest.algorithm);
  if (digest !== options.file.digest.value) {
    await rm(partial, { force: true });
    throw portError("verification-failed", `La firma de ${options.file.path} no coincide.`, true);
  }
  await rm(target, { force: true });
  await rename(partial, target);
  return { path: options.file.path, byteSize: info.size, digest: { ...options.file.digest } };
}

function downloadMarker(model: LocalModelDefinition, requestId: string, now: Date) {
  return {
    schemaVersion: 1,
    modelId: model.id,
    revision: model.revision,
    requestId,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MARKER_LIFETIME_MS).toISOString(),
  };
}

function errorMarker(model: LocalModelDefinition, code: string, now: Date) {
  return {
    schemaVersion: 1,
    modelId: model.id,
    revision: model.revision,
    code,
    at: now.toISOString(),
  };
}

export function createNodeModelSetupPort(options: NodeModelSetupOptions): ModelSetupPort {
  if (!options || typeof options !== "object" || typeof options.root !== "string" || !options.smoke) {
    throw new TypeError("Node model setup options are invalid.");
  }
  const modelsRoot = resolve(options.root);
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const resolveModel = options.resolveModel ?? getLocalModelDefinition;
  return Object.freeze({
    async install({ modelId, requestId, signal, onProgress }: Parameters<ModelSetupPort["install"]>[0]): Promise<ModelInstallManifest> {
      const model = resolveModel(modelId as LocalModelId);
      const prepared = await prepareRoot(modelsRoot, model);
      const markerPath = safePath(prepared.modelRoot, MODEL_DOWNLOAD_MARKER);
      const errorPath = safePath(prepared.modelRoot, MODEL_ERROR_MARKER);
      if (!await hasLicense(model, prepared.modelRoot)) {
        throw portError("license-required", "Acepta la licencia del modelo antes de descargarlo.", false);
      }
      await rm(errorPath, { force: true });
      await atomicJson(markerPath, downloadMarker(model, requestId, now()));
      onProgress({ ratio: 0.01, phase: "prepare", message: `Preparando ${model.label}` });
      try {
        const totalBytes = modelInstallByteSize(model);
        const files: ModelFileEvidence[] = [];
        let baseBytes = 0;
        for (const file of model.files) {
          if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          await atomicJson(markerPath, downloadMarker(model, requestId, now()));
          files.push(await downloadFile({
            modelRoot: prepared.modelRoot,
            file,
            fetch: fetchImpl,
            signal,
            baseBytes,
            totalBytes,
            onProgress,
          }));
          baseBytes += file.byteSize;
        }
        const manifestPath = safePath(prepared.modelRoot, MODEL_INSTALL_MANIFEST);
        const installedAt = now().toISOString();
        await atomicJson(manifestPath, createModelInstallManifest(model, { installedAt, files }));
        onProgress({ ratio: 0.9, phase: "smoke", message: `Probando ${model.label}` });
        let smoke: ModelSmokeEvidence;
        try {
          smoke = await options.smoke.run({ model, modelsRoot: prepared.root, signal });
        } catch (error) {
          if (signal.aborted) throw error;
          throw portError("smoke-failed", "La prueba local del modelo falló.", true);
        }
        if (
          smoke.status !== "passed"
          || !model.runtime.preferredBackends.includes(smoke.backend)
          || smoke.catalogFingerprint !== modelCatalogFingerprint(model)
        ) throw portError("smoke-failed", "La prueba local del modelo falló.", true);
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        const manifest = createModelInstallManifest(model, { installedAt, files, smoke });
        await atomicJson(manifestPath, manifest);
        await rm(markerPath, { force: true });
        onProgress({ ratio: 1, phase: "smoke", message: `${model.label} listo` });
        return manifest;
      } catch (error) {
        await rm(markerPath, { force: true }).catch(() => undefined);
        if (!signal.aborted) {
          const code = error instanceof ModelSetupPortError ? error.code : "setup-failed";
          await atomicJson(errorPath, errorMarker(model, code, now())).catch(() => undefined);
        }
        if (error instanceof ModelSetupPortError || signal.aborted) throw error;
        throw portError("storage-failed", "No se pudo escribir el modelo local.", true);
      }
    },
  });
}
