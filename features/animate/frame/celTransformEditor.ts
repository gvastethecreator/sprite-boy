import type {
  CelTransform,
  EntityId,
  ISO8601Timestamp,
} from "../../../core/project";
import { isEntityId, isISO8601Timestamp } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";

const POSITION_LIMIT = 1_000_000;
const SCALE_MIN = 0.01;
const SCALE_MAX = 32;

export type CelTransformHistory =
  | { readonly mode: "record" }
  | { readonly mode: "coalesce"; readonly transactionId: EntityId };

export type CelTransformEditResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly message: string };

export interface CelTransformEditor {
  select(sequenceId: EntityId, celId: EntityId): CelTransformEditResult;
  setTransform(
    celId: EntityId,
    patch: Partial<CelTransform>,
    history?: CelTransformHistory,
  ): CelTransformEditResult;
  reset(celId: EntityId): CelTransformEditResult;
  setLocked(celId: EntityId, locked: boolean): CelTransformEditResult;
}

interface CelTransformEditorOptions {
  readonly store: ProjectStore;
  readonly nextId: () => EntityId;
  readonly now: () => ISO8601Timestamp;
}

const FAILURE = Object.freeze({ ok: false as const, message: "Frame edit could not be applied." });

function clamp(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}

function rotation(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizePatch(patch: Partial<CelTransform>): Partial<CelTransform> | null {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return null;
  const allowed = new Set(["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY"]);
  const result: Partial<CelTransform> = {};
  try {
    for (const key of Reflect.ownKeys(patch)) {
      if (typeof key !== "string" || !allowed.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(patch, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      const value = descriptor.value;
      if (key === "flipX" || key === "flipY") {
        if (typeof value !== "boolean") return null;
        result[key] = value;
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      if (key === "x" || key === "y") result[key] = clamp(value, -POSITION_LIMIT, POSITION_LIMIT);
      else if (key === "scaleX" || key === "scaleY") result[key] = clamp(value, SCALE_MIN, SCALE_MAX);
      else if (key === "rotation") result.rotation = rotation(value);
      else result.opacity = clamp(value, 0, 1);
    }
  } catch {
    return null;
  }
  return result;
}

function fullTransform(current: CelTransform | undefined, patch: Partial<CelTransform>): CelTransform {
  return {
    x: current?.x ?? 0,
    y: current?.y ?? 0,
    scaleX: current?.scaleX ?? 1,
    scaleY: current?.scaleY ?? 1,
    rotation: current?.rotation ?? 0,
    opacity: current?.opacity ?? 1,
    flipX: current?.flipX ?? false,
    flipY: current?.flipY ?? false,
    ...patch,
  };
}

export function createCelTransformEditor(options: CelTransformEditorOptions): CelTransformEditor {
  const dispatch = (
    command: Parameters<ProjectStore["dispatch"]>[0]["command"],
    history: CelTransformHistory = { mode: "record" },
  ): CelTransformEditResult => {
    try {
      const commandId = options.nextId();
      const issuedAt = options.now();
      if (
        !isEntityId(commandId) ||
        !isISO8601Timestamp(issuedAt) ||
        (history.mode === "coalesce" && !isEntityId(history.transactionId))
      ) return FAILURE;
      const dispatched = options.store.dispatch({
        command,
        metadata: {
          commandId,
          origin: "user",
          history: history.mode,
          ...(history.mode === "coalesce" ? { transactionId: history.transactionId } : {}),
          issuedAt,
        },
      });
      return dispatched.result.ok
        ? Object.freeze({ ok: true, revision: dispatched.revision })
        : FAILURE;
    } catch {
      return FAILURE;
    }
  };

  const selectedCel = (celId: EntityId) => {
    if (!isEntityId(celId)) return null;
    try {
      const project = options.store.getSnapshot().project;
      const cel = project.cels[celId];
      if (
        !cel ||
        project.workspace.selectedSequenceId !== cel.sequenceId ||
        !project.workspace.selectedCelIds?.includes(celId)
      ) return null;
      return cel;
    } catch {
      return null;
    }
  };

  const editor: CelTransformEditor = {
    select(sequenceId, celId) {
      if (!isEntityId(sequenceId) || !isEntityId(celId)) return FAILURE;
      try {
        const project = options.store.getSnapshot().project;
        const sequence = project.sequences[sequenceId];
        const cel = project.cels[celId];
        if (!sequence || !cel || cel.sequenceId !== sequenceId || !sequence.celIds.includes(celId)) return FAILURE;
      } catch {
        return FAILURE;
      }
      return dispatch({
        type: "workspace.update",
        patch: {
          activeWorkspace: "animate",
          selectedSequenceId: sequenceId,
          selectedCelIds: [celId],
        },
      });
    },
    setTransform(celId, patch, history = { mode: "record" }) {
      const cel = selectedCel(celId);
      const normalized = normalizePatch(patch);
      if (!cel || cel.locked || !normalized || Object.keys(normalized).length === 0) return FAILURE;
      return dispatch({
        type: "cel.update",
        celId,
        patch: { transform: fullTransform(cel.transform, normalized) },
      }, history);
    },
    reset(celId) {
      const cel = selectedCel(celId);
      if (!cel || cel.locked) return FAILURE;
      return dispatch({
        type: "cel.update",
        celId,
        patch: {
          transform: fullTransform(undefined, { opacity: cel.transform?.opacity ?? 1 }),
        },
      });
    },
    setLocked(celId, locked) {
      const cel = selectedCel(celId);
      if (!cel || typeof locked !== "boolean") return FAILURE;
      return dispatch({ type: "cel.update", celId, patch: { locked } });
    },
  };
  return Object.freeze(editor);
}
