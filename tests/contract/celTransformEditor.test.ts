import { describe, expect, it } from "vitest";
import { createEmptyStudioProject, type Cel, type Region, type Sequence } from "../../core/project";
import { createProjectStoreWithHistory } from "../../core/stores";
import { createCelTransformEditor } from "../../features/animate/frame/celTransformEditor";

const NOW = "2026-07-26T05:00:00.000Z";

function runtime() {
  const project = createEmptyStudioProject({ id: "project-frames", now: NOW });
  project.assets.asset = {
    id: "asset",
    name: "frame.png",
    mimeType: "image/png",
    blobKey: "asset",
    contentHash: "a".repeat(64),
    width: 32,
    height: 24,
    byteSize: 10,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "import", importedAt: NOW },
    media: { type: "image" },
  };
  project.rootOrder.assetIds.push("asset");
  const region: Region = {
    id: "region",
    assetId: "asset",
    bounds: { x: 0, y: 0, width: 32, height: 24 },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const sequence: Sequence = {
    id: "sequence",
    name: "Walk",
    celIds: ["cel-a", "cel-b"],
    fps: 12,
    loop: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const cel = (id: string): Cel => ({
    id,
    sequenceId: sequence.id,
    source: { type: "region", regionId: region.id },
    durationMs: 100,
    createdAt: NOW,
    updatedAt: NOW,
  });
  project.regions.region = region;
  project.rootOrder.regionIds.push(region.id);
  project.sequences.sequence = sequence;
  project.rootOrder.sequenceIds.push(sequence.id);
  project.cels["cel-a"] = cel("cel-a");
  project.cels["cel-b"] = cel("cel-b");
  project.workspace = { activeWorkspace: "animate", selectedSequenceId: "sequence", selectedCelIds: ["cel-a"] };
  let id = 0;
  const built = createProjectStoreWithHistory(project, {
    context: { nextId: () => `generated-${++id}`, now: () => NOW },
  });
  const editor = createCelTransformEditor({
    store: built.store,
    nextId: () => `command-${++id}`,
    now: () => NOW,
  });
  return { ...built, editor };
}

describe("cel transform editor", () => {
  it("selects a cel and keeps the sequence identity", () => {
    const { store, editor } = runtime();
    expect(editor.select("sequence", "cel-b")).toMatchObject({ ok: true, revision: 1 });
    expect(store.getSnapshot().project.workspace).toMatchObject({
      activeWorkspace: "animate",
      selectedSequenceId: "sequence",
      selectedCelIds: ["cel-b"],
    });
  });

  it("merges, clamps and coalesces a transform gesture into one undo", () => {
    const { store, history, editor } = runtime();
    expect(editor.setTransform("cel-a", { x: 12, scaleX: 99, rotation: 540 }, {
      mode: "coalesce",
      transactionId: "drag-1",
    }).ok).toBe(true);
    expect(editor.setTransform("cel-a", { x: 18, opacity: -4 }, {
      mode: "coalesce",
      transactionId: "drag-1",
    }).ok).toBe(true);
    expect(store.getSnapshot().project.cels["cel-a"].transform).toEqual({
      x: 18,
      y: 0,
      scaleX: 32,
      scaleY: 1,
      rotation: -180,
      opacity: 0,
      flipX: false,
      flipY: false,
    });
    expect(history.undo()).toMatchObject({ ok: true });
    expect(store.getSnapshot().project.cels["cel-a"].transform).toBeUndefined();
  });

  it("blocks locked edits, permits unlock, and resets while preserving opacity", () => {
    const { store, editor } = runtime();
    expect(editor.setTransform("cel-a", { opacity: 0.4, x: 9 }).ok).toBe(true);
    expect(editor.setLocked("cel-a", true).ok).toBe(true);
    expect(editor.setTransform("cel-a", { x: 20 })).toEqual({ ok: false, message: "Frame edit could not be applied." });
    expect(editor.setLocked("cel-a", false).ok).toBe(true);
    expect(editor.reset("cel-a").ok).toBe(true);
    expect(store.getSnapshot().project.cels["cel-a"].transform).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 0.4,
      flipX: false,
      flipY: false,
    });
  });

  it("fails closed on wrong ownership, non-finite values and hostile patches", () => {
    const { store, editor } = runtime();
    const revision = store.getSnapshot().revision;
    expect(editor.select("sequence", "missing").ok).toBe(false);
    expect(editor.setTransform("cel-b", { x: 1 }).ok).toBe(false);
    expect(editor.setTransform("cel-a", { x: Number.NaN }).ok).toBe(false);
    const hostile = new Proxy({}, { ownKeys() { throw new Error("secret-value"); } });
    expect(() => editor.setTransform("cel-a", hostile)).not.toThrow();
    expect(editor.setTransform("cel-a", hostile)).toEqual({ ok: false, message: "Frame edit could not be applied." });
    expect(store.getSnapshot().revision).toBe(revision);
  });
});
