import { isEntityId, isISO8601Timestamp } from "../../../core/project/primitives";
import type { ProjectCommand, ProjectCommandBatch } from "../../../core/project/commands";
import type { StudioProjectV1 } from "../../../core/project/schema";
import type {
  WandRegionIntentBatch,
  WandRegionMutation,
  WandSelectedComponent,
} from "./wandSelection";

type AddRegionCommand = Extract<ProjectCommand, { type: "regions.commitRecipe" }>;
type RemoveRegionCommand = Extract<ProjectCommand, { type: "region.remove" }>;

export interface WandRegionCommandAdapter {
  readonly add: (component: WandSelectedComponent) => AddRegionCommand;
}

/** Exact own-data view over the canonical project Regions collection. */
export interface WandCanonicalProjectRegionView {
  readonly regions: StudioProjectV1["regions"];
}

function invalid(message: string): TypeError {
  return new TypeError(`Wand region command adapter ${message}.`);
}

function isArray(value: unknown, label: string): boolean {
  try {
    return Array.isArray(value);
  } catch {
    throw invalid(`${label} is invalid`);
  }
}

function ownData(record: object, key: PropertyKey, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw invalid(`${label} is invalid`);
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalid(`${label} is invalid`);
  return descriptor.value;
}

function exactKeys(record: object, keys: readonly string[], label: string): void {
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(record);
  } catch {
    throw invalid(`${label} is invalid`);
  }
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) throw invalid(`${label} is invalid`);
}

/** Rebuilds callback/intent payloads from own data only; accessors and symbols never execute. */
function cloneOwnData(value: unknown, label: string, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "undefined") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw invalid(`${label} is invalid`);
    return value;
  }
  if (typeof value !== "object") throw invalid(`${label} is invalid`);
  if (seen.has(value)) throw invalid(`${label} is invalid`);
  seen.add(value);
  try {
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      throw invalid(`${label} is invalid`);
    }
    if (isArray(value, label)) {
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      } catch {
        throw invalid(`${label} is invalid`);
      }
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
        throw invalid(`${label} is invalid`);
      }
      const length = lengthDescriptor.value as number;
      if (
        keys.length !== length + 1
        || !keys.includes("length")
        || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length))
      ) throw invalid(`${label} is invalid`);
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        result.push(cloneOwnData(ownData(value, String(index), `${label}[${index}]`), `${label}[${index}]`, seen));
      }
      return result;
    }
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      throw invalid(`${label} is invalid`);
    }
    if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label} is invalid`);
    if (keys.some((key) => typeof key !== "string")) throw invalid(`${label} is invalid`);
    const result: Record<string, unknown> = {};
    for (const key of keys as readonly string[]) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneOwnData(ownData(value, key, `${label}.${key}`), `${label}.${key}`, seen),
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function sameBounds(
  left: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  right: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

function readAdapter(value: unknown): WandRegionCommandAdapter {
  if (typeof value !== "object" || value === null || isArray(value, "adapter")) throw invalid("requires an adapter record");
  exactKeys(value, ["add"], "adapter");
  const add = ownData(value, "add", "adapter.add");
  if (typeof add !== "function") throw invalid("requires an add callback");
  return Object.freeze({
    add: add as WandRegionCommandAdapter["add"],
  });
}

function validateClonedBounds(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(`${label} is invalid`);
  exactKeys(value, ["x", "y", "width", "height"], label);
  const bounds = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(bounds.x) || (bounds.x as number) < 0
    || !Number.isSafeInteger(bounds.y) || (bounds.y as number) < 0
    || !Number.isSafeInteger(bounds.width) || (bounds.width as number) < 1
    || !Number.isSafeInteger(bounds.height) || (bounds.height as number) < 1
  ) throw invalid(`${label} is invalid`);
}

function validateClonedRegionBounds(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(`${label} is invalid`);
  exactKeys(value, ["x", "y", "width", "height"], label);
  const bounds = value as Record<string, unknown>;
  if (
    typeof bounds.x !== "number" || !Number.isFinite(bounds.x)
    || typeof bounds.y !== "number" || !Number.isFinite(bounds.y)
    || typeof bounds.width !== "number" || !Number.isFinite(bounds.width) || bounds.width <= 0
    || typeof bounds.height !== "number" || !Number.isFinite(bounds.height) || bounds.height <= 0
  ) throw invalid(`${label} is invalid`);
}

function validateClonedPoint(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || isArray(value, label)) throw invalid(`${label} is invalid`);
  exactKeys(value, ["x", "y"], label);
  const point = value as Record<string, unknown>;
  if (
    typeof point.x !== "number" || !Number.isFinite(point.x)
    || typeof point.y !== "number" || !Number.isFinite(point.y)
  ) throw invalid(`${label} is invalid`);
}

function validateClonedComponent(value: unknown, sourceAssetId: string, operationType: string): void {
  if (typeof value !== "object" || value === null || isArray(value, "intent component")) throw invalid("intent component is invalid");
  exactKeys(value, ["id", "sourceAssetId", "firstPixelOffset", "pixelCount", "bounds", "mask"], "intent.component");
  const component = value as unknown as WandSelectedComponent;
  if (
    !/^wand:sha256:[0-9a-f]{64}$/u.test(component.id)
    || !isEntityId(component.sourceAssetId)
    || (operationType === "add" && component.sourceAssetId !== sourceAssetId)
    || !Number.isSafeInteger(component.firstPixelOffset) || component.firstPixelOffset < 0
    || !Number.isSafeInteger(component.pixelCount) || component.pixelCount < 1
  ) throw invalid("intent component is invalid");
  validateClonedBounds(component.bounds, "intent.component.bounds");
  if (typeof component.mask !== "object" || component.mask === null || isArray(component.mask, "intent component mask")) throw invalid("intent component mask is invalid");
  exactKeys(component.mask, ["bounds", "pixelCount", "runs"], "intent.component.mask");
  validateClonedBounds(component.mask.bounds, "intent.component.mask.bounds");
  if (component.mask.pixelCount !== component.pixelCount || !isArray(component.mask.runs, "intent component mask runs") || component.mask.runs.length === 0) {
    throw invalid("intent component mask is invalid");
  }
  for (const run of component.mask.runs) {
    if (typeof run !== "object" || run === null || isArray(run, "intent component mask run")) throw invalid("intent component mask run is invalid");
    exactKeys(run, ["offset", "length"], "intent.component.mask.run");
    if (!Number.isSafeInteger(run.offset) || run.offset < 0 || !Number.isSafeInteger(run.length) || run.length < 1) {
      throw invalid("intent component mask run is invalid");
    }
  }
}

function readIntent(value: unknown): WandRegionIntentBatch {
  const cloned = cloneOwnData(value, "intent");
  if (typeof cloned !== "object" || cloned === null || isArray(cloned, "intent")) throw invalid("received invalid intent");
  exactKeys(cloned, ["type", "sourceAssetId", "history", "operations"], "intent");
  const intent = cloned as unknown as WandRegionIntentBatch;
  if (
    intent.type !== "wand-region.intent-batch"
    || !isEntityId(intent.sourceAssetId)
    || intent.history !== "single-undo"
    || !isArray(intent.operations, "intent operations")
    || intent.operations.length === 0
  ) throw invalid("received invalid intent");
  for (const operation of intent.operations) {
    if (typeof operation !== "object" || operation === null || isArray(operation, "intent operation")) throw invalid("received invalid intent");
    exactKeys(operation, ["type", "component"], "intent.operation");
    if (operation.type !== "add" && operation.type !== "remove") {
      throw invalid("received invalid intent");
    }
    validateClonedComponent(operation.component, intent.sourceAssetId, operation.type);
  }
  return intent;
}

function invoke<T>(callback: () => T, label: string): T {
  try {
    return callback();
  } catch {
    throw invalid(`${label} failed`);
  }
}

function readAddCommand(value: unknown, operation: WandRegionMutation, sourceAssetId: string): AddRegionCommand {
  const clonedValue = cloneOwnData(value, "add result");
  if (typeof clonedValue !== "object" || clonedValue === null || isArray(clonedValue, "add result")) {
    throw invalid("add callback must return one matching regions.commitRecipe command");
  }
  const cloned = clonedValue as AddRegionCommand;
  const region = isArray(cloned.regions, "add result regions") && cloned.regions.length === 1 ? cloned.regions[0] : undefined;
  if (
    cloned.type !== "regions.commitRecipe"
    || typeof cloned.recipe !== "object" || cloned.recipe === null || isArray(cloned.recipe, "add result recipe")
    || cloned.recipe.sourceAssetId !== sourceAssetId
    || typeof region !== "object" || region === null || isArray(region, "add result region")
    || region.assetId !== sourceAssetId
    || typeof region.bounds !== "object" || region.bounds === null || isArray(region.bounds, "add result bounds")
    || !sameBounds(region.bounds, operation.component.bounds)
  ) throw invalid("add callback must return one matching regions.commitRecipe command");
  return cloned;
}

function resolveCanonicalRegionId(
  viewValue: WandCanonicalProjectRegionView,
  component: WandSelectedComponent,
): string {
  const cloned = cloneOwnData(viewValue, "canonical project Region view");
  if (typeof cloned !== "object" || cloned === null || isArray(cloned, "canonical project Region view")) {
    throw invalid("requires a canonical project Region view");
  }
  exactKeys(cloned, ["regions"], "canonical project Region view");
  const regions = (cloned as { regions?: unknown }).regions;
  if (typeof regions !== "object" || regions === null || isArray(regions, "canonical project Regions")) {
    throw invalid("canonical project Regions are invalid");
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(regions);
  } catch {
    throw invalid("canonical project Regions are invalid");
  }
  if (keys.some((key) => typeof key !== "string" || !isEntityId(key))) {
    throw invalid("canonical project Regions are invalid");
  }
  const matches: string[] = [];
  for (const key of keys as readonly string[]) {
    const regionValue = ownData(regions, key, `canonical project Regions.${key}`);
    if (typeof regionValue !== "object" || regionValue === null || isArray(regionValue, `canonical project Regions.${key}`)) {
      throw invalid("canonical project Regions are invalid");
    }
    const region = regionValue as Record<string, unknown>;
    const regionKeys = Reflect.ownKeys(region);
    const allowedRegionKeys = ["id", "assetId", "name", "bounds", "pivot", "hidden", "createdAt", "updatedAt", "provenance"];
    if (
      regionKeys.some((regionKey) => typeof regionKey !== "string" || !allowedRegionKeys.includes(regionKey))
      || !["id", "assetId", "bounds", "createdAt", "updatedAt"].every((required) => regionKeys.includes(required))
      || region.id !== key
      || !isEntityId(region.id)
      || !isEntityId(region.assetId)
      || !isISO8601Timestamp(region.createdAt)
      || !isISO8601Timestamp(region.updatedAt)
    ) {
      throw invalid("canonical project Regions are invalid");
    }
    validateClonedRegionBounds(region.bounds, `canonical project Regions.${key}.bounds`);
    if (region.name !== undefined && typeof region.name !== "string") {
      throw invalid("canonical project Regions are invalid");
    }
    if (region.pivot !== undefined) validateClonedPoint(region.pivot, `canonical project Regions.${key}.pivot`);
    if (region.hidden !== undefined && typeof region.hidden !== "boolean") {
      throw invalid("canonical project Regions are invalid");
    }
    const provenance = region.provenance;
    if (provenance !== undefined && (typeof provenance !== "object" || provenance === null || isArray(provenance, `canonical project Regions.${key}.provenance`))) {
      throw invalid("canonical project Regions are invalid");
    }
    if (provenance !== undefined) {
      const provenanceKeys = Reflect.ownKeys(provenance);
      if (
        provenanceKeys.some((provenanceKey) =>
          typeof provenanceKey !== "string" || !["source", "sourceId", "importedAt", "note"].includes(provenanceKey))
        || typeof (provenance as Record<string, unknown>).source !== "string"
        || ((provenance as Record<string, unknown>).source as string).trim().length === 0
        || ((provenance as Record<string, unknown>).sourceId !== undefined && typeof (provenance as Record<string, unknown>).sourceId !== "string")
        || ((provenance as Record<string, unknown>).importedAt !== undefined && !isISO8601Timestamp((provenance as Record<string, unknown>).importedAt))
        || ((provenance as Record<string, unknown>).note !== undefined && typeof (provenance as Record<string, unknown>).note !== "string")
      ) throw invalid("canonical project Regions are invalid");
    }
    if (
      region.assetId === component.sourceAssetId
      && sameBounds(region.bounds as WandSelectedComponent["bounds"], component.bounds)
      && provenance !== undefined
      && (provenance as Record<string, unknown>).source === "wand"
      && (provenance as Record<string, unknown>).sourceId === component.id
    ) matches.push(key);
  }
  if (matches.length === 0) throw invalid("found no canonical Region for the exact wand component");
  if (matches.length > 1) throw invalid("found ambiguous canonical Regions for the exact wand component");
  return matches[0]!;
}

/**
 * Converts feature intents to one canonical `command.batch`, preserving one-undo semantics.
 * Canonical project Region matching prevents subtract from deleting an unrelated Region. No store is owned here.
 */
export function adaptWandRegionIntentToProjectBatch(
  intentValue: WandRegionIntentBatch,
  canonicalViewValue: WandCanonicalProjectRegionView,
  adapterValue: WandRegionCommandAdapter,
): ProjectCommandBatch {
  const intent = readIntent(intentValue);
  const adapter = readAdapter(adapterValue);
  const commands: ProjectCommand[] = intent.operations.map((operation) => {
    if (operation.type === "add") {
      return readAddCommand(invoke(() => adapter.add(operation.component), "add callback"), operation, intent.sourceAssetId);
    }
    const expectedRegionId = resolveCanonicalRegionId(canonicalViewValue, operation.component);
    return {
      type: "region.remove",
      regionId: expectedRegionId,
      policy: "reject",
    } satisfies RemoveRegionCommand;
  });
  return { type: "command.batch", commands };
}
