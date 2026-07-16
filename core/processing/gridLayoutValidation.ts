import { GRID_PROCESSING_LIMITS } from "./gridProcessingLimits";

export type GridLayoutMode = "auto" | "manual";

export interface GridManualLayoutDraft {
  readonly rows: number;
  readonly cols: number;
}

/** UI state retains the manual selection even while automatic detection is active. */
export interface GridLayoutDraft {
  readonly mode: GridLayoutMode;
  readonly manual: GridManualLayoutDraft;
}

export interface GridLayoutSourceDimensions {
  readonly width: number;
  readonly height: number;
}

export type GridRecipeLayoutV1 =
  | { readonly mode: "auto" }
  | { readonly mode: "manual"; readonly rows: number; readonly cols: number };

export type GridLayoutValidationPath =
  | "source"
  | "source.width"
  | "source.height"
  | "layout"
  | "layout.mode"
  | "layout.manual"
  | "layout.manual.rows"
  | "layout.manual.cols";

export type GridLayoutValidationCode =
  | "invalid-object"
  | "invalid-keys"
  | "invalid-mode"
  | "invalid-integer"
  | "source-pixel-limit"
  | "exceeds-source"
  | "result-count-limit";

export interface GridLayoutValidationIssue {
  readonly code: GridLayoutValidationCode;
  readonly path: GridLayoutValidationPath;
  /** Stable UI-safe copy; it never includes attacker-controlled values. */
  readonly message: string;
}

export interface InvalidGridLayoutValidationResult {
  readonly ok: false;
  readonly issues: readonly GridLayoutValidationIssue[];
}

export type GridLayoutValidationResult =
  | { readonly ok: true; readonly value: GridLayoutDraft }
  | InvalidGridLayoutValidationResult;

type DataRecord = Record<string, unknown>;

const EXPECTED_SOURCE_KEYS = Object.freeze(["width", "height"] as const);
const EXPECTED_LAYOUT_KEYS = Object.freeze(["mode", "manual"] as const);
const EXPECTED_MANUAL_KEYS = Object.freeze(["rows", "cols"] as const);

function issue(
  code: GridLayoutValidationCode,
  path: GridLayoutValidationPath,
  message: string,
): GridLayoutValidationIssue {
  return Object.freeze({ code, path, message });
}

function invalidResult(...issues: GridLayoutValidationIssue[]): InvalidGridLayoutValidationResult {
  return Object.freeze({ ok: false as const, issues: Object.freeze(issues) });
}

/**
 * Inspects the complete value graph through descriptors before invoking the
 * structured-clone proxy check. This is deliberately recursive: running
 * structuredClone first would evaluate a nested enumerable getter.
 */
function hasOnlyDataDescriptors(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  seen.add(value);

  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return false;
      if (!hasOnlyDataDescriptors(descriptor.value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Copies enumerable own data properties without reading the properties themselves. */
function readDataRecord(value: unknown): DataRecord | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output = Object.create(null) as DataRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      Object.defineProperty(output, key, { enumerable: true, value: descriptor.value });
    }
    return output;
  } catch {
    return null;
  }
}

/**
 * Rejects proxies only after the caller has recursively reached the relevant
 * nested schema. That preserves precise paths (for example `layout.manual`)
 * while ensuring structuredClone never evaluates a nested getter.
 */
function isDataCloneSafe(value: unknown): boolean {
  if (typeof structuredClone !== "function" || !hasOnlyDataDescriptors(value)) return false;
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function hasExactKeys(record: DataRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => (
    Object.prototype.hasOwnProperty.call(record, key)
  ));
}

function isCanonicalInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && value >= minimum
    && value <= maximum;
}

export function validateGridLayoutSource(
  value: unknown,
): { readonly ok: true; readonly value: GridLayoutSourceDimensions }
  | { readonly ok: false; readonly issues: readonly GridLayoutValidationIssue[] } {
  const source = readDataRecord(value);
  if (!source) return invalidResult(issue(
    "invalid-object", "source", "Source dimensions must be a plain data object.",
  ));
  if (!hasExactKeys(source, EXPECTED_SOURCE_KEYS)) return invalidResult(issue(
    "invalid-keys", "source", "Source dimensions must contain only width and height.",
  ));

  const issues: GridLayoutValidationIssue[] = [];
  if (!isCanonicalInteger(source.width, 1, GRID_PROCESSING_LIMITS.maxDimension)) {
    issues.push(issue("invalid-integer", "source.width", `Source width must be an integer from 1 to ${GRID_PROCESSING_LIMITS.maxDimension}.`));
  }
  if (!isCanonicalInteger(source.height, 1, GRID_PROCESSING_LIMITS.maxDimension)) {
    issues.push(issue("invalid-integer", "source.height", `Source height must be an integer from 1 to ${GRID_PROCESSING_LIMITS.maxDimension}.`));
  }
  if (issues.length > 0) return invalidResult(...issues);

  const width = source.width as number;
  const height = source.height as number;
  if (!Number.isSafeInteger(width * height) || width * height > GRID_PROCESSING_LIMITS.maxSourcePixels) {
    return invalidResult(issue(
      "source-pixel-limit", "source", `Source dimensions must not exceed ${GRID_PROCESSING_LIMITS.maxSourcePixels} pixels.`,
    ));
  }
  if (!isDataCloneSafe(value)) return invalidResult(issue(
    "invalid-object", "source", "Source dimensions must be a plain data object.",
  ));
  return Object.freeze({ ok: true as const, value: Object.freeze({ width, height }) });
}

/** Non-throwing boundary for controls and persisted UI state. */
export function validateGridLayoutDraft(value: unknown, sourceValue: unknown): GridLayoutValidationResult {
  const source = validateGridLayoutSource(sourceValue);
  if (!source.ok) return source;

  const layout = readDataRecord(value);
  if (!layout) return invalidResult(issue(
    "invalid-object", "layout", "Grid layout must be a plain data object.",
  ));
  if (!hasExactKeys(layout, EXPECTED_LAYOUT_KEYS)) return invalidResult(issue(
    "invalid-keys", "layout", "Grid layout must contain only mode and manual values.",
  ));

  const issues: GridLayoutValidationIssue[] = [];
  if (layout.mode !== "auto" && layout.mode !== "manual") {
    issues.push(issue("invalid-mode", "layout.mode", "Grid mode must be auto or manual."));
  }
  const manual = readDataRecord(layout.manual);
  if (!manual) return invalidResult(...issues, issue(
    "invalid-object", "layout.manual", "Manual grid values must be a plain data object.",
  ));
  if (!hasExactKeys(manual, EXPECTED_MANUAL_KEYS)) return invalidResult(...issues, issue(
    "invalid-keys", "layout.manual", "Manual grid values must contain only rows and columns.",
  ));

  if (!isCanonicalInteger(manual.rows, 1, GRID_PROCESSING_LIMITS.maxResultCount)) {
    issues.push(issue("invalid-integer", "layout.manual.rows", `Rows must be an integer from 1 to ${GRID_PROCESSING_LIMITS.maxResultCount}.`));
  }
  if (!isCanonicalInteger(manual.cols, 1, GRID_PROCESSING_LIMITS.maxResultCount)) {
    issues.push(issue("invalid-integer", "layout.manual.cols", `Columns must be an integer from 1 to ${GRID_PROCESSING_LIMITS.maxResultCount}.`));
  }
  if (issues.length > 0) return invalidResult(...issues);

  const rows = manual.rows as number;
  const cols = manual.cols as number;
  if (rows > source.value.height) issues.push(issue("exceeds-source", "layout.manual.rows", "Rows cannot exceed the source height."));
  if (cols > source.value.width) issues.push(issue("exceeds-source", "layout.manual.cols", "Columns cannot exceed the source width."));
  if (rows * cols > GRID_PROCESSING_LIMITS.maxResultCount) {
    issues.push(issue("result-count-limit", "layout.manual", `The grid cannot produce more than ${GRID_PROCESSING_LIMITS.maxResultCount} cells.`));
  }
  if (issues.length > 0) return invalidResult(...issues);

  if (!isDataCloneSafe(value)) return invalidResult(issue(
    "invalid-object", "layout", "Grid layout must be a plain data object.",
  ));

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({ mode: layout.mode as GridLayoutMode, manual: Object.freeze({ rows, cols }) }),
  });
}

export function assertGridLayoutDraft(value: unknown, source: unknown): GridLayoutDraft {
  const result = validateGridLayoutDraft(value, source);
  if (result.ok) return result.value;
  const first = result.issues[0];
  throw new TypeError(`Invalid grid layout (${first.path}:${first.code}).`);
}

/**
 * Worker-facing recipe seam. It enforces the exact serialized form by routing
 * through the very same source-aware draft validator used by controls.
 */
export function assertGridRecipeLayout(value: unknown, source: unknown): GridRecipeLayoutV1 {
  const layout = readDataRecord(value);
  if (!layout) throw new TypeError("Invalid grid recipe layout.");
  if (layout.mode === "auto" && hasExactKeys(layout, ["mode"])) {
    if (!isDataCloneSafe(value)) throw new TypeError("Invalid grid recipe layout.");
    assertGridLayoutDraft({ mode: "auto", manual: { rows: 1, cols: 1 } }, source);
    return Object.freeze({ mode: "auto" as const });
  }
  if (layout.mode === "manual" && hasExactKeys(layout, ["mode", "rows", "cols"])) {
    if (!isDataCloneSafe(value)) throw new TypeError("Invalid grid recipe layout.");
    const draft = assertGridLayoutDraft(
      { mode: "manual", manual: { rows: layout.rows, cols: layout.cols } },
      source,
    );
    return Object.freeze({ mode: "manual" as const, rows: draft.manual.rows, cols: draft.manual.cols });
  }
  throw new TypeError("Invalid grid recipe layout.");
}
