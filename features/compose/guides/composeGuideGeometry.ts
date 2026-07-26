import type { InteractionGuide } from "../../../core/stores";

const MAX_ITEMS = 10_000;
const MAX_SCENE_VALUE = 1_000_000;

export interface ComposeSnapItem {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly visible?: boolean;
}

export interface ComposeSnapInput {
  readonly moving: ComposeSnapItem;
  readonly others: readonly ComposeSnapItem[];
  readonly canvas: { readonly width: number; readonly height: number };
  readonly viewportScale: number;
  readonly toleranceCssPx?: number;
  readonly enabled?: boolean;
}

export interface ComposeSnapResult {
  readonly x: number;
  readonly y: number;
  readonly guides: readonly InteractionGuide[];
}

interface AxisCandidate {
  readonly position: number;
  readonly priority: number;
}

interface AxisSnap {
  readonly delta: number;
  readonly guide: number;
  readonly distance: number;
  readonly priority: number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_SCENE_VALUE) {
    throw new TypeError(`${label} is outside the supported scene range.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function positive(value: number, label: string): number {
  const result = finite(value, label);
  if (result <= 0) throw new TypeError(`${label} must be positive.`);
  return result;
}

function itemAnchors(item: ComposeSnapItem): { readonly x: readonly number[]; readonly y: readonly number[] } {
  const x = finite(item.x, "Layer x");
  const y = finite(item.y, "Layer y");
  const width = positive(item.width, "Layer width") * Math.abs(finite(item.scaleX, "Layer scaleX"));
  const height = positive(item.height, "Layer height") * Math.abs(finite(item.scaleY, "Layer scaleY"));
  const radians = finite(item.rotation, "Layer rotation") * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const halfWidth = (width * cosine + height * sine) / 2;
  const halfHeight = (width * sine + height * cosine) / 2;
  return Object.freeze({
    x: Object.freeze([x - halfWidth, x, x + halfWidth]),
    y: Object.freeze([y - halfHeight, y, y + halfHeight]),
  });
}

function candidates(canvasEdge: number, others: readonly ComposeSnapItem[], axis: "x" | "y"): AxisCandidate[] {
  const result: AxisCandidate[] = [
    { position: 0, priority: 0 },
    { position: canvasEdge / 2, priority: 0 },
    { position: canvasEdge, priority: 0 },
  ];
  for (const item of others) {
    if (item.visible === false) continue;
    for (const position of itemAnchors(item)[axis]) result.push({ position, priority: 1 });
  }
  return result;
}

function bestSnap(
  movingAnchors: readonly number[],
  axisCandidates: readonly AxisCandidate[],
  tolerance: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const moving of movingAnchors) {
    for (const candidate of axisCandidates) {
      const delta = candidate.position - moving;
      const distance = Math.abs(delta);
      if (distance > tolerance) continue;
      const next = { delta, guide: candidate.position, distance, priority: candidate.priority };
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance && candidate.priority < best.priority) ||
        (distance === best.distance && candidate.priority === best.priority && candidate.position < best.guide)
      ) best = next;
    }
  }
  return best;
}

export function snapComposeLayer(input: ComposeSnapInput): ComposeSnapResult {
  if (input.others.length > MAX_ITEMS) throw new TypeError("Too many guide candidates.");
  const x = finite(input.moving.x, "Layer x");
  const y = finite(input.moving.y, "Layer y");
  if (input.enabled === false) return Object.freeze({ x, y, guides: Object.freeze([]) });

  const canvasWidth = positive(input.canvas.width, "Canvas width");
  const canvasHeight = positive(input.canvas.height, "Canvas height");
  const viewportScale = positive(input.viewportScale, "Viewport scale");
  const toleranceCssPx = input.toleranceCssPx ?? 6;
  if (!Number.isFinite(toleranceCssPx) || toleranceCssPx < 0 || toleranceCssPx > 64) {
    throw new TypeError("Guide tolerance is invalid.");
  }
  const tolerance = toleranceCssPx / viewportScale;
  const moving = itemAnchors(input.moving);
  const xSnap = bestSnap(moving.x, candidates(canvasWidth, input.others, "x"), tolerance);
  const ySnap = bestSnap(moving.y, candidates(canvasHeight, input.others, "y"), tolerance);
  const guides: InteractionGuide[] = [];
  if (xSnap) guides.push({ axis: "x", position: xSnap.guide });
  if (ySnap) guides.push({ axis: "y", position: ySnap.guide });
  return Object.freeze({
    x: Object.is(x + (xSnap?.delta ?? 0), -0) ? 0 : x + (xSnap?.delta ?? 0),
    y: Object.is(y + (ySnap?.delta ?? 0), -0) ? 0 : y + (ySnap?.delta ?? 0),
    guides: Object.freeze(guides.map((guide) => Object.freeze(guide))),
  });
}
