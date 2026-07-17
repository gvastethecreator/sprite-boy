import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import StudioWorkspaceErrorBoundary from "../../components/studio/StudioWorkspaceErrorBoundary";

function BrokenChild(): ReactNode {
  throw new Error("render failure");
}

describe("StudioWorkspaceErrorBoundary (G8-01)", () => {
  it("contains a render failure and exposes a retry action", () => {
    const { rerender } = render(
      <StudioWorkspaceErrorBoundary resetKey="slice:1">
        <BrokenChild />
      </StudioWorkspaceErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This workspace needs a retry");
    expect(screen.getByRole("button", { name: "Retry workspace" })).toBeInTheDocument();

    rerender(
      <StudioWorkspaceErrorBoundary resetKey="slice:2">
        <p>Workspace recovered</p>
      </StudioWorkspaceErrorBoundary>,
    );

    expect(screen.getByText("Workspace recovered")).toBeInTheDocument();
  });

  it("recovers in place when the user presses retry", () => {
    let shouldThrow = true;
    function ToggleChild(): ReactNode {
      if (shouldThrow) throw new Error("temporary failure");
      return <p>Recovered after retry</p>;
    }

    const { rerender } = render(
      <StudioWorkspaceErrorBoundary resetKey="slice:1">
        <ToggleChild />
      </StudioWorkspaceErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry workspace" }));
    rerender(
      <StudioWorkspaceErrorBoundary resetKey="slice:1">
        <ToggleChild />
      </StudioWorkspaceErrorBoundary>,
    );

    expect(screen.getByText("Recovered after retry")).toBeInTheDocument();
  });
});
