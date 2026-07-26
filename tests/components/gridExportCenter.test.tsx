import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetRepository } from "../../core/assets";
import { GridExportCenter } from "../../features/slice/export/GridExportCenter";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

const exportMocks = vi.hoisted(() => ({
  resolveGridRegionBlob: vi.fn(),
}));

vi.mock("../../features/slice/export/gridExport", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../features/slice/export/gridExport")>(),
  resolveGridRegionBlob: exportMocks.resolveGridRegionBlob,
}));

describe("GridExportCenter", () => {
  it("shows real region previews and releases their object URLs", async () => {
    exportMocks.resolveGridRegionBlob.mockResolvedValue({
      id: "region-hero",
      name: "Hero frame",
      blob: new Blob(["preview"], { type: "image/png" }),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:grid-region-preview");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const repository = {
      projectId: studioProjectV1Fixture.id,
      dispose: vi.fn(),
    } as unknown as AssetRepository;

    const view = render(
      <GridExportCenter
        project={studioProjectV1Fixture}
        revision={4}
        repository={repository}
        onOpenCompose={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    expect(await screen.findByRole("img", { name: "Hero frame preview" })).toHaveAttribute(
      "src",
      "blob:grid-region-preview",
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    view.unmount();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:grid-region-preview"));
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("finishes with clear feedback when a preview cannot load", async () => {
    exportMocks.resolveGridRegionBlob.mockRejectedValue(new Error("missing blob"));
    const repository = {
      projectId: studioProjectV1Fixture.id,
      dispose: vi.fn(),
    } as unknown as AssetRepository;

    render(
      <GridExportCenter
        project={studioProjectV1Fixture}
        revision={4}
        repository={repository}
        onOpenCompose={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    expect(await screen.findByText("Preview unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading preview/i })).toBeNull();
  });
});
