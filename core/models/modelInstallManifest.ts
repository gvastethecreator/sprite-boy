import {
  modelCatalogFingerprint,
  type LocalModelDefinition,
} from "./modelCatalog";
import {
  deriveLocalModelStatus,
  type ModelFileEvidence,
  type ModelSmokeEvidence,
} from "./modelReadiness";

export const MODEL_INSTALL_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface ModelInstallManifest {
  readonly schemaVersion: typeof MODEL_INSTALL_MANIFEST_SCHEMA_VERSION;
  readonly modelId: LocalModelDefinition["id"];
  readonly repositoryId: string;
  readonly revision: string;
  readonly catalogFingerprint: string;
  readonly installedAt: string;
  readonly files: readonly ModelFileEvidence[];
  readonly smoke: ModelSmokeEvidence | null;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseFiles(value: unknown): readonly ModelFileEvidence[] {
  if (!Array.isArray(value)) throw new TypeError("Model install manifest files must be an array.");
  return value.map((item) => {
    const file = dataRecord(item, "Model install manifest file");
    const digest = dataRecord(file.digest, "Model install manifest file digest");
    if (
      typeof file.path !== "string"
      || !Number.isSafeInteger(file.byteSize)
      || (file.byteSize as number) <= 0
      || (digest.algorithm !== "sha256" && digest.algorithm !== "git-sha1")
      || typeof digest.value !== "string"
    ) throw new TypeError("Model install manifest file is invalid.");
    return {
      path: file.path,
      byteSize: file.byteSize as number,
      digest: { algorithm: digest.algorithm, value: digest.value },
    };
  });
}

function parseSmoke(value: unknown): ModelSmokeEvidence | null {
  if (value === null) return null;
  const smoke = dataRecord(value, "Model install manifest smoke");
  if (
    (smoke.status !== "passed" && smoke.status !== "failed")
    || typeof smoke.catalogFingerprint !== "string"
    || (smoke.backend !== "webgpu" && smoke.backend !== "wasm")
    || typeof smoke.completedAt !== "string"
    || typeof smoke.outputSha256 !== "string"
  ) throw new TypeError("Model install manifest smoke is invalid.");
  return {
    status: smoke.status,
    catalogFingerprint: smoke.catalogFingerprint,
    backend: smoke.backend,
    completedAt: smoke.completedAt,
    outputSha256: smoke.outputSha256,
  };
}

function freezeManifest(value: ModelInstallManifest): ModelInstallManifest {
  return Object.freeze({
    ...value,
    files: Object.freeze(value.files.map((file) => Object.freeze({
      ...file,
      digest: Object.freeze({ ...file.digest }),
    }))),
    smoke: value.smoke === null ? null : Object.freeze({ ...value.smoke }),
  });
}

export function createModelInstallManifest(
  model: LocalModelDefinition,
  options: {
    readonly installedAt: string;
    readonly files: readonly ModelFileEvidence[];
    readonly smoke?: ModelSmokeEvidence | null;
  },
): ModelInstallManifest {
  if (Number.isNaN(Date.parse(options.installedAt))) {
    throw new TypeError("Model install time is invalid.");
  }
  const status = deriveLocalModelStatus(model, {
    licenseAccepted: true,
    activeDownload: false,
    files: options.files,
    smoke: null,
  });
  if (status.state !== "installed-unverified") {
    throw new TypeError("Model install files do not match the catalog.");
  }
  return freezeManifest({
    schemaVersion: MODEL_INSTALL_MANIFEST_SCHEMA_VERSION,
    modelId: model.id,
    repositoryId: model.repositoryId,
    revision: model.revision,
    catalogFingerprint: modelCatalogFingerprint(model),
    installedAt: options.installedAt,
    files: options.files,
    smoke: options.smoke ?? null,
  });
}

export function parseModelInstallManifest(
  value: unknown,
  model: LocalModelDefinition,
): ModelInstallManifest {
  const manifest = dataRecord(value, "Model install manifest");
  if (
    manifest.schemaVersion !== MODEL_INSTALL_MANIFEST_SCHEMA_VERSION
    || manifest.modelId !== model.id
    || manifest.repositoryId !== model.repositoryId
    || manifest.revision !== model.revision
    || manifest.catalogFingerprint !== modelCatalogFingerprint(model)
    || typeof manifest.installedAt !== "string"
  ) throw new TypeError("Model install manifest identity is invalid.");
  return createModelInstallManifest(model, {
    installedAt: manifest.installedAt,
    files: parseFiles(manifest.files),
    smoke: parseSmoke(manifest.smoke),
  });
}
