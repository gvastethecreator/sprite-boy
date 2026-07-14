export interface SceneAffineMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_SCENE_MATRIX: SceneAffineMatrix = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value;
}

function canonicalTrigonometric(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

/** Multiply affine matrices so the resulting transform applies right first. */
export function multiplySceneMatrices(
  left: SceneAffineMatrix,
  right: SceneAffineMatrix,
): SceneAffineMatrix {
  return Object.freeze({
    a: canonicalNumber(left.a * right.a + left.c * right.b),
    b: canonicalNumber(left.b * right.a + left.d * right.b),
    c: canonicalNumber(left.a * right.c + left.c * right.d),
    d: canonicalNumber(left.b * right.c + left.d * right.d),
    e: canonicalNumber(left.a * right.e + left.c * right.f + left.e),
    f: canonicalNumber(left.b * right.e + left.d * right.f + left.f),
  });
}

export function sceneTranslation(x: number, y: number): SceneAffineMatrix {
  return Object.freeze({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: canonicalNumber(x),
    f: canonicalNumber(y),
  });
}

export function sceneScale(x: number, y: number): SceneAffineMatrix {
  return Object.freeze({
    a: canonicalNumber(x),
    b: 0,
    c: 0,
    d: canonicalNumber(y),
    e: 0,
    f: 0,
  });
}

export function sceneRotation(degrees: number): SceneAffineMatrix {
  const radians = (degrees % 360) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return Object.freeze({
    a: canonicalTrigonometric(cosine),
    b: canonicalTrigonometric(sine),
    c: canonicalTrigonometric(-sine),
    d: canonicalTrigonometric(cosine),
    e: 0,
    f: 0,
  });
}

export function composeSceneMatrices(
  ...matrices: readonly SceneAffineMatrix[]
): SceneAffineMatrix {
  return matrices.reduce(multiplySceneMatrices, IDENTITY_SCENE_MATRIX);
}
