import { describe, expect, it, vi } from "vitest";
import type { AssetMetadata, AssetRepository } from "../../core/assets";
import {
  createEmptyStudioProject,
  type AssetRecord,
  type ProjectCommandResult,
  type StudioProject,
} from "../../core/project";
import { createProjectStore, type ProjectStore } from "../../core/stores";
import {
  commitBackgroundRemoval,
} from "../../features/slice/backgroundRemoval/commitBackgroundRemoval";

const NOW = "2026-07-26T04:00:00.000Z";

function sourceAsset(): AssetRecord {
  return {
    id: "source",
    name: "hero.png",
    blobKey: "blob-source",
    contentHash: "sha256:source",
    mimeType: "image/png",
    width: 8,
    height: 6,
    byteSize: 64,
    createdAt: NOW,
    updatedAt: NOW,
    provenance: { source: "fixture" },
    media: { type: "image" },
  };
}

function harness() {
  const project = createEmptyStudioProject({ id: "commit-project", name: "Commit project", now: NOW });
  const source = sourceAsset();
  project.assets[source.id] = source;
  project.rootOrder.assetIds.push(source.id);
  const store = createProjectStore(project, {
    context: { now: () => NOW, nextId: () => "unused" },
  });
  const records = new Map<string, AssetRecord>();
  const blobs = new Map<string, Blob>();
  const put = vi.fn(async (blob: Blob, metadata: AssetMetadata) => {
    const record: AssetRecord = {
      id: metadata.id,
      name: metadata.name,
      blobKey: `blob-${metadata.id}`,
      contentHash: `sha256:${metadata.id}`,
      mimeType: metadata.declaredMimeType ?? blob.type,
      width: metadata.width,
      height: metadata.height,
      byteSize: blob.size,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      provenance: metadata.provenance,
      media: metadata.media ?? { type: "image" },
    };
    records.set(record.id, record);
    blobs.set(record.id, blob);
    return record;
  });
  const remove = vi.fn(async (assetId: string) => {
    records.delete(assetId);
    blobs.delete(assetId);
  });
  const repository = { projectId: project.id, put, remove } as unknown as AssetRepository;
  return { store, repository, records, blobs, put, remove };
}

const model = {
  id: "birefnet-lite-512" as const,
  repositoryId: "studioludens/birefnet-lite-512",
  revision: "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7",
  backend: "wasm" as const,
  inputWidth: 512,
  inputHeight: 512,
};

const ids: Record<"asset" | "artifact" | "recipe" | "command", string> = {
  asset: "output",
  artifact: "artifact-background",
  recipe: "recipe-background",
  command: "command-background",
};

describe("commitBackgroundRemoval", () => {
  it("stores the accepted PNG and commits its full provenance in one history entry", async () => {
    const runtime = harness();
    const output = new Blob(["output-png"], { type: "image/png" });
    const result = await commitBackgroundRemoval({
      store: runtime.store,
      repository: runtime.repository,
      sourceAssetId: "source",
      expectedRevision: 0,
      output,
      width: 8,
      height: 6,
      model,
      now: () => NOW,
      nextId: (kind) => ids[kind],
    });

    const snapshot = runtime.store.getSnapshot();
    expect(result.asset.name).toBe("hero-no-bg.png");
    expect(snapshot.revision).toBe(1);
    expect(snapshot.project.workspace.selectedAssetId).toBe("output");
    expect(snapshot.project.processingRecipes["recipe-background"]).toMatchObject({
      kind: "background-removal",
      sourceAssetId: "source",
      model: { id: "birefnet-lite-512", backend: "wasm" },
    });
    expect(snapshot.project.generatedArtifacts["artifact-background"]).toMatchObject({
      outputAssetId: "output",
      sourceAssetId: "source",
      recipeId: "recipe-background",
    });
    expect(runtime.records.get("output")?.provenance).toEqual({
      source: "derived",
      parentAssetId: "source",
      recipeId: "recipe-background",
      artifactId: "artifact-background",
    });
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it("rejects a stale preview before writing the output", async () => {
    const runtime = harness();
    await expect(commitBackgroundRemoval({
      store: runtime.store,
      repository: runtime.repository,
      sourceAssetId: "source",
      expectedRevision: 7,
      output: new Blob(["output-png"], { type: "image/png" }),
      width: 8,
      height: 6,
      model,
    })).rejects.toMatchObject({ code: "project-changed" });
    expect(runtime.put).not.toHaveBeenCalled();
  });

  it("removes the stored blob if the project rejects the command", async () => {
    const runtime = harness();
    const base = runtime.store;
    const rejected: ProjectCommandResult = {
      ok: false,
      project: base.getSnapshot().project as unknown as StudioProject,
      diagnostics: [{ code: "INVALID_PATCH", message: "Injected rejection" }],
    };
    const store = {
      ...base,
      dispatch: vi.fn(() => ({ revision: 0, result: rejected })),
    } as ProjectStore;
    await expect(commitBackgroundRemoval({
      store,
      repository: runtime.repository,
      sourceAssetId: "source",
      expectedRevision: 0,
      output: new Blob(["output-png"], { type: "image/png" }),
      width: 8,
      height: 6,
      model,
      now: () => NOW,
      nextId: (kind) => ids[kind],
    })).rejects.toMatchObject({ code: "project-rejected" });
    expect(runtime.put).toHaveBeenCalledTimes(1);
    expect(runtime.remove).toHaveBeenCalledWith("output", "release-and-remove");
    expect(runtime.records.has("output")).toBe(false);
  });

  it("never removes an unrelated asset when the repository returns the wrong record", async () => {
    const runtime = harness();
    const source = runtime.store.getSnapshot().project.assets.source!;
    const repository = {
      ...runtime.repository,
      projectId: runtime.repository.projectId,
      put: vi.fn(async () => source),
      remove: runtime.remove,
    } as AssetRepository;

    await expect(commitBackgroundRemoval({
      store: runtime.store,
      repository,
      sourceAssetId: "source",
      expectedRevision: 0,
      output: new Blob(["output-png"], { type: "image/png" }),
      width: 8,
      height: 6,
      model,
      now: () => NOW,
      nextId: (kind) => ids[kind],
    })).rejects.toMatchObject({ code: "repository-failed" });

    expect(runtime.remove).toHaveBeenCalledWith("output", "release-and-remove");
    expect(runtime.remove).not.toHaveBeenCalledWith("source", expect.anything());
    expect(runtime.store.getSnapshot().project.assets.source).toEqual(source);
  });
});
