import { describe, expect, it } from "vitest";
import { projectCodec } from "../../core/persistence";
import {
  validateStudioProject,
  type ProjectCommandContext,
  type StudioProjectV1,
} from "../../core/project";
import { createProjectStore } from "../../core/stores";
import {
  COMPOSITION_ENTRY_POLICY,
  createCompositionEntryIntent,
  deriveCompositionEntryIdentity,
  openCompositionFromSource,
  type CompositionEntryRequest,
  type CompositionEntrySource,
} from "../../features/compose/project/compositionEntry";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

const ISSUED_AT = "2026-07-16T12:00:00.000Z";
const COMMITTED_AT = "2026-07-16T12:00:01.000Z";

function cloneFixture(): StudioProjectV1 {
  return structuredClone(studioProjectV1Fixture);
}

function request(source: CompositionEntrySource, suffix = "1"): CompositionEntryRequest {
  return {
    source,
    commandId: `compose-entry-command-${suffix}`,
    issuedAt: ISSUED_AT,
  };
}

function context(now = COMMITTED_AT): ProjectCommandContext {
  let nextId = 0;
  return {
    nextId: () => `generated-${++nextId}`,
    now: () => now,
  };
}

describe("A1-01 Composition entry integration", () => {
  it("creates and opens one Asset-backed Composition in one canonical dispatch", () => {
    const store = createProjectStore(cloneFixture(), { context: context() });
    const source = { type: "asset", id: "asset-sheet" } as const;
    const identity = deriveCompositionEntryIdentity(source);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    const result = openCompositionFromSource(store, request(source));

    expect(result).toEqual({
      ok: true,
      outcome: "created",
      source,
      sourceAssetId: "asset-sheet",
      compositionId: identity.compositionId,
      layerId: identity.layerId,
      dimensions: { width: 256, height: 128 },
      revision: 1,
      dispatched: true,
    });
    expect(notifications).toBe(1);

    const project = store.getSnapshot().project;
    expect(project.compositions[identity.compositionId]).toEqual({
      id: identity.compositionId,
      name: "hero-sheet.png composition",
      owner: { type: "project" },
      layerIds: [identity.layerId],
      width: 256,
      height: 128,
      background: null,
      createdAt: ISSUED_AT,
      updatedAt: ISSUED_AT,
    });
    expect(project.layers[identity.layerId]).toEqual({
      id: identity.layerId,
      compositionId: identity.compositionId,
      name: "hero-sheet.png",
      source: { type: "asset", id: "asset-sheet" },
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
      visible: true,
      locked: false,
      createdAt: ISSUED_AT,
      updatedAt: ISSUED_AT,
    });
    expect(project.workspace).toMatchObject({
      activeWorkspace: "compose",
      selectedAssetId: "asset-sheet",
      selectedCompositionId: identity.compositionId,
      selectedLayerId: identity.layerId,
    });
    expect(project.workspace).not.toHaveProperty("selectedRegionId");
    expect(validateStudioProject(project).valid).toBe(true);
    expect(COMPOSITION_ENTRY_POLICY).toEqual({
      assetCanvas: "intrinsic-asset-dimensions",
      regionCanvas: "region-bounds-dimensions",
      initialLayerTransform: "identity-at-canvas-origin",
      initialBackground: null,
    });
  });

  it("uses Region bounds for canvas dimensions while retaining its Asset reference context", () => {
    const store = createProjectStore(cloneFixture(), { context: context() });
    const source = { type: "region", id: "region-hero" } as const;
    const identity = deriveCompositionEntryIdentity(source);

    const result = openCompositionFromSource(store, request(source));

    expect(result).toMatchObject({
      ok: true,
      outcome: "created",
      source,
      sourceAssetId: "asset-sheet",
      compositionId: identity.compositionId,
      layerId: identity.layerId,
      dimensions: { width: 128, height: 128 },
      revision: 1,
    });
    const project = store.getSnapshot().project;
    expect(project.compositions[identity.compositionId]).toMatchObject({
      width: 128,
      height: 128,
      name: "Hero frame composition",
    });
    expect(project.layers[identity.layerId].source).toEqual({
      type: "region",
      id: "region-hero",
    });
    expect(project.workspace).toMatchObject({
      activeWorkspace: "compose",
      selectedAssetId: "asset-sheet",
      selectedRegionId: "region-hero",
      selectedCompositionId: identity.compositionId,
      selectedLayerId: identity.layerId,
    });
  });

  it("builds a deterministic command envelope without runtime-only fields", () => {
    const first = createCompositionEntryIntent(
      cloneFixture(),
      request({ type: "asset", id: "asset-sheet" }),
    );
    const second = createCompositionEntryIntent(
      cloneFixture(),
      request({ type: "asset", id: "asset-sheet" }),
    );

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toMatchObject({
      ok: true,
      outcome: "create",
      envelope: {
        command: {
          type: "command.batch",
          commands: [
            { type: "composition.create" },
            { type: "workspace.update" },
          ],
        },
        metadata: {
          commandId: "compose-entry-command-1",
          origin: "user",
          history: "record",
          issuedAt: ISSUED_AT,
        },
      },
    });
    const encoded = JSON.stringify(first);
    expect(encoded).not.toMatch(/(?:blob:|data:)/i);
    expect(encoded).not.toContain("Blob");
    expect(encoded).not.toContain("objectUrl");
  });

  it("reopens an existing identity, then returns already-open without another dispatch", () => {
    const store = createProjectStore(cloneFixture(), { context: context() });
    const source = { type: "region", id: "region-hero" } as const;
    const first = openCompositionFromSource(store, request(source, "create"));
    expect(first).toMatchObject({ ok: true, outcome: "created", revision: 1 });

    store.dispatch({
      command: { type: "workspace.update", patch: { activeWorkspace: "slice" } },
      metadata: {
        commandId: "leave-compose",
        origin: "user",
        history: "record",
        issuedAt: ISSUED_AT,
      },
    });
    const reopened = openCompositionFromSource(store, request(source, "reopen"));
    expect(reopened).toMatchObject({
      ok: true,
      outcome: "opened",
      revision: 3,
      dispatched: true,
    });

    const before = store.getSnapshot();
    const alreadyOpen = openCompositionFromSource(store, request(source, "already"));
    expect(alreadyOpen).toMatchObject({
      ok: true,
      outcome: "already-open",
      revision: 3,
      dispatched: false,
    });
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().project.rootOrder.compositionIds.filter(
      (id) => id === deriveCompositionEntryIdentity(source).compositionId,
    )).toHaveLength(1);
  });

  it("survives codec reload with stable identity and canonical validation", () => {
    const source = { type: "asset", id: "asset-sheet" } as const;
    const store = createProjectStore(cloneFixture(), { context: context() });
    const created = openCompositionFromSource(store, request(source, "before-reload"));
    expect(created.ok).toBe(true);

    const encoded = projectCodec.encode(store.getSnapshot().project as StudioProjectV1);
    const reloadedProject = projectCodec.decode(encoded);
    expect(validateStudioProject(reloadedProject)).toMatchObject({ valid: true, diagnostics: [] });
    expect(encoded).not.toMatch(/(?:blob:|data:)/i);

    const reloadedStore = createProjectStore(reloadedProject, { context: context() });
    const reopened = openCompositionFromSource(
      reloadedStore,
      request(source, "after-reload"),
    );
    expect(reopened).toMatchObject({
      ok: true,
      outcome: "already-open",
      compositionId: deriveCompositionEntryIdentity(source).compositionId,
      revision: 0,
      dispatched: false,
    });
    expect(projectCodec.encode(reloadedStore.getSnapshot().project as StudioProjectV1)).toBe(encoded);
  });
});
