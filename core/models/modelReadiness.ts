import {
  modelCatalogFingerprint,
  modelInstallByteSize,
  type LocalModelDefinition,
  type ModelBackend,
  type ModelDigestAlgorithm,
} from "./modelCatalog";

export type LocalModelState =
  | "license-required"
  | "absent"
  | "downloading"
  | "installed-unverified"
  | "ready"
  | "error";

export interface ModelFileEvidence {
  readonly path: string;
  readonly byteSize: number;
  readonly digest: {
    readonly algorithm: ModelDigestAlgorithm;
    readonly value: string;
  };
}

export interface ModelSmokeEvidence {
  readonly status: "passed" | "failed";
  readonly catalogFingerprint: string;
  readonly backend: ModelBackend;
  readonly completedAt: string;
  readonly outputSha256: string;
  readonly peakMemoryBytes: number;
}

export interface ModelInstallationEvidence {
  readonly licenseAccepted: boolean;
  readonly activeDownload: boolean;
  readonly files: readonly ModelFileEvidence[];
  readonly smoke: ModelSmokeEvidence | null;
  readonly errorCode?: string | null;
}

export interface LocalModelStatus {
  readonly modelId: LocalModelDefinition["id"];
  readonly state: LocalModelState;
  readonly verifiedBytes: number;
  readonly totalBytes: number;
  readonly problems: readonly string[];
}

export interface ModelCapacityEvidence {
  readonly availableStorageBytes: number | null;
  readonly availableMemoryBytes: number | null;
  readonly backends: readonly ModelBackend[] | null;
}

export interface ModelCapacityAssessment {
  readonly state: "supported" | "warning" | "blocked";
  readonly canInstall: boolean;
  readonly requiredStorageBytes: number;
  readonly requiredMemoryBytes: number;
  readonly problems: readonly string[];
}

function freezeStatus(status: LocalModelStatus): LocalModelStatus {
  return Object.freeze({ ...status, problems: Object.freeze([...status.problems]) });
}

function safeNonnegativeInteger(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

export function deriveLocalModelStatus(
  model: LocalModelDefinition,
  evidence: ModelInstallationEvidence,
): LocalModelStatus {
  const totalBytes = modelInstallByteSize(model);
  if (model.gated && !evidence.licenseAccepted) {
    return freezeStatus({
      modelId: model.id,
      state: "license-required",
      verifiedBytes: 0,
      totalBytes,
      problems: ["license-required"],
    });
  }
  if (evidence.errorCode) {
    return freezeStatus({
      modelId: model.id,
      state: "error",
      verifiedBytes: 0,
      totalBytes,
      problems: [evidence.errorCode],
    });
  }
  if (evidence.activeDownload) {
    return freezeStatus({
      modelId: model.id,
      state: "downloading",
      verifiedBytes: 0,
      totalBytes,
      problems: [],
    });
  }
  if (evidence.files.length === 0) {
    return freezeStatus({
      modelId: model.id,
      state: "absent",
      verifiedBytes: 0,
      totalBytes,
      problems: [],
    });
  }

  const byPath = new Map<string, ModelFileEvidence>();
  const problems: string[] = [];
  for (const file of evidence.files) {
    if (byPath.has(file.path)) problems.push(`duplicate:${file.path}`);
    else byPath.set(file.path, file);
  }
  let verifiedBytes = 0;
  for (const expected of model.files) {
    const actual = byPath.get(expected.path);
    if (!actual) {
      problems.push(`missing:${expected.path}`);
      continue;
    }
    if (actual.byteSize !== expected.byteSize) {
      problems.push(`size:${expected.path}`);
      continue;
    }
    if (
      actual.digest.algorithm !== expected.digest.algorithm
      || actual.digest.value.toLowerCase() !== expected.digest.value
    ) {
      problems.push(`digest:${expected.path}`);
      continue;
    }
    verifiedBytes += actual.byteSize;
  }
  if (problems.length > 0) {
    return freezeStatus({ modelId: model.id, state: "error", verifiedBytes, totalBytes, problems });
  }
  if (evidence.smoke === null) {
    return freezeStatus({
      modelId: model.id,
      state: "installed-unverified",
      verifiedBytes,
      totalBytes,
      problems: [],
    });
  }
  if (
    evidence.smoke.status !== "passed"
    || evidence.smoke.catalogFingerprint !== modelCatalogFingerprint(model)
    || !model.runtime.preferredBackends.includes(evidence.smoke.backend)
    || !/^sha256:[0-9a-f]{64}$/u.test(evidence.smoke.outputSha256)
    || !Number.isSafeInteger(evidence.smoke.peakMemoryBytes)
    || evidence.smoke.peakMemoryBytes <= 0
    || Number.isNaN(Date.parse(evidence.smoke.completedAt))
  ) {
    return freezeStatus({
      modelId: model.id,
      state: "error",
      verifiedBytes,
      totalBytes,
      problems: ["smoke-invalid"],
    });
  }
  return freezeStatus({ modelId: model.id, state: "ready", verifiedBytes, totalBytes, problems: [] });
}

export function assessModelCapacity(
  model: LocalModelDefinition,
  evidence: ModelCapacityEvidence,
): ModelCapacityAssessment {
  if (
    !safeNonnegativeInteger(evidence.availableStorageBytes)
    || !safeNonnegativeInteger(evidence.availableMemoryBytes)
  ) {
    throw new TypeError("Model capacity values must be null or nonnegative safe integers.");
  }
  const installBytes = modelInstallByteSize(model);
  const requiredStorageBytes = installBytes + Math.max(67_108_864, Math.ceil(installBytes * 0.1));
  const requiredMemoryBytes = model.runtime.minimumMemoryBytes;
  const problems: string[] = [];
  if (
    evidence.backends !== null
    && !model.runtime.preferredBackends.some((backend) => evidence.backends?.includes(backend))
  ) {
    problems.push("backend-unavailable");
  }
  if (evidence.availableStorageBytes !== null && evidence.availableStorageBytes < requiredStorageBytes) {
    problems.push("storage-insufficient");
  }
  if (evidence.availableMemoryBytes !== null && evidence.availableMemoryBytes < requiredMemoryBytes) {
    problems.push("memory-insufficient");
  }
  const unknown = evidence.availableStorageBytes === null
    || evidence.availableMemoryBytes === null
    || evidence.backends === null;
  const blocked = problems.length > 0;
  return Object.freeze({
    state: blocked ? "blocked" : unknown ? "warning" : "supported",
    canInstall: !blocked,
    requiredStorageBytes,
    requiredMemoryBytes,
    problems: Object.freeze([
      ...problems,
      ...(unknown ? ["capacity-partial"] : []),
    ]),
  });
}
