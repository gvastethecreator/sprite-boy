import { createEmptyStudioProject, type StudioProjectV1 } from "../../core/project";
import { createSceneProjection, type SceneProjection } from "../../core/render";
import type { WorkspaceState } from "../../core/stores";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

interface MutableProjectState {
  project: StudioProjectV1;
  revision: number;
}

function projectState(
  project = structuredClone(studioProjectV1Fixture),
  revision = 7,
): MutableProjectState {
  return { project, revision };
}

function workspaceState(
  overrides: Partial<WorkspaceState> = {},
): WorkspaceState {
  return {
    panelSizes: overrides.panelSizes ?? {},
    viewports: overrides.viewports ?? {},
    preferences: overrides.preferences ?? {},
  };
}

function withWorkspace(
  workspaceId: "assets" | "slice" | "compose" | "animate" | "collision" | "export",
): MutableProjectState {
  const state = projectState();
  state.project.workspace.activeWorkspace = workspaceId;
  return state;
}

function assertDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) assertDeepFrozen(descriptor.value, seen);
  }
}

describe("createSceneProjection", () => {
  it.each([
    ["assets", "asset", "asset-sheet"],
    ["slice", "region", "region-hero"],
    ["compose", "composition", "composition-project"],
    ["animate", "cel", "cel-composition"],
    ["collision", "cel", "cel-composition"],
    ["export", "cel", "cel-composition"],
  ] as const)(
    "resolves the %s workspace from durable selection",
    (workspaceId, kind, expectedId) => {
      const projection = createSceneProjection(withWorkspace(workspaceId), workspaceState());

      expect(projection.workspaceId).toBe(workspaceId);
      expect(projection.root?.kind).toBe(kind);
      const id = projection.root === null
        ? undefined
        : projection.root.kind === "asset"
          ? projection.root.assetId
          : projection.root.kind === "region"
            ? projection.root.regionId
            : projection.root.kind === "composition"
              ? projection.root.compositionId
              : projection.root.kind === "variant"
                ? projection.root.variantSetId
                : projection.root.celId;
      expect(id).toBe(expectedId);
    },
  );

  it("projects a normalized cel, active variant and compositor-ready layer sources", () => {
    const state = withWorkspace("animate");
    state.project.workspace.selectedCelIds = ["cel-variants"];

    const projection = createSceneProjection(state, workspaceState({
      viewports: {
        animate: { scale: 2.5, offset: { x: 12, y: -8 } },
      },
    }));

    expect(projection.viewport).toEqual({ scale: 2.5, offset: { x: 12, y: -8 } });
    expect(projection.canvas).toEqual({ width: 128, height: 128, background: null });
    expect(projection.root).toMatchObject({
      kind: "cel",
      celId: "cel-variants",
      sequenceId: "sequence-main",
      durationMs: 120,
      transform: {
        x: 1,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
      source: {
        kind: "variant",
        variantSetId: "variant-set-main",
        activeVariant: "A",
        composition: {
          kind: "composition",
          compositionId: "composition-variant-a",
          layers: [
            {
              kind: "layer",
              layerId: "layer-variant-a",
              visible: true,
              locked: false,
              source: {
                asset: {
                  assetId: "asset-sheet",
                  blobKey: "asset/hero-sheet",
                  contentHash: "sha256:hero-sheet",
                  mimeType: "image/png",
                  width: 256,
                  height: 128,
                },
                sourceRect: { x: 0, y: 0, width: 128, height: 128 },
              },
            },
          ],
        },
      },
    });
  });

  it("preserves canonical layer order and visibility instead of applying UI draw policy", () => {
    const state = withWorkspace("compose");
    state.project.layers["layer-project-copy"] = {
      ...structuredClone(state.project.layers["layer-project"]),
      id: "layer-project-copy",
      name: "Hidden copy",
      visible: false,
    };
    state.project.compositions["composition-project"].layerIds = [
      "layer-project-copy",
      "layer-project",
    ];

    const root = createSceneProjection(state, workspaceState()).root;

    expect(root?.kind).toBe("composition");
    if (root?.kind !== "composition") throw new Error("Expected a composition root.");
    expect(root.layers.map((layer) => [layer.layerId, layer.visible])).toEqual([
      ["layer-project-copy", false],
      ["layer-project", true],
    ]);
  });

  it("uses selected layer, variant and root-order fallbacks without record insertion order", () => {
    const layerState = withWorkspace("compose");
    delete layerState.project.workspace.selectedCompositionId;
    expect(createSceneProjection(layerState, workspaceState()).root).toMatchObject({
      kind: "composition",
      compositionId: "composition-project",
    });

    const variantState = withWorkspace("compose");
    delete variantState.project.workspace.selectedCompositionId;
    delete variantState.project.workspace.selectedLayerId;
    expect(createSceneProjection(variantState, workspaceState()).root).toMatchObject({
      kind: "variant",
      variantSetId: "variant-set-main",
      activeVariant: "A",
    });

    const orderedState = withWorkspace("compose");
    delete orderedState.project.workspace.selectedCompositionId;
    delete orderedState.project.workspace.selectedLayerId;
    delete orderedState.project.workspace.selectedVariantSetId;
    orderedState.project.compositions = {
      "composition-variant-b": orderedState.project.compositions["composition-variant-b"],
      "composition-project": orderedState.project.compositions["composition-project"],
      "composition-cel": orderedState.project.compositions["composition-cel"],
      "composition-variant-a": orderedState.project.compositions["composition-variant-a"],
    };
    expect(createSceneProjection(orderedState, workspaceState()).root).toMatchObject({
      kind: "composition",
      compositionId: "composition-project",
    });
  });

  it("defaults to Assets and returns a stable empty scene for an empty valid project", () => {
    const project = createEmptyStudioProject();
    const empty = createSceneProjection({ project, revision: 0 }, workspaceState());

    expect(empty).toEqual({
      projectId: "project-empty",
      revision: 0,
      workspaceId: "assets",
      viewport: { scale: 1, offset: { x: 0, y: 0 } },
      canvas: null,
      root: null,
    });
    assertDeepFrozen(empty);
  });

  it("is deterministic and ignores panel, preference and non-active viewport state", () => {
    const state = withWorkspace("compose");
    const first = createSceneProjection(state, workspaceState({
      panelSizes: { left: 240 },
      preferences: { checkerboard: true },
      viewports: {
        compose: { scale: 1.5, offset: { x: 4, y: 5 } },
        animate: { scale: 9, offset: { x: 90, y: 90 } },
      },
    }));
    const second = createSceneProjection(state, workspaceState({
      panelSizes: { left: 800, right: 310 },
      preferences: { checkerboard: false, theme: "contrast" },
      viewports: {
        compose: { scale: 1.5, offset: { x: 4, y: 5 } },
        animate: { scale: 0.25, offset: { x: -90, y: -90 } },
      },
    }));

    expect(first).toEqual(second);
    expect(createSceneProjection(state, workspaceState({
      viewports: { compose: { scale: 1.5, offset: { x: 4, y: 5 } } },
    }))).toEqual(first);
  });

  it("copies all projected data and deeply freezes the result", () => {
    const state = withWorkspace("slice");
    const workspace = workspaceState({
      viewports: { slice: { scale: 2, offset: { x: 3, y: 4 } } },
    });
    const projection: SceneProjection = createSceneProjection(state, workspace);

    state.project.assets["asset-sheet"].blobKey = "mutated";
    state.project.regions["region-hero"].bounds.width = 1;
    (workspace.viewports.slice as { offset: { x: number } }).offset.x = 999;

    expect(projection.viewport.offset.x).toBe(3);
    expect(projection.root).toMatchObject({
      kind: "region",
      width: 128,
      source: { asset: { blobKey: "asset/hero-sheet" } },
    });
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
    assertDeepFrozen(projection);
  });
});
