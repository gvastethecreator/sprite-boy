// Enum definitions for application state
export enum AppMode {
  BUILDER = "BUILDER", // Unified Build/Slice mode
  ANIMATION = "ANIMATION",
  TEMPLATE = "TEMPLATE",
  COLLISION = "COLLISION",
}

// Types of hitboxes used in game development
export enum HitboxType {
  HURTBOX = "HURTBOX",
  HITBOX = "HITBOX",
  SOLID = "SOLID",
  TRIGGER = "TRIGGER",
}

export enum DragMode {
  NONE = "NONE",
  PAN = "PAN",
  MOVE_FRAME = "MOVE_FRAME",
  RESIZE_FRAME = "RESIZE_FRAME",
  CREATE_FRAME = "CREATE_FRAME",
  MOVE_PIVOT = "MOVE_PIVOT",
  ROTATE_FRAME = "ROTATE_FRAME",
  SWAP_SLOTS = "SWAP_SLOTS",
}

// Added BuilderLayoutMode to resolve missing export error
export type BuilderLayoutMode = "grid" | "free";

export const DND_ASSET_TYPE = "application/react-dnd-asset-id";
export const DND_KEYFRAME_TYPE = "application/react-dnd-keyframe-index";
export const DND_ASSET_REORDER_TYPE = "application/react-dnd-asset-reorder";
export const DND_FRAME_TYPE = "application/react-dnd-frame-id";
