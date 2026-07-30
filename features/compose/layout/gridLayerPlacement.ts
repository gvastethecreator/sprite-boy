import type {
  CompositionLayout,
  EntityId,
  ISO8601Timestamp,
  LayerTransform,
  ProjectCommand,
  StudioProject,
} from "../../../core/project";
import type { DeepReadonly } from "../../../core/stores";
import { resolveCompositionDropTransform, resolveCompositionLayout } from "./compositionLayout";

export interface CompositionGridReflowPatch {
  readonly width?: number;
  readonly height?: number;
  readonly layout?: CompositionLayout;
}

function sourceDimensions(
  project: DeepReadonly<StudioProject>,
  layer: DeepReadonly<StudioProject["layers"][string]>,
): { readonly width: number; readonly height: number } | null {
  if (layer.source.type === "asset") {
    const asset = project.assets[layer.source.id];
    return asset ? { width: asset.width, height: asset.height } : null;
  }
  const region = project.regions[layer.source.id];
  return region ? { width: region.bounds.width, height: region.bounds.height } : null;
}

function sameTransform(left: DeepReadonly<LayerTransform>, right: LayerTransform): boolean {
  return left.x === right.x && left.y === right.y &&
    left.scaleX === right.scaleX && left.scaleY === right.scaleY &&
    left.rotation === right.rotation && left.opacity === right.opacity &&
    left.flipX === right.flipX && left.flipY === right.flipY;
}

/**
 * Build explicit layer updates for grid-managed layers. Keeping these updates
 * in a batch makes canvas/layout edits honest in impact analysis and undo.
 */
export function createGridLayerReflowCommands(
  project: DeepReadonly<StudioProject>,
  compositionId: EntityId,
  patch: CompositionGridReflowPatch,
  issuedAt: ISO8601Timestamp,
): readonly ProjectCommand[] {
  const composition = project.compositions[compositionId];
  if (!composition) return [];
  const nextComposition = {
    width: patch.width ?? composition.width,
    height: patch.height ?? composition.height,
    layout: patch.layout ?? resolveCompositionLayout(composition),
  };
  const layout = resolveCompositionLayout(nextComposition);
  if (layout.mode !== "grid") return [];
  if (
    !Number.isSafeInteger(layout.rows) || layout.rows < 1 || layout.rows > 12 ||
    !Number.isSafeInteger(layout.columns) || layout.columns < 1 || layout.columns > 12 ||
    !Number.isSafeInteger(layout.gap) || layout.gap < 0 || layout.gap > 1_024 ||
    !Number.isSafeInteger(nextComposition.width) || nextComposition.width < 1 ||
    !Number.isSafeInteger(nextComposition.height) || nextComposition.height < 1 ||
    layout.gap * (layout.columns - 1) >= nextComposition.width ||
    layout.gap * (layout.rows - 1) >= nextComposition.height
  ) return [];
  const maximumCell = layout.rows * layout.columns - 1;
  const commands: ProjectCommand[] = [];
  for (const layerId of composition.layerIds) {
    const layer = project.layers[layerId];
    if (!layer || layer.cellIndex === undefined) continue;
    const source = sourceDimensions(project, layer);
    if (!source) continue;
    const cellIndex = Math.min(layer.cellIndex, maximumCell);
    const placement = resolveCompositionDropTransform({
      composition: nextComposition,
      source,
      cellIndex,
    });
    const transform: LayerTransform = {
      ...layer.transform,
      x: placement.x,
      y: placement.y,
      scaleX: placement.scaleX,
      scaleY: placement.scaleY,
    };
    if (cellIndex === layer.cellIndex && sameTransform(layer.transform, transform)) continue;
    commands.push({
      type: "layer.update",
      layerId,
      patch: {
        transform,
        ...(cellIndex === layer.cellIndex ? {} : { cellIndex }),
        updatedAt: issuedAt,
      },
    });
  }
  return Object.freeze(commands);
}
