import { describe, expect, it } from "vitest";
import {
  validateStudioProject,
  type AssetRecord,
  type StudioProjectV1,
} from "../../core/project";
import { createProjectStore } from "../../core/stores";
import {
  createCompositionEntryIntent,
  deriveCompositionEntryIdentity,
  openCompositionFromSource,
  type CompositionEntryRequest,
} from "../../features/compose/project/compositionEntry";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

const NOW = "2026-07-16T12:00:00.000Z";

function cloneFixture(): StudioProjectV1 {
  return structuredClone(studioProjectV1Fixture);
}

function request(type: "asset" | "region", id: string): CompositionEntryRequest {
  return {
    source: { type, id },
    commandId: `command-${type}-${id}`,
    issuedAt: NOW,
  };
}

function createStore(project = cloneFixture(), now = NOW) {
  return createProjectStore(project, {
    context: {
      nextId: () => "unused-generated-id",
      now: () => now,
    },
  });
}

describe("A1-01 Composition entry hostile boundaries", () => {
  it("rejects missing Asset/Region and a dangling Region reference without mutation", () => {
    const store = createStore();
    const before = store.getSnapshot();
    expect(openCompositionFromSource(store, request("asset", "missing"))).toMatchObject({
      ok: false,
      code: "SOURCE_NOT_FOUND",
      revision: 0,
    });
    expect(openCompositionFromSource(store, request("region", "missing"))).toMatchObject({
      ok: false,
      code: "SOURCE_NOT_FOUND",
      revision: 0,
    });
    expect(store.getSnapshot()).toBe(before);

    const dangling = cloneFixture();
    dangling.regions["region-hero"].assetId = "asset-gone";
    expect(createCompositionEntryIntent(dangling, request("region", "region-hero"))).toMatchObject({
      ok: false,
      code: "SOURCE_REFERENCE_MISSING",
    });
  });

  it("contains getter-backed, extra-field and revoked requests without invoking code", () => {
    let reads = 0;
    const getterRequest = {
      get source(): never {
        reads += 1;
        throw new Error("private getter payload");
      },
      commandId: "getter-command",
      issuedAt: NOW,
    };
    expect(createCompositionEntryIntent(
      cloneFixture(),
      getterRequest as unknown as CompositionEntryRequest,
    )).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(reads).toBe(0);

    expect(createCompositionEntryIntent(
      cloneFixture(),
      { ...request("asset", "asset-sheet"), runtimeUrl: "blob:secret" } as CompositionEntryRequest,
    )).toMatchObject({ ok: false, code: "INVALID_REQUEST" });

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(createCompositionEntryIntent(
      cloneFixture(),
      revoked.proxy as CompositionEntryRequest,
    )).toMatchObject({ ok: false, code: "INVALID_REQUEST" });

    const hostileReference = cloneFixture();
    let referenceReads = 0;
    Object.defineProperty(hostileReference.regions["region-hero"], "assetId", {
      configurable: true,
      enumerable: true,
      get() {
        referenceReads += 1;
        throw new Error("private reference payload");
      },
    });
    expect(createCompositionEntryIntent(
      hostileReference,
      request("region", "region-hero"),
    )).toMatchObject({ ok: false, code: "SOURCE_NOT_FOUND" });
    expect(referenceReads).toBe(0);
  });

  it("detects a reserved Composition identity owned by a cel", () => {
    const project = cloneFixture();
    const identity = deriveCompositionEntryIdentity({ type: "asset", id: "asset-sheet" });
    const previousId = "composition-cel";
    const moved = project.compositions[previousId];
    delete project.compositions[previousId];
    moved.id = identity.compositionId;
    moved.layerIds = ["layer-cel"];
    project.compositions[identity.compositionId] = moved;
    project.layers["layer-cel"].compositionId = identity.compositionId;
    const cel = project.cels["cel-composition"];
    if (cel.source.type !== "composition") throw new Error("Fixture cel source changed.");
    cel.source.compositionId = identity.compositionId;
    delete project.workspace.selectedCompositionId;
    delete project.workspace.selectedLayerId;
    expect(validateStudioProject(project).valid).toBe(true);

    expect(createCompositionEntryIntent(project, request("asset", "asset-sheet"))).toMatchObject({
      ok: false,
      code: "IDENTITY_CONFLICT",
    });
  });

  it("rejects a valid reserved Asset entry whose Layer source kind or ID was replaced", () => {
    const store = createStore();
    const source = { type: "asset", id: "asset-sheet" } as const;
    const created = openCompositionFromSource(store, request(source.type, source.id));
    expect(created).toMatchObject({ ok: true, outcome: "created" });
    const identity = deriveCompositionEntryIdentity(source);
    const canonical = structuredClone(store.getSnapshot().project as StudioProjectV1);

    const wrongKind = structuredClone(canonical);
    wrongKind.layers[identity.layerId].source = { type: "region", id: "region-hero" };
    expect(validateStudioProject(wrongKind).valid).toBe(true);
    expect(createCompositionEntryIntent(wrongKind, request(source.type, source.id))).toMatchObject({
      ok: false,
      code: "IDENTITY_CONFLICT",
    });

    const wrongId = structuredClone(canonical);
    wrongId.layers[identity.layerId].source = { type: "asset", id: "asset-processed" };
    expect(validateStudioProject(wrongId).valid).toBe(true);
    expect(createCompositionEntryIntent(wrongId, request(source.type, source.id))).toMatchObject({
      ok: false,
      code: "IDENTITY_CONFLICT",
    });

    const hostileSource = structuredClone(canonical);
    let sourceReads = 0;
    Object.defineProperty(hostileSource.layers[identity.layerId], "source", {
      configurable: true,
      enumerable: true,
      get() {
        sourceReads += 1;
        throw new Error("private Layer source payload");
      },
    });
    expect(createCompositionEntryIntent(
      hostileSource,
      request(source.type, source.id),
    )).toMatchObject({ ok: false, code: "IDENTITY_CONFLICT" });
    expect(sourceReads).toBe(0);
  });

  it("rejects a valid reserved Asset entry whose canvas dimensions were replaced", () => {
    const store = createStore();
    const source = { type: "asset", id: "asset-sheet" } as const;
    expect(openCompositionFromSource(store, request(source.type, source.id))).toMatchObject({
      ok: true,
      outcome: "created",
    });
    const identity = deriveCompositionEntryIdentity(source);
    const project = structuredClone(store.getSnapshot().project as StudioProjectV1);
    project.compositions[identity.compositionId].width = 128;
    expect(validateStudioProject(project).valid).toBe(true);

    expect(createCompositionEntryIntent(project, request(source.type, source.id))).toMatchObject({
      ok: false,
      code: "IDENTITY_CONFLICT",
    });
  });

  it("rejects a valid reserved entry with an extra Layer instead of adopting it", () => {
    const store = createStore();
    const source = { type: "asset", id: "asset-sheet" } as const;
    expect(openCompositionFromSource(store, request(source.type, source.id))).toMatchObject({
      ok: true,
      outcome: "created",
    });
    const identity = deriveCompositionEntryIdentity(source);
    const project = structuredClone(store.getSnapshot().project as StudioProjectV1);
    project.layers["compose-entry-extra-layer"] = {
      ...structuredClone(project.layers[identity.layerId]),
      id: "compose-entry-extra-layer",
    };
    project.compositions[identity.compositionId].layerIds.push("compose-entry-extra-layer");
    expect(validateStudioProject(project).valid).toBe(true);

    expect(createCompositionEntryIntent(project, request(source.type, source.id))).toMatchObject({
      ok: false,
      code: "IDENTITY_CONFLICT",
    });
  });

  it("keeps graph and revision unchanged when canonical dispatch rejects the batch", () => {
    const store = createStore(cloneFixture(), "not-an-iso-timestamp");
    const before = store.getSnapshot();

    const result = openCompositionFromSource(store, request("asset", "asset-sheet"));

    expect(result).toMatchObject({
      ok: false,
      code: "DISPATCH_REJECTED",
      revision: 0,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "INVARIANT_VIOLATION" }),
      ]),
    });
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().project.compositions).not.toHaveProperty(
      deriveCompositionEntryIdentity({ type: "asset", id: "asset-sheet" }).compositionId,
    );
  });

  it("supports an own __proto__ Asset ID without prototype pollution", () => {
    const project = cloneFixture();
    const asset: AssetRecord = {
      id: "__proto__",
      name: "prototype-safe.png",
      blobKey: "asset/prototype-safe",
      contentHash: "sha256:prototype-safe",
      mimeType: "image/png",
      width: 7,
      height: 9,
      byteSize: 63,
      createdAt: NOW,
      updatedAt: NOW,
      provenance: { source: "fixture" },
    };
    Object.defineProperty(project.assets, "__proto__", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: asset,
    });
    project.rootOrder.assetIds.push("__proto__");
    expect(validateStudioProject(project).valid).toBe(true);
    const store = createStore(project);

    const result = openCompositionFromSource(store, request("asset", "__proto__"));

    expect(result).toMatchObject({
      ok: true,
      outcome: "created",
      sourceAssetId: "__proto__",
      dimensions: { width: 7, height: 9 },
    });
    const identity = deriveCompositionEntryIdentity({ type: "asset", id: "__proto__" });
    expect(store.getSnapshot().project.layers[identity.layerId].source).toEqual({
      type: "asset",
      id: "__proto__",
    });
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
  });
});
