import type { ReactNode } from "react";
import { FolderOpen, Upload } from "lucide-react";
import type { StudioCommandId, StudioLaneId } from "../../core/studio";

interface LaneCopy {
    readonly title: string;
    readonly line: string;
    readonly example: string;
}

const LANE_COPY: Readonly<Record<StudioLaneId, LaneCopy>> = Object.freeze({
    items: {
        title: "Separate loose items",
        line: "Drop an image with separate items on a transparent background.",
        example: "Example: a prop sheet with coins, keys and potions.",
    },
    grid: {
        title: "Slice a regular sheet",
        line: "Drop a sheet with a regular layout.",
        example: "Example: a character sheet with rows of poses.",
    },
    animation: {
        title: "Build animation rows",
        line: "Drop a sheet or a video.",
        example: "Example: a walk cycle sheet, or an MP4 clip.",
    },
    tileset: {
        title: "Build tiles and textures",
        line: "Drop a tileset or a texture.",
        example: "Example: a 16×16 terrain tileset.",
    },
});

export interface LaneEmptyStateProps {
    readonly lane: StudioLaneId;
    readonly onExecute: (commandId: StudioCommandId) => void;
    /** When set, the import button is disabled and shows this reason. */
    readonly importDisabledReason?: string;
    readonly children?: ReactNode;
}

/** First view of a lane that has no source yet. */
export function LaneEmptyState({ lane, onExecute, importDisabledReason, children }: LaneEmptyStateProps) {
    const copy = LANE_COPY[lane];
    const titleId = `lane-${lane}-empty-title`;
    return (
        <section
            data-lane-empty={lane}
            aria-labelledby={titleId}
            className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-workspace p-6"
        >
            <div className="w-full max-w-lg rounded-xl border-2 border-dashed border-white/12 bg-panel/60 px-8 py-10 text-center">
                <h1 id={titleId} className="text-lg font-semibold tracking-tight text-textMain">{copy.title}</h1>
                <p className="mt-2 text-sm text-textMain/90">{copy.line}</p>
                <p className="mt-1 text-xs text-textMuted">{copy.example}</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    <button
                        type="button"
                        data-command-id="asset.import"
                        disabled={Boolean(importDisabledReason)}
                        title={importDisabledReason}
                        onClick={() => onExecute("asset.import")}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white shadow-glow hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Upload size={14} aria-hidden="true" />
                        Choose a file
                    </button>
                    <button
                        type="button"
                        data-command-id="lane.go.library"
                        onClick={() => onExecute("lane.go.library")}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-surface px-4 py-2 text-xs font-semibold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <FolderOpen size={14} aria-hidden="true" />
                        Open from Library
                    </button>
                </div>
                {importDisabledReason ? (
                    <p className="mt-3 text-[11px] text-textMuted">{importDisabledReason}</p>
                ) : null}
                {children}
            </div>
        </section>
    );
}

export interface LaneStepPlaceholderProps {
    readonly stepLabel: string;
    /** Step that fixes the missing input, for example the lane Source step. */
    readonly fixCommandId: StudioCommandId;
    readonly fixLabel: string;
    readonly onExecute: (commandId: StudioCommandId) => void;
}

/** A step whose editor has not shipped yet. It never shows an empty panel. */
export function LaneStepPlaceholder({
    stepLabel,
    fixCommandId,
    fixLabel,
    onExecute,
}: LaneStepPlaceholderProps) {
    return (
        <section
            data-lane-step-placeholder
            aria-label={`${stepLabel} is not available yet`}
            className="absolute inset-0 flex items-center justify-center bg-workspace p-6 text-center"
        >
            <div className="max-w-sm">
                <h1 className="text-base font-semibold text-textMain">{stepLabel} is not available yet</h1>
                <p className="mt-2 text-xs leading-5 text-textMuted">
                    This step needs a source first, and its editor is still being built.
                </p>
                <button
                    type="button"
                    data-command-id={fixCommandId}
                    onClick={() => onExecute(fixCommandId)}
                    className="mt-4 inline-flex min-h-9 items-center rounded-md border border-white/10 bg-surface px-3 text-xs font-semibold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {fixLabel}
                </button>
            </div>
        </section>
    );
}

export default LaneEmptyState;
