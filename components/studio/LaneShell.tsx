import { useEffect, useState, type ReactNode } from "react";
import { Info, PanelRightClose, PanelRightOpen } from "lucide-react";
import {
    STUDIO_LANE_LABELS,
    STUDIO_STEP_LABELS,
    type StudioCommandId,
    type StudioLaneId,
    type StudioLaneRoute,
    type StudioLaneSignals,
    type StudioLaneStepId,
    type StudioWorkspaceId,
} from "../../core/studio";
import { LaneStepper } from "./LaneStepper";
import { StudioWidthNotice } from "./StudioWidthNotice";
import type { StudioViewport } from "./useStudioViewport";

export interface LaneShellProps {
    readonly route: StudioLaneRoute;
    /** Old editor that this step still mounts, or null for a native step. */
    readonly mount: StudioWorkspaceId | null;
    readonly viewport: StudioViewport;
    readonly signals?: StudioLaneSignals;
    readonly onExecute: (commandId: StudioCommandId) => void;
    /** Left tools, inspector and tray are optional and collapse when absent. */
    readonly tools?: ReactNode;
    readonly inspector?: ReactNode;
    readonly tray?: ReactNode;
    readonly children: ReactNode;
}

const TEMPORARY_MOUNT_COPY: Readonly<Partial<Record<StudioWorkspaceId, string>>> = Object.freeze({
    slice: "This step still uses the previous Slice editor.",
    compose: "This step still uses the previous Compose editor.",
    animate: "This step still uses the previous Animate editor.",
    collision: "This step still uses the previous Collision editor.",
    export: "This step still uses the previous Export view.",
});

function InspectorToggle({
    open,
    onToggle,
}: {
    readonly open: boolean;
    readonly onToggle: () => void;
}) {
    const Icon = open ? PanelRightClose : PanelRightOpen;
    return (
        <button
            type="button"
            aria-pressed={open}
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-surface px-2 py-1 text-[11px] font-medium text-textMuted hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <Icon size={12} aria-hidden="true" />
            Inspector
        </button>
    );
}

/**
 * Four-zone frame for a lane step: stepper on top, tools on the left, the
 * workspace in the center, an inspector on the right and a tray below.
 * A missing zone collapses, so no panel is ever empty.
 */
export function LaneShell({
    route,
    mount,
    viewport,
    signals,
    onExecute,
    tools,
    inspector,
    tray,
    children,
}: LaneShellProps) {
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const overlay = viewport.mode === "overlay";

    useEffect(() => {
        if (!overlay) setInspectorOpen(false);
    }, [overlay]);

    const lane = route.tab === "library" ? null : (route.tab as StudioLaneId);
    const step = route.step as StudioLaneStepId | null;
    const bannerCopy = mount ? TEMPORARY_MOUNT_COPY[mount] : undefined;
    const label = lane && step ? `${STUDIO_LANE_LABELS[lane]} › ${STUDIO_STEP_LABELS[step]}` : "Library";
    const hasInspector = Boolean(inspector);
    const showInspector = hasInspector && (!overlay || inspectorOpen);
    const toggle = overlay && hasInspector
        ? <InspectorToggle open={inspectorOpen} onToggle={() => setInspectorOpen((current) => !current)} />
        : null;

    return (
        <div
            className="flex min-h-0 flex-1 flex-col gap-2"
            data-lane-shell={route.tab}
            data-lane-step={step ?? undefined}
            data-viewport-mode={viewport.mode}
        >
            {viewport.mode === "unsupported" ? <StudioWidthNotice width={viewport.width} /> : null}

            {lane && step ? (
                <LaneStepper lane={lane} activeStep={step} signals={signals} onExecute={onExecute} />
            ) : null}

            {bannerCopy || toggle ? (
                <div className="flex shrink-0 items-center gap-2">
                    {bannerCopy ? (
                        <div
                            role="note"
                            data-temporary-mount={mount ?? undefined}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-1.5 text-[11px] text-amber-200/90"
                        >
                            <Info size={12} aria-hidden="true" className="shrink-0" />
                            <span className="truncate">{bannerCopy}</span>
                        </div>
                    ) : <span className="flex-1" />}
                    {toggle}
                </div>
            ) : null}

            <div className="relative flex min-h-0 flex-1 gap-2" role="group" aria-label={label}>
                {tools ? (
                    <aside
                        aria-label="Tools"
                        data-lane-zone="tools"
                        className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-panel border border-border/20 bg-panel"
                    >
                        {tools}
                    </aside>
                ) : null}

                <div data-lane-zone="center" className="flex min-w-0 flex-1 flex-col gap-2">
                    {children}
                    {tray ? (
                        <div data-lane-zone="tray" className="shrink-0">
                            {tray}
                        </div>
                    ) : null}
                </div>

                {showInspector ? (
                    <aside
                        aria-label="Inspector"
                        data-lane-zone="inspector"
                        data-inspector-overlay={overlay || undefined}
                        className={[
                            "flex w-[300px] shrink-0 flex-col overflow-hidden rounded-panel border border-border/20 bg-panel",
                            overlay ? "absolute inset-y-0 right-0 z-30 shadow-modal" : "",
                        ].join(" ")}
                    >
                        {inspector}
                    </aside>
                ) : null}
            </div>
        </div>
    );
}

export default LaneShell;
