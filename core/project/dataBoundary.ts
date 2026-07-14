const MAX_DATA_NODES = 100_000;

export type DataCloneResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

interface CloneState {
  readonly ancestors: WeakSet<object>;
  readonly clones: WeakMap<object, unknown>;
  nodes: number;
}

function cloneDataValue(value: unknown, state: CloneState): DataCloneResult<unknown> {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return { ok: true, value };
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? { ok: true, value }
      : { ok: false };
  }
  if (typeof value !== "object") return { ok: false };
  if (state.ancestors.has(value)) return { ok: false };
  const existing = state.clones.get(value);
  if (existing !== undefined) return { ok: true, value: existing };
  state.nodes += 1;
  if (state.nodes > MAX_DATA_NODES) return { ok: false };

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Array.prototype) return { ok: false };
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_DATA_NODES
      ) return { ok: false };
      const length = lengthDescriptor.value;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1) return { ok: false };
      const target: unknown[] = [];
      target.length = length;
      state.clones.set(value, target);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return { ok: false };
        }
        const cloned = cloneDataValue(descriptor.value, state);
        if (!cloned.ok) return cloned;
        Object.defineProperty(target, String(index), {
          configurable: true,
          enumerable: true,
          value: cloned.value,
          writable: true,
        });
      }
      return { ok: true, value: target };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { ok: false };
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_DATA_NODES) return { ok: false };
    const target: Record<PropertyKey, unknown> = {};
    state.clones.set(value, target);
    for (const key of keys) {
      if (typeof key !== "string") return { ok: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return { ok: false };
      }
      const cloned = cloneDataValue(descriptor.value, state);
      if (!cloned.ok) return cloned;
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value: cloned.value,
        writable: true,
      });
    }
    return { ok: true, value: target };
  } catch {
    return { ok: false };
  } finally {
    state.ancestors.delete(value);
  }
}

/**
 * Create a stable, executable-code-free view of an external data graph.
 * Accessors, symbols, exotic prototypes, cycles and sparse/custom arrays are
 * rejected without invoking property getters.
 */
export function cloneDataOnly<T>(value: T): DataCloneResult<T> {
  const result = cloneDataValue(value, {
    ancestors: new WeakSet<object>(),
    clones: new WeakMap<object, unknown>(),
    nodes: 0,
  });
  return result as DataCloneResult<T>;
}
