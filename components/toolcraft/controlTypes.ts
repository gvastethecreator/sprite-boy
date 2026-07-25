export type ControlChangeHistoryMode = "merge" | "record" | "skip";

export type ControlChangeMeta = {
  readonly history?: ControlChangeHistoryMode;
  readonly historyGroup?: string;
};

export type ControlValueChangeHandler<Value> = (
  value: Value,
  meta?: ControlChangeMeta,
) => void;

export type ControlOption = {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
};

let nextControlHistoryGroupSeq = 0;

/**
 * Returns a new non-empty id per call. Deterministic sequence only — no
 * randomness or clock.
 */
export function createControlHistoryGroupId(scope: string): string {
  nextControlHistoryGroupSeq += 1;
  const safeScope = scope.length > 0 ? scope : "control";
  return `${safeScope}:${nextControlHistoryGroupSeq}`;
}
