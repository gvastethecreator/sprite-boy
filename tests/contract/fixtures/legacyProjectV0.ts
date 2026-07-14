/**
 * Sanitized legacy save envelope based on the current ProjectState and usePersistence shapes.
 * `fixture://` references stand in for binary resolver entries; no Blob/Data URL or user content is embedded.
 */
export const legacyProjectV0Fixture = {
  project: {
    imageMeta: {
      src: "fixture://source-sheet",
      width: 192,
      height: 64,
      name: "legacy-sheet.png",
      fileSize: 4096,
    },
    builderCanvas: { width: 128, height: 64 },
    frames: [
      {
        id: 0,
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        hitboxes: [
          { id: "legacy-hurtbox", x: 8, y: 8, w: 48, h: 52, type: "HURTBOX", tag: "body" },
        ],
      },
      { id: 1, x: 64, y: 0, w: 64, h: 64 },
      { id: 2, x: 128, y: 0, w: 64, h: 64, hidden: true },
    ],
    builderSlots: {
      0: {
        gridIndex: 0,
        assetId: "legacy-builder-asset",
        fitMode: "fit",
        alignment: "center",
        scaleX: 1,
        scaleY: 1,
        lockAspect: true,
        rotation: 0,
        opacity: 1,
        offsetX: 0,
        offsetY: 0,
        flipX: false,
        flipY: false,
      },
    },
    builderFreeObjects: [
      {
        id: "legacy-free-object",
        assetId: "legacy-builder-asset",
        x: 72,
        y: 8,
        w: 48,
        h: 48,
        rotation: 15,
        flipX: false,
        flipY: true,
        opacity: 0.8,
        zIndex: 2,
      },
    ],
    animations: [
      {
        id: "legacy-walk",
        name: "Walk",
        fps: 12,
        loop: true,
        keyframes: [
          { uid: "legacy-cel-ambiguous", sourceIndex: 0, pivotX: 0.5, pivotY: 1 },
          {
            uid: "legacy-cel-frame-only",
            sourceIndex: 1,
            pivotX: 0.5,
            pivotY: 1,
            rotation: 5,
            scaleX: 1.1,
            scaleY: 1.1,
            opacity: 0.9,
          },
        ],
      },
    ],
    builderAssets: [
      {
        id: "legacy-builder-asset",
        src: "fixture://builder-asset",
        name: "builder-piece.png",
        width: 64,
        height: 64,
      },
    ],
    aspectRatio: "2:1",
  },
  ui: {
    slicerGrid: { rows: 1, cols: 3, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 },
    builderGrid: { rows: 1, cols: 2, marginX: 0, marginY: 0, paddingX: 0, paddingY: 0 },
    templateConfig: {
      viewType: "full",
      showIndices: true,
      gridColor: "#3b82f6",
      gridWidth: 1,
      backgroundColor: "#09090b",
    },
    onionSkin: { enabled: true, opacity: 0.3, showHitboxes: false },
    currentMode: "ANIMATION",
  },
} as const;

export const legacyProjectV0Ambiguity = {
  keyframeUid: "legacy-cel-ambiguous",
  sourceIndex: 0,
  matchingFrameId: 0,
  matchingBuilderGridIndex: 0,
  expectedIssueCode: "AMBIGUOUS_LEGACY_CEL_SOURCE",
} as const;
