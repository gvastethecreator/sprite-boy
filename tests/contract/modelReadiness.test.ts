import { describe, expect, it } from "vitest";

import {
  assessModelCapacity,
  deriveLocalModelStatus,
  getLocalModelDefinition,
  modelCatalogFingerprint,
  type LocalModelDefinition,
  type ModelInstallationEvidence,
} from "../../core/models";

function installedEvidence(model: LocalModelDefinition): ModelInstallationEvidence {
  return {
    licenseAccepted: true,
    activeDownload: false,
    files: model.files.map((file) => ({
      path: file.path,
      byteSize: file.byteSize,
      digest: { ...file.digest },
    })),
    smoke: null,
  };
}

describe("local model readiness (M1-01)", () => {
  const lite = getLocalModelDefinition("birefnet-lite-512");
  const rmbg = getLocalModelDefinition("rmbg-2.0");

  it("derives license, absent and downloading states before file verification", () => {
    expect(deriveLocalModelStatus(rmbg, {
      licenseAccepted: false,
      activeDownload: true,
      files: [],
      smoke: null,
    }).state).toBe("license-required");
    expect(deriveLocalModelStatus(lite, {
      licenseAccepted: true,
      activeDownload: false,
      files: [],
      smoke: null,
    }).state).toBe("absent");
    expect(deriveLocalModelStatus(lite, {
      licenseAccepted: true,
      activeDownload: true,
      files: [],
      smoke: null,
    }).state).toBe("downloading");
  });

  it("never marks partial, duplicate, wrong-size or wrong-hash files ready", () => {
    const installed = installedEvidence(lite);
    const cases = [
      installed.files.slice(1),
      [...installed.files, installed.files[0]!],
      installed.files.map((file, index) => index === 0 ? { ...file, byteSize: file.byteSize + 1 } : file),
      installed.files.map((file, index) => index === 0
        ? { ...file, digest: { ...file.digest, value: "0".repeat(64) } }
        : file),
    ];
    for (const files of cases) {
      expect(deriveLocalModelStatus(lite, { ...installed, files }).state).toBe("error");
    }
  });

  it("requires a matching successful inference after a verified install", () => {
    const installed = installedEvidence(lite);
    const unverified = deriveLocalModelStatus(lite, installed);
    expect(unverified).toMatchObject({
      state: "installed-unverified",
      verifiedBytes: unverified.totalBytes,
    });

    const ready = deriveLocalModelStatus(lite, {
      ...installed,
      smoke: {
        status: "passed",
        catalogFingerprint: modelCatalogFingerprint(lite),
        backend: "wasm",
        completedAt: "2026-07-25T22:00:00.000Z",
        outputSha256: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(ready.state).toBe("ready");
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.problems)).toBe(true);

    expect(deriveLocalModelStatus(lite, {
      ...installed,
      smoke: {
        status: "passed",
        catalogFingerprint: "old-catalog",
        backend: "wasm",
        completedAt: "2026-07-25T22:00:00.000Z",
        outputSha256: `sha256:${"a".repeat(64)}`,
      },
    }).state).toBe("error");
  });

  it("blocks known resource deficits and warns on unknown browser capacity", () => {
    expect(assessModelCapacity(lite, {
      availableStorageBytes: 1,
      availableMemoryBytes: lite.runtime.minimumMemoryBytes,
      backends: ["wasm"],
    })).toMatchObject({ state: "blocked", canInstall: false, problems: ["storage-insufficient"] });
    expect(assessModelCapacity(rmbg, {
      availableStorageBytes: 1_000_000_000,
      availableMemoryBytes: 1_000_000_000,
      backends: ["wasm"],
    })).toMatchObject({
      state: "blocked",
      canInstall: false,
      problems: ["backend-unavailable", "memory-insufficient"],
    });
    expect(assessModelCapacity(lite, {
      availableStorageBytes: null,
      availableMemoryBytes: null,
      backends: null,
    })).toMatchObject({ state: "warning", canInstall: true, problems: ["capacity-partial"] });
    expect(() => assessModelCapacity(lite, {
      availableStorageBytes: -1,
      availableMemoryBytes: null,
      backends: null,
    })).toThrow(/nonnegative safe integers/i);
  });
});
