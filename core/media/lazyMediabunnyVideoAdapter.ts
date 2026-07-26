import type {
  VideoExtractOptions,
  VideoExtractedFrame,
  VideoPreflight,
} from "./videoContracts";

interface VideoAdapterBackend {
  preflight(
    blob: Blob,
    options?: { readonly trackIndex?: number; readonly signal?: AbortSignal },
  ): PromiseLike<VideoPreflight>;
  extractFrames(
    blob: Blob,
    options: VideoExtractOptions,
  ): PromiseLike<readonly VideoExtractedFrame[]>;
}

/** Keep MediaBunny out of the initial Studio bundle until a video is inspected. */
export class LazyMediabunnyVideoAdapter implements VideoAdapterBackend {
  #backend: Promise<VideoAdapterBackend> | null = null;

  #load(): Promise<VideoAdapterBackend> {
    this.#backend ??= import("./mediabunnyVideoAdapter").then(
      ({ MediabunnyVideoAdapter }) => new MediabunnyVideoAdapter(),
    );
    return this.#backend;
  }

  async preflight(
    blob: Blob,
    options: { readonly trackIndex?: number; readonly signal?: AbortSignal } = {},
  ): Promise<VideoPreflight> {
    return (await this.#load()).preflight(blob, options);
  }

  async extractFrames(
    blob: Blob,
    options: VideoExtractOptions,
  ): Promise<readonly VideoExtractedFrame[]> {
    return (await this.#load()).extractFrames(blob, options);
  }
}
