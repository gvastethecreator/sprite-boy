import type { WandSelectionSnapshot } from "./wandSelection";

export interface WandSelectionProbeProps {
  readonly selection: WandSelectionSnapshot;
  readonly title?: string;
}

function maskPath(selection: WandSelectionSnapshot): string {
  const mask = selection.mask;
  if (!mask) return "";
  return mask.runs.map((run) => {
    const localY = Math.floor(run.offset / mask.bounds.width);
    const localX = run.offset % mask.bounds.width;
    return `M${mask.bounds.x + localX} ${mask.bounds.y + localY}h${run.length}v1h-${run.length}z`;
  }).join("");
}

/** Isolated browser-safe VIS probe; production canvas integration belongs to S1-04. */
export function WandSelectionProbe({
  selection,
  title = "Wand selection mask preview",
}: WandSelectionProbeProps) {
  const path = maskPath(selection);
  return (
    <svg
      aria-label={title}
      data-component-count={selection.components.length}
      data-pixel-count={selection.mask?.pixelCount ?? 0}
      role="img"
      viewBox={`0 0 ${Math.max(1, selection.sourceWidth)} ${Math.max(1, selection.sourceHeight)}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <rect fill="#151923" height="100%" width="100%" />
      {path ? <path d={path} fill="#67e8f9" fillOpacity="0.72" /> : null}
      {selection.bounds ? (
        <rect
          data-selection-bounds="true"
          fill="none"
          height={selection.bounds.height}
          stroke="#fbbf24"
          strokeDasharray="1 1"
          strokeWidth="0.5"
          width={selection.bounds.width}
          x={selection.bounds.x}
          y={selection.bounds.y}
        />
      ) : null}
    </svg>
  );
}
