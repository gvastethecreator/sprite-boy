import type { LocalModelDefinition } from "./modelCatalog";

interface ModelMaskTensor {
  readonly type: string;
  readonly size: number;
  readonly data: unknown;
}

interface Float16ArrayLike extends ArrayLike<number> {
  readonly buffer: ArrayBufferLike;
}

function float16BitsToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function nativeFloat16Array(value: unknown): Float16ArrayLike | null {
  const constructor = (globalThis as { readonly Float16Array?: new (buffer: ArrayBufferLike) => Float16ArrayLike })
    .Float16Array;
  return constructor && value instanceof constructor ? value : null;
}

function tensorReader(
  tensor: ModelMaskTensor,
  expectedType: LocalModelDefinition["runtime"]["outputType"],
): (index: number) => number {
  if (tensor.type !== expectedType) throw new TypeError("Model output tensor type is invalid.");
  if (expectedType === "float32") {
    if (!(tensor.data instanceof Float32Array)) throw new TypeError("Model output tensor data is invalid.");
    const data = tensor.data;
    return (index) => data[index]!;
  }
  if (tensor.data instanceof Uint16Array) {
    const data = tensor.data;
    return (index) => float16BitsToNumber(data[index]!);
  }
  const native = nativeFloat16Array(tensor.data);
  if (!native) throw new TypeError("Model output tensor data is invalid.");
  return (index) => native[index]!;
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

export function normalizeModelMaskTensor(
  tensor: ModelMaskTensor,
  expectedSize: number,
  expectedType: LocalModelDefinition["runtime"]["outputType"],
  normalization: LocalModelDefinition["runtime"]["outputNormalization"],
): Uint8Array {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || tensor.size !== expectedSize) {
    throw new TypeError("Model output tensor size is invalid.");
  }
  const read = tensorReader(tensor, expectedType);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  if (normalization === "min-max") {
    for (let index = 0; index < expectedSize; index += 1) {
      const value = read(index);
      if (!Number.isFinite(value)) throw new TypeError("Model mask contains invalid values.");
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    if (!(maximum > minimum)) throw new TypeError("Model mask has no usable range.");
  }
  const bytes = new Uint8Array(expectedSize);
  for (let index = 0; index < expectedSize; index += 1) {
    const raw = read(index);
    const value = normalization === "sigmoid"
      ? sigmoid(raw)
      : (raw - minimum) / (maximum - minimum);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError("Model mask contains invalid values.");
    }
    bytes[index] = Math.round(value * 255);
  }
  return bytes;
}
