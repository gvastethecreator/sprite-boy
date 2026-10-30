import { FolderOpen } from "lucide-react";
import {
    STUDIO_LANE_LABELS,
    STUDIO_STEP_LABELS,
    getDefaultRoute,
    routeCommandId,
    type StudioCommandId,
    type StudioLaneId,
    type StudioLaneRoute,
    type StudioLaneStepId,
} from "../../core/studio";
import { LaneEmptyState, LaneStepPlaceholder } from "./LaneEmptyState";

export interface LaneNativeStepProps {
    readonly route: StudioLaneRoute;
    readonly onExecute: (commandId: StudioCommandId) => void;
}

const NOT_AVAILABLE = "Import for this lane is not available yet.";

/** View for a lane step that has no editor yet. Every state names what is missing. */
export function LaneNativeStep({ route, onExecute }: LaneNativeStepProps) {
    if (route.tab === "library") {
        return (
            <main
                data-studio-workspace-content="library"
                aria-label="Library content"
                className="relative flex-1 overflow-hidden rounded-panel border border-border/20 bg-workspace"
            >
                <section className="absolute inset-0 flex items-center justify-center p-6 text-center">
                    <div className="max-w-sm">
                        <FolderOpen size={28} strokeWidth={1.5} aria-hidden="true" className="mx-auto text-textMuted" />
                        <h1 className="mt-3 text-base font-semibold text-textMain">Library is empty</h1>
                        <p className="mt-2 text-xs leading-5 text-textMuted">
                            Sources, approved items and sheets will appear here once a lane produces them.
                        </p>
                    </div>
                </section>
            </main>
        );
    }

    const lane = route.tab as StudioLaneId;
    const step = route.step as StudioLaneStepId;
    const sourceRoute = getDefaultRoute(lane);

    return (
        <main
            data-studio-workspace-content={lane}
            aria-label={`${STUDIO_LANE_LABELS[lane]} ${STUDIO_STEP_LABELS[step]} content`}
            className="relative flex-1 overflow-hidden rounded-panel border border-border/20 bg-workspace"
        >
            {step === "source" ? (
                <LaneEmptyState lane={lane} onExecute={onExecute} importDisabledReason={NOT_AVAILABLE} />
            ) : (
                <LaneStepPlaceholder
                    stepLabel={STUDIO_STEP_LABELS[step]}
                    fixCommandId={routeCommandId(sourceRoute)}
                    fixLabel={`Go to ${STUDIO_LANE_LABELS[lane]} › ${STUDIO_STEP_LABELS[sourceRoute.step as StudioLaneStepId]}`}
                    onExecute={onExecute}
                />
            )}
        </main>
    );
}

export default LaneNativeStep;
