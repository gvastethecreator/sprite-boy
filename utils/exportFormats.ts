import { FrameData, SpriteAnimation, HitboxData } from "../types";
import { calculateGeometry } from "./renderUtils";

interface ExportFrameInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  pivot: { x: number; y: number };
  collision?: Array<{
    label: string;
    type: HitboxData["type"];
    rect: { x: number; y: number; w: number; h: number };
  }>;
}

/** Generates a generic JSON sprite-sheet descriptor with frame rects, hitboxes and pivot points. */
export const generateGenericJSON = (
  anim: SpriteAnimation,
  frames: FrameData[],
  geometry: ReturnType<typeof calculateGeometry>,
  scale: number,
) => {
  const { cols, marginX, marginY, paddingX, paddingY, cellW, cellH } = geometry;

  const frameData = anim.keyframes.map((kf) => {
    const sourceFrame = frames.find((f) => f.id === kf.sourceIndex);
    const hitboxes = sourceFrame?.hitboxes || [];

    // If frame is from builder (no sourceFrame usually), fallback to grid calc
    const c = kf.sourceIndex % cols;
    const r = Math.floor(kf.sourceIndex / cols);
    const x = marginX + c * (cellW + paddingX);
    const y = marginY + r * (cellH + paddingY);

    const frameInfo: ExportFrameInfo = {
      x: sourceFrame ? sourceFrame.x : Math.round(x),
      y: sourceFrame ? sourceFrame.y : Math.round(y),
      w: sourceFrame ? sourceFrame.w : Math.round(cellW),
      h: sourceFrame ? sourceFrame.h : Math.round(cellH),
      pivot: { x: kf.pivotX, y: kf.pivotY },
    };

    if (hitboxes.length > 0) {
      frameInfo.collision = hitboxes.map((hb) => ({
        label: hb.tag,
        type: hb.type,
        rect: { x: hb.x, y: hb.y, w: hb.w, h: hb.h },
      }));
    }

    return frameInfo;
  });

  return JSON.stringify(
    {
      meta: {
        app: "SpriteSlice Studio",
        version: "1.0",
        scale: scale,
      },
      animation: {
        name: anim.name,
        framerate: anim.fps,
        loop: anim.loop,
        frames: frameData,
      },
    },
    null,
    2,
  );
};

/** Generates a Phaser 3–compatible JSON atlas (hash format). */
export const generatePhaser3 = (
  anim: SpriteAnimation,
  _frames: FrameData[],
  _geometry: ReturnType<typeof calculateGeometry>,
) => {
  // Phaser 3 Animation Config
  // Usually Phaser uses a texture atlas JSON + an anim config.
  // This generates the ANIM configuration object assuming frames are named/indexed.

  const config = {
    key: anim.name,
    frames: anim.keyframes.map((kf) => kf.sourceIndex), // Or frame names if we had them
    frameRate: anim.fps,
    repeat: anim.loop ? -1 : 0,
  };

  return `// Phaser 3 Animation Configuration
this.anims.create(${JSON.stringify(config, null, 2)});`;
};

/** Generates a Godot SpriteFrames resource file (.tres) for the given animations. */
export const generateGodotSpriteFrames = (
  anim: SpriteAnimation,
  frames: FrameData[],
  geometry: ReturnType<typeof calculateGeometry>,
  totalW: number,
  totalH: number,
) => {
  // Simulating Godot's Tres resource format for SpriteFrames is complex as text,
  // but we can export a JSON Dictionary that Godot can parse via JSON.parse().

  // In Godot, an AtlasTexture cuts a region.
  // We will provide data compatible with a custom Godot importer script.

  const godotFrames = anim.keyframes.map((kf) => {
    const sourceFrame = frames.find((f) => f.id === kf.sourceIndex);
    const hitboxes = sourceFrame?.hitboxes || [];
    // Fallback grid logic would go here if needed

    return {
      region: {
        x: sourceFrame?.x || 0,
        y: sourceFrame?.y || 0,
        w: sourceFrame?.w || 0,
        h: sourceFrame?.h || 0,
      },
      offset: {
        x: (sourceFrame?.w || 0) * (kf.pivotX - 0.5),
        y: (sourceFrame?.h || 0) * (kf.pivotY - 0.5),
      },
      duration: 1.0,
      hitboxes: hitboxes, // Custom data for Godot
    };
  });

  return JSON.stringify(
    {
      resource_type: "SpriteFrames",
      anim_name: anim.name,
      fps: anim.fps,
      loop: anim.loop,
      texture_size: { w: totalW, h: totalH },
      frames: godotFrames,
    },
    null,
    2,
  );
};
