import {
  isAssetRepositoryError,
  withAssetRepositoryMutation,
  type AssetMetadata,
  type AssetRepository,
} from "../../../core/assets";
import {
  VideoMediaError,
  type VideoExtractOptions,
  type VideoExtractedFrame,
  type VideoPreflight,
  type VideoSampling,
  type VideoTimeRange,
} from "../../../core/media";
import {
  isEntityId,
  type AssetRecord,
  type Cel,
  type ProcessingRecipe,
  type Region,
  type Sequence,
  type StudioProject,
} from "../../../core/project";
import { JobTaskError, type JobTask, type JobTaskContext } from "../../../core/processing";
import type { ProjectStore } from "../../../core/stores";

export interface VideoImportAdapter {
  preflight(
    blob: Blob,
    options?: { readonly trackIndex?: number; readonly signal?: AbortSignal },
  ): PromiseLike<VideoPreflight>;
  extractFrames(
    blob: Blob,
    options: VideoExtractOptions,
  ): PromiseLike<readonly VideoExtractedFrame[]>;
}

export interface VideoImportSelection {
  readonly trackIndex: number;
  readonly range: VideoTimeRange;
  readonly sampling: VideoSampling;
}

export interface CreateVideoImportJobTaskOptions {
  readonly adapter: VideoImportAdapter;
  readonly store: ProjectStore;
  readonly repository: AssetRepository;
  readonly file: Blob;
  readonly fileName: string;
  readonly selection: VideoImportSelection;
  readonly nextId?: () => string;
  readonly now?: () => string;
  readonly reportAssetCleanupDebt?: (
    projectId: string,
    assetId: string,
    pending: boolean,
  ) => void;
}

export interface VideoImportJobResult {
  readonly revision: number;
  readonly sourceAsset: AssetRecord;
  readonly recipe: ProcessingRecipe;
  readonly frames: readonly AssetRecord[];
  readonly regions: readonly Region[];
  readonly sequence: Sequence;
  readonly cels: readonly Cel[];
}

interface OwnedAssetAttempt {
  readonly requestedId: string;
  readonly expected: AssetMetadata;
  putStarted: boolean;
}

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const MAX_SEQUENCE_FPS = 240;
let identitySequence = 0;

function defaultId(prefix: string): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  } catch {
    // Fall through to a process-local identity.
  }
  identitySequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${identitySequence.toString(36)}`;
}

function generatedId(value: string, label: string): string {
  if (!isEntityId(value)) {
    throw new JobTaskError("invalid-input", `${label} must produce a valid entity ID.`, false);
  }
  return value;
}

function safeName(value: string): string {
  const name = value.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").trim();
  return (name.length > 0 ? name : "video").slice(0, 120);
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!ABORTED_GETTER || Reflect.apply(ABORTED_GETTER, signal, []) as boolean) {
    throw new JobTaskError("runtime-failure", "Video import stopped before completion.", true);
  }
}

function assertTimestamp(value: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new JobTaskError("invalid-input", "Video import timestamp must be canonical ISO-8601.", false);
  }
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function createProgressReporter(context: JobTaskContext) {
  let latestRatio = 0;
  return (ratio: number, phase: string): void => {
    latestRatio = Math.max(latestRatio, clampRatio(ratio));
    context.reportProgress({ ratio: latestRatio, phase, message: null });
  };
}

function isNotFound(error: unknown): boolean {
  if (isAssetRepositoryError(error)) return error.code === "ASSET_NOT_FOUND";
  try {
    return error !== null
      && typeof error === "object"
      && "name" in error
      && (error as { readonly name?: unknown }).name === "NotFoundError";
  } catch {
    return false;
  }
}

export function toVideoImportJobTaskError(error: unknown): JobTaskError {
  if (error instanceof JobTaskError) return error;
  if (error instanceof VideoMediaError) {
    switch (error.code) {
      case "VIDEO_INVALID_INPUT":
      case "VIDEO_UNSUPPORTED_FORMAT":
      case "VIDEO_TRACK_MISSING":
      case "VIDEO_TRACK_NOT_FOUND":
      case "VIDEO_LIMIT_EXCEEDED":
      case "VIDEO_FRAME_UNAVAILABLE":
        return new JobTaskError("invalid-input", error.message, false);
      case "VIDEO_CODEC_UNSUPPORTED":
        return new JobTaskError("runtime-failure", error.message, false);
      case "VIDEO_CANCELLED":
        return new JobTaskError("runtime-failure", "Video import stopped before completion.", true);
      case "VIDEO_DECODE_FAILED":
      case "VIDEO_ENCODE_FAILED":
        return new JobTaskError("runtime-failure", error.message, false);
    }
  }
  if (isAssetRepositoryError(error)) {
    if (error.code === "ASSET_INVALID_INPUT") {
      return new JobTaskError("invalid-input", "Video assets could not be stored.", false);
    }
    if (error.code === "ASSET_QUOTA_EXCEEDED") {
      return new JobTaskError("runtime-failure", "Storage quota was exceeded during video import.", true);
    }
    return new JobTaskError("runtime-failure", "Video assets could not be stored.", error.recoverable);
  }
  return new JobTaskError("runtime-failure", "Video import failed.", true);
}

function captureAdapter(value: VideoImportAdapter): {
  readonly preflight: VideoImportAdapter["preflight"];
  readonly extractFrames: VideoImportAdapter["extractFrames"];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Video import adapter must be an object.");
  }
  const preflight = value.preflight;
  const extractFrames = value.extractFrames;
  if (typeof preflight !== "function" || typeof extractFrames !== "function") {
    throw new TypeError("Video import adapter methods are required.");
  }
  return Object.freeze({
    preflight: ((blob, options) => Reflect.apply(preflight, value, [blob, options])) as VideoImportAdapter["preflight"],
    extractFrames: ((blob, options) => Reflect.apply(extractFrames, value, [blob, options])) as VideoImportAdapter["extractFrames"],
  });
}

function captureSelection(value: VideoImportSelection): VideoImportSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Video import selection must be an object.");
  }
  const range = value.range;
  const sampling = value.sampling;
  if (!Number.isSafeInteger(value.trackIndex) || value.trackIndex < 0) {
    throw new TypeError("Video import track index is invalid.");
  }
  if (!range || !Number.isSafeInteger(range.startUs) || !Number.isSafeInteger(range.endUs)
    || range.startUs < 0 || range.endUs <= range.startUs) {
    throw new TypeError("Video import time range is invalid.");
  }
  if (!sampling || (sampling.mode !== "all" && sampling.mode !== "fps")) {
    throw new TypeError("Video import sampling mode is invalid.");
  }
  if (sampling.mode === "fps" && (!Number.isFinite(sampling.fps) || sampling.fps <= 0)) {
    throw new TypeError("Video import sampling FPS is invalid.");
  }
  return Object.freeze({
    trackIndex: value.trackIndex,
    range: Object.freeze({ startUs: range.startUs, endUs: range.endUs }),
    sampling: sampling.mode === "all"
      ? Object.freeze({ mode: "all" as const })
      : Object.freeze({ mode: "fps" as const, fps: sampling.fps }),
  });
}

function captureContext(context: JobTaskContext): JobTaskContext {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new JobTaskError("invalid-input", "Video import job context is invalid.", false);
  }
  try {
    if (!isEntityId(context.requestId) || typeof context.reportProgress !== "function" || !ABORTED_GETTER) {
      throw new TypeError();
    }
    Reflect.apply(ABORTED_GETTER, context.signal, []);
    return context;
  } catch {
    throw new JobTaskError("invalid-input", "Video import job context is invalid.", false);
  }
}

function assertProjectUnchanged(
  store: ProjectStore,
  initialProjectId: string,
  initialRevision: number,
): StudioProject {
  const current = store.getSnapshot();
  if (current.project.id !== initialProjectId || current.revision !== initialRevision) {
    throw new JobTaskError("runtime-failure", "The project changed during video import.", true);
  }
  return current.project as StudioProject;
}

function assertIdsAvailable(project: StudioProject, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new JobTaskError("runtime-failure", "Video import generated duplicate IDs.", true);
  }
  for (const id of ids) {
    if (project.assets[id] || project.regions[id] || project.processingRecipes[id]
      || project.sequences[id] || project.cels[id]) {
      throw new JobTaskError("runtime-failure", `Video import ID ${id} is already in use.`, true);
    }
  }
}

async function assertRepositoryDestinationAbsent(
  repository: AssetRepository,
  assetId: string,
): Promise<void> {
  try {
    await repository.getMetadata(assetId);
    throw new JobTaskError("runtime-failure", `Asset destination ${assetId} is already in use.`, true);
  } catch (error) {
    if (error instanceof JobTaskError) throw error;
    if (isNotFound(error)) return;
    throw toVideoImportJobTaskError(error);
  }
}

async function cleanupOwnedAssets(
  repository: AssetRepository,
  store: ProjectStore,
  attempts: readonly OwnedAssetAttempt[],
): Promise<readonly string[]> {
  const failed: string[] = [];
  for (const attempt of attempts) {
    if (!attempt.putStarted) continue;
    const id = attempt.requestedId;
    if (store.getSnapshot().project.assets[id]) continue;
    try {
      const record = await repository.getMetadata(id);
      if (!matchesOwnedAsset(record, attempt.expected)) continue;
      const latest = store.getSnapshot();
      if (latest.project.id !== repository.projectId || latest.project.assets[id]) {
        failed.push(id);
        continue;
      }
      await repository.remove(id, "release-and-remove");
      try {
        await repository.getMetadata(id);
        failed.push(id);
      } catch (error) {
        if (!isNotFound(error)) failed.push(id);
      }
    } catch (error) {
      if (!isNotFound(error)) failed.push(id);
    }
  }
  return Object.freeze([...new Set(failed)]);
}

function matchesOwnedAsset(record: AssetRecord, expected: AssetMetadata): boolean {
  if (record.id !== expected.id || record.name !== expected.name
    || record.width !== expected.width || record.height !== expected.height
    || record.createdAt !== expected.createdAt || record.updatedAt !== expected.updatedAt
    || (expected.declaredMimeType !== undefined && record.mimeType !== expected.declaredMimeType)
    || record.provenance.source !== expected.provenance.source) return false;
  if (expected.provenance.source === "import") {
    if (record.provenance.source !== "import"
      || record.provenance.importedAt !== expected.provenance.importedAt) return false;
  } else if (expected.provenance.source === "derived") {
    if (record.provenance.source !== "derived"
      || record.provenance.recipeId !== expected.provenance.recipeId
      || record.provenance.parentAssetId !== expected.provenance.parentAssetId) return false;
  }
  if (!expected.media) return true;
  if (expected.media.type === "image") return record.media.type === "image";
  if (expected.media.type !== "video" || record.media.type !== "video") return false;
  const actualTrack = record.media.track;
  const expectedTrack = expected.media.track;
  return record.media.durationUs === expected.media.durationUs
    && actualTrack.index === expectedTrack.index
    && actualTrack.codec === expectedTrack.codec
    && actualTrack.codedWidth === expectedTrack.codedWidth
    && actualTrack.codedHeight === expectedTrack.codedHeight
    && actualTrack.displayWidth === expectedTrack.displayWidth
    && actualTrack.displayHeight === expectedTrack.displayHeight
    && actualTrack.rotationDegrees === expectedTrack.rotationDegrees
    && actualTrack.frameRate === expectedTrack.frameRate
    && actualTrack.sampleCount === expectedTrack.sampleCount;
}

function validatePreflight(preflight: VideoPreflight, selection: VideoImportSelection): void {
  if (!preflight || typeof preflight !== "object" || preflight.track.index !== selection.trackIndex
    || preflight.durationUs < selection.range.endUs || preflight.track.displayWidth < 1
    || preflight.track.displayHeight < 1) {
    throw new JobTaskError("invalid-input", "Video preflight did not match the selected track or range.", false);
  }
  if (!preflight.decodable) {
    throw new JobTaskError("runtime-failure", "The selected video codec is not available in this browser.", false);
  }
}

function validateFrames(frames: readonly VideoExtractedFrame[]): void {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new JobTaskError("invalid-input", "Video extraction returned no frames.", false);
  }
  for (const frame of frames) {
    if (!(frame.blob instanceof Blob) || frame.blob.size < 1 || frame.mimeType !== "image/png"
      || (frame.blob.type !== "" && frame.blob.type !== "image/png")
      || !Number.isSafeInteger(frame.timestampUs) || frame.timestampUs < 0
      || !Number.isSafeInteger(frame.durationUs) || frame.durationUs < 0
      || !Number.isSafeInteger(frame.width) || frame.width < 1
      || !Number.isSafeInteger(frame.height) || frame.height < 1) {
      throw new JobTaskError("invalid-input", "Video extraction returned an invalid PNG frame.", false);
    }
  }
}

function sequenceFps(selection: VideoImportSelection, preflight: VideoPreflight): number {
  const fps = selection.sampling.mode === "fps"
    ? selection.sampling.fps
    : preflight.track.frameRate ?? 12;
  return Math.min(MAX_SEQUENCE_FPS, Math.max(1, fps));
}

function frameDurationMs(frame: VideoExtractedFrame, fps: number): number {
  const durationUs = frame.durationUs > 0 ? frame.durationUs : Math.round(1_000_000 / fps);
  return Math.max(1, durationUs / 1_000);
}

export function createVideoImportJobTask(
  options: CreateVideoImportJobTaskOptions,
): JobTask<VideoImportJobResult> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Video import job options must be an object.");
  }
  const adapter = captureAdapter(options.adapter);
  const store = options.store;
  const repository = options.repository;
  const file = options.file;
  const fileName = safeName(options.fileName);
  const selection = captureSelection(options.selection);
  if (!store || store.kind !== "project" || typeof store.dispatch !== "function") {
    throw new TypeError("Video import requires a ProjectStore.");
  }
  if (!repository || typeof repository.put !== "function") {
    throw new TypeError("Video import requires an AssetRepository.");
  }
  if (!(file instanceof Blob) || file.size < 1 || typeof options.fileName !== "string"
    || options.fileName.trim().length === 0) {
    throw new TypeError("Video import requires a non-empty named Blob.");
  }
  const nextId = options.nextId ?? (() => defaultId("video-import"));
  const now = options.now ?? (() => new Date().toISOString());
  const reportAssetCleanupDebt = options.reportAssetCleanupDebt;
  if (typeof nextId !== "function" || typeof now !== "function"
    || (reportAssetCleanupDebt !== undefined && typeof reportAssetCleanupDebt !== "function")) {
    throw new TypeError("Video import factories must be functions.");
  }
  let consumed = false;

  return Object.freeze(async (rawContext: JobTaskContext): Promise<VideoImportJobResult> => {
    const context = captureContext(rawContext);
    if (consumed) {
      throw new JobTaskError("invalid-input", "Video import task was already consumed.", false);
    }
    consumed = true;
    const report = createProgressReporter(context);
    const initial = store.getSnapshot();
    const initialProject = initial.project as StudioProject;
    if (repository.projectId !== initialProject.id) {
      throw new JobTaskError("invalid-input", "Asset repository belongs to another project.", false);
    }

    let preflight: VideoPreflight;
    let frames: readonly VideoExtractedFrame[];
    try {
      abortIfNeeded(context.signal);
      report(0.03, "video.preflight");
      preflight = await adapter.preflight(file, {
        trackIndex: selection.trackIndex,
        signal: context.signal,
      });
      validatePreflight(preflight, selection);
      abortIfNeeded(context.signal);
      report(0.12, "video.decode");
      frames = await adapter.extractFrames(file, {
        trackIndex: selection.trackIndex,
        range: selection.range,
        sampling: selection.sampling,
        signal: context.signal,
        onProgress: (progress) => report(0.12 + clampRatio(progress.ratio) * 0.53, "video.decode"),
      });
      validateFrames(frames);
      abortIfNeeded(context.signal);
      assertProjectUnchanged(store, initialProject.id, initial.revision);
      report(0.68, "video.storage");
    } catch (error) {
      throw toVideoImportJobTaskError(error);
    }

    const id = (label: string) => generatedId(nextId(), label);
    const sourceAssetId = id("source asset ID factory");
    const recipeId = id("recipe ID factory");
    const frameAssetIds = frames.map(() => id("frame asset ID factory"));
    const regionIds = frames.map(() => id("region ID factory"));
    const sequenceId = id("sequence ID factory");
    const celIds = frames.map(() => id("cel ID factory"));
    const allIds = [sourceAssetId, recipeId, ...frameAssetIds, ...regionIds, sequenceId, ...celIds];
    assertIdsAvailable(initialProject, allIds);
    const timestamp = now();
    assertTimestamp(timestamp);
    const sourceMetadata: AssetMetadata = {
      id: sourceAssetId,
      name: fileName,
      width: preflight.track.displayWidth,
      height: preflight.track.displayHeight,
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: { source: "import", importedAt: timestamp },
      media: {
        type: "video",
        durationUs: preflight.durationUs,
        track: { ...preflight.track },
      },
      declaredMimeType: preflight.mimeType,
    };
    const frameMetadata = frames.map((frame, index): AssetMetadata => ({
      id: frameAssetIds[index]!,
      name: `${fileName}-${String(index + 1).padStart(4, "0")}.png`,
      width: frame.width,
      height: frame.height,
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: {
        source: "derived",
        recipeId,
        parentAssetId: sourceAssetId,
      },
      media: { type: "image" },
      declaredMimeType: "image/png",
    }));
    const attempts: OwnedAssetAttempt[] = [sourceMetadata, ...frameMetadata]
      .map((expected) => ({ requestedId: expected.id, expected, putStarted: false }));

    return withAssetRepositoryMutation(repository, async () => {
      let committed = false;
      try {
        assertProjectUnchanged(store, initialProject.id, initial.revision);
        for (const attempt of attempts) {
          abortIfNeeded(context.signal);
          await assertRepositoryDestinationAbsent(repository, attempt.requestedId);
        }

        attempts[0]!.putStarted = true;
        const sourceAsset = await repository.put(file, sourceMetadata);
        if (sourceAsset.id !== sourceAssetId) {
          throw new JobTaskError("runtime-failure", "Repository changed the source asset ID.", true);
        }
        abortIfNeeded(context.signal);
        report(0.72, "video.storage");

        const frameAssets: AssetRecord[] = [];
        for (const [index, frame] of frames.entries()) {
          const frameId = frameAssetIds[index]!;
          attempts[index + 1]!.putStarted = true;
          const record = await repository.put(frame.blob, frameMetadata[index]!);
          if (record.id !== frameId) {
            throw new JobTaskError("runtime-failure", `Repository changed frame asset ID ${index}.`, true);
          }
          frameAssets.push(record);
          abortIfNeeded(context.signal);
          report(0.72 + ((index + 1) / frames.length) * 0.2, "video.storage");
        }

        abortIfNeeded(context.signal);
        const projectBeforeDispatch = assertProjectUnchanged(store, initialProject.id, initial.revision);
        assertIdsAvailable(projectBeforeDispatch, allIds);
        const fps = sequenceFps(selection, preflight);
        const recipe: ProcessingRecipe = {
          kind: "video-extract",
          version: 1,
          id: recipeId,
          name: `${fileName} frames`,
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceAssetId,
          trackIndex: selection.trackIndex,
          range: { ...selection.range },
          sampling: selection.sampling.mode === "all"
            ? { mode: "all" }
            : { mode: "fps", fps: selection.sampling.fps },
          output: { mimeType: "image/png" },
        };
        const regions: Region[] = frames.map((frame, index) => ({
          id: regionIds[index]!,
          assetId: frameAssetIds[index]!,
          name: `Frame ${index + 1}`,
          bounds: { x: 0, y: 0, width: frame.width, height: frame.height },
          createdAt: timestamp,
          updatedAt: timestamp,
          provenance: {
            source: "video-extract",
            sourceId: recipeId,
            importedAt: timestamp,
            note: `frame:${index};timestampUs:${frame.timestampUs}`,
          },
        }));
        const sequence: Sequence = {
          id: sequenceId,
          name: fileName,
          celIds: [],
          fps,
          defaultDurationMs: 1_000 / fps,
          loop: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const cels: Cel[] = frames.map((frame, index) => ({
          id: celIds[index]!,
          sequenceId,
          source: { type: "region", regionId: regionIds[index]! },
          durationMs: frameDurationMs(frame, fps),
          createdAt: timestamp,
          updatedAt: timestamp,
        }));

        report(0.96, "video.commit");
        const dispatch = store.dispatch({
          command: {
            type: "command.batch",
            commands: [
              { type: "asset.import", asset: sourceAsset, atIndex: projectBeforeDispatch.rootOrder.assetIds.length },
              {
                type: "regions.commitRecipe",
                recipe,
                regions,
                derivedAssets: frameAssets,
                atIndex: projectBeforeDispatch.rootOrder.regionIds.length,
              },
              {
                type: "sequence.create",
                sequence,
                atIndex: projectBeforeDispatch.rootOrder.sequenceIds.length,
              },
              ...cels.map((cel, index) => ({
                type: "cel.add" as const,
                sequenceId,
                cel,
                atIndex: index,
              })),
              {
                type: "workspace.update",
                patch: {
                  activeWorkspace: "slice" as const,
                  selectedAssetId: frameAssetIds[0]!,
                  selectedRegionId: regionIds[0]!,
                  selectedSequenceId: sequenceId,
                  selectedCelIds: [celIds[0]!],
                },
              },
            ],
          },
          metadata: {
            commandId: id("command ID factory"),
            transactionId: id("transaction ID factory"),
            origin: "worker",
            history: "record",
            issuedAt: timestamp,
          },
        });
        if (!dispatch.result.ok) {
          throw new JobTaskError(
            "runtime-failure",
            dispatch.result.diagnostics[0]?.message ?? "Project rejected the video import.",
            true,
          );
        }
        committed = true;
        report(0.99, "video.commit");
        return Object.freeze({
          revision: dispatch.revision,
          sourceAsset,
          recipe: Object.freeze(recipe),
          frames: Object.freeze([...frameAssets]),
          regions: Object.freeze([...regions]),
          sequence: Object.freeze(sequence),
          cels: Object.freeze([...cels]),
        });
      } catch (error) {
        if (!committed) {
          const cleanupAssetIds = await cleanupOwnedAssets(repository, store, attempts);
          if (cleanupAssetIds.length > 0) {
            for (const assetId of cleanupAssetIds) {
              try {
                reportAssetCleanupDebt?.(initialProject.id, assetId, true);
              } catch {
                // Persistence diagnostics must not hide the cleanup failure.
              }
            }
            throw new JobTaskError(
              "runtime-failure",
              `Video import cleanup failed for ${cleanupAssetIds.length} asset${cleanupAssetIds.length === 1 ? "" : "s"}.`,
              true,
            );
          }
        }
        throw toVideoImportJobTaskError(error);
      }
    });
  });
}
