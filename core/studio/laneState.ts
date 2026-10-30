import {
  STUDIO_LANE_INVARIANTS,
  STUDIO_LANE_STEPS,
  STUDIO_OPTIONAL_STEPS,
  type StudioLaneId,
  type StudioLaneStepId,
} from "./laneRegistry";

export type StudioStepState = "empty" | "pending" | "ready" | "invalidated";
export type StudioInvariantState = "pass" | "fail" | "unknown";

export interface StudioInvariantStatus {
  readonly id: string;
  readonly label: string;
  readonly state: StudioInvariantState;
  readonly reason: string;
}

/** What a lane reports to the shell. Later tickets add real signals. */
export interface StudioLaneSignals {
  readonly steps?: Readonly<Partial<Record<StudioLaneStepId, StudioStepState>>>;
  readonly invariants?: Readonly<
    Record<string, { readonly state: StudioInvariantState; readonly reason: string }>
  >;
}

const NOT_CHECKED: { readonly state: StudioInvariantState; readonly reason: string } = Object.freeze({
  state: "unknown",
  reason: "Not checked yet.",
});

/** Derive step states. They are never stored, so they cannot go stale. */
export function deriveStepStates(
  lane: StudioLaneId,
  signals: StudioLaneSignals = {},
): Readonly<Record<string, StudioStepState>> {
  const states: Record<string, StudioStepState> = {};
  for (const step of STUDIO_LANE_STEPS[lane]) {
    states[step] = signals.steps?.[step as StudioLaneStepId] ?? "empty";
  }
  return Object.freeze(states);
}

export function deriveInvariants(
  lane: StudioLaneId,
  signals: StudioLaneSignals = {},
): readonly StudioInvariantStatus[] {
  return Object.freeze(
    STUDIO_LANE_INVARIANTS[lane].map((invariant) => {
      const signal = signals.invariants?.[invariant.id] ?? NOT_CHECKED;
      return Object.freeze({ id: invariant.id, label: invariant.label, ...signal });
    }),
  );
}

export function isOptionalStep(lane: StudioLaneId, step: string): boolean {
  return STUDIO_OPTIONAL_STEPS.has(`${lane}.${step}`);
}
