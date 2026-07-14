import React, { memo, useCallback, useEffect, useRef } from "react";
import { GripHorizontal } from "lucide-react";
import Timeline from "../common/Timeline";
import { createWorkspacePanelSizeSelector } from "../../core/stores";
import { useWorkspaceStore } from "../../contexts/StudioStoreContext";
import { useWorkspaceStoreSelector } from "../../hooks/useStudioStoreSelector";

const TIMELINE_PANEL_ID = "timeline";
const TIMELINE_DEFAULT_HEIGHT = 220;
const TIMELINE_MIN_HEIGHT = 120;
const TIMELINE_MAX_HEIGHT = 500;
const TIMELINE_KEYBOARD_STEP = 10;

function clampTimelineHeight(height: number): number {
  return Math.min(Math.max(TIMELINE_MIN_HEIGHT, height), TIMELINE_MAX_HEIGHT);
}

const selectStoredTimelineHeight = createWorkspacePanelSizeSelector(
  TIMELINE_PANEL_ID,
  TIMELINE_DEFAULT_HEIGHT,
);
const selectTimelineHeight = (
  state: Parameters<typeof selectStoredTimelineHeight>[0],
): number => clampTimelineHeight(selectStoredTimelineHeight(state));

const TimelinePanel = memo(function TimelinePanel() {
  const store = useWorkspaceStore();
  const height = useWorkspaceStoreSelector(store, selectTimelineHeight);
  const resizeOrigin = useRef<{ readonly pointerY: number; readonly height: number } | null>(null);

  const setHeight = useCallback((nextHeight: number) => {
    store.dispatch({
      type: "workspace.setPanelSize",
      panelId: TIMELINE_PANEL_ID,
      size: clampTimelineHeight(nextHeight),
    });
  }, [store]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const origin = resizeOrigin.current;
    if (!origin) return;
    setHeight(origin.height + origin.pointerY - event.clientY);
  }, [setHeight]);

  const cleanupRef = useRef<() => void>(() => undefined);
  const handleMouseUp = useCallback(() => cleanupRef.current(), []);
  const removeResizeListeners = useCallback(() => {
    resizeOrigin.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
  }, [handleMouseMove, handleMouseUp]);
  cleanupRef.current = removeResizeListeners;

  const startResize = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    removeResizeListeners();
    resizeOrigin.current = { pointerY: event.clientY, height };
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove, handleMouseUp, height, removeResizeListeners]);

  const handleResizeKey = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setHeight(height + (event.key === "ArrowUp" ? TIMELINE_KEYBOARD_STEP : -TIMELINE_KEYBOARD_STEP));
  }, [height, setHeight]);

  useEffect(() => removeResizeListeners, [removeResizeListeners]);

  return (
    <div
      data-testid="timeline-panel"
      style={{ height }}
      className="bg-panel rounded-panel shrink-0 flex flex-col border border-border/20 overflow-hidden animate-slide-up relative"
    >
      <button
        type="button"
        role="separator"
        aria-label="Resize timeline"
        aria-orientation="horizontal"
        aria-valuemin={TIMELINE_MIN_HEIGHT}
        aria-valuemax={TIMELINE_MAX_HEIGHT}
        aria-valuenow={height}
        onMouseDown={startResize}
        onKeyDown={handleResizeKey}
        className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-accent/20 z-20 group flex justify-center items-center"
      >
        <GripHorizontal
          size={10}
          aria-hidden="true"
          className="text-transparent group-hover:text-textMuted opacity-50"
        />
      </button>
      <Timeline />
    </div>
  );
});

export default TimelinePanel;
