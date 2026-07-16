import React, { useState } from "react";
import { AppMode, GridConfig, FrameData } from "../../../types";
import {
  Grid3X3,
  Scissors,
  Wand2,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Monitor,
} from "lucide-react";
import NumberControl from "../../common/NumberControl";

interface SlicerToolsProps {
  currentMode: AppMode;
  onSyncGridConfig?: () => void;
  onAutoSlice?: () => void;
  isLoading?: boolean;
  imageMeta?: any;
  isMagicWandActive?: boolean;
  setIsMagicWandActive?: (active: boolean) => void;
  wandTolerance?: number;
  setWandTolerance?: (tol: number) => void;
  selectedFrame?: FrameData | null;
  onDuplicateFrame?: (id: number) => void;
  onFrameToAsset?: (id: number) => void;
  gridConfig?: GridConfig;
  setGridConfig?: (config: GridConfig) => void;
  /** Legacy project-grid editor. Slice owns its replacement in SliceGridInspector. */
  showLegacyGridControls?: boolean;
}

const SectionHeader = ({
  title,
  icon: Icon,
  colorClass = "text-accent",
  action,
}: {
  title: string;
  icon?: any;
  colorClass?: string;
  action?: React.ReactNode;
}) => (
  <div className="h-10 bg-white/5 flex items-center justify-between px-4 shrink-0 select-none border-b border-white/5 backdrop-blur-md">
    <div className="flex items-center gap-2">
      {Icon && <Icon size={16} className={colorClass} />}
      <span className="text-[11px] font-bold text-textMuted uppercase tracking-wider">{title}</span>
    </div>
    {action}
  </div>
);

const SlicerTools: React.FC<SlicerToolsProps> = (props) => {
  const [isGridOpen, setIsGridOpen] = useState(true);
  const hasImageOrCanvas = !!props.imageMeta;
  const isBuilder = props.currentMode === AppMode.BUILDER;

  return (
    <div className="shrink-0 flex flex-col border-b border-white/5 bg-panel-gradient">
      <SectionHeader
        title={isBuilder ? "Canvas Geometry" : "Slicing Strategy"}
        icon={isBuilder ? Monitor : Scissors}
      />

      <div className="p-4 space-y-5">
        {!isBuilder && (
          <div className="space-y-3">
            <button
              onClick={props.onAutoSlice}
              disabled={props.isLoading || !hasImageOrCanvas}
              className="w-full py-3 btn-primary rounded-xl text-xs font-bold flex items-center justify-center gap-2 superellipse disabled:opacity-50 disabled:grayscale transition-all active:scale-95"
            >
              <Wand2 size={16} className={props.isLoading ? "animate-spin" : ""} />
              {props.isLoading ? "Analyzing..." : "Auto-Detect Sprites"}
            </button>

            <div
              className={`border rounded-xl transition-all duration-300 overflow-hidden shadow-inner-depth ${props.isMagicWandActive ? "border-accent bg-accent/10" : "border-white/5 bg-black/20"}`}
            >
              <button
                onClick={() => props.setIsMagicWandActive?.(!props.isMagicWandActive)}
                className="w-full py-3 px-3 flex items-center justify-between text-xs font-medium text-textMain hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sparkles
                    size={14}
                    className={
                      props.isMagicWandActive ? "text-accent drop-shadow-md" : "text-textMuted"
                    }
                  />
                  Magic Wand
                </div>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${props.isMagicWandActive ? "bg-accent border-accent" : "border-white/20 bg-black/40"}`}
                >
                  {props.isMagicWandActive && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                </div>
              </button>
              {props.isMagicWandActive && props.setWandTolerance && (
                <div className="px-3 pb-3 pt-1 animate-fade-in border-t border-white/5 bg-black/20">
                  <NumberControl
                    label="Tolerance"
                    value={props.wandTolerance || 30}
                    onChange={props.setWandTolerance}
                    min={1}
                    max={100}
                    slider
                    labelClassName="w-16 text-[9px]"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {props.gridConfig && props.showLegacyGridControls !== false && (
          <div className="border border-white/5 rounded-xl bg-black/20 overflow-hidden shadow-inner-depth animate-slide-up">
            <button
              onClick={() => setIsGridOpen(!isGridOpen)}
              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex items-center gap-2">
                <Grid3X3 size={12} /> Grid Layout
              </span>
              {isGridOpen ? (
                <ChevronDown size={14} className="text-textMuted" />
              ) : (
                <ChevronRight size={14} className="text-textMuted" />
              )}
            </button>
            {isGridOpen && (
              <div className="p-4 space-y-6 animate-scale-in bg-black/20 shadow-inner-depth">
                <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                  <NumberControl
                    label="Rows"
                    value={props.gridConfig.rows}
                    onChange={(v) =>
                      props.setGridConfig?.({ ...props.gridConfig!, rows: Math.max(1, v) })
                    }
                    min={1}
                    max={64}
                    slider
                    labelClassName="w-10 text-[9px]"
                  />
                  <NumberControl
                    label="Cols"
                    value={props.gridConfig.cols}
                    onChange={(v) =>
                      props.setGridConfig?.({ ...props.gridConfig!, cols: Math.max(1, v) })
                    }
                    min={1}
                    max={64}
                    slider
                    labelClassName="w-10 text-[9px]"
                  />
                </div>

                <div className="space-y-6 pt-4 border-t border-white/5">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                    <NumberControl
                      label="Margin X"
                      value={props.gridConfig.marginX}
                      onChange={(v) => props.setGridConfig?.({ ...props.gridConfig!, marginX: v })}
                      min={0}
                      max={200}
                      slider
                      labelClassName="w-14 text-[9px]"
                    />
                    <NumberControl
                      label="Margin Y"
                      value={props.gridConfig.marginY}
                      onChange={(v) => props.setGridConfig?.({ ...props.gridConfig!, marginY: v })}
                      min={0}
                      max={200}
                      slider
                      labelClassName="w-14 text-[9px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                    <NumberControl
                      label="Cell Gap X"
                      value={props.gridConfig.paddingX}
                      onChange={(v) => props.setGridConfig?.({ ...props.gridConfig!, paddingX: v })}
                      min={0}
                      max={100}
                      slider
                      labelClassName="w-14 text-[9px]"
                    />
                    <NumberControl
                      label="Cell Gap Y"
                      value={props.gridConfig.paddingY}
                      onChange={(v) => props.setGridConfig?.({ ...props.gridConfig!, paddingY: v })}
                      min={0}
                      max={100}
                      slider
                      labelClassName="w-14 text-[9px]"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={props.onSyncGridConfig}
                    className="w-full py-2 bg-surface hover:bg-tool border border-white/5 rounded-lg text-[10px] font-bold text-textMuted hover:text-textMain transition-all"
                  >
                    Sync Grids
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SlicerTools;
