import { describe, expect, it } from "vitest";

import {
  createModelInstallManifest,
  getLocalModelDefinition,
  modelCatalogFingerprint,
  parseModelInstallManifest,
} from "../../core/models";

describe("model install manifest (M1-01)", () => {
  const model = getLocalModelDefinition("birefnet-lite-512");
  const files = model.files.map((file) => ({
    path: file.path,
    byteSize: file.byteSize,
    digest: { ...file.digest },
  }));

  it("round-trips verified files and an optional inference proof", () => {
    const manifest = createModelInstallManifest(model, {
      installedAt: "2026-07-25T22:00:00.000Z",
      files,
      smoke: {
        status: "passed",
        catalogFingerprint: modelCatalogFingerprint(model),
        backend: "wasm",
        completedAt: "2026-07-25T22:01:00.000Z",
        outputSha256: `sha256:${"b".repeat(64)}`,
      },
    });

    expect(parseModelInstallManifest(JSON.parse(JSON.stringify(manifest)), model)).toEqual(manifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.files)).toBe(true);
    expect(Object.isFrozen(manifest.files[0]?.digest)).toBe(true);
  });

  it("rejects stale identity, incomplete files and malformed smoke evidence", () => {
    const base = createModelInstallManifest(model, {
      installedAt: "2026-07-25T22:00:00.000Z",
      files,
    });
    expect(() => parseModelInstallManifest({ ...base, revision: "0".repeat(40) }, model))
      .toThrow(/identity/i);
    expect(() => createModelInstallManifest(model, {
      installedAt: "2026-07-25T22:00:00.000Z",
      files: files.slice(1),
    })).toThrow(/do not match/i);
    expect(() => parseModelInstallManifest({ ...base, smoke: { status: "passed" } }, model))
      .toThrow(/smoke/i);
  });
});
