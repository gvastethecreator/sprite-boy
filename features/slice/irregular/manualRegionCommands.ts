import type { ProjectCommand } from "../../../core/project/commands";
import { cloneDataOnly } from "../../../core/project/dataBoundary";
import { isEntityId, isISO8601Timestamp } from "../../../core/project/primitives";
import type { Rect, StudioProjectV1 } from "../../../core/project/schema";
import { validateStudioProject } from "../../../core/project/validation";

export const MAX_MANUAL_REGIONS = 4096;
export const MAX_MANUAL_REGION_ID_LENGTH = 4096;

export type ManualRegionIntent =
  | {
      readonly type: "create";
      readonly regionId: string;
      readonly sourceAssetId: string;
      readonly bounds: Rect;
      readonly timestamp: string;
      readonly atIndex?: number;
    }
  | {
      readonly type: "move";
      readonly regionId: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "resize";
      readonly regionId: string;
      readonly bounds: Rect;
    }
  | {
      readonly type: "delete";
      readonly regionId: string;
    };

export type ManualRegionCommand = Extract<
  ProjectCommand,
  { type: "region.create" | "region.update" | "region.remove" }
>;

function invalid(message: string): TypeError {
  return new TypeError(`Manual Region command adapter ${message}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownRecordValue<T>(record: Record<string, T>, id: string): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, id);
  return descriptor && "value" in descriptor && descriptor.enumerable
    ? descriptor.value
    : undefined;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !keys.includes(key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) throw invalid("received an invalid intent shape");
}

function readEntityId(value: unknown, label: string): string {
  if (!isEntityId(value) || value.length > MAX_MANUAL_REGION_ID_LENGTH) {
    throw invalid(`${label} must be a bounded EntityId`);
  }
  return value;
}

function readBounds(value: unknown): Readonly<Rect> {
  if (!isRecord(value)) throw invalid("bounds must be an exact source-space rectangle");
  exactKeys(value, ["x", "y", "width", "height"]);
  const { x, y, width, height } = value;
  if (
    !Number.isSafeInteger(x) || (x as number) < 0
    || !Number.isSafeInteger(y) || (y as number) < 0
    || !Number.isSafeInteger(width) || (width as number) < 1
    || !Number.isSafeInteger(height) || (height as number) < 1
  ) throw invalid("bounds must use safe integers and positive dimensions");
  return Object.freeze({ x: x as number, y: y as number, width: width as number, height: height as number });
}

function readProject(value: unknown): StudioProjectV1 {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok) throw invalid("requires a canonical data-only StudioProjectV1");
  const validation = validateStudioProject(cloned.value);
  if (!validation.valid) throw invalid("requires a valid canonical StudioProjectV1");
  return cloned.value as StudioProjectV1;
}

function readIntent(value: unknown): ManualRegionIntent {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || !isRecord(cloned.value) || typeof cloned.value.type !== "string") {
    throw invalid("received an invalid intent shape");
  }
  const intent = cloned.value;
  switch (intent.type) {
    case "create": {
      exactKeys(intent, ["type", "regionId", "sourceAssetId", "bounds", "timestamp"], ["atIndex"]);
      const regionId = readEntityId(intent.regionId, "regionId");
      const sourceAssetId = readEntityId(intent.sourceAssetId, "sourceAssetId");
      const bounds = readBounds(intent.bounds);
      if (!isISO8601Timestamp(intent.timestamp)) throw invalid("timestamp must be ISO-8601");
      if (
        intent.atIndex !== undefined
        && (!Number.isSafeInteger(intent.atIndex) || (intent.atIndex as number) < 0)
      ) throw invalid("atIndex must be a non-negative safe integer");
      return Object.freeze({
        type: "create",
        regionId,
        sourceAssetId,
        bounds,
        timestamp: intent.timestamp,
        ...(intent.atIndex === undefined ? {} : { atIndex: intent.atIndex as number }),
      });
    }
    case "move": {
      exactKeys(intent, ["type", "regionId", "x", "y"]);
      const regionId = readEntityId(intent.regionId, "regionId");
      if (
        !Number.isSafeInteger(intent.x) || (intent.x as number) < 0
        || !Number.isSafeInteger(intent.y) || (intent.y as number) < 0
      ) throw invalid("move coordinates must be non-negative safe integers");
      return Object.freeze({ type: "move", regionId, x: intent.x as number, y: intent.y as number });
    }
    case "resize":
      exactKeys(intent, ["type", "regionId", "bounds"]);
      return Object.freeze({
        type: "resize",
        regionId: readEntityId(intent.regionId, "regionId"),
        bounds: readBounds(intent.bounds),
      });
    case "delete":
      exactKeys(intent, ["type", "regionId"]);
      return Object.freeze({ type: "delete", regionId: readEntityId(intent.regionId, "regionId") });
    default:
      throw invalid("received an unsupported intent type");
  }
}

function assertInSource(bounds: Rect, width: number, height: number): void {
  if (bounds.x > width - bounds.width || bounds.y > height - bounds.height) {
    throw invalid("bounds must stay inside the source Asset");
  }
}

/**
 * Build one canonical data command for a manual Region mutation.
 * No-op geometry returns null so ProjectStore history and revision stay stable.
 */
export function adaptManualRegionIntentToProjectCommand(
  projectValue: unknown,
  intentValue: unknown,
): ManualRegionCommand | null {
  const project = readProject(projectValue);
  const intent = readIntent(intentValue);

  if (intent.type === "create") {
    if (Object.prototype.hasOwnProperty.call(project.regions, intent.regionId)) {
      throw invalid("regionId already exists in the canonical project");
    }
    const source = ownRecordValue(project.assets, intent.sourceAssetId);
    if (!source) throw invalid("source Asset does not exist in the canonical project");
    if (Object.keys(project.regions).length >= MAX_MANUAL_REGIONS) {
      throw invalid(`cannot exceed ${MAX_MANUAL_REGIONS} Regions`);
    }
    const atIndex = intent.atIndex ?? project.rootOrder.regionIds.length;
    if (atIndex > project.rootOrder.regionIds.length) throw invalid("atIndex is outside the Region order");
    assertInSource(intent.bounds, source.width, source.height);
    return Object.freeze({
      type: "region.create",
      region: Object.freeze({
        id: intent.regionId,
        assetId: intent.sourceAssetId,
        bounds: intent.bounds,
        createdAt: intent.timestamp,
        updatedAt: intent.timestamp,
      }),
      ...(intent.atIndex === undefined ? {} : { atIndex }),
    });
  }

  const region = ownRecordValue(project.regions, intent.regionId);
  if (!region) throw invalid("target Region does not exist in the canonical project");
  if (intent.type === "delete") {
    return Object.freeze({ type: "region.remove", regionId: region.id, policy: "reject" });
  }

  const source = ownRecordValue(project.assets, region.assetId);
  if (!source) throw invalid("target Region source Asset does not exist");
  const bounds = intent.type === "move"
    ? Object.freeze({ ...region.bounds, x: intent.x, y: intent.y })
    : intent.bounds;
  assertInSource(bounds, source.width, source.height);
  if (
    bounds.x === region.bounds.x
    && bounds.y === region.bounds.y
    && bounds.width === region.bounds.width
    && bounds.height === region.bounds.height
  ) return null;
  return Object.freeze({
    type: "region.update",
    regionId: region.id,
    patch: Object.freeze({ bounds }),
  });
}
