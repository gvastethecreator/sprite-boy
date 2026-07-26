import { describe, expect, it } from "vitest";

import {
  LOCAL_MODEL_CATALOG,
  MODEL_CATALOG_SCHEMA_VERSION,
  getLocalModelDefinition,
  isLocalModelId,
  modelCatalogFingerprint,
  modelInstallByteSize,
} from "../../core/models";

describe("local model catalog (M1-01)", () => {
  it("pins the supported profiles to immutable Hub revisions and hashes", () => {
    expect(MODEL_CATALOG_SCHEMA_VERSION).toBe(1);
    expect(Object.keys(LOCAL_MODEL_CATALOG)).toEqual(["birefnet-lite-512", "ben2-base", "rmbg-2.0"]);
    expect(getLocalModelDefinition("birefnet-lite-512")).toMatchObject({
      repositoryId: "studioludens/birefnet-lite-512",
      revision: "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7",
      gated: false,
      license: { id: "MIT", use: "permissive" },
      runtime: { dtype: "fp16", inputWidth: 512, inputHeight: 512 },
    });
    expect(getLocalModelDefinition("ben2-base")).toMatchObject({
      repositoryId: "PramaLLC/BEN2",
      revision: "e48a20765fb421d19dcdb0bf3cc61e802ca5ec8f",
      gated: false,
      license: { id: "MIT", use: "permissive" },
      runtime: { dtype: "fp32", inputWidth: 1024, inputHeight: 1024, preferredBackends: ["webgpu", "wasm"] },
    });
    expect(getLocalModelDefinition("rmbg-2.0")).toMatchObject({
      repositoryId: "briaai/RMBG-2.0",
      revision: "5df4c9c76d8170882c34f6986e848ee07fd0ba43",
      gated: true,
      license: { id: "bria-rmbg-2.0", use: "non-commercial" },
      runtime: { dtype: "q4f16", inputWidth: 1024, inputHeight: 1024 },
    });
    expect(modelInstallByteSize(getLocalModelDefinition("birefnet-lite-512"))).toBe(98_485_002);
    expect(modelInstallByteSize(getLocalModelDefinition("ben2-base"))).toBe(222_932_053);
    expect(modelInstallByteSize(getLocalModelDefinition("rmbg-2.0"))).toBe(233_816_089);
  });

  it("keeps every file safe, size-bound, hashed and pinned to its revision", () => {
    for (const model of Object.values(LOCAL_MODEL_CATALOG)) {
      expect(Object.isFrozen(model)).toBe(true);
      expect(Object.isFrozen(model.files)).toBe(true);
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/u);
      expect(modelCatalogFingerprint(model)).toContain(`${model.id}:${model.revision}`);
      const paths = new Set<string>();
      for (const file of model.files) {
        expect(file.path).toMatch(/^(?![./\\])(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+$/u);
        expect(paths.has(file.path)).toBe(false);
        paths.add(file.path);
        expect(file.byteSize).toBeGreaterThan(0);
        expect(file.digest.value).toMatch(file.digest.algorithm === "sha256"
          ? /^[0-9a-f]{64}$/u
          : /^[0-9a-f]{40}$/u);
        expect(file.downloadUrl).toContain(`/resolve/${model.revision}/`);
      }
    }
  });

  it("allowlists IDs", () => {
    expect(isLocalModelId("birefnet-lite-512")).toBe(true);
    expect(isLocalModelId("ben2-base")).toBe(true);
    expect(isLocalModelId("rmbg-2.0")).toBe(true);
    expect(isLocalModelId("../../private-model")).toBe(false);
  });

  it("invalidates install evidence when the runtime contract changes", () => {
    const model = getLocalModelDefinition("ben2-base");
    const changed = {
      ...model,
      runtime: { ...model.runtime, outputName: "changed-output" },
    };
    expect(modelCatalogFingerprint(changed)).not.toBe(modelCatalogFingerprint(model));
  });
});
