import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, CircleDashed, ListChecks, RotateCcw } from "lucide-react";
import {
    STUDIO_STEP_LABELS,
    deriveInvariants,
    deriveStepStates,
    getLaneSteps,
    isOptionalStep,
    routeCommandId,
    routeHref,
    type StudioCommandId,
    type StudioLaneId,
    type StudioLaneRoute,
    type StudioLaneSignals,
    type StudioLaneStepId,
    type StudioStepState,
} from "../../core/studio";

export interface LaneStepperProps {
    readonly lane: StudioLaneId;
    readonly activeStep: StudioLaneStepId;
    readonly signals?: StudioLaneSignals;
    readonly onExecute: (commandId: StudioCommandId) => void;
}

const STATE_LABEL: Readonly<Record<StudioStepState, string>> = Object.freeze({
    empty: "No input yet",
    pending: "Work is open",
    ready: "Ready",
    invalidated: "Out of date",
});

function StepIcon({ state }: { readonly state: StudioStepState }) {
    const common = { size: 12, strokeWidth: 2, "aria-hidden": true } as const;
    if (state === "ready") return <Check {...common} className="text-emerald-400" />;
    if (state === "invalidated") return <RotateCcw {...common} className="text-amber-400" />;
    if (state === "pending") return <CircleDashed {...common} className="text-accent" />;
    return <CircleDashed {...common} className="text-textMuted/50" />;
}

const INVARIANT_STYLE = {
    pass: "text-emerald-400",
    fail: "text-red-300",
    unknown: "text-textMuted",
} as const;

/** Horizontal step list with derived states and the lane invariant checklist. */
export function LaneStepper({ lane, activeStep, signals, onExecute }: LaneStepperProps) {
    const steps = getLaneSteps(lane) as readonly StudioLaneStepId[];
    const states = deriveStepStates(lane, signals);
    const invariants = deriveInvariants(lane, signals);
    const failing = invariants.filter((item) => item.state === "fail").length;
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const popoverId = useId();

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <div
            className="relative flex h-10 shrink-0 items-center justify-between gap-3 rounded-panel border border-border/20 bg-panel px-2"
            data-lane-stepper={lane}
            onKeyDown={onKeyDown}
        >
            <nav aria-label={`${lane} steps`} className="min-w-0 flex-1 overflow-x-auto">
                <ol className="flex items-center gap-0.5">
                    {steps.map((step, index) => {
                        const route = { tab: lane, step } as StudioLaneRoute;
                        const state = states[step] ?? "empty";
                        const active = step === activeStep;
                        return (
                            <li key={step} className="flex shrink-0 items-center">
                                {index > 0 ? <span aria-hidden="true" className="mx-0.5 h-px w-3 bg-white/10" /> : null}
                                <a
                                    href={routeHref(route)}
                                    data-step-id={step}
                                    data-step-state={state}
                                    aria-current={active ? "step" : undefined}
                                    title={`${STUDIO_STEP_LABELS[step]}: ${STATE_LABEL[state]}`}
                                    onClick={(event) => {
                                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                                        event.preventDefault();
                                        onExecute(routeCommandId(route));
                                    }}
                                    className={[
                                        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                        active ? "bg-white/12 text-textMain" : "text-textMuted hover:bg-white/5 hover:text-textMain",
                                    ].join(" ")}
                                >
                                    <StepIcon state={state} />
                                    {STUDIO_STEP_LABELS[step]}
                                    {isOptionalStep(lane, step) ? (
                                        <span className="text-[9px] font-normal text-textMuted/70">optional</span>
                                    ) : null}
                                    <span className="sr-only">, {STATE_LABEL[state]}</span>
                                </a>
                            </li>
                        );
                    })}
                </ol>
            </nav>

            <div className="relative shrink-0">
                <button
                    ref={triggerRef}
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-controls={open ? popoverId : undefined}
                    onClick={() => setOpen((current) => !current)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-surface px-2 text-[11px] font-medium text-textMuted hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <ListChecks size={13} aria-hidden="true" />
                    Checklist
                    {failing > 0 ? (
                        <span className="rounded-full bg-red-500/20 px-1 font-mono text-[9px] text-red-300">{failing}</span>
                    ) : null}
                    <ChevronDown size={11} aria-hidden="true" className={open ? "rotate-180" : ""} />
                </button>
                {open ? (
                    <div
                        ref={popoverRef}
                        id={popoverId}
                        role="dialog"
                        aria-label={`${lane} lane invariants`}
                        className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-panel p-2 shadow-xl"
                    >
                        <ul className="space-y-1">
                            {invariants.map((item) => (
                                <li key={item.id} data-invariant-id={item.id} data-invariant-state={item.state} className="flex gap-2 rounded px-2 py-1.5 text-xs">
                                    {item.state === "fail" ? (
                                        <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-red-300" />
                                    ) : item.state === "pass" ? (
                                        <Check size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-400" />
                                    ) : (
                                        <CircleDashed size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-textMuted/60" />
                                    )}
                                    <span className="min-w-0">
                                        <span className="block font-medium text-textMain">{item.label}</span>
                                        <span className={`block text-[11px] ${INVARIANT_STYLE[item.state]}`}>
                                            {item.state === "pass" ? "Pass" : item.state === "fail" ? "Fail" : "Unknown"}: {item.reason}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default LaneStepper;
