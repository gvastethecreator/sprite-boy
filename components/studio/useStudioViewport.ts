import { useEffect, useState } from "react";

/** Narrowest window the lane shell supports. */
export const STUDIO_MIN_WIDTH = 1024;
/** From this width up, the inspector sits beside the canvas instead of over it. */
export const STUDIO_WIDE_WIDTH = 1280;

export type StudioViewportMode = "unsupported" | "overlay" | "wide";

export function resolveViewportMode(width: number): StudioViewportMode {
  if (width < STUDIO_MIN_WIDTH) return "unsupported";
  return width < STUDIO_WIDE_WIDTH ? "overlay" : "wide";
}

export interface StudioViewport {
  readonly width: number;
  readonly mode: StudioViewportMode;
}

function readWidth(): number {
  return typeof window === "undefined" ? STUDIO_WIDE_WIDTH : window.innerWidth;
}

export function useStudioViewport(): StudioViewport {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return { width, mode: resolveViewportMode(width) };
}
