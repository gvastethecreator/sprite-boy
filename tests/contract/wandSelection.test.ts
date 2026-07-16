import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  IRREGULAR_REGION_DONOR_DEFAULTS,
  IrregularRegionDetectionCancelledError,
  type IrregularRegionDetectionOptions,
} from "../../core/processing/irregularRegionDetection";
import {
  applyProjectCommandBatch,
  applyProjectCommandInverse,
} from "../../core/project/applyCommand";
import type { ProjectCommandContext } from "../../core/project/commands";
import type { Region } from "../../core/project/schema";
import {
  adaptWandRegionIntentToProjectBatch,
  cancelWandSelection,
  createEmptyWandSelection,
  mapWandClientPointToSource,
  selectWandComponent,
} from "../../features/slice/irregular";
import { studioProjectV1Fixture } from "./fixtures/studioProjectV1";

function rgba(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function alpha(pixels: Uint8ClampedArray, width: number, x: number, y: number, value = 255): void {
  pixels[(y * width + x) * 4 + 3] = value;
}

const everyComponent: IrregularRegionDetectionOptions = Object.freeze({
  ...IRREGULAR_REGION_DONOR_DEFAULTS,
  minPixelCount: 1,
  minWidth: 1,
  minHeight: 1,
});

function select(
  selection: ReturnType<typeof createEmptyWandSelection>,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  mode: "replace" | "add" | "subtract" = "replace",
  options: IrregularRegionDetectionOptions = everyComponent,
) {
  return selectWandComponent(selection, {
    sourceAssetId: "asset-sheet",
    pixels,
    width,
    height,
    seed: { x, y },
    mode,
    options,
  });
}

function selectedPixels(selection: ReturnType<typeof createEmptyWandSelection>): string[] {
  if (!selection.mask) return [];
  const result: string[] = [];
  for (const run of selection.mask.runs) {
    for (let offset = run.offset; offset < run.offset + run.length; offset += 1) {
      result.push(`${selection.mask.bounds.x + offset % selection.mask.bounds.width},${selection.mask.bounds.y + Math.floor(offset / selection.mask.bounds.width)}`);
    }
  }
  return result;
}

function canonicalWandRegion(
  component: { readonly id: string; readonly sourceAssetId: string; readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } },
  regionId = "region-exact",
): Region {
  return {
    id: regionId,
    assetId: component.sourceAssetId,
    bounds: { ...component.bounds },
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    provenance: { source: "wand" as const, sourceId: component.id },
  };
}

function canonicalRegionView(...regions: Region[]) {
  return { regions: Object.fromEntries(regions.map((region) => [region.id, region])) };
}

describe("S1-02 wand selection model", () => {
  it("selects exact seed membership when disconnected components have overlapping bounds", () => {
    const pixels = rgba(5, 5);
    for (let x = 0; x < 5; x += 1) {
      alpha(pixels, 5, x, 0);
      alpha(pixels, 5, x, 4);
    }
    for (let y = 1; y < 4; y += 1) {
      alpha(pixels, 5, 0, y);
      alpha(pixels, 5, 4, y);
    }
    alpha(pixels, 5, 2, 2);

    const inner = select(createEmptyWandSelection(), pixels, 5, 5, 2, 2);
    expect(inner.hit).toMatchObject({ pixelCount: 1, bounds: { x: 2, y: 2, width: 1, height: 1 } });
    expect(selectedPixels(inner.selection)).toEqual(["2,2"]);

    const outer = select(createEmptyWandSelection(), pixels, 5, 5, 0, 0);
    expect(outer.hit).toMatchObject({ pixelCount: 16, bounds: { x: 0, y: 0, width: 5, height: 5 } });
    expect(selectedPixels(outer.selection)).not.toContain("2,2");
  });

  it("reduces replace/add/subtract with stable identity, set ordering and no duplicate intents", () => {
    const pixels = rgba(6, 2);
    alpha(pixels, 6, 0, 0);
    alpha(pixels, 6, 1, 0);
    alpha(pixels, 6, 4, 1);
    alpha(pixels, 6, 5, 1);

    const first = select(createEmptyWandSelection(), pixels, 6, 2, 4, 1);
    const firstId = first.hit!.id;
    expect(first.intent?.operations.map(({ type }) => type)).toEqual(["add"]);

    const added = select(first.selection, pixels, 6, 2, 0, 0, "add");
    expect(added.selection.components.map(({ firstPixelOffset }) => firstPixelOffset)).toEqual([0, 10]);
    expect(added.selection.mask).toMatchObject({ pixelCount: 4, bounds: { x: 0, y: 0, width: 6, height: 2 } });
    expect(added.intent?.operations.map(({ type }) => type)).toEqual(["add"]);

    const repeated = select(added.selection, pixels, 6, 2, 4, 1, "add");
    expect(repeated.selection).toBe(added.selection);
    expect(repeated.hit?.id).toBe(firstId);
    expect(repeated.intent).toBeNull();
    expect(repeated.status).toBe("unchanged");

    const removed = select(repeated.selection, pixels, 6, 2, 4, 1, "subtract");
    expect(removed.intent?.operations).toMatchObject([{ type: "remove", component: { id: firstId } }]);
    const last = select(removed.selection, pixels, 6, 2, 0, 0, "subtract");
    expect(last.status).toBe("cleared");
    expect(last.selection.components).toEqual([]);
    expect(last.selection.mask).toBeNull();
    expect(last.selection.bounds).toBeNull();
  });

  it("floods only the seed component and ignores unrelated components beyond maxRegions", () => {
    const pixels = rgba(5, 1);
    alpha(pixels, 5, 0, 0);
    alpha(pixels, 5, 2, 0);
    alpha(pixels, 5, 4, 0);
    const result = select(createEmptyWandSelection(), pixels, 5, 1, 4, 0, "replace", {
      ...everyComponent,
      maxRegions: 1,
    });
    expect(result.hit).toMatchObject({
      firstPixelOffset: 4,
      pixelCount: 1,
      bounds: { x: 4, y: 0, width: 1, height: 1 },
    });
  });

  it("separates the known FNV32 source collision and emits replace remove/add intents", () => {
    const pixels = rgba(1, 1);
    alpha(pixels, 1, 0, 0);
    const first = selectWandComponent(createEmptyWandSelection(), {
      sourceAssetId: "asset-haumha-jsez3r",
      pixels,
      width: 1,
      height: 1,
      seed: { x: 0, y: 0 },
      mode: "replace",
      options: everyComponent,
    });
    const replacement = selectWandComponent(first.selection, {
      sourceAssetId: "asset-1koyyyc-k2ukzu",
      pixels,
      width: 1,
      height: 1,
      seed: { x: 0, y: 0 },
      mode: "replace",
      options: everyComponent,
    });
    expect(first.hit?.id).toMatch(/^wand:sha256:[0-9a-f]{64}$/u);
    const numbers = Buffer.alloc(10 * 4);
    [1, 1, 0, 1, 0, 0, 1, 1, 0, 1].forEach((value, index) => numbers.writeUInt32BE(value, index * 4));
    const expectedDigest = createHash("sha256")
      .update("sprite-boy:wand-component:v2\0")
      .update("asset-haumha-jsez3r")
      .update(Buffer.from([0]))
      .update(numbers)
      .digest("hex");
    expect(first.hit?.id).toBe(`wand:sha256:${expectedDigest}`);
    expect(first.hit?.id).not.toBe(replacement.hit?.id);
    expect(replacement.selection).not.toBe(first.selection);
    expect(replacement.intent?.operations.map(({ type, component }) => [type, component.sourceAssetId])).toEqual([
      ["remove", "asset-haumha-jsez3r"],
      ["add", "asset-1koyyyc-k2ukzu"],
    ]);
  });

  it("defines transparent, outside, strict threshold, diagonal and replace-clear behavior", () => {
    const pixels = rgba(3, 3);
    alpha(pixels, 3, 0, 0, 10);
    alpha(pixels, 3, 1, 1, 11);
    alpha(pixels, 3, 2, 2, 11);
    const threshold = { ...everyComponent, alphaThreshold: 10, connectivity: 4 as const };

    expect(select(createEmptyWandSelection(), pixels, 3, 3, 0, 0, "replace", threshold).status).toBe("no-hit");
    expect(select(createEmptyWandSelection(), pixels, 3, 3, -1, 0, "replace", threshold).status).toBe("no-hit");
    const diagonalFour = select(createEmptyWandSelection(), pixels, 3, 3, 1, 1, "replace", threshold);
    expect(diagonalFour.hit?.pixelCount).toBe(1);
    const diagonalEight = select(createEmptyWandSelection(), pixels, 3, 3, 1, 1, "replace", {
      ...threshold,
      connectivity: 8,
    });
    expect(diagonalEight.hit?.pixelCount).toBe(2);

    const cleared = select(diagonalEight.selection, pixels, 3, 3, 2, 0, "replace", threshold);
    expect(cleared.status).toBe("cleared");
    expect(cleared.intent?.operations.map(({ type }) => type)).toEqual(["remove"]);
  });

  it("rejects hostile seed/options without invoking accessors", () => {
    const pixels = rgba(1, 1);
    alpha(pixels, 1, 0, 0);
    let seedReads = 0;
    const hostileSeed = { y: 0 } as { x: number; y: number };
    Object.defineProperty(hostileSeed, "x", {
      enumerable: true,
      get() {
        seedReads += 1;
        return 0;
      },
    });
    expect(() => selectWandComponent(createEmptyWandSelection(), {
      sourceAssetId: "asset-sheet",
      pixels,
      width: 1,
      height: 1,
      seed: hostileSeed,
      mode: "replace",
      options: everyComponent,
    })).toThrow(TypeError);
    expect(seedReads).toBe(0);

    let optionReads = 0;
    const hostileOptions = { ...everyComponent };
    Object.defineProperty(hostileOptions, "connectivity", {
      enumerable: true,
      get() {
        optionReads += 1;
        return 4;
      },
    });
    expect(() => select(createEmptyWandSelection(), pixels, 1, 1, 0, 0, "replace", hostileOptions)).toThrow(TypeError);
    expect(optionReads).toBe(0);
    expect(() => select(createEmptyWandSelection(), pixels, 1, 1, Number.NaN, 0)).toThrow(TypeError);
  });

  it("rebuilds complete root input/selection records from own data and contains proxies", () => {
    const pixels = rgba(1, 1);
    alpha(pixels, 1, 0, 0);
    let inputReads = 0;
    const hostileInput = {
      pixels,
      width: 1,
      height: 1,
      seed: { x: 0, y: 0 },
      mode: "replace",
      options: everyComponent,
    } as Record<string, unknown>;
    Object.defineProperty(hostileInput, "sourceAssetId", {
      enumerable: true,
      get() {
        inputReads += 1;
        return "asset-sheet";
      },
    });
    expect(() => selectWandComponent(createEmptyWandSelection(), hostileInput as never)).toThrow(TypeError);
    expect(inputReads).toBe(0);

    const selected = select(createEmptyWandSelection(), pixels, 1, 1, 0, 0).selection;
    let selectionReads = 0;
    const hostileSelection = { ...selected } as Record<string, unknown>;
    Object.defineProperty(hostileSelection, "version", {
      enumerable: true,
      get() {
        selectionReads += 1;
        return 1;
      },
    });
    expect(() => cancelWandSelection(hostileSelection as never)).toThrow(TypeError);
    expect(selectionReads).toBe(0);

    const proxy = new Proxy({}, {
      ownKeys() {
        throw new Error("private proxy detail");
      },
    });
    expect(() => selectWandComponent(selected, proxy as never)).toThrow("input is not valid wand selection input");

    const revokedSelection = Proxy.revocable({}, {});
    revokedSelection.revoke();
    expect(() => cancelWandSelection(revokedSelection.proxy as never)).toThrow("selection is not valid wand selection input");

    const revokedSeed = Proxy.revocable({}, {});
    revokedSeed.revoke();
    expect(() => selectWandComponent(createEmptyWandSelection(), {
      sourceAssetId: "asset-sheet",
      pixels,
      width: 1,
      height: 1,
      seed: revokedSeed.proxy as never,
      mode: "replace",
      options: everyComponent,
    })).toThrow("seed is not valid wand selection input");

    const revokedBounds = Proxy.revocable({}, {});
    revokedBounds.revoke();
    expect(() => cancelWandSelection({ ...selected, bounds: revokedBounds.proxy as never })).toThrow(
      "selection.bounds is not valid wand selection input",
    );
  });

  it("cancels without exposing a next snapshot and Escape retains exact state identity", () => {
    const small = rgba(1, 1);
    alpha(small, 1, 0, 0);
    const selected = select(createEmptyWandSelection(), small, 1, 1, 0, 0).selection;
    expect(cancelWandSelection(selected)).toMatchObject({ selection: selected, changed: false, status: "cancelled" });

    const width = 8_193;
    const huge = rgba(width, 1);
    for (let offset = 3; offset < huge.length; offset += 4) huge[offset] = 255;
    let checks = 0;
    expect(() => selectWandComponent(selected, {
      sourceAssetId: "asset-sheet",
      pixels: huge,
      width,
      height: 1,
      seed: { x: 0, y: 0 },
      mode: "replace",
      options: everyComponent,
      // preflight=1, flood head=0 is 2; check 3 proves the seed-local flood
      // polls again at head=4096 without any global component pass.
      isCancelled: () => ++checks === 3,
    })).toThrow(IrregularRegionDetectionCancelledError);
    expect(checks).toBe(3);
    expect(selected.components).toHaveLength(1);

    expect(() => selectWandComponent(selected, {
      sourceAssetId: "asset-sheet",
      pixels: small,
      width: 1,
      height: 1,
      seed: { x: 0, y: 0 },
      mode: "replace",
      options: everyComponent,
      isCancelled: () => { throw new Error("PRIVATE_CANCEL_SECRET"); },
    })).toThrow("isCancelled callback is not valid wand selection input");
  });

  it("preserves randomized seed identity and aggregate mask union", () => {
    let state = 0x51ce02;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let sample = 0; sample < 40; sample += 1) {
      const width = 4 + (random() % 12);
      const height = 4 + (random() % 10);
      const pixels = rgba(width, height);
      for (let index = 0; index < width * height; index += 1) {
        pixels[index * 4 + 3] = random() % 3 === 0 ? 255 : 0;
      }
      const seedOffset = random() % (width * height);
      const x = seedOffset % width;
      const y = Math.floor(seedOffset / width);
      const first = select(createEmptyWandSelection(), pixels, width, height, x, y);
      const again = select(createEmptyWandSelection(), pixels, width, height, x, y);
      expect(again.hit?.id ?? null).toBe(first.hit?.id ?? null);
      expect(again.selection).toEqual(first.selection);
      if (first.hit) {
        expect(first.selection.mask?.pixelCount).toBe(first.hit.pixelCount);
        expect(new Set(selectedPixels(first.selection)).size).toBe(first.hit.pixelCount);
      }
    }
  });

  it("keeps a one-megapixel seed selection inside the S1 practical budget", () => {
    const width = 1_024;
    const height = 1_024;
    const pixels = rgba(width, height);
    for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
    const startedAt = performance.now();
    const result = select(createEmptyWandSelection(), pixels, width, height, 512, 512);
    const elapsedMs = performance.now() - startedAt;
    expect(result.hit?.pixelCount).toBe(width * height);
    expect(result.selection.mask?.runs).toHaveLength(height);
    expect(elapsedMs).toBeLessThan(2_500);
  });
});

describe("S1-02 wand coordinate and command adapters", () => {
  it("maps CSS points through zoom/DPR/pan and returns null outside source", () => {
    const transform = {
      canvasClientLeft: 100,
      canvasClientTop: 50,
      devicePixelRatio: 2,
      zoom: 3,
      sourceOriginCanvasX: 20,
      sourceOriginCanvasY: 10,
      sourceWidth: 20,
      sourceHeight: 10,
    };
    expect(mapWandClientPointToSource({ clientX: 110, clientY: 55 }, transform)).toEqual({ x: 0, y: 0 });
    expect(mapWandClientPointToSource({ clientX: 136, clientY: 73 }, transform)).toEqual({ x: 8, y: 6 });
    expect(mapWandClientPointToSource({ clientX: 99, clientY: 50 }, transform)).toBeNull();
    expect(() => mapWandClientPointToSource({ clientX: 0, clientY: 0 }, { ...transform, zoom: 0 })).toThrow(TypeError);

    let reads = 0;
    const hostile = { clientY: 0 } as { clientX: number; clientY: number };
    Object.defineProperty(hostile, "clientX", { enumerable: true, get: () => { reads += 1; return 0; } });
    expect(() => mapWandClientPointToSource(hostile, transform)).toThrow(TypeError);
    expect(reads).toBe(0);
  });

  it("adapts add intents into canonical one-undo batches and rejects semantic drift", () => {
    const pixels = rgba(2, 1);
    alpha(pixels, 2, 0, 0);
    const transition = select(createEmptyWandSelection(), pixels, 2, 1, 0, 0);
    const component = transition.hit!;
    const command = adaptWandRegionIntentToProjectBatch(transition.intent!, canonicalRegionView(), {
      add: () => ({
        type: "regions.commitRecipe",
        recipe: {
          id: "recipe-wand-1",
          kind: "grid-split",
          version: 1,
          sourceAssetId: "asset-sheet",
          layout: { mode: "auto" },
          crop: { threshold: 0, padding: 0 },
          chroma: { enabled: false, color: "#000000", tolerance: 0, smoothness: 0, spill: 0 },
          pixel: { enabled: false, size: 1, quantize: false, colors: 2 },
          createdAt: "2026-07-16T12:00:00.000Z",
          updatedAt: "2026-07-16T12:00:00.000Z",
        },
        regions: [{
          id: `region-${component.id}`,
          assetId: "asset-sheet",
          bounds: component.bounds,
          createdAt: "2026-07-16T12:00:00.000Z",
          updatedAt: "2026-07-16T12:00:00.000Z",
          provenance: { source: "wand", sourceId: component.id },
        }],
      }),
    });
    expect(command).toMatchObject({
      type: "command.batch",
      commands: [{ type: "regions.commitRecipe", regions: [{ bounds: component.bounds }] }],
    });
    const context: ProjectCommandContext = {
      nextId: () => "unused",
      now: () => "2026-07-16T12:00:00.000Z",
    };
    const applied = applyProjectCommandBatch(studioProjectV1Fixture, command, context);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.diagnostics.map(({ message }) => message).join("; "));
    expect(applied.project.regions).toHaveProperty(`region-${component.id}`);
    const undone = applyProjectCommandInverse(applied.project, applied.inverse, context);
    expect(undone.ok).toBe(true);
    expect(undone.project).toEqual(studioProjectV1Fixture);

    expect(() => adaptWandRegionIntentToProjectBatch(transition.intent!, canonicalRegionView(), {
      add: () => ({ ...command.commands[0] as Extract<typeof command.commands[number], { type: "regions.commitRecipe" }>, regions: [] }),
    })).toThrow(/one matching/);
  });

  it("resolves subtract from one canonical project Region and preserves real undo", () => {
    const pixels = rgba(1, 1);
    alpha(pixels, 1, 0, 0);
    const selected = select(createEmptyWandSelection(), pixels, 1, 1, 0, 0).selection;
    const subtract = select(selected, pixels, 1, 1, 0, 0, "subtract");
    const component = selected.components[0]!;
    const exactRegion = canonicalWandRegion(component);
    const unusedAdd = () => { throw new Error("unused"); };

    const command = adaptWandRegionIntentToProjectBatch(
      subtract.intent!,
      canonicalRegionView(exactRegion),
      { add: unusedAdd },
    );
    expect(command).toEqual({
      type: "command.batch",
      commands: [{ type: "region.remove", regionId: "region-exact", policy: "reject" }],
    });

    const project = structuredClone(studioProjectV1Fixture);
    project.regions[exactRegion.id] = exactRegion;
    project.rootOrder.regionIds.push(exactRegion.id);
    const context: ProjectCommandContext = {
      nextId: () => "unused",
      now: () => "2026-07-16T12:00:00.000Z",
    };
    const applied = applyProjectCommandBatch(project, command, context);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.diagnostics.map(({ message }) => message).join("; "));
    expect(applied.project.regions).not.toHaveProperty(exactRegion.id);
    const undone = applyProjectCommandInverse(applied.project, applied.inverse, context);
    expect(undone.ok).toBe(true);
    expect(undone.project).toEqual(project);
  });

  it("rejects self-consistent unrelated projection, zero matches and ambiguous canonical matches", () => {
    const pixels = rgba(1, 1);
    alpha(pixels, 1, 0, 0);
    const selected = select(createEmptyWandSelection(), pixels, 1, 1, 0, 0).selection;
    const subtract = select(selected, pixels, 1, 1, 0, 0, "subtract");
    const component = selected.components[0]!;
    const exactRegion = canonicalWandRegion(component);
    const unrelatedProjection = canonicalWandRegion(component, "region-unrelated");
    const unusedAdd = () => { throw new Error("unused"); };

    let externalRemoveEffects = 0;
    // Even a self-consistent copied projection cannot inject a post-resolution callback/effect.
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, canonicalRegionView(exactRegion), {
      add: unusedAdd,
      remove: () => {
        externalRemoveEffects += 1;
        return { type: "region.remove", regionId: unrelatedProjection.id, policy: "reject" };
      },
    } as never)).toThrow(/adapter is invalid/);
    expect(externalRemoveEffects).toBe(0);

    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, canonicalRegionView(), {
      add: unusedAdd,
    })).toThrow(/found no canonical Region/);

    expect(() => adaptWandRegionIntentToProjectBatch(
      subtract.intent!,
      canonicalRegionView(exactRegion, canonicalWandRegion(component, "region-duplicate")),
      {
        add: unusedAdd,
      },
    )).toThrow(/found ambiguous canonical Regions/);
  });

  it("contains hostile canonical views, intents, adapters and add callback results without execution or leaks", () => {
    const pixels = rgba(1, 1);
    alpha(pixels, 1, 0, 0);
    const selected = select(createEmptyWandSelection(), pixels, 1, 1, 0, 0).selection;
    const subtract = select(selected, pixels, 1, 1, 0, 0, "subtract");
    const exactRegion = canonicalWandRegion(selected.components[0]!);
    const view = canonicalRegionView(exactRegion);
    const unusedAdd = () => { throw new Error("unused"); };

    let adapterReads = 0;
    const hostileAdapter = {} as Record<string, unknown>;
    Object.defineProperty(hostileAdapter, "add", {
      enumerable: true,
      get() {
        adapterReads += 1;
        return unusedAdd;
      },
    });
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, view, hostileAdapter as never)).toThrow(/adapter.add is invalid/);
    expect(adapterReads).toBe(0);

    let intentReads = 0;
    const hostileIntent = { ...subtract.intent } as Record<string, unknown>;
    Object.defineProperty(hostileIntent, "type", {
      enumerable: true,
      get() {
        intentReads += 1;
        return "wand-region.intent-batch";
      },
    });
    expect(() => adaptWandRegionIntentToProjectBatch(hostileIntent as never, view, {
      add: unusedAdd,
    })).toThrow(/intent.type is invalid/);
    expect(intentReads).toBe(0);

    const revokedAdapter = Proxy.revocable({}, {});
    revokedAdapter.revoke();
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, view, revokedAdapter.proxy as never)).toThrow(
      "Wand region command adapter adapter is invalid.",
    );

    let hostileViewAddCalls = 0;
    const shouldNotAdd = () => {
      hostileViewAddCalls += 1;
      throw new Error("PRIVATE_ADD_SECRET");
    };
    let viewReads = 0;
    const getterView = {} as Record<string, unknown>;
    Object.defineProperty(getterView, "regions", {
      enumerable: true,
      get() {
        viewReads += 1;
        return view.regions;
      },
    });
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, getterView as never, {
      add: shouldNotAdd,
    })).toThrow(/canonical project Region view.regions is invalid/);
    expect(viewReads).toBe(0);

    let regionReads = 0;
    const getterRegions = {} as Record<string, unknown>;
    Object.defineProperty(getterRegions, exactRegion.id, {
      enumerable: true,
      get() {
        regionReads += 1;
        return exactRegion;
      },
    });
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, { regions: getterRegions } as never, {
      add: shouldNotAdd,
    })).toThrow(/canonical project Region view.regions.region-exact is invalid/);
    expect(regionReads).toBe(0);

    const hostileRegions = new Proxy({}, {
      ownKeys() {
        throw new Error("PRIVATE_REGIONS_SECRET");
      },
    });
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, { regions: hostileRegions } as never, {
      add: shouldNotAdd,
    })).toThrow("Wand region command adapter canonical project Region view.regions is invalid.");

    const revokedView = Proxy.revocable({}, {});
    revokedView.revoke();
    expect(() => adaptWandRegionIntentToProjectBatch(subtract.intent!, revokedView.proxy as never, {
      add: shouldNotAdd,
    })).toThrow("Wand region command adapter canonical project Region view is invalid.");
    expect(hostileViewAddCalls).toBe(0);

    const addTransition = select(createEmptyWandSelection(), pixels, 1, 1, 0, 0);
    expect(() => adaptWandRegionIntentToProjectBatch(addTransition.intent!, canonicalRegionView(), {
      add: () => { throw new Error("PRIVATE_ADD_SECRET"); },
    })).toThrow("Wand region command adapter add callback failed.");

    let addResultReads = 0;
    expect(() => adaptWandRegionIntentToProjectBatch(addTransition.intent!, canonicalRegionView(), {
      add: () => {
        const result = {} as Record<string, unknown>;
        Object.defineProperty(result, "type", {
          enumerable: true,
          get() {
            addResultReads += 1;
            return "regions.commitRecipe";
          },
        });
        return result as never;
      },
    })).toThrow(/add result.type is invalid/);
    expect(addResultReads).toBe(0);
  });
});
