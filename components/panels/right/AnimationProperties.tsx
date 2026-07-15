import React from "react";
import {
  Film,
  Layers,
  Crosshair,
  Copy,
  Trash2,
  RotateCw,
  Ghost,
  Maximize,
} from "lucide-react";
import { SpriteAnimation, Keyframe, OnionSkinConfig } from "../../../types";
import NumberControl from "../../common/NumberControl";
import { SectionHeader, Section, PropRow, TextInput, Checkbox } from "../../common/PanelComponents";

interface AnimationPropertiesProps {
  animation: SpriteAnimation;
  keyframeIndex: number | null;
  onUpdateAnim: (id: string, data: Partial<SpriteAnimation>) => void;
  onUpdateKeyframe?: (index: number, data: Partial<Keyframe>) => void;
  onDeleteKeyframe?: (index: number) => void;
  onDuplicateKeyframe?: (index: number) => void;
  onionSkin?: OnionSkinConfig;
  setOnionSkin?: (config: OnionSkinConfig) => void;
}

const ORIGINS = [
  { label: "TL", x: 0, y: 0 },
  { label: "T", x: 0.5, y: 0 },
  { label: "TR", x: 1, y: 0 },
  { label: "L", x: 0, y: 0.5 },
  { label: "C", x: 0.5, y: 0.5 },
  { label: "R", x: 1, y: 0.5 },
  { label: "BL", x: 0, y: 1 },
  { label: "B", x: 0.5, y: 1 },
  { label: "BR", x: 1, y: 1 },
];

const AnimationProperties: React.FC<AnimationPropertiesProps> = (props) => {
  const activeKf =
    props.keyframeIndex !== null ? props.animation.keyframes[props.keyframeIndex] : null;

  return (
    <>
      <SectionHeader title="Sequence Config" icon={Film} colorClass="text-purple-400" />
      <Section>
        <PropRow label="Name">
          <TextInput
            value={props.animation.name}
            onChange={(e) => props.onUpdateAnim(props.animation.id, { name: e })}
          />
        </PropRow>
        <div className="h-1" />
        <NumberControl
          label="FPS"
          value={props.animation.fps}
          onChange={(v) => props.onUpdateAnim(props.animation.id, { fps: v })}
          min={1}
          max={60}
          unit="FPS"
          slider
        />
        <Checkbox
          label="Loop Playback"
          checked={props.animation.loop}
          onChange={(v) => props.onUpdateAnim(props.animation.id, { loop: v })}
        />
      </Section>

      {props.onionSkin && props.setOnionSkin && (
        <>
          <SectionHeader title="Onion Skin" icon={Layers} colorClass="text-orange-400" />
          <Section>
            <Checkbox
              label="Enable"
              checked={props.onionSkin.enabled}
              onChange={(v) => props.setOnionSkin!({ ...props.onionSkin!, enabled: v })}
            />
            {props.onionSkin.enabled && (
              <NumberControl
                label="Opacity"
                value={props.onionSkin.opacity}
                onChange={(v) => props.setOnionSkin!({ ...props.onionSkin!, opacity: v })}
                min={0}
                max={1}
                step={0.1}
                slider
              />
            )}
          </Section>
        </>
      )}

      <SectionHeader title="Keyframe Inspector" icon={Crosshair} colorClass="text-blue-400" />
      <Section>
        {activeKf ? (
          <div className="space-y-6">
            {/* Transform Origin Quick Selector */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider block">
                Transform Origin
              </label>
              <div className="grid grid-cols-3 gap-1 bg-black/20 p-1 rounded-lg border border-white/5">
                {ORIGINS.map((o) => (
                  <button
                    key={o.label}
                    onClick={() =>
                      props.onUpdateKeyframe?.(props.keyframeIndex!, { pivotX: o.x, pivotY: o.y })
                    }
                    className={`py-1 text-[9px] font-bold rounded transition-all ${activeKf.pivotX === o.x && activeKf.pivotY === o.y ? "bg-accent text-white shadow-sm" : "text-textMuted hover:bg-white/5 hover:text-textMain"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pivot Controls */}
            <div className="grid grid-cols-2 gap-3">
              <NumberControl
                label="Pivot X"
                value={activeKf.pivotX}
                onChange={(v) => props.onUpdateKeyframe?.(props.keyframeIndex!, { pivotX: v })}
                min={-2}
                max={2}
                step={0.01}
                labelClassName="w-12 text-[9px]"
              />
              <NumberControl
                label="Pivot Y"
                value={activeKf.pivotY}
                onChange={(v) => props.onUpdateKeyframe?.(props.keyframeIndex!, { pivotY: v })}
                min={-2}
                max={2}
                step={0.01}
                labelClassName="w-12 text-[9px]"
              />
            </div>

            {/* Rotation & Alpha */}
            <div className="pt-4 border-t border-white/5 space-y-4">
              <NumberControl
                icon={RotateCw}
                label="Rotate"
                value={activeKf.rotation || 0}
                onChange={(v) => props.onUpdateKeyframe?.(props.keyframeIndex!, { rotation: v })}
                min={-360}
                max={360}
                step={1}
                slider
                unit="°"
                labelClassName="w-12 text-[9px]"
              />
              <NumberControl
                icon={Ghost}
                label="Alpha"
                value={activeKf.opacity ?? 1}
                onChange={(v) => props.onUpdateKeyframe?.(props.keyframeIndex!, { opacity: v })}
                min={0}
                max={1}
                step={0.05}
                slider
                labelClassName="w-12 text-[9px]"
              />
            </div>

            {/* Scale */}
            <div className="pt-4 border-t border-white/5 space-y-4">
              <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex items-center gap-2">
                <Maximize size={12} /> Scaling
              </label>
              <div className="grid grid-cols-2 gap-3">
                <NumberControl
                  label="Scale X"
                  value={activeKf.scaleX ?? 1}
                  onChange={(v) => props.onUpdateKeyframe?.(props.keyframeIndex!, { scaleX: v })}
                  min={-10}
                  max={10}
                  step={0.1}
                  labelClassName="w-12 text-[9px]"
                />
                <NumberControl
                  label="Scale Y"
                  value={activeKf.scaleY ?? 1}
                  onChange={(v) => props.onUpdateKeyframe?.(props.keyframeIndex!, { scaleY: v })}
                  min={-10}
                  max={10}
                  step={0.1}
                  labelClassName="w-12 text-[9px]"
                />
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-white/5 grid grid-cols-2 gap-3">
              <button
                onClick={() => props.onDuplicateKeyframe?.(props.keyframeIndex!)}
                className="py-2.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg flex items-center justify-center gap-2 btn-3d text-textMain font-semibold"
              >
                <Copy size={14} /> Clone
              </button>
              <button
                onClick={() => props.onDeleteKeyframe?.(props.keyframeIndex!)}
                className="py-2.5 text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg flex items-center justify-center gap-2 btn-3d font-semibold"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-textMuted italic text-center py-10 opacity-40">
            Select a keyframe in timeline
          </div>
        )}
      </Section>
    </>
  );
};

export default AnimationProperties;
