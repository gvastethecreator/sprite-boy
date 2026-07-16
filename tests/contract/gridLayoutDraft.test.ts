import { describe, expect, it } from "vitest";
import { GRID_PROCESSING_LIMITS } from "../../core/processing/gridProcessingProtocol";
import { assertGridProcessingRequest } from "../../core/processing/gridProcessingProtocol";
import {
  assertGridLayoutDraft,
  createGridLayoutDraft,
  serializeGridRecipeLayout,
  setGridLayoutMode,
  setManualGridLayout,
  validateGridLayoutDraft,
  type GridLayoutValidationResult,
} from "../../features/slice/grid";

const SOURCE = Object.freeze({ width: 96, height: 32 });

function invalidCodes(result: GridLayoutValidationResult): readonly string[] {
  if (result.ok) throw new Error("Expected invalid layout result.");
  return result.issues.map(({ path, code }) => `${path}:${code}`);
}

describe("G2-01 grid layout draft", () => {
  it("creates an immutable deterministic auto draft with a retained manual default", () => {
    const first = createGridLayoutDraft(SOURCE);
    const second = createGridLayoutDraft({ width: 96, height: 32 });

    expect(first).toEqual({ mode: "auto", manual: { rows: 1, cols: 1 } });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.manual)).toBe(true);
  });

  it("preserves the exact last manual selection across auto/manual toggles", () => {
    const initial = createGridLayoutDraft(SOURCE, { rows: 4, cols: 12 });
    const manual = setGridLayoutMode(initial, "manual", SOURCE);
    expect(manual).toEqual({
      ok: true,
      value: { mode: "manual", manual: { rows: 4, cols: 12 } },
    });
    if (!manual.ok) throw new Error("Expected manual draft.");

    const edited = setManualGridLayout(manual.value, { rows: 8, cols: 6 }, SOURCE);
    if (!edited.ok) throw new Error("Expected edited draft.");
    const auto = setGridLayoutMode(edited.value, "auto", SOURCE);
    if (!auto.ok) throw new Error("Expected auto draft.");
    const restored = setGridLayoutMode(auto.value, "manual", SOURCE);

    expect(restored).toEqual({
      ok: true,
      value: { mode: "manual", manual: { rows: 8, cols: 6 } },
    });
  });

  it("serializes only the exact worker recipe layout for each mode", () => {
    const autoDraft = createGridLayoutDraft(SOURCE, { rows: 4, cols: 12 });
    const autoLayout = serializeGridRecipeLayout(autoDraft, SOURCE);
    const manualDraft = setGridLayoutMode(autoDraft, "manual", SOURCE);
    if (!manualDraft.ok) throw new Error("Expected manual draft.");
    const manualLayout = serializeGridRecipeLayout(manualDraft.value, SOURCE);

    expect(autoLayout).toEqual({ mode: "auto" });
    expect(Reflect.ownKeys(autoLayout)).toEqual(["mode"]);
    expect(manualLayout).toEqual({ mode: "manual", rows: 4, cols: 12 });
    expect(Reflect.ownKeys(manualLayout)).toEqual(["mode", "rows", "cols"]);
    expect(Object.isFrozen(autoLayout)).toBe(true);
    expect(Object.isFrozen(manualLayout)).toBe(true);
  });

  it.each([
    [{ width: 1, height: 1 }, { mode: "manual", manual: { rows: 1, cols: 1 } }],
    [{ width: 17, height: 3 }, { mode: "manual", manual: { rows: 3, cols: 17 } }],
    [
      { width: 64, height: 64 },
      { mode: "manual", manual: { rows: 64, cols: 64 } },
    ],
  ])("accepts source-aware boundary %o with %o", (source, draft) => {
    const result = validateGridLayoutDraft(draft, source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(serializeGridRecipeLayout(result.value, source)).toEqual({
      mode: "manual",
      rows: draft.manual.rows,
      cols: draft.manual.cols,
    });
  });

  it("rejects source-relative and aggregate overflows without clamping", () => {
    expect(invalidCodes(validateGridLayoutDraft(
      { mode: "manual", manual: { rows: 33, cols: 97 } },
      SOURCE,
    ))).toEqual([
      "layout.manual.rows:exceeds-source",
      "layout.manual.cols:exceeds-source",
    ]);

    const tooMany = validateGridLayoutDraft(
      { mode: "manual", manual: { rows: 65, cols: 64 } },
      { width: 64, height: 65 },
    );
    expect(invalidCodes(tooMany)).toEqual(["layout.manual:result-count-limit"]);

    const current = createGridLayoutDraft(SOURCE, { rows: 2, cols: 4 });
    const rejectedEdit = setManualGridLayout(current, { rows: 999, cols: 4 }, SOURCE);
    expect(invalidCodes(rejectedEdit)).toEqual(["layout.manual.rows:exceeds-source"]);
    expect(current).toEqual({ mode: "auto", manual: { rows: 2, cols: 4 } });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    -0,
    0,
    -1,
    GRID_PROCESSING_LIMITS.maxResultCount + 1,
  ])("rejects hostile row count %s as a canonical-integer error", (rows) => {
    const result = validateGridLayoutDraft(
      { mode: "manual", manual: { rows, cols: 1 } },
      SOURCE,
    );
    expect(invalidCodes(result)).toEqual(["layout.manual.rows:invalid-integer"]);
  });

  it.each([
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    2.25,
    -0,
    0,
    -4,
    GRID_PROCESSING_LIMITS.maxResultCount + 1,
  ])("rejects hostile column count %s as a canonical-integer error", (cols) => {
    const result = validateGridLayoutDraft(
      { mode: "manual", manual: { rows: 1, cols } },
      SOURCE,
    );
    expect(invalidCodes(result)).toEqual(["layout.manual.cols:invalid-integer"]);
  });

  it("fails closed for unknown keys, missing keys, arrays and sparse arrays", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = 1;

    expect(invalidCodes(validateGridLayoutDraft(
      { mode: "auto", manual: { rows: 1, cols: 1 }, surprise: true },
      SOURCE,
    ))).toEqual(["layout:invalid-keys"]);
    expect(invalidCodes(validateGridLayoutDraft(
      { mode: "manual", manual: { rows: 1, cols: 1, extra: 1 } },
      SOURCE,
    ))).toEqual(["layout.manual:invalid-keys"]);
    expect(invalidCodes(validateGridLayoutDraft(
      { mode: "auto" },
      SOURCE,
    ))).toEqual(["layout:invalid-keys"]);
    expect(invalidCodes(validateGridLayoutDraft(sparse, SOURCE))).toEqual([
      "layout:invalid-object",
    ]);
    expect(invalidCodes(validateGridLayoutDraft(
      { mode: "auto", manual: sparse },
      SOURCE,
    ))).toEqual(["layout.manual:invalid-object"]);
  });

  it("rejects accessors without evaluating them", () => {
    let reads = 0;
    const manual = { cols: 1 } as { rows?: number; cols: number };
    Object.defineProperty(manual, "rows", {
      enumerable: true,
      get() {
        reads += 1;
        return 1;
      },
    });
    const result = validateGridLayoutDraft({ mode: "auto", manual }, SOURCE);

    expect(result.ok).toBe(false);
    expect(reads).toBe(0);
    expect(invalidCodes(result)).toEqual(["layout.manual:invalid-object"]);
  });

  it("rejects transparent and hostile proxies without throwing", () => {
    const transparent = new Proxy(
      { mode: "auto", manual: { rows: 1, cols: 1 } },
      {},
    );
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile");
      },
    });

    expect(invalidCodes(validateGridLayoutDraft(transparent, SOURCE))).toEqual([
      "layout:invalid-object",
    ]);
    expect(invalidCodes(validateGridLayoutDraft(hostile, SOURCE))).toEqual([
      "layout:invalid-object",
    ]);
  });

  it("validates source objects with the same strict fail-closed boundary", () => {
    const draft = { mode: "auto", manual: { rows: 1, cols: 1 } };
    expect(invalidCodes(validateGridLayoutDraft(draft, { width: 1, height: 1, x: 1 }))).toEqual([
      "source:invalid-keys",
    ]);
    expect(invalidCodes(validateGridLayoutDraft(draft, { width: -0, height: 1 }))).toEqual([
      "source.width:invalid-integer",
    ]);
    expect(invalidCodes(validateGridLayoutDraft(
      draft,
      { width: GRID_PROCESSING_LIMITS.maxDimension, height: GRID_PROCESSING_LIMITS.maxDimension },
    ))).toEqual(["source:source-pixel-limit"]);
    expect(invalidCodes(validateGridLayoutDraft(draft, new Proxy(SOURCE, {})))).toEqual([
      "source:invalid-object",
    ]);
  });

  it("provides an exact throwing boundary for domain and worker consumers", () => {
    expect(assertGridLayoutDraft(
      { mode: "manual", manual: { rows: 2, cols: 3 } },
      SOURCE,
    )).toEqual({ mode: "manual", manual: { rows: 2, cols: 3 } });
    expect(() => assertGridLayoutDraft(
      { mode: "manual", manual: { rows: 2.1, cols: 3 } },
      SOURCE,
    )).toThrow("Invalid grid layout (layout.manual.rows:invalid-integer).");
    expect(() => serializeGridRecipeLayout(
      { mode: "manual", manual: { rows: 99, cols: 1 } },
      SOURCE,
    )).toThrow("Invalid grid layout (layout.manual.rows:exceeds-source).");
  });

  it("applies the source-aware control boundary again at the worker protocol seam", () => {
    const source = { width: 3, height: 2 };
    const accepted = serializeGridRecipeLayout(
      { mode: "manual", manual: { rows: 2, cols: 3 } },
      source,
    );
    const request = {
      version: 1,
      type: "process",
      requestId: "grid-layout-shared-seam",
      source: {
        ...source,
        format: "rgba8",
        colorSpace: "srgb",
        pixels: new ArrayBuffer(source.width * source.height * 4),
      },
      recipe: {
        kind: "grid-split",
        version: 1,
        sourceAssetId: "asset-sheet",
        layout: accepted,
        crop: { threshold: 0, padding: 0 },
        chroma: { enabled: false, color: "#00ff00", tolerance: 0, smoothness: 0, spill: 0 },
        pixel: { enabled: false, size: 1, quantize: false, colors: 2 },
      },
    };

    expect(() => assertGridProcessingRequest(request)).not.toThrow();
    expect(() => serializeGridRecipeLayout(
      { mode: "manual", manual: { rows: 3, cols: 3 } },
      source,
    )).toThrow("Invalid grid layout (layout.manual.rows:exceeds-source).");

    request.recipe.layout = { mode: "manual", rows: 3, cols: 3 };
    expect(() => assertGridProcessingRequest(request)).toThrow(/request\.recipe\.layout/);
  });
});
