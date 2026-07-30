import type {
  EntityId,
  ISO8601Timestamp,
  Layer,
  LayerSource,
  LayerTransform,
} from "../../../core/project";
import { isEntityId, isISO8601Timestamp } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";

const POSITION_LIMIT = 1_000_000;
const SCALE_MIN = 0.01;
const SCALE_MAX = 32;

export type LayerEditHistory =
  | { readonly mode: "record" }
  | { readonly mode: "coalesce"; readonly transactionId: EntityId };

export type LayerEditResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly message: string };

export interface ComposeLayerEditor {
  select(layerId: EntityId | null): LayerEditResult;
  add(compositionId: EntityId, source: LayerSource, name?: string): LayerEditResult;
  duplicate(layerId: EntityId): LayerEditResult;
  remove(layerId: EntityId): LayerEditResult;
  move(layerId: EntityId, direction: "forward" | "backward"): LayerEditResult;
  rename(layerId: EntityId, name: string): LayerEditResult;
  setVisible(layerId: EntityId, visible: boolean): LayerEditResult;
  setLocked(layerId: EntityId, locked: boolean): LayerEditResult;
  setTransform(
    layerId: EntityId,
    patch: Partial<LayerTransform>,
    history?: LayerEditHistory,
  ): LayerEditResult;
  resetTransform(layerId: EntityId): LayerEditResult;
}

export interface ComposeLayerEditorOptions {
  readonly store: ProjectStore;
  readonly nextId: (kind: "command" | "layer") => EntityId;
  readonly now: () => ISO8601Timestamp;
}

const FAILURE = Object.freeze({
  ok: false as const,
  message: "Layer edit could not be applied.",
});

function clamp(value: number, min: number, max: number): number {
  const result = Math.min(max, Math.max(min, value));
  return Object.is(result, -0) ? 0 : result;
}

function normalizeRotation(value: number): number {
  const result = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(result, -0) ? 0 : result;
}

function normalizeTransformPatch(
  patch: Partial<LayerTransform>,
): Partial<LayerTransform> | null {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return null;
  const allowed = new Set([
    "x",
    "y",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity",
    "flipX",
    "flipY",
  ]);
  const result: Partial<LayerTransform> = {};
  try {
    for (const key of Reflect.ownKeys(patch)) {
      if (typeof key !== "string" || !allowed.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(patch, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      const value = descriptor.value;
      if (key === "flipX" || key === "flipY") {
        if (typeof value !== "boolean") return null;
        result[key] = value;
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      if (key === "x" || key === "y") {
        result[key] = clamp(value, -POSITION_LIMIT, POSITION_LIMIT);
      } else if (key === "scaleX" || key === "scaleY") {
        result[key] = clamp(value, SCALE_MIN, SCALE_MAX);
      } else if (key === "rotation") {
        result.rotation = normalizeRotation(value);
      } else {
        result.opacity = clamp(value, 0, 1);
      }
    }
  } catch {
    return null;
  }
  return result;
}

function sourceExists(
  project: ReturnType<ProjectStore["getSnapshot"]>["project"],
  source: LayerSource,
): boolean {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return false;
  try {
    const keys = Reflect.ownKeys(source);
    if (keys.length !== 2 || !keys.includes("type") || !keys.includes("id")) return false;
    if (!isEntityId(source.id)) return false;
    if (source.type === "asset") return project.assets[source.id]?.media.type === "image";
    if (source.type !== "region") return false;
    const region = project.regions[source.id];
    return Boolean(region && project.assets[region.assetId]?.media.type === "image");
  } catch {
    return false;
  }
}

function normalizeName(name: string | undefined, fallback: string): string | null {
  if (name === undefined) return fallback;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function mergeTransform(
  current: LayerTransform,
  patch: Partial<LayerTransform>,
): LayerTransform {
  return { ...current, ...patch };
}

export function createComposeLayerEditor(
  options: ComposeLayerEditorOptions,
): ComposeLayerEditor {
  const dispatch = (
    command: Parameters<ProjectStore["dispatch"]>[0]["command"],
    history: LayerEditHistory | { readonly mode: "ignore" } = { mode: "record" },
  ): LayerEditResult => {
    try {
      const commandId = options.nextId("command");
      const issuedAt = options.now();
      if (
        !isEntityId(commandId) ||
        !isISO8601Timestamp(issuedAt) ||
        (history.mode === "coalesce" && !isEntityId(history.transactionId))
      ) return FAILURE;
      const dispatched = options.store.dispatch({
        command,
        metadata: {
          commandId,
          origin: "user",
          history: history.mode,
          ...(history.mode === "coalesce" ? { transactionId: history.transactionId } : {}),
          issuedAt,
        },
      });
      return dispatched.result.ok
        ? Object.freeze({ ok: true, revision: dispatched.revision })
        : FAILURE;
    } catch {
      return FAILURE;
    }
  };

  const activeLayer = (layerId: EntityId): Layer | null => {
    if (!isEntityId(layerId)) return null;
    try {
      const project = options.store.getSnapshot().project;
      const compositionId = project.workspace.selectedCompositionId;
      const composition = compositionId ? project.compositions[compositionId] : undefined;
      const layer = project.layers[layerId];
      if (!composition || !layer || layer.compositionId !== composition.id) return null;
      return composition.layerIds.includes(layerId) ? layer : null;
    } catch {
      return null;
    }
  };

  const editor: ComposeLayerEditor = {
    select(layerId) {
      if (layerId !== null && !activeLayer(layerId)) return FAILURE;
      return dispatch({
        type: "workspace.update",
        patch: { selectedLayerId: layerId ?? undefined },
      }, { mode: "ignore" });
    },
    add(compositionId, source, name) {
      if (!isEntityId(compositionId)) return FAILURE;
      try {
        const project = options.store.getSnapshot().project;
        const composition = project.compositions[compositionId];
        if (
          !composition ||
          project.workspace.selectedCompositionId !== compositionId ||
          !sourceExists(project, source)
        ) return FAILURE;
        const sourceRecord = source.type === "asset"
          ? project.assets[source.id]
          : project.regions[source.id];
        const layerName = normalizeName(name, sourceRecord?.name?.trim() || "Layer");
        const layerId = options.nextId("layer");
        const now = options.now();
        if (!layerName || !isEntityId(layerId) || !isISO8601Timestamp(now)) return FAILURE;
        const layer: Layer = {
          id: layerId,
          compositionId,
          name: layerName,
          source: { type: source.type, id: source.id },
          transform: {
            x: composition.width / 2,
            y: composition.height / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            opacity: 1,
            flipX: false,
            flipY: false,
          },
          visible: true,
          locked: false,
          createdAt: now,
          updatedAt: now,
        };
        return dispatch({
          type: "command.batch",
          commands: [
            { type: "layer.add", compositionId, layer },
            { type: "workspace.update", patch: { selectedLayerId: layerId } },
          ],
        });
      } catch {
        return FAILURE;
      }
    },
    duplicate(layerId) {
      const layer = activeLayer(layerId);
      if (!layer || layer.locked) return FAILURE;
      try {
        const project = options.store.getSnapshot().project;
        const composition = project.compositions[layer.compositionId];
        const index = composition?.layerIds.indexOf(layerId) ?? -1;
        const copyId = options.nextId("layer");
        const now = options.now();
        if (!composition || index < 0 || !isEntityId(copyId) || !isISO8601Timestamp(now)) return FAILURE;
        const copy: Layer = {
          ...layer,
          id: copyId,
          name: `${layer.name?.trim() || "Layer"} copy`.slice(0, 128),
          source: { ...layer.source },
          transform: { ...layer.transform },
          createdAt: now,
          updatedAt: now,
        };
        return dispatch({
          type: "command.batch",
          commands: [
            { type: "layer.add", compositionId: composition.id, layer: copy, atIndex: index + 1 },
            { type: "workspace.update", patch: { selectedLayerId: copyId } },
          ],
        });
      } catch {
        return FAILURE;
      }
    },
    remove(layerId) {
      const layer = activeLayer(layerId);
      if (!layer || layer.locked) return FAILURE;
      try {
        const selected = options.store.getSnapshot().project.workspace.selectedLayerId === layerId;
        return dispatch(selected ? {
          type: "command.batch",
          commands: [
            { type: "layer.remove", layerId },
            { type: "workspace.update", patch: { selectedLayerId: undefined } },
          ],
        } : { type: "layer.remove", layerId });
      } catch {
        return FAILURE;
      }
    },
    move(layerId, direction) {
      const layer = activeLayer(layerId);
      if (!layer || layer.locked || (direction !== "forward" && direction !== "backward")) {
        return FAILURE;
      }
      try {
        const snapshot = options.store.getSnapshot();
        const composition = snapshot.project.compositions[layer.compositionId];
        const current = composition?.layerIds.indexOf(layerId) ?? -1;
        const target = direction === "forward" ? current + 1 : current - 1;
        if (!composition || current < 0) return FAILURE;
        if (target < 0 || target >= composition.layerIds.length) {
          return Object.freeze({ ok: true, revision: snapshot.revision });
        }
        return dispatch({ type: "layer.reorder", layerId, toIndex: target });
      } catch {
        return FAILURE;
      }
    },
    rename(layerId, name) {
      const layer = activeLayer(layerId);
      const normalized = normalizeName(name, "Layer");
      if (!layer || layer.locked || !normalized) return FAILURE;
      return dispatch({
        type: "layer.update",
        layerId,
        patch: { name: normalized, updatedAt: options.now() },
      });
    },
    setVisible(layerId, visible) {
      const layer = activeLayer(layerId);
      if (!layer || typeof visible !== "boolean") return FAILURE;
      return dispatch({
        type: "layer.update",
        layerId,
        patch: { visible, updatedAt: options.now() },
      });
    },
    setLocked(layerId, locked) {
      const layer = activeLayer(layerId);
      if (!layer || typeof locked !== "boolean") return FAILURE;
      return dispatch({
        type: "layer.update",
        layerId,
        patch: { locked, updatedAt: options.now() },
      });
    },
    setTransform(layerId, patch, history = { mode: "record" }) {
      const layer = activeLayer(layerId);
      const normalized = normalizeTransformPatch(patch);
      if (!layer || layer.locked || !normalized || Object.keys(normalized).length === 0) {
        return FAILURE;
      }
      return dispatch({
        type: "layer.update",
        layerId,
        patch: {
          transform: mergeTransform(layer.transform, normalized),
          ...(
            layer.cellIndex !== undefined &&
            ["x", "y", "scaleX", "scaleY"].some((key) => Object.hasOwn(normalized, key))
              ? { cellIndex: undefined }
              : {}
          ),
          updatedAt: options.now(),
        },
      }, history);
    },
    resetTransform(layerId) {
      const layer = activeLayer(layerId);
      if (!layer || layer.locked) return FAILURE;
      return dispatch({
        type: "layer.update",
        layerId,
        patch: {
          ...(layer.cellIndex === undefined ? {} : { cellIndex: undefined }),
          transform: {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            opacity: layer.transform.opacity,
            flipX: false,
            flipY: false,
          },
          updatedAt: options.now(),
        },
      });
    },
  };
  return Object.freeze(editor);
}
