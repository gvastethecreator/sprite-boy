import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  SliceSourceCanvasFrame,
  SliceSourcePreview,
  createSliceSourceDisplayMetadata,
} from "../../features/slice/source/SliceSourcePreview";
import type { SourceSessionSnapshot } from "../../features/slice/source/sourceSession";

function readySnapshot(
  generation: number,
  name: string,
  source: object,
  size = 2_560,
): SourceSessionSnapshot {
  return Object.freeze({
    status: "ready" as const,
    generation,
    disposed: false,
    metadata: Object.freeze({
      name,
      declaredMimeType: "image/png",
      mimeType: "image/png" as const,
      format: "png" as const,
      size,
      lastModified: 0,
      width: 32,
      height: 16,
      pixelCount: 512,
    }),
    source: Object.freeze({ image: source, width: 32, height: 16 }),
    error: null,
  });
}

function idleSnapshot(generation: number): SourceSessionSnapshot {
  return Object.freeze({
    status: "idle" as const,
    generation,
    disposed: false,
    metadata: null,
    source: null,
    error: null,
  });
}

describe("SliceSourcePreview (G0-03)", () => {
  it("renders native source metadata and a contained preview", () => {
    const source = {};
    const host = {
      createObjectURL: vi.fn(() => "blob:sheet"),
      revokeObjectURL: vi.fn(),
    };
    render(
      <SliceSourcePreview
        snapshot={readySnapshot(1, "hero-sheet.png", source)}
        getBlob={() => new Blob(["pixels"], { type: "image/png" })}
        urlOptions={{ host }}
      />,
    );

    expect(screen.getByText("hero-sheet.png")).toBeInTheDocument();
    expect(screen.getByText("32 × 16")).toBeInTheDocument();
    expect(screen.getByText("2.5 KiB")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Source preview: hero-sheet.png" }))
      .toHaveAttribute("src", "blob:sheet");
  });

  it("keeps a retained source lease while replacement validates, then swaps exactly once", () => {
    const firstIdentity = {};
    const secondIdentity = {};
    const first = readySnapshot(1, "first.png", firstIdentity);
    const host = {
      createObjectURL: vi.fn()
        .mockReturnValueOnce("blob:first")
        .mockReturnValueOnce("blob:second"),
      revokeObjectURL: vi.fn(),
    };
    let blob = new Blob(["first"]);
    const getBlob = () => blob;
    const view = render(
      <SliceSourcePreview snapshot={first} getBlob={getBlob} urlOptions={{ host }} />,
    );
    const replacing: SourceSessionSnapshot = Object.freeze({
      status: "decoding" as const,
      generation: 2,
      disposed: false,
      metadata: first.metadata,
      candidateMetadata: Object.freeze({
        name: "second.png",
        declaredMimeType: "image/png",
        mimeType: "image/png" as const,
        format: "png" as const,
        size: 2_560,
        lastModified: 0,
      }),
      source: first.source,
      error: null,
    });

    view.rerender(
      <SliceSourcePreview snapshot={replacing} getBlob={getBlob} urlOptions={{ host }} />,
    );
    expect(host.createObjectURL).toHaveBeenCalledTimes(1);
    expect(host.revokeObjectURL).not.toHaveBeenCalled();

    blob = new Blob(["second"]);
    view.rerender(
      <SliceSourcePreview
        snapshot={readySnapshot(2, "second.png", secondIdentity)}
        getBlob={getBlob}
        urlOptions={{ host }}
      />,
    );
    expect(screen.getByRole("img", { name: "Source preview: second.png" }))
      .toHaveAttribute("src", "blob:second");
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:first");
  });

  it("releases on reset/unmount and ignores a regressive late snapshot", () => {
    const host = {
      createObjectURL: vi.fn(() => "blob:owned"),
      revokeObjectURL: vi.fn(),
    };
    const ready = readySnapshot(1, "sheet.png", {});
    const view = render(
      <SliceSourcePreview snapshot={ready} getBlob={() => new Blob()} urlOptions={{ host }} />,
    );
    view.rerender(
      <SliceSourcePreview snapshot={idleSnapshot(2)} getBlob={() => null} urlOptions={{ host }} />,
    );
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:owned");

    view.rerender(
      <SliceSourcePreview snapshot={ready} getBlob={() => new Blob()} urlOptions={{ host }} />,
    );
    expect(view.container.querySelector("[data-slice-source-preview]")).not.toBeInTheDocument();
    expect(host.createObjectURL).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("releases the live preview lease when its consumer unmounts", () => {
    const host = {
      createObjectURL: vi.fn(() => "blob:unmount"),
      revokeObjectURL: vi.fn(),
    };
    const view = render(
      <SliceSourcePreview
        snapshot={readySnapshot(4, "sheet.png", {})}
        getBlob={() => new Blob()}
        urlOptions={{ host }}
      />,
    );

    view.unmount();
    expect(host.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:unmount");
  });

  it("offers an accessible retry after URL allocation failure", () => {
    const host = {
      createObjectURL: vi.fn()
        .mockImplementationOnce(() => { throw new Error("busy"); })
        .mockReturnValueOnce("blob:recovered"),
      revokeObjectURL: vi.fn(),
    };
    render(
      <SliceSourcePreview
        snapshot={readySnapshot(1, "sheet.png", {})}
        getBlob={() => new Blob()}
        urlOptions={{ host }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be created/i);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Retry preview" })));
    expect(screen.getByRole("img", { name: "Source preview: sheet.png" }))
      .toHaveAttribute("src", "blob:recovered");
  });

  it("frames the existing interactive canvas without replacing its grid surface", () => {
    render(
      <SliceSourceCanvasFrame snapshot={readySnapshot(7, "grid.png", {})}>
        <div role="application" aria-label="Existing grid canvas">canvas tools</div>
      </SliceSourceCanvasFrame>,
    );

    expect(screen.getByRole("region", { name: "Slice canvas and source metadata" }))
      .toContainElement(screen.getByRole("application", { name: "Existing grid canvas" }));
    expect(screen.getByLabelText("Slice source metadata")).toHaveTextContent("32 × 16");
  });

  it("announces the preview-to-canvas commit bridge as busy", () => {
    const { container } = render(
      <SliceSourcePreview
        snapshot={readySnapshot(8, "opening.png", {})}
        getBlob={() => new Blob()}
        urlOptions={{
          host: { createObjectURL: () => "blob:opening", revokeObjectURL: () => undefined },
        }}
        committing
      />,
    );

    expect(container.querySelector("[data-slice-source-preview]"))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/Opening the validated source/i);
  });

  it("builds an honest legacy fallback for a loaded project", () => {
    const legacy = {
      src: "blob:loaded-project-source",
      width: 96,
      height: 48,
      name: "legacy-sheet.webp",
      fileSize: 4_096,
    };
    expect(createSliceSourceDisplayMetadata(null, legacy)).toEqual({
      name: "legacy-sheet.webp",
      width: 96,
      height: 48,
      size: 4_096,
      formatLabel: "WebP · inferred",
      formatConfidence: "inferred",
    });
    render(
      <SliceSourceCanvasFrame snapshot={idleSnapshot(8)} legacyImageMeta={legacy}>
        <div>legacy canvas</div>
      </SliceSourceCanvasFrame>,
    );
    const metadata = screen.getByLabelText("Slice source metadata");
    expect(metadata).toHaveTextContent("legacy-sheet.webp");
    expect(metadata).toHaveTextContent("96 × 48");
    expect(metadata).toHaveTextContent("4.0 KiB");
    expect(metadata).toHaveTextContent("WebP · inferred");
    expect(metadata.querySelector("[data-format-confidence]"))
      .toHaveAttribute("data-format-confidence", "inferred");
  });

  it("labels unknown legacy format honestly and prefers validated metadata", () => {
    const legacy = {
      src: "blob:opaque-source",
      width: 20,
      height: 10,
      name: "source-without-extension",
      fileSize: 200,
    };
    const view = render(
      <SliceSourceCanvasFrame snapshot={idleSnapshot(9)} legacyImageMeta={legacy}>
        <div>canvas</div>
      </SliceSourceCanvasFrame>,
    );
    expect(screen.getByText("Unknown")).toHaveAttribute("data-format-confidence", "unknown");

    const validated = readySnapshot(10, "validated.png", {});
    if (validated.status !== "ready") throw new Error("ready fixture is invalid");
    view.rerender(
      <SliceSourceCanvasFrame
        snapshot={validated}
        metadataOverride={validated.metadata}
        legacyImageMeta={legacy}
      >
        <div>canvas</div>
      </SliceSourceCanvasFrame>,
    );
    expect(screen.getByText("validated.png")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toHaveAttribute("data-format-confidence", "validated");
    expect(screen.queryByText("source-without-extension")).not.toBeInTheDocument();
  });
});
