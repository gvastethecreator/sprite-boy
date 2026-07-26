import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ToastContainer from "../../components/overlays/ToastContainer";

vi.mock("@gsap/react", () => ({
  useGSAP: (callback: () => void) => callback(),
}));

vi.mock("gsap", () => ({
  default: { fromTo: vi.fn(), set: vi.fn() },
}));

describe("ToastContainer", () => {
  it("keeps compact notifications above bottom controls and exposes dismissal", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <ToastContainer
        toasts={[{ id: "saved", msg: "Project saved", type: "success" }]}
        onRemove={onRemove}
      />,
    );

    const region = container.firstElementChild;
    expect(region).toHaveClass("bottom-[calc(env(safe-area-inset-bottom)+4rem)]");
    expect(region).toHaveClass("sm:top-20");
    expect(screen.getByRole("status")).toHaveTextContent("Project saved");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification: Project saved" }));
    expect(onRemove).toHaveBeenCalledWith("saved");
  });
});
