import {
  createEmptyStudioProject,
  validateStudioProject,
} from "../project";
import type {
  AssetRecord,
  Cel,
  CollisionSet,
  CollisionShapeType,
  Composition,
  Layer,
  ProcessingRecipe,
  Region,
  Sequence,
  StudioProjectV1,
  WorkspaceId,
} from "../project";
import {
  ProjectMigrator,
} from "./projectMigration";
import type {
  ProjectMigrationIssue,
  ProjectMigrationResult,
  ProjectMigrationStep,
  ProjectMigrationStepResult,
} from "./projectMigration";

export interface LegacyAssetResolution {
  assetId: string;
  contentHash: string;
  blobKey: string;
  mimeType: string;
  byteSize: number;
}

export type LegacyCelSourceResolution =
  | { type: "frame"; frameId: number }
  | { type: "builder-slot"; gridIndex: number };

export interface LegacyProjectV0MigrationContext {
  projectId: string;
  projectName: string;
  timestamp: string;
  assetResolutions: Readonly<Record<string, LegacyAssetResolution>>;
  celSourceResolutions?: Readonly<Record<string, LegacyCelSourceResolution>>;
}

interface LegacyImageMeta {
  src: string;
  width: number;
  height: number;
  name: string;
  fileSize: number;
}

interface LegacyHitbox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  tag: string;
}

interface LegacyFrame {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  hitboxes?: LegacyHitbox[];
}

interface LegacyBuilderAsset {
  id: string;
  src: string;
  name: string;
  width: number;
  height: number;
}

interface LegacyBuilderSlot {
  gridIndex: number;
  assetId: string;
  fitMode: "fit" | "fill" | "original" | "stretch";
  alignment: string;
  scaleX: number;
  scaleY: number;
  lockAspect: boolean;
  rotation: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
  flipX: boolean;
  flipY: boolean;
}

interface LegacyFreeObject {
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  zIndex: number;
}

interface LegacyKeyframe {
  uid: string;
  sourceIndex: number;
  pivotX: number;
  pivotY: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

interface LegacyAnimation {
  id: string;
  name: string;
  fps: number;
  loop: boolean;
  keyframes: LegacyKeyframe[];
}

interface LegacyGrid {
  rows: number;
  cols: number;
  marginX: number;
  marginY: number;
  paddingX: number;
  paddingY: number;
}

interface LegacyProjectV0Document {
  project: {
    imageMeta: LegacyImageMeta | null;
    builderCanvas: { width: number; height: number } | null;
    frames: LegacyFrame[];
    builderSlots: Record<string, LegacyBuilderSlot>;
    builderFreeObjects: LegacyFreeObject[];
    animations: LegacyAnimation[];
    builderAssets: LegacyBuilderAsset[];
    aspectRatio?: string;
  };
  ui: {
    slicerGrid: LegacyGrid;
    builderGrid: LegacyGrid;
    templateConfig: {
      viewType: string;
      showIndices: boolean;
      gridColor: string;
      gridWidth: number;
      backgroundColor: string;
    };
    onionSkin: { enabled: boolean; opacity: number; showHitboxes: boolean };
    currentMode: string;
  };
}

interface LegacySourceAsset {
  kind: "source-sheet" | "builder";
  legacyId: string;
  sourceRef: string;
  name: string;
  width: number;
  height: number;
  legacyByteSize?: number;
}

type ResolvedCelSource =
  | { type: "frame"; frame: LegacyFrame }
  | { type: "builder-slot"; slot: LegacyBuilderSlot; asset: LegacyBuilderAsset };

const ALIGNMENTS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${path} contains unsupported fields: ${unknown.sort().join(", ")}.`);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, path: string, minimum?: number): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || Object.is(value, -0)
    || (minimum !== undefined && value < minimum)
  ) {
    throw new TypeError(`${path} must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`}.`);
  }
  return value;
}

function requireInteger(value: unknown, path: string, minimum = 0): number {
  const parsed = requireNumber(value, path, minimum);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${path} must be a safe integer.`);
  return parsed;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be boolean.`);
  return value;
}

function assertUnique(values: readonly (string | number)[], path: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${path} values must be unique.`);
}

function parseGrid(value: unknown, path: string): LegacyGrid {
  const record = requireRecord(value, path);
  assertKnownKeys(record, ["rows", "cols", "marginX", "marginY", "paddingX", "paddingY"], path);
  return {
    rows: requireInteger(record.rows, `${path}.rows`, 1),
    cols: requireInteger(record.cols, `${path}.cols`, 1),
    marginX: requireNumber(record.marginX, `${path}.marginX`, 0),
    marginY: requireNumber(record.marginY, `${path}.marginY`, 0),
    paddingX: requireNumber(record.paddingX, `${path}.paddingX`, 0),
    paddingY: requireNumber(record.paddingY, `${path}.paddingY`, 0),
  };
}

function assertLegacyProjectV0(value: unknown): asserts value is LegacyProjectV0Document {
  const envelope = requireRecord(value, "$legacy");
  assertKnownKeys(envelope, ["project", "ui", "schemaVersion"], "$legacy");
  if (envelope.schemaVersion !== undefined && envelope.schemaVersion !== 0) {
    throw new TypeError("$legacy.schemaVersion must be 0 when present.");
  }
  const project = requireRecord(envelope.project, "$legacy.project");
  assertKnownKeys(project, [
    "imageMeta", "builderCanvas", "frames", "builderSlots", "builderFreeObjects",
    "animations", "builderAssets", "aspectRatio",
  ], "$legacy.project");

  if (project.imageMeta !== null) {
    const image = requireRecord(project.imageMeta, "$legacy.project.imageMeta");
    assertKnownKeys(image, ["src", "width", "height", "name", "fileSize"], "$legacy.project.imageMeta");
    requireString(image.src, "$legacy.project.imageMeta.src");
    requireNumber(image.width, "$legacy.project.imageMeta.width", 1);
    requireNumber(image.height, "$legacy.project.imageMeta.height", 1);
    requireString(image.name, "$legacy.project.imageMeta.name");
    requireInteger(image.fileSize, "$legacy.project.imageMeta.fileSize", 0);
  }
  if (project.builderCanvas !== null) {
    const canvas = requireRecord(project.builderCanvas, "$legacy.project.builderCanvas");
    assertKnownKeys(canvas, ["width", "height"], "$legacy.project.builderCanvas");
    requireNumber(canvas.width, "$legacy.project.builderCanvas.width", 1);
    requireNumber(canvas.height, "$legacy.project.builderCanvas.height", 1);
  }

  const frames = requireArray(project.frames, "$legacy.project.frames");
  for (const [index, raw] of frames.entries()) {
    const path = `$legacy.project.frames[${index}]`;
    const frame = requireRecord(raw, path);
    assertKnownKeys(frame, ["id", "x", "y", "w", "h", "hidden", "hitboxes"], path);
    requireInteger(frame.id, `${path}.id`);
    requireNumber(frame.x, `${path}.x`, 0);
    requireNumber(frame.y, `${path}.y`, 0);
    requireNumber(frame.w, `${path}.w`, 1);
    requireNumber(frame.h, `${path}.h`, 1);
    if (frame.hidden !== undefined) requireBoolean(frame.hidden, `${path}.hidden`);
    if (frame.hitboxes !== undefined) {
      for (const [shapeIndex, rawShape] of requireArray(frame.hitboxes, `${path}.hitboxes`).entries()) {
        const shapePath = `${path}.hitboxes[${shapeIndex}]`;
        const shape = requireRecord(rawShape, shapePath);
        assertKnownKeys(shape, ["id", "x", "y", "w", "h", "type", "tag"], shapePath);
        requireString(shape.id, `${shapePath}.id`);
        requireNumber(shape.x, `${shapePath}.x`, 0);
        requireNumber(shape.y, `${shapePath}.y`, 0);
        requireNumber(shape.w, `${shapePath}.w`, 1);
        requireNumber(shape.h, `${shapePath}.h`, 1);
        requireString(shape.type, `${shapePath}.type`);
        requireString(shape.tag, `${shapePath}.tag`);
      }
    }
  }
  assertUnique(frames.map((frame) => (frame as LegacyFrame).id), "$legacy.project.frames[].id");

  const assets = requireArray(project.builderAssets, "$legacy.project.builderAssets");
  for (const [index, raw] of assets.entries()) {
    const path = `$legacy.project.builderAssets[${index}]`;
    const asset = requireRecord(raw, path);
    assertKnownKeys(asset, ["id", "src", "name", "width", "height"], path);
    requireString(asset.id, `${path}.id`);
    requireString(asset.src, `${path}.src`);
    requireString(asset.name, `${path}.name`);
    requireNumber(asset.width, `${path}.width`, 1);
    requireNumber(asset.height, `${path}.height`, 1);
  }
  assertUnique(assets.map((asset) => (asset as LegacyBuilderAsset).id), "$legacy.project.builderAssets[].id");
  const builderAssetIds = new Set(
    assets.map((asset) => (asset as LegacyBuilderAsset).id),
  );

  const slots = requireRecord(project.builderSlots, "$legacy.project.builderSlots");
  for (const [key, raw] of Object.entries(slots)) {
    const path = `$legacy.project.builderSlots.${key}`;
    const slot = requireRecord(raw, path);
    assertKnownKeys(slot, [
      "gridIndex", "assetId", "fitMode", "alignment", "scaleX", "scaleY", "lockAspect",
      "rotation", "opacity", "offsetX", "offsetY", "flipX", "flipY",
    ], path);
    const gridIndex = requireInteger(slot.gridIndex, `${path}.gridIndex`);
    if (key !== String(gridIndex)) throw new TypeError(`${path}.gridIndex must match its record key.`);
    const slotAssetId = requireString(slot.assetId, `${path}.assetId`);
    if (!builderAssetIds.has(slotAssetId)) {
      throw new TypeError(`${path}.assetId references an unknown Builder asset.`);
    }
    if (!["fit", "fill", "original", "stretch"].includes(requireString(slot.fitMode, `${path}.fitMode`))) {
      throw new TypeError(`${path}.fitMode is unsupported.`);
    }
    if (!ALIGNMENTS.has(requireString(slot.alignment, `${path}.alignment`))) {
      throw new TypeError(`${path}.alignment is unsupported.`);
    }
    requireNumber(slot.scaleX, `${path}.scaleX`, 0);
    requireNumber(slot.scaleY, `${path}.scaleY`, 0);
    requireBoolean(slot.lockAspect, `${path}.lockAspect`);
    requireNumber(slot.rotation, `${path}.rotation`);
    requireNumber(slot.opacity, `${path}.opacity`, 0);
    if ((slot.opacity as number) > 1) throw new TypeError(`${path}.opacity must be <= 1.`);
    requireNumber(slot.offsetX, `${path}.offsetX`);
    requireNumber(slot.offsetY, `${path}.offsetY`);
    requireBoolean(slot.flipX, `${path}.flipX`);
    requireBoolean(slot.flipY, `${path}.flipY`);
  }

  const freeObjects = requireArray(project.builderFreeObjects, "$legacy.project.builderFreeObjects");
  for (const [index, raw] of freeObjects.entries()) {
    const path = `$legacy.project.builderFreeObjects[${index}]`;
    const object = requireRecord(raw, path);
    assertKnownKeys(object, [
      "id", "assetId", "x", "y", "w", "h", "rotation", "flipX", "flipY", "opacity", "zIndex",
    ], path);
    requireString(object.id, `${path}.id`);
    const objectAssetId = requireString(object.assetId, `${path}.assetId`);
    if (!builderAssetIds.has(objectAssetId)) {
      throw new TypeError(`${path}.assetId references an unknown Builder asset.`);
    }
    for (const key of ["x", "y", "rotation"] as const) requireNumber(object[key], `${path}.${key}`);
    requireNumber(object.w, `${path}.w`, 1);
    requireNumber(object.h, `${path}.h`, 1);
    requireBoolean(object.flipX, `${path}.flipX`);
    requireBoolean(object.flipY, `${path}.flipY`);
    requireNumber(object.opacity, `${path}.opacity`, 0);
    if ((object.opacity as number) > 1) throw new TypeError(`${path}.opacity must be <= 1.`);
    requireInteger(object.zIndex, `${path}.zIndex`);
  }
  assertUnique(freeObjects.map((object) => (object as LegacyFreeObject).id), "$legacy.project.builderFreeObjects[].id");

  const animations = requireArray(project.animations, "$legacy.project.animations");
  for (const [index, raw] of animations.entries()) {
    const path = `$legacy.project.animations[${index}]`;
    const animation = requireRecord(raw, path);
    assertKnownKeys(animation, ["id", "name", "fps", "loop", "keyframes"], path);
    requireString(animation.id, `${path}.id`);
    requireString(animation.name, `${path}.name`);
    requireNumber(animation.fps, `${path}.fps`, 0.001);
    requireBoolean(animation.loop, `${path}.loop`);
    const keyframes = requireArray(animation.keyframes, `${path}.keyframes`);
    for (const [keyframeIndex, rawKeyframe] of keyframes.entries()) {
      const keyframePath = `${path}.keyframes[${keyframeIndex}]`;
      const keyframe = requireRecord(rawKeyframe, keyframePath);
      assertKnownKeys(keyframe, [
        "uid", "sourceIndex", "pivotX", "pivotY", "rotation", "scaleX", "scaleY", "opacity",
      ], keyframePath);
      requireString(keyframe.uid, `${keyframePath}.uid`);
      requireInteger(keyframe.sourceIndex, `${keyframePath}.sourceIndex`);
      requireNumber(keyframe.pivotX, `${keyframePath}.pivotX`);
      requireNumber(keyframe.pivotY, `${keyframePath}.pivotY`);
      for (const key of ["rotation", "scaleX", "scaleY", "opacity"] as const) {
        if (keyframe[key] !== undefined) requireNumber(keyframe[key], `${keyframePath}.${key}`, key === "rotation" ? undefined : 0);
      }
      if (typeof keyframe.opacity === "number" && keyframe.opacity > 1) {
        throw new TypeError(`${keyframePath}.opacity must be <= 1.`);
      }
    }
    assertUnique(keyframes.map((keyframe) => (keyframe as LegacyKeyframe).uid), `${path}.keyframes[].uid`);
  }
  assertUnique(animations.map((animation) => (animation as LegacyAnimation).id), "$legacy.project.animations[].id");
  assertUnique(
    animations.flatMap((animation) => (animation as LegacyAnimation).keyframes.map(({ uid }) => uid)),
    "$legacy.project.animations[].keyframes[].uid",
  );
  if (project.aspectRatio !== undefined) {
    requireString(project.aspectRatio, "$legacy.project.aspectRatio");
  }

  const ui = requireRecord(envelope.ui, "$legacy.ui");
  assertKnownKeys(ui, ["slicerGrid", "builderGrid", "templateConfig", "onionSkin", "currentMode"], "$legacy.ui");
  parseGrid(ui.slicerGrid, "$legacy.ui.slicerGrid");
  parseGrid(ui.builderGrid, "$legacy.ui.builderGrid");
  const template = requireRecord(ui.templateConfig, "$legacy.ui.templateConfig");
  assertKnownKeys(template, ["viewType", "showIndices", "gridColor", "gridWidth", "backgroundColor"], "$legacy.ui.templateConfig");
  requireString(template.viewType, "$legacy.ui.templateConfig.viewType");
  requireBoolean(template.showIndices, "$legacy.ui.templateConfig.showIndices");
  requireString(template.gridColor, "$legacy.ui.templateConfig.gridColor");
  requireNumber(template.gridWidth, "$legacy.ui.templateConfig.gridWidth", 0);
  requireString(template.backgroundColor, "$legacy.ui.templateConfig.backgroundColor");
  const onion = requireRecord(ui.onionSkin, "$legacy.ui.onionSkin");
  assertKnownKeys(onion, ["enabled", "opacity", "showHitboxes"], "$legacy.ui.onionSkin");
  requireBoolean(onion.enabled, "$legacy.ui.onionSkin.enabled");
  requireNumber(onion.opacity, "$legacy.ui.onionSkin.opacity", 0);
  if ((onion.opacity as number) > 1) throw new TypeError("$legacy.ui.onionSkin.opacity must be <= 1.");
  requireBoolean(onion.showHitboxes, "$legacy.ui.onionSkin.showHitboxes");
  const currentMode = requireString(ui.currentMode, "$legacy.ui.currentMode").toUpperCase();
  if (!["SLICER", "SLICE", "BUILDER", "COMPOSE", "ANIMATION", "ANIMATE", "COLLISION", "ASSETS", "EXPORT"].includes(currentMode)) {
    throw new TypeError("$legacy.ui.currentMode is unsupported.");
  }
}

function ownValue(record: object | undefined, key: string): unknown {
  if (!record) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function requireOwnData(record: object, key: string, path: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch (cause) {
    throw new TypeError(`${path} could not be inspected as a data property.`, { cause });
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${path} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function optionalOwnData(
  record: object,
  key: string,
  path: string,
): { found: boolean; value?: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch (cause) {
    throw new TypeError(`${path} could not be inspected as a data property.`, { cause });
  }
  if (!descriptor) return { found: false };
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${path} must be an enumerable data property.`);
  }
  return { found: true, value: descriptor.value };
}

function validateResolution(value: unknown, sourceRef: string): LegacyAssetResolution {
  const resolution = requireRecord(value, `$context.assetResolutions[${JSON.stringify(sourceRef)}]`);
  assertKnownKeys(resolution, ["assetId", "contentHash", "blobKey", "mimeType", "byteSize"], "$context.assetResolutions[]");
  const assetId = requireString(
    requireOwnData(resolution, "assetId", "$context.assetResolutions[].assetId"),
    "$context.assetResolutions[].assetId",
  );
  const contentHash = requireString(
    requireOwnData(resolution, "contentHash", "$context.assetResolutions[].contentHash"),
    "$context.assetResolutions[].contentHash",
  );
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new TypeError("Resolved contentHash must be 64 lowercase hex characters.");
  const blobKey = requireString(
    requireOwnData(resolution, "blobKey", "$context.assetResolutions[].blobKey"),
    "$context.assetResolutions[].blobKey",
  );
  if (blobKey !== `sha256:${contentHash}`) throw new TypeError("Resolved blobKey must match contentHash.");
  return {
    assetId,
    contentHash,
    blobKey,
    mimeType: requireString(
      requireOwnData(resolution, "mimeType", "$context.assetResolutions[].mimeType"),
      "$context.assetResolutions[].mimeType",
    ),
    byteSize: requireInteger(
      requireOwnData(resolution, "byteSize", "$context.assetResolutions[].byteSize"),
      "$context.assetResolutions[].byteSize",
      0,
    ),
  };
}

function normalizeCelSourceResolution(value: unknown, keyframeUid: string): LegacyCelSourceResolution {
  const path = `$context.celSourceResolutions[${JSON.stringify(keyframeUid)}]`;
  const resolution = requireRecord(value, path);
  const type = requireString(requireOwnData(resolution, "type", `${path}.type`), `${path}.type`);
  if (type === "frame") {
    assertKnownKeys(resolution, ["type", "frameId"], path);
    return Object.freeze({
      type: "frame",
      frameId: requireInteger(requireOwnData(resolution, "frameId", `${path}.frameId`), `${path}.frameId`),
    });
  }
  if (type === "builder-slot") {
    assertKnownKeys(resolution, ["type", "gridIndex"], path);
    return Object.freeze({
      type: "builder-slot",
      gridIndex: requireInteger(
        requireOwnData(resolution, "gridIndex", `${path}.gridIndex`),
        `${path}.gridIndex`,
      ),
    });
  }
  throw new TypeError(`${path}.type is unsupported.`);
}

function normalizeMigrationContext(value: unknown): LegacyProjectV0MigrationContext {
  const context = requireRecord(value, "$context");
  assertKnownKeys(
    context,
    ["projectId", "projectName", "timestamp", "assetResolutions", "celSourceResolutions"],
    "$context",
  );
  const rawAssetResolutions = requireRecord(
    requireOwnData(context, "assetResolutions", "$context.assetResolutions"),
    "$context.assetResolutions",
  );
  const assetResolutions = Object.create(null) as Record<string, LegacyAssetResolution>;
  for (const sourceRef of Object.keys(rawAssetResolutions).sort()) {
    setRecord(
      assetResolutions,
      sourceRef,
      Object.freeze(validateResolution(
        requireOwnData(
          rawAssetResolutions,
          sourceRef,
          `$context.assetResolutions[${JSON.stringify(sourceRef)}]`,
        ),
        sourceRef,
      )),
    );
  }
  const rawCelSourceResolutions = optionalOwnData(
    context,
    "celSourceResolutions",
    "$context.celSourceResolutions",
  );
  let celSourceResolutions: Readonly<Record<string, LegacyCelSourceResolution>> | undefined;
  if (rawCelSourceResolutions.found && rawCelSourceResolutions.value !== undefined) {
    const rawResolutions = requireRecord(
      rawCelSourceResolutions.value,
      "$context.celSourceResolutions",
    );
    const normalized = Object.create(null) as Record<string, LegacyCelSourceResolution>;
    for (const keyframeUid of Object.keys(rawResolutions).sort()) {
      setRecord(
        normalized,
        keyframeUid,
        normalizeCelSourceResolution(
          requireOwnData(
            rawResolutions,
            keyframeUid,
            `$context.celSourceResolutions[${JSON.stringify(keyframeUid)}]`,
          ),
          keyframeUid,
        ),
      );
    }
    celSourceResolutions = Object.freeze(normalized);
  }
  return Object.freeze({
    projectId: requireString(
      requireOwnData(context, "projectId", "$context.projectId"),
      "$context.projectId",
    ),
    projectName: requireString(
      requireOwnData(context, "projectName", "$context.projectName"),
      "$context.projectName",
    ),
    timestamp: requireString(
      requireOwnData(context, "timestamp", "$context.timestamp"),
      "$context.timestamp",
    ),
    assetResolutions: Object.freeze(assetResolutions),
    ...(celSourceResolutions ? { celSourceResolutions } : {}),
  });
}

function sourceAssets(document: LegacyProjectV0Document): LegacySourceAsset[] {
  const sources: LegacySourceAsset[] = [];
  if (document.project.imageMeta) {
    sources.push({
      kind: "source-sheet",
      legacyId: "source-sheet",
      sourceRef: document.project.imageMeta.src,
      name: document.project.imageMeta.name,
      width: document.project.imageMeta.width,
      height: document.project.imageMeta.height,
      legacyByteSize: document.project.imageMeta.fileSize,
    });
  }
  for (const asset of document.project.builderAssets) {
    sources.push({
      kind: "builder",
      legacyId: asset.id,
      sourceRef: asset.src,
      name: asset.name,
      width: asset.width,
      height: asset.height,
    });
  }
  return sources;
}

function missingAssetIssues(
  sources: readonly LegacySourceAsset[],
  context: LegacyProjectV0MigrationContext,
): ProjectMigrationIssue[] {
  const issues: ProjectMigrationIssue[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.sourceRef)) continue;
    seen.add(source.sourceRef);
    if (ownValue(context.assetResolutions, source.sourceRef) === undefined) {
      issues.push({
        code: "LEGACY_ASSET_NEEDS_RELINK",
        category: "needs-relink",
        severity: "error",
        blocking: true,
        path: "$.project",
        message: `Legacy asset ${source.name} requires a durable binary resolution.`,
        entityId: source.legacyId,
        sourceRef: source.sourceRef,
      });
    }
  }
  return issues;
}

function resolutionEquals(
  resolution: LegacyCelSourceResolution,
  type: "frame" | "builder-slot",
  sourceIndex: number,
): boolean {
  return resolution.type === type && (
    type === "frame"
      ? (resolution as Extract<LegacyCelSourceResolution, { type: "frame" }>).frameId === sourceIndex
      : (resolution as Extract<LegacyCelSourceResolution, { type: "builder-slot" }>).gridIndex === sourceIndex
  );
}

function resolveCelSources(
  document: LegacyProjectV0Document,
  context: LegacyProjectV0MigrationContext,
): { resolved: Map<string, ResolvedCelSource>; issues: ProjectMigrationIssue[] } {
  const frames = new Map(document.project.frames.map((frame) => [frame.id, frame]));
  const slots = new Map(Object.values(document.project.builderSlots).map((slot) => [slot.gridIndex, slot]));
  const builderAssets = new Map(document.project.builderAssets.map((asset) => [asset.id, asset]));
  const resolved = new Map<string, ResolvedCelSource>();
  const issues: ProjectMigrationIssue[] = [];
  const keyframeUids = new Set(
    document.project.animations.flatMap((animation) => (
      animation.keyframes.map((keyframe) => keyframe.uid)
    )),
  );
  for (const keyframeUid of Object.keys(context.celSourceResolutions ?? {})) {
    if (!keyframeUids.has(keyframeUid)) {
      throw new TypeError(`Cel source resolution ${keyframeUid} does not match a legacy keyframe.`);
    }
  }
  for (const animation of document.project.animations) {
    for (const keyframe of animation.keyframes) {
      const frame = frames.get(keyframe.sourceIndex);
      const slot = slots.get(keyframe.sourceIndex);
      const requested = ownValue(context.celSourceResolutions, keyframe.uid) as LegacyCelSourceResolution | undefined;
      if (frame && slot) {
        if (
          !requested
          || (!resolutionEquals(requested, "frame", keyframe.sourceIndex)
            && !resolutionEquals(requested, "builder-slot", keyframe.sourceIndex))
        ) {
          issues.push({
            code: "AMBIGUOUS_LEGACY_CEL_SOURCE",
            category: "ambiguity",
            severity: "error",
            blocking: true,
            path: `$.project.animations.${animation.id}.keyframes.${keyframe.uid}.sourceIndex`,
            message: `Legacy sourceIndex ${keyframe.sourceIndex} matches both a frame and a Builder slot.`,
            entityId: keyframe.uid,
            choices: [
              { id: `frame:${frame.id}`, label: `Frame ${frame.id}` },
              { id: `builder-slot:${slot.gridIndex}`, label: `Builder slot ${slot.gridIndex}` },
            ],
          });
          continue;
        }
        if (requested.type === "frame") resolved.set(keyframe.uid, { type: "frame", frame });
        else {
          const asset = builderAssets.get(slot.assetId);
          if (asset) resolved.set(keyframe.uid, { type: "builder-slot", slot, asset });
        }
        continue;
      }
      if (frame) {
        if (requested && !resolutionEquals(requested, "frame", frame.id)) {
          throw new TypeError(`Cel source resolution for ${keyframe.uid} contradicts the only available frame.`);
        }
        resolved.set(keyframe.uid, { type: "frame", frame });
        continue;
      }
      if (slot) {
        if (requested && !resolutionEquals(requested, "builder-slot", slot.gridIndex)) {
          throw new TypeError(`Cel source resolution for ${keyframe.uid} contradicts the only available Builder slot.`);
        }
        const asset = builderAssets.get(slot.assetId);
        if (asset) {
          resolved.set(keyframe.uid, { type: "builder-slot", slot, asset });
          continue;
        }
      }
      issues.push({
        code: "LEGACY_CEL_SOURCE_NEEDS_RELINK",
        category: "needs-relink",
        severity: "error",
        blocking: true,
        path: `$.project.animations.${animation.id}.keyframes.${keyframe.uid}.sourceIndex`,
        message: `No legacy frame or resolvable Builder slot matches sourceIndex ${keyframe.sourceIndex}.`,
        entityId: keyframe.uid,
        sourceRef: `legacy-source-index:${keyframe.sourceIndex}`,
      });
    }
  }
  return { resolved, issues };
}

function setRecord<T>(record: Record<string, T>, id: string, value: T): void {
  if (Object.prototype.hasOwnProperty.call(record, id)) throw new TypeError(`Duplicate canonical ID ${id}.`);
  Object.defineProperty(record, id, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function mapWorkspace(mode: string): WorkspaceId | undefined {
  const normalized = mode.toUpperCase();
  if (normalized === "SLICER" || normalized === "SLICE") return "slice";
  if (normalized === "BUILDER" || normalized === "COMPOSE") return "compose";
  if (normalized === "ANIMATION" || normalized === "ANIMATE") return "animate";
  if (normalized === "COLLISION") return "collision";
  if (normalized === "ASSETS") return "assets";
  if (normalized === "EXPORT") return "export";
  return undefined;
}

function mapCollisionType(type: string): CollisionShapeType {
  const normalized = type.toUpperCase();
  if (normalized === "HURTBOX") return "hurtbox";
  if (normalized === "HITBOX") return "hitbox";
  if (normalized === "SOLID") return "solid";
  if (normalized === "TRIGGER") return "trigger";
  throw new TypeError(`Unsupported legacy collision type ${type}.`);
}

function gridGeometry(width: number, height: number, grid: LegacyGrid) {
  const cellW = Math.max(1, (
    width - grid.marginX * 2 - grid.paddingX * Math.max(0, grid.cols - 1)
  ) / grid.cols);
  const cellH = Math.max(1, (
    height - grid.marginY * 2 - grid.paddingY * Math.max(0, grid.rows - 1)
  ) / grid.rows);
  return { cellW, cellH };
}

function alignmentOffset(alignment: string, cellW: number, cellH: number, width: number, height: number) {
  const x = alignment.includes("left") ? 0 : alignment.includes("right") ? cellW - width : (cellW - width) / 2;
  const y = alignment.includes("top") ? 0 : alignment.includes("bottom") ? cellH - height : (cellH - height) / 2;
  return { x, y };
}

function builderSlotTransform(
  slot: LegacyBuilderSlot,
  asset: LegacyBuilderAsset,
  canvas: { width: number; height: number },
  grid: LegacyGrid,
) {
  const { cellW, cellH } = gridGeometry(canvas.width, canvas.height, grid);
  const column = slot.gridIndex % grid.cols;
  const row = Math.floor(slot.gridIndex / grid.cols);
  if (row >= grid.rows) throw new TypeError(`Builder slot ${slot.gridIndex} is outside its grid.`);
  let baseScaleX = 1;
  let baseScaleY = 1;
  if (slot.fitMode === "fit") {
    baseScaleX = baseScaleY = Math.min(cellW / asset.width, cellH / asset.height);
  } else if (slot.fitMode === "fill") {
    baseScaleX = baseScaleY = Math.max(cellW / asset.width, cellH / asset.height);
  } else if (slot.fitMode === "stretch") {
    baseScaleX = cellW / asset.width;
    baseScaleY = cellH / asset.height;
  }
  const scaleX = baseScaleX * slot.scaleX;
  const scaleY = baseScaleY * slot.scaleY;
  const width = asset.width * scaleX;
  const height = asset.height * scaleY;
  const align = alignmentOffset(slot.alignment, cellW, cellH, width, height);
  return {
    x: grid.marginX + column * (cellW + grid.paddingX) + align.x + width / 2 + slot.offsetX,
    y: grid.marginY + row * (cellH + grid.paddingY) + align.y + height / 2 + slot.offsetY,
    scaleX,
    scaleY,
    rotation: slot.rotation,
    opacity: slot.opacity,
    flipX: slot.flipX,
    flipY: slot.flipY,
  };
}

function buildCanonicalProject(
  document: LegacyProjectV0Document,
  context: LegacyProjectV0MigrationContext,
  sources: readonly LegacySourceAsset[],
  celSources: ReadonlyMap<string, ResolvedCelSource>,
): StudioProjectV1 {
  const project = createEmptyStudioProject({
    id: context.projectId,
    name: context.projectName,
    now: context.timestamp,
  });
  const resolvedAssetIds = new Map<string, string>();
  const assetsByContentHash = new Map<string, AssetRecord>();
  const canonicalAssetIds = new Set<string>();
  let sourceAssetId: string | undefined;
  for (const source of sources) {
    const resolution = validateResolution(ownValue(context.assetResolutions, source.sourceRef), source.sourceRef);
    if (source.legacyByteSize !== undefined && source.legacyByteSize !== resolution.byteSize) {
      throw new TypeError(`Resolved byteSize for ${source.sourceRef} does not match legacy metadata.`);
    }
    const sourceKey = source.kind === "source-sheet"
      ? "source-sheet"
      : `builder:${source.legacyId}`;
    const existing = assetsByContentHash.get(resolution.contentHash);
    if (existing) {
      if (
        existing.blobKey !== resolution.blobKey
        || existing.mimeType !== resolution.mimeType
        || existing.byteSize !== resolution.byteSize
        || existing.width !== source.width
        || existing.height !== source.height
      ) {
        throw new TypeError(`Resolved content identity ${resolution.contentHash} has contradictory metadata.`);
      }
      resolvedAssetIds.set(sourceKey, existing.id);
      if (source.kind === "source-sheet") sourceAssetId = existing.id;
      continue;
    }
    if (canonicalAssetIds.has(resolution.assetId)) {
      throw new TypeError(`Canonical asset ID ${resolution.assetId} resolves distinct content hashes.`);
    }
    const asset: AssetRecord = {
      id: resolution.assetId,
      name: source.name,
      blobKey: resolution.blobKey,
      contentHash: resolution.contentHash,
      mimeType: resolution.mimeType,
      width: source.width,
      height: source.height,
      byteSize: resolution.byteSize,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
      provenance: {
        source: "legacy",
        sourceId: /^(?:blob:|data:)/iu.test(source.sourceRef) ? sourceKey : source.sourceRef,
        importedAt: context.timestamp,
      },
    };
    setRecord(project.assets, asset.id, asset);
    project.rootOrder.assetIds.push(asset.id);
    assetsByContentHash.set(asset.contentHash, asset);
    canonicalAssetIds.add(asset.id);
    resolvedAssetIds.set(sourceKey, asset.id);
    if (source.kind === "source-sheet") sourceAssetId = asset.id;
  }

  for (const frame of document.project.frames) {
    if (!sourceAssetId) throw new TypeError("Legacy frames require imageMeta and a resolved source sheet.");
    const id = `legacy:region:${frame.id}`;
    const region: Region = {
      id,
      assetId: sourceAssetId,
      name: `Legacy frame ${frame.id}`,
      bounds: { x: frame.x, y: frame.y, width: frame.w, height: frame.h },
      ...(frame.hidden === undefined ? {} : { hidden: frame.hidden }),
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
      provenance: { source: "legacy", sourceId: String(frame.id), importedAt: context.timestamp },
    };
    setRecord(project.regions, id, region);
    project.rootOrder.regionIds.push(id);
    if (frame.hitboxes && frame.hitboxes.length > 0) {
      const collisionId = `legacy:collision:region:${frame.id}`;
      const collision: CollisionSet = {
        id: collisionId,
        owner: { type: "region", regionId: id },
        shapes: frame.hitboxes.map((shape) => ({
          id: shape.id,
          type: mapCollisionType(shape.type),
          bounds: { x: shape.x, y: shape.y, width: shape.w, height: shape.h },
          tag: shape.tag,
        })),
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      };
      setRecord(project.collisionSets, collisionId, collision);
    }
  }

  const builderAssets = new Map(document.project.builderAssets.map((asset) => [asset.id, asset]));
  if (document.project.builderCanvas) {
    const compositionId = "legacy:composition:builder";
    const composition: Composition = {
      id: compositionId,
      name: "Legacy Builder canvas",
      owner: { type: "project" },
      layerIds: [],
      width: document.project.builderCanvas.width,
      height: document.project.builderCanvas.height,
      background: document.ui.templateConfig.backgroundColor,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
    };
    const slots = Object.values(document.project.builderSlots).sort((left, right) => left.gridIndex - right.gridIndex);
    for (const slot of slots) {
      const legacyAsset = builderAssets.get(slot.assetId);
      const assetId = resolvedAssetIds.get(`builder:${slot.assetId}`);
      if (!legacyAsset || !assetId) throw new TypeError(`Builder slot ${slot.gridIndex} references an unknown asset.`);
      const layer: Layer = {
        id: `legacy:layer:builder-slot:${slot.gridIndex}`,
        compositionId,
        name: `Legacy Builder slot ${slot.gridIndex}`,
        source: { type: "asset", id: assetId },
        transform: builderSlotTransform(slot, legacyAsset, document.project.builderCanvas, document.ui.builderGrid),
        visible: true,
        locked: false,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      };
      setRecord(project.layers, layer.id, layer);
      composition.layerIds.push(layer.id);
    }
    const freeObjects = document.project.builderFreeObjects
      .map((object, index) => ({ object, index }))
      .sort((left, right) => left.object.zIndex - right.object.zIndex || left.index - right.index);
    for (const { object } of freeObjects) {
      const legacyAsset = builderAssets.get(object.assetId);
      const assetId = resolvedAssetIds.get(`builder:${object.assetId}`);
      if (!legacyAsset || !assetId) throw new TypeError(`Builder free object ${object.id} references an unknown asset.`);
      const layer: Layer = {
        id: `legacy:layer:builder-free:${object.id}`,
        compositionId,
        name: `Legacy free object ${object.id}`,
        source: { type: "asset", id: assetId },
        transform: {
          x: object.x + object.w / 2,
          y: object.y + object.h / 2,
          scaleX: object.w / legacyAsset.width,
          scaleY: object.h / legacyAsset.height,
          rotation: object.rotation,
          opacity: object.opacity,
          flipX: object.flipX,
          flipY: object.flipY,
        },
        visible: true,
        locked: false,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      };
      setRecord(project.layers, layer.id, layer);
      composition.layerIds.push(layer.id);
    }
    setRecord(project.compositions, compositionId, composition);
    project.rootOrder.compositionIds.push(compositionId);
    project.workspace.selectedCompositionId = compositionId;
  } else if (
    Object.keys(document.project.builderSlots).length > 0
    || document.project.builderFreeObjects.length > 0
  ) {
    throw new TypeError("Legacy Builder content requires builderCanvas.");
  }

  for (const animation of document.project.animations) {
    const sequenceId = `legacy:sequence:${animation.id}`;
    const durationMs = 1000 / animation.fps;
    const sequence: Sequence = {
      id: sequenceId,
      name: animation.name,
      celIds: [],
      fps: animation.fps,
      defaultDurationMs: durationMs,
      loop: animation.loop,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
    };
    for (const keyframe of animation.keyframes) {
      const resolved = celSources.get(keyframe.uid);
      if (!resolved) throw new TypeError(`Keyframe ${keyframe.uid} has no resolved source.`);
      const celId = `legacy:cel:${keyframe.uid}`;
      let source: Cel["source"];
      let pivotWidth: number;
      let pivotHeight: number;
      if (resolved.type === "frame") {
        source = { type: "region", regionId: `legacy:region:${resolved.frame.id}` };
        pivotWidth = resolved.frame.w;
        pivotHeight = resolved.frame.h;
      } else {
        const assetId = resolvedAssetIds.get(`builder:${resolved.asset.id}`);
        if (!assetId) throw new TypeError(`Keyframe ${keyframe.uid} Builder asset is unresolved.`);
        const compositionId = `legacy:composition:cel:${keyframe.uid}`;
        const layerId = `legacy:layer:cel:${keyframe.uid}`;
        const layer: Layer = {
          id: layerId,
          compositionId,
          name: `Legacy cel source ${keyframe.uid}`,
          source: { type: "asset", id: assetId },
          transform: {
            x: resolved.asset.width / 2,
            y: resolved.asset.height / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            opacity: 1,
            flipX: resolved.slot.flipX,
            flipY: resolved.slot.flipY,
          },
          visible: true,
          locked: false,
          createdAt: context.timestamp,
          updatedAt: context.timestamp,
        };
        const composition: Composition = {
          id: compositionId,
          name: `Legacy cel composition ${keyframe.uid}`,
          owner: { type: "cel", celId },
          layerIds: [layerId],
          width: resolved.asset.width,
          height: resolved.asset.height,
          createdAt: context.timestamp,
          updatedAt: context.timestamp,
        };
        setRecord(project.layers, layerId, layer);
        setRecord(project.compositions, compositionId, composition);
        source = { type: "composition", compositionId };
        pivotWidth = resolved.asset.width;
        pivotHeight = resolved.asset.height;
      }
      const cel: Cel = {
        id: celId,
        sequenceId,
        source,
        durationMs,
        pivot: { x: pivotWidth * keyframe.pivotX, y: pivotHeight * keyframe.pivotY },
        transform: {
          rotation: keyframe.rotation ?? 0,
          scaleX: keyframe.scaleX ?? 1,
          scaleY: keyframe.scaleY ?? 1,
          opacity: keyframe.opacity ?? 1,
        },
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      };
      setRecord(project.cels, celId, cel);
      sequence.celIds.push(celId);
    }
    setRecord(project.sequences, sequenceId, sequence);
    project.rootOrder.sequenceIds.push(sequenceId);
  }

  if (sourceAssetId) {
    const grid = document.ui.slicerGrid;
    const recipe: ProcessingRecipe = {
      id: "legacy:recipe:slicer-grid",
      name: "Legacy slicer grid",
      kind: "grid-split",
      version: 1,
      sourceAssetId,
      layout: { mode: "manual", rows: grid.rows, cols: grid.cols },
      crop: { threshold: 0, padding: 0 },
      chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
      pixel: { enabled: false, size: 1, quantize: false, colors: 256 },
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
    };
    setRecord(project.processingRecipes, recipe.id, recipe);
    project.workspace.selectedAssetId = sourceAssetId;
    if (project.rootOrder.regionIds[0]) project.workspace.selectedRegionId = project.rootOrder.regionIds[0];
  }
  const activeWorkspace = mapWorkspace(document.ui.currentMode);
  if (activeWorkspace) project.workspace.activeWorkspace = activeWorkspace;
  if (project.rootOrder.sequenceIds[0]) project.workspace.selectedSequenceId = project.rootOrder.sequenceIds[0];

  const validation = validateStudioProject(project);
  if (!validation.valid) {
    const summary = validation.diagnostics.slice(0, 5).map(({ code, path }) => `${code}@${path}`).join(", ");
    throw new TypeError(`Legacy migration produced an invalid V1 project: ${summary}.`);
  }
  return project;
}

function completedIssues(
  document: LegacyProjectV0Document,
  sources: readonly LegacySourceAsset[],
  context: LegacyProjectV0MigrationContext,
): ProjectMigrationIssue[] {
  const issues: ProjectMigrationIssue[] = [
    {
      code: "LEGACY_PROJECT_NORMALIZED",
      category: "change",
      severity: "info",
      blocking: false,
      path: "$.project",
      message: "Legacy indexed project state was normalized into stable V1 entities.",
    },
  ];
  if (Object.keys(document.project.builderSlots).length > 0) {
    issues.push({
      code: "LEGACY_BUILDER_SLOT_CONSTRAINTS_FLATTENED",
      category: "loss",
      severity: "warning",
      blocking: false,
      path: "$.project.builderSlots",
      message: "Builder fit/alignment constraints were flattened to exact current transforms; future grid resize behavior is not preserved.",
    });
  }
  if (document.project.aspectRatio !== undefined) {
    issues.push({
      code: "LEGACY_ASPECT_RATIO_NOT_STORED",
      category: "loss",
      severity: "warning",
      blocking: false,
      path: "$.project.aspectRatio",
      message: "The legacy aspect-ratio label is not stored in V1; canonical canvas dimensions preserve the current ratio.",
    });
  }
  const hashes = new Set<string>();
  let deduplicated = 0;
  for (const source of sources) {
    const resolution = ownValue(context.assetResolutions, source.sourceRef) as LegacyAssetResolution;
    if (hashes.has(resolution.contentHash)) deduplicated += 1;
    else hashes.add(resolution.contentHash);
  }
  if (deduplicated > 0) {
    issues.push({
      code: "LEGACY_ASSET_CONTENT_DEDUPLICATED",
      category: "change",
      severity: "info",
      blocking: false,
      path: "$.project",
      message: `${deduplicated} duplicate legacy asset reference${deduplicated === 1 ? " was" : "s were"} mapped to canonical content identity.`,
    });
  }
  if (
    document.ui.slicerGrid.marginX !== 0
    || document.ui.slicerGrid.marginY !== 0
    || document.ui.slicerGrid.paddingX !== 0
    || document.ui.slicerGrid.paddingY !== 0
  ) {
    issues.push({
      code: "LEGACY_SLICER_GRID_SPACING_NOT_REPRESENTED",
      category: "loss",
      severity: "warning",
      blocking: false,
      path: "$.ui.slicerGrid",
      message: "V1 processing recipes preserve rows/columns but not legacy grid margin/gap values.",
    });
  }
  issues.push({
    code: "LEGACY_VIEW_PREFERENCES_NOT_PROJECT_DATA",
    category: "loss",
    severity: "warning",
    blocking: false,
    path: "$.ui",
    message: "Grid labels/colors and onion-skin settings are interaction preferences and were not embedded in the V1 project.",
  });
  return issues;
}

export const legacyProjectV0ToV1Step = Object.freeze({
  id: "legacy-project-v0-to-v1",
  fromVersion: 0,
  toVersion: 1,
  migrate(
    document: unknown,
    context: LegacyProjectV0MigrationContext,
  ): ProjectMigrationStepResult {
    assertLegacyProjectV0(document);
    const normalizedContext = normalizeMigrationContext(context);
    const sources = sourceAssets(document);
    const celResolution = resolveCelSources(document, normalizedContext);
    const blockingIssues = [
      ...missingAssetIssues(sources, normalizedContext),
      ...celResolution.issues,
    ];
    if (blockingIssues.length > 0) return { status: "needs-input", issues: blockingIssues };
    return {
      status: "completed",
      document: buildCanonicalProject(document, normalizedContext, sources, celResolution.resolved),
      issues: completedIssues(document, sources, normalizedContext),
    };
  },
} satisfies ProjectMigrationStep<LegacyProjectV0MigrationContext>);

export const legacyProjectV0Migrator = new ProjectMigrator([legacyProjectV0ToV1Step]);

export function migrateLegacyProjectV0(
  document: unknown,
  context: LegacyProjectV0MigrationContext,
  signal?: AbortSignal,
): Promise<ProjectMigrationResult> {
  return legacyProjectV0Migrator.migrate(document, {
    sourceVersion: 0,
    targetVersion: 1,
    context,
    ...(signal ? { signal } : {}),
  });
}
