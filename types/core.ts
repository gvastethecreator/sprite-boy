import { BuilderCanvasSize } from "./ui";
import { HitboxType } from "./enums";

export type SlotAlignment =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// Hitbox data structure for collision regions
export interface HitboxData {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: HitboxType;
  tag: string;
}

export interface ImageMeta {
  src: string;
  width: number;
  height: number;
  name: string;
  fileSize: number;
}

export interface FrameData {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  // List of collision boxes associated with this frame
  hitboxes?: HitboxData[];
}

export interface BuilderAsset {
  id: string;
  src: string;
  name: string;
  width: number;
  height: number;
}

export interface SlotData {
  gridIndex: number;
  assetId: string;
  fitMode: "fit" | "fill" | "original" | "stretch";
  alignment: SlotAlignment;
  scaleX: number;
  scaleY: number;
  lockAspect: boolean;
  rotation: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
  flipX: boolean;
  flipY: boolean;
}

export interface BuilderFreeObject {
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  zIndex: number;
}

export interface Keyframe {
  uid: string;
  sourceIndex: number;
  pivotX: number;
  pivotY: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

export interface SpriteAnimation {
  id: string;
  name: string;
  fps: number;
  loop: boolean;
  keyframes: Keyframe[];
}

export interface ProjectState {
  imageMeta: ImageMeta | null;
  builderCanvas: BuilderCanvasSize | null;
  frames: FrameData[];
  builderSlots: Record<number, SlotData>;
  builderFreeObjects: BuilderFreeObject[];
  animations: SpriteAnimation[];
  builderAssets: BuilderAsset[];
  aspectRatio?: string;
}
