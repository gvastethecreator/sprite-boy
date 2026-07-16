import { isEntityId, isISO8601Timestamp, type Composition, type EntityId } from "../../../core/project";
import { cloneDataOnly } from "../../../core/project/dataBoundary";
import type { DeepReadonly, ProjectStore } from "../../../core/stores";

export const COMPOSITION_CANVAS_MAX_EDGE = 16_384;
export const COMPOSITION_CANVAS_MAX_PIXELS = 64 * 1024 * 1024;

export const COMPOSITION_ASPECT_RATIOS = Object.freeze([
  Object.freeze({ id: "1:1", label: "Square", width: 1, height: 1 }),
  Object.freeze({ id: "4:3", label: "Standard", width: 4, height: 3 }),
  Object.freeze({ id: "3:2", label: "Photo", width: 3, height: 2 }),
  Object.freeze({ id: "5:4", label: "Classic", width: 5, height: 4 }),
  Object.freeze({ id: "16:9", label: "Widescreen", width: 16, height: 9 }),
  Object.freeze({ id: "21:9", label: "Ultrawide", width: 21, height: 9 }),
  Object.freeze({ id: "3:4", label: "Portrait", width: 3, height: 4 }),
  Object.freeze({ id: "4:5", label: "Portrait photo", width: 4, height: 5 }),
  Object.freeze({ id: "2:3", label: "Tall photo", width: 2, height: 3 }),
  Object.freeze({ id: "9:16", label: "Vertical", width: 9, height: 16 }),
] as const);

export type CompositionAspectRatioId = (typeof COMPOSITION_ASPECT_RATIOS)[number]["id"];
export type CompositionAspectRatioSelection = CompositionAspectRatioId | "custom";

export interface CompositionCanvasDraft {
  readonly width: string;
  readonly height: string;
  readonly backgroundMode: "transparent" | "color";
  readonly backgroundColor: string;
}

export interface CompositionCanvasBaseline {
  readonly revision: number;
  readonly width: number;
  readonly height: number;
  readonly background: string | null;
}

export interface CompositionCanvasSettingsValue {
  readonly width: number;
  readonly height: number;
  readonly background: string | null;
}

export interface CompositionCanvasDraftValidation {
  readonly valid: boolean;
  readonly value?: CompositionCanvasSettingsValue;
  readonly errors: Readonly<Partial<Record<"width" | "height" | "background" | "canvas", string>>>;
}

export type ApplyCompositionCanvasSettingsResult =
  | {
      readonly ok: true;
      readonly outcome: "updated" | "unchanged";
      readonly revision: number;
      readonly value: CompositionCanvasSettingsValue;
    }
  | {
      readonly ok: false;
      readonly code: "INVALID_DRAFT" | "COMPOSITION_MISSING" | "STALE_DRAFT" | "COMMAND_REJECTED" | "BOUNDARY_FAILED";
      readonly message: string;
      readonly revision: number;
      readonly validation?: CompositionCanvasDraftValidation;
    };

export interface ApplyCompositionCanvasSettingsInput {
  readonly compositionId: EntityId;
  readonly draft: CompositionCanvasDraft;
  readonly baseline: CompositionCanvasBaseline;
  readonly commandId: EntityId;
  readonly issuedAt: string;
}

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const INVALID_DRAFT: CompositionCanvasDraft = Object.freeze({
  width: "",
  height: "",
  backgroundMode: "transparent",
  backgroundColor: "#ffffff",
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function safeRevision(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function invalidValidation(message = "Canvas settings could not be read safely."): CompositionCanvasDraftValidation {
  return Object.freeze({ valid: false, errors: Object.freeze({ canvas: message }) });
}

function normalizeDraft(value: unknown): CompositionCanvasDraft | null {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || !isPlainRecord(cloned.value)) return null;
  const keys = Object.keys(cloned.value).sort();
  if (keys.join("|") !== "backgroundColor|backgroundMode|height|width") return null;
  const { width, height, backgroundMode, backgroundColor } = cloned.value;
  if (
    typeof width !== "string" ||
    typeof height !== "string" ||
    (backgroundMode !== "transparent" && backgroundMode !== "color") ||
    typeof backgroundColor !== "string"
  ) return null;
  return Object.freeze({ width, height, backgroundMode, backgroundColor });
}

function normalizeBaseline(value: unknown): CompositionCanvasBaseline | null {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || !isPlainRecord(cloned.value)) return null;
  const keys = Object.keys(cloned.value).sort();
  if (keys.join("|") !== "background|height|revision|width") return null;
  const { revision, width, height, background } = cloned.value;
  if (
    !Number.isSafeInteger(revision) || (revision as number) < 0 ||
    !Number.isSafeInteger(width) || (width as number) < 1 ||
    !Number.isSafeInteger(height) || (height as number) < 1 ||
    (background !== null && (typeof background !== "string" || !HEX_COLOR.test(background)))
  ) return null;
  return Object.freeze({
    revision: revision as number,
    width: width as number,
    height: height as number,
    background: background as string | null,
  });
}

function normalizeCompositionCanvas(value: unknown): CompositionCanvasSettingsValue | null {
  if (!isPlainRecord(value)) return null;
  const width = readOwnData(value, "width");
  const height = readOwnData(value, "height");
  const backgroundValue = readOwnData(value, "background");
  const background = backgroundValue === undefined ? null : backgroundValue;
  if (
    !Number.isSafeInteger(width) || (width as number) < 1 ||
    !Number.isSafeInteger(height) || (height as number) < 1 ||
    (background !== null && (typeof background !== "string" || !HEX_COLOR.test(background)))
  ) return null;
  return Object.freeze({
    width: width as number,
    height: height as number,
    background: background as string | null,
  });
}

interface CompositionCanvasTarget extends CompositionCanvasSettingsValue {
  readonly id: EntityId;
  readonly ownerKey: string;
  readonly layerIds: readonly EntityId[];
}

function ownKeysExactly(value: unknown, expected: readonly string[]): boolean {
  if (!isPlainRecord(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length &&
      keys.every((key) => typeof key === "string" && expected.includes(key));
  } catch {
    return false;
  }
}

function normalizeOwner(value: unknown): string | null {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || !isPlainRecord(cloned.value)) return null;
  const type = cloned.value.type;
  if (type === "project" && ownKeysExactly(cloned.value, ["type"])) return "project";
  if (
    type === "cel" &&
    ownKeysExactly(cloned.value, ["type", "celId"]) &&
    isEntityId(cloned.value.celId)
  ) return `cel:${cloned.value.celId}`;
  if (
    type === "variantSet" &&
    ownKeysExactly(cloned.value, ["type", "variantSetId", "variant"]) &&
    isEntityId(cloned.value.variantSetId) &&
    ["A", "B", "C", "D"].includes(String(cloned.value.variant))
  ) return `variantSet:${cloned.value.variantSetId}:${cloned.value.variant}`;
  return null;
}

function normalizeLayerIds(value: unknown): readonly EntityId[] | null {
  const cloned = cloneDataOnly(value);
  if (!cloned.ok || !Array.isArray(cloned.value) || cloned.value.some((id) => !isEntityId(id))) {
    return null;
  }
  return Object.freeze([...cloned.value] as EntityId[]);
}

function normalizeCompositionTarget(value: unknown): CompositionCanvasTarget | null {
  const settings = normalizeCompositionCanvas(value);
  if (!settings) return null;
  const id = readOwnData(value, "id");
  const ownerKey = normalizeOwner(readOwnData(value, "owner"));
  const layerIds = normalizeLayerIds(readOwnData(value, "layerIds"));
  if (!isEntityId(id) || ownerKey === null || layerIds === null) return null;
  return Object.freeze({ ...settings, id, ownerKey, layerIds });
}

function sameLayerIds(left: readonly EntityId[], right: readonly EntityId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function readOwnData(record: unknown, key: string): unknown {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor && descriptor.enumerable
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function readStoreMethod(store: unknown, key: "getSnapshot" | "dispatch"): ((...args: unknown[]) => unknown) | null {
  const method = readOwnData(store, key);
  return typeof method === "function" ? method as (...args: unknown[]) => unknown : null;
}

function readCanvasSnapshot(
  store: unknown,
  compositionId: string,
): { readonly revision: number; readonly composition: CompositionCanvasTarget | null } | null {
  const getSnapshot = readStoreMethod(store, "getSnapshot");
  if (!getSnapshot) return null;
  try {
    const snapshot = Reflect.apply(getSnapshot, store, []);
    const revisionValue = readOwnData(snapshot, "revision");
    if (!Number.isSafeInteger(revisionValue) || (revisionValue as number) < 0) return null;
    const project = readOwnData(snapshot, "project");
    const compositions = readOwnData(project, "compositions");
    const composition = readOwnData(compositions, compositionId);
    return Object.freeze({
      revision: revisionValue as number,
      composition: composition === undefined ? null : normalizeCompositionTarget(composition),
    });
  } catch {
    return null;
  }
}

function safeArrayShape(value: unknown, maximumLength = 1_000): boolean {
  try {
    if (!Array.isArray(value)) return false;
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    return Boolean(
      descriptor && "value" in descriptor && Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 0 && descriptor.value <= maximumLength,
    );
  } catch {
    return false;
  }
}

function safeArrayLength(value: unknown): number | null {
  try {
    if (!Array.isArray(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    return descriptor && "value" in descriptor && Number.isSafeInteger(descriptor.value)
      ? descriptor.value as number
      : null;
  } catch {
    return null;
  }
}

function safeMessageArray(value: unknown): boolean {
  if (!safeArrayShape(value, 100)) return false;
  const length = safeArrayLength(value);
  if (length === null) return false;
  for (let index = 0; index < length; index += 1) {
    const entry = readOwnData(value, String(index));
    if (!isPlainRecord(entry)) return false;
    if (typeof readOwnData(entry, "code") !== "string" || typeof readOwnData(entry, "message") !== "string") {
      return false;
    }
  }
  return true;
}

function validateChangedIds(
  value: unknown,
  compositionId: EntityId,
): "updated" | "unchanged" | null {
  if (!isPlainRecord(value)) return null;
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length === 0) return "unchanged";
  if (keys.length !== 1 || keys[0] !== "compositions") return null;
  const compositions = readOwnData(value, "compositions");
  if (!safeArrayShape(compositions, 1)) return null;
  return readOwnData(compositions, "0") === compositionId ? "updated" : null;
}

function validateDispatchResult(
  value: unknown,
  before: { readonly revision: number; readonly composition: CompositionCanvasTarget },
  compositionId: EntityId,
  requested: CompositionCanvasSettingsValue,
): { readonly ok: true; readonly revision: number; readonly outcome: "updated" | "unchanged" } |
  { readonly ok: false; readonly rejected: boolean } {
  if (!ownKeysExactly(value, ["revision", "result"])) return { ok: false, rejected: false };
  const revision = readOwnData(value, "revision");
  const result = readOwnData(value, "result");
  if (!Number.isSafeInteger(revision) || (revision as number) < before.revision || !isPlainRecord(result)) {
    return { ok: false, rejected: false };
  }
  const ok = readOwnData(result, "ok");
  if (ok === false) {
    if (!ownKeysExactly(result, ["ok", "project", "diagnostics"]) &&
      !ownKeysExactly(result, ["ok", "project", "diagnostics", "impact"])) {
      return { ok: false, rejected: false };
    }
    return revision === before.revision && safeMessageArray(readOwnData(result, "diagnostics"))
      ? { ok: false, rejected: true }
      : { ok: false, rejected: false };
  }
  if (ok !== true || !ownKeysExactly(result, ["ok", "project", "changedIds", "warnings", "impact", "inverse"])) {
    return { ok: false, rejected: false };
  }
  if (!safeMessageArray(readOwnData(result, "warnings"))) return { ok: false, rejected: false };
  const outcome = validateChangedIds(readOwnData(result, "changedIds"), compositionId);
  if (outcome === null) return { ok: false, rejected: false };
  const expectedRevision = outcome === "updated" ? before.revision + 1 : before.revision;
  if (revision !== expectedRevision || !Number.isSafeInteger(expectedRevision)) {
    return { ok: false, rejected: false };
  }
  const project = readOwnData(result, "project");
  const compositions = readOwnData(project, "compositions");
  const target = normalizeCompositionTarget(readOwnData(compositions, compositionId));
  if (
    !target ||
    target.id !== compositionId ||
    target.width !== requested.width ||
    target.height !== requested.height ||
    target.background !== requested.background ||
    target.ownerKey !== before.composition.ownerKey ||
    !sameLayerIds(target.layerIds, before.composition.layerIds)
  ) return { ok: false, rejected: false };
  return { ok: true, revision, outcome };
}

function dimension(value: string, label: "Width" | "Height"): { value?: number; error?: string } {
  if (!/^[1-9]\d*$/.test(value.trim())) {
    return { error: `${label} must be a positive whole number.` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > COMPOSITION_CANVAS_MAX_EDGE) {
    return { error: `${label} must be between 1 and ${COMPOSITION_CANVAS_MAX_EDGE}.` };
  }
  return { value: parsed };
}

export function createCompositionCanvasDraft(
  composition: Pick<DeepReadonly<Composition>, "width" | "height" | "background">,
): CompositionCanvasDraft {
  const normalized = normalizeCompositionCanvas(composition);
  if (!normalized) return INVALID_DRAFT;
  const background = normalized.background;
  return Object.freeze({
    width: String(normalized.width),
    height: String(normalized.height),
    backgroundMode: background === null ? "transparent" : "color",
    backgroundColor: background === null ? "#ffffff" : background,
  });
}

export function createCompositionCanvasBaseline(
  revision: number,
  composition: Pick<DeepReadonly<Composition>, "width" | "height" | "background">,
): CompositionCanvasBaseline {
  const normalized = normalizeCompositionCanvas(composition);
  if (!normalized) return Object.freeze({ revision: safeRevision(revision), width: 0, height: 0, background: null });
  return Object.freeze({
    revision: safeRevision(revision),
    width: normalized.width,
    height: normalized.height,
    background: normalized.background,
  });
}

export function validateCompositionCanvasDraft(
  draft: CompositionCanvasDraft | unknown,
): CompositionCanvasDraftValidation {
  const normalized = normalizeDraft(draft);
  if (!normalized) return invalidValidation();
  const errors: Partial<Record<"width" | "height" | "background" | "canvas", string>> = {};
  const parsedWidth = dimension(normalized.width, "Width");
  const parsedHeight = dimension(normalized.height, "Height");
  if (parsedWidth.error) errors.width = parsedWidth.error;
  if (parsedHeight.error) errors.height = parsedHeight.error;
  if (normalized.backgroundMode === "color" && !HEX_COLOR.test(normalized.backgroundColor)) {
    errors.background = "Background color must be a three, four, six or eight-digit hex color.";
  }
  if (
    parsedWidth.value !== undefined &&
    parsedHeight.value !== undefined &&
    parsedWidth.value * parsedHeight.value > COMPOSITION_CANVAS_MAX_PIXELS
  ) {
    errors.canvas = `Canvas area cannot exceed ${COMPOSITION_CANVAS_MAX_PIXELS.toLocaleString("en-US")} pixels.`;
  }
  if (Object.keys(errors).length > 0 || parsedWidth.value === undefined || parsedHeight.value === undefined) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  return Object.freeze({
    valid: true,
    value: Object.freeze({
      width: parsedWidth.value,
      height: parsedHeight.value,
      background: normalized.backgroundMode === "transparent"
        ? null
        : normalized.backgroundColor.toLowerCase(),
    }),
    errors: Object.freeze({}),
  });
}

export function detectCompositionAspectRatio(width: number, height: number): CompositionAspectRatioSelection {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return "custom";
  }
  return COMPOSITION_ASPECT_RATIOS.find(
    (ratio) => width * ratio.height === height * ratio.width,
  )?.id ?? "custom";
}

/** Preserve the current longest edge while applying an exact supported ratio. */
export function applyCompositionAspectRatio(
  draft: CompositionCanvasDraft | unknown,
  ratioId: CompositionAspectRatioId | unknown,
): CompositionCanvasDraft {
  const normalizedDraft = normalizeDraft(draft);
  if (!normalizedDraft) return INVALID_DRAFT;
  const ratio = COMPOSITION_ASPECT_RATIOS.find((candidate) => candidate.id === ratioId);
  if (!ratio) return normalizedDraft;
  const validation = validateCompositionCanvasDraft(normalizedDraft);
  const currentWidth = validation.value?.width ?? 1024;
  const currentHeight = validation.value?.height ?? 1024;
  const longestEdge = Math.min(COMPOSITION_CANVAS_MAX_EDGE, Math.max(currentWidth, currentHeight));
  const longestRatioEdge = Math.max(ratio.width, ratio.height);
  const desiredUnit = Math.max(1, Math.floor(longestEdge / longestRatioEdge));
  const edgeUnit = Math.floor(COMPOSITION_CANVAS_MAX_EDGE / longestRatioEdge);
  const pixelUnit = Math.floor(Math.sqrt(
    COMPOSITION_CANVAS_MAX_PIXELS / (ratio.width * ratio.height),
  ));
  const unit = Math.max(1, Math.min(desiredUnit, edgeUnit, pixelUnit));
  const width = unit * ratio.width;
  const height = unit * ratio.height;
  return Object.freeze({ ...normalizedDraft, width: String(width), height: String(height) });
}

function baselineMatches(
  baseline: CompositionCanvasBaseline,
  composition: CompositionCanvasSettingsValue,
): boolean {
  return baseline.width === composition.width &&
    baseline.height === composition.height &&
    baseline.background === composition.background;
}

export function applyCompositionCanvasSettings(
  store: ProjectStore,
  input: ApplyCompositionCanvasSettingsInput | unknown,
): ApplyCompositionCanvasSettingsResult {
  const detached = cloneDataOnly(input);
  if (!detached.ok || !isPlainRecord(detached.value)) {
    return Object.freeze({ ok: false, code: "INVALID_DRAFT", message: "Canvas settings could not be read safely.", revision: 0 });
  }
  const keys = Object.keys(detached.value).sort();
  if (keys.join("|") !== "baseline|commandId|compositionId|draft|issuedAt") {
    return Object.freeze({ ok: false, code: "INVALID_DRAFT", message: "Canvas settings could not be read safely.", revision: 0 });
  }
  const { compositionId, draft, baseline, commandId, issuedAt } = detached.value;
  const normalizedBaseline = normalizeBaseline(baseline);
  const validation = validateCompositionCanvasDraft(draft);
  if (
    !isEntityId(compositionId) ||
    !isEntityId(commandId) ||
    !isISO8601Timestamp(issuedAt) ||
    !normalizedBaseline
  ) {
    return Object.freeze({ ok: false, code: "INVALID_DRAFT", message: "Canvas settings could not be read safely.", revision: 0, validation });
  }
  const before = readCanvasSnapshot(store, compositionId);
  if (!before) {
    return Object.freeze({ ok: false, code: "BOUNDARY_FAILED", message: "Canvas settings are temporarily unavailable. Try again.", revision: 0 });
  }
  if (!validation.valid || !validation.value) {
    return Object.freeze({
      ok: false,
      code: "INVALID_DRAFT",
      message: "Correct the highlighted canvas settings before applying.",
      revision: before.revision,
      validation,
    });
  }
  const composition = before.composition;
  if (!composition) {
    return Object.freeze({
      ok: false,
      code: "COMPOSITION_MISSING",
      message: "This composition is no longer available.",
      revision: before.revision,
    });
  }
  if (before.revision !== normalizedBaseline.revision && !baselineMatches(normalizedBaseline, composition)) {
    return Object.freeze({
      ok: false,
      code: "STALE_DRAFT",
      message: "Canvas settings changed elsewhere. Reload the latest values before applying.",
      revision: before.revision,
    });
  }
  const dispatch = readStoreMethod(store, "dispatch");
  if (!dispatch) {
    return Object.freeze({ ok: false, code: "BOUNDARY_FAILED", message: "Canvas settings are temporarily unavailable. Try again.", revision: before.revision });
  }
  let rawResult: unknown;
  try {
    rawResult = Reflect.apply(dispatch, store, [{
    command: {
      type: "composition.update",
      compositionId,
      patch: validation.value,
    },
    metadata: {
      commandId,
      origin: "user",
      history: "record",
      issuedAt,
    },
  }]);
  } catch {
    return Object.freeze({ ok: false, code: "BOUNDARY_FAILED", message: "Canvas settings are temporarily unavailable. Try again.", revision: before.revision });
  }
  const validatedResult = validateDispatchResult(
    rawResult,
    { revision: before.revision, composition },
    compositionId,
    validation.value,
  );
  if (!validatedResult.ok && validatedResult.rejected) {
    return Object.freeze({
      ok: false,
      code: "COMMAND_REJECTED",
      message: "Canvas settings could not be applied. Review the current composition and try again.",
      revision: before.revision,
    });
  }
  if (!validatedResult.ok) {
    return Object.freeze({ ok: false, code: "BOUNDARY_FAILED", message: "Canvas settings are temporarily unavailable. Try again.", revision: before.revision });
  }
  return Object.freeze({
    ok: true,
    outcome: validatedResult.outcome,
    revision: validatedResult.revision,
    value: validation.value,
  });
}
