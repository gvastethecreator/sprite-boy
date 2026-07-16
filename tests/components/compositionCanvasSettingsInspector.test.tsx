import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectStoreWithHistory } from "../../core/stores";
import { CompositionCanvasSettingsInspector } from "../../features/compose/canvasSettings";
import { studioProjectV1Fixture } from "../contract/fixtures/studioProjectV1";

const NOW = "2026-07-16T16:30:00.000Z";

function runtime() {
  return createProjectStoreWithHistory(structuredClone(studioProjectV1Fixture), {
    context: { nextId: () => "unused-id", now: () => NOW },
  });
}

describe("CompositionCanvasSettingsInspector", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps invalid draft visible, described and unapplied", () => {
    const { store } = runtime();
    render(<CompositionCanvasSettingsInspector store={store} compositionId="composition-project" />);
    const width = screen.getByRole("textbox", { name: /Width/i });
    fireEvent.change(width, { target: { value: "0" } });
    expect(width).toHaveValue("0");
    expect(width).toHaveAttribute("aria-invalid", "true");
    expect(width).toHaveAccessibleDescription(/positive whole number/i);
    expect(screen.getByRole("button", { name: /Apply/i })).toBeDisabled();
    expect(screen.getByText("Invalid size")).toBeInTheDocument();
    expect(store.getSnapshot().revision).toBe(0);
  });

  it("applies a supported ratio and transparent/color modes with keyboard-native controls", async () => {
    const { store, history } = runtime();
    render(
      <CompositionCanvasSettingsInspector
        store={store}
        compositionId="composition-project"
        now={() => NOW}
        createCommandId={(revision) => `canvas-ui-${revision}`}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: /Aspect ratio/i }), { target: { value: "16:9" } });
    expect(screen.getByRole("textbox", { name: /Width/i })).toHaveValue("128");
    expect(screen.getByRole("textbox", { name: /Height/i })).toHaveValue("72");
    fireEvent.click(screen.getByRole("radio", { name: /Color/i }));
    fireEvent.change(screen.getByLabelText("Canvas background color"), { target: { value: "#13579b" } });
    const preview = screen.getByLabelText("Canvas preview").querySelector("[data-canvas-preview]");
    expect(preview).toHaveStyle({ aspectRatio: "128 / 72", backgroundColor: "#13579b" });
    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Canvas settings applied");
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
    expect(store.getSnapshot().project.compositions["composition-project"]).toMatchObject({
      width: 128,
      height: 72,
      background: "#13579b",
    });
    expect(history.getSnapshot().undoEntries).toHaveLength(1);
  });

  it("detects concurrent canonical changes and requires an explicit reload", async () => {
    const { store } = runtime();
    render(<CompositionCanvasSettingsInspector store={store} compositionId="composition-project" now={() => NOW} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Width/i }), { target: { value: "640" } });
    act(() => {
      store.dispatch({
        command: { type: "composition.update", compositionId: "composition-project", patch: { width: 256, height: 144 } },
        metadata: { commandId: "outside-ui", origin: "user", history: "record", issuedAt: NOW },
      });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/changed elsewhere/i));
    expect(screen.getByRole("button", { name: /Apply/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Reset/i }));
    expect(screen.getByRole("textbox", { name: /Width/i })).toHaveValue("256");
    expect(screen.getByRole("textbox", { name: /Height/i })).toHaveValue("144");
    expect(screen.queryByText(/changed elsewhere/i)).not.toBeInTheDocument();
  });

  it("renders a safe missing-composition state", () => {
    const { store } = runtime();
    render(<CompositionCanvasSettingsInspector store={store} compositionId="missing" />);
    expect(screen.getByLabelText("Canvas settings")).toHaveTextContent(/Select a composition/i);
    expect(screen.queryByRole("button", { name: /Apply/i })).not.toBeInTheDocument();
  });

  it.each([
    ["clock", { now: () => { throw new Error("PRIVATE_NOW_SECRET"); } }],
    ["command id", { createCommandId: () => { throw new Error("PRIVATE_ID_SECRET"); } }],
  ] as const)("contains a throwing %s callback and focuses safe recovery feedback", async (_label, callbacks) => {
    const { store } = runtime();
    render(
      <CompositionCanvasSettingsInspector
        store={store}
        compositionId="composition-project"
        {...callbacks}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Width/i }), { target: { value: "256" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be prepared/i);
    expect(alert).not.toHaveTextContent(/PRIVATE/i);
    await waitFor(() => expect(alert).toHaveFocus());
    expect(store.getSnapshot().revision).toBe(0);
  });

  it("falls back safely when requestAnimationFrame throws", async () => {
    vi.stubGlobal("requestAnimationFrame", () => { throw new Error("PRIVATE_RAF_SECRET"); });
    const { store } = runtime();
    render(
      <CompositionCanvasSettingsInspector
        store={store}
        compositionId="composition-project"
        now={() => NOW}
        createCommandId={() => "canvas-raf-safe"}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Width/i }), { target: { value: "256" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/applied/i);
    expect(status).not.toHaveTextContent(/PRIVATE/i);
    await waitFor(() => expect(status).toHaveFocus());
    expect(store.getSnapshot().revision).toBe(1);
  });
});
