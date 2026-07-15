import React, { useState } from "react";
import { AppMode } from "../../types";
import {
  Monitor,
  Image as ImageIcon,
  Grid3X3,
  Layout,
  Camera,
  PlusSquare,
  Layers,
  Film,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import SlicerTools from "../panels/left/SlicerTools";
import BgRemovalTool from "../panels/left/BgRemovalTool";
import AnimationList from "../panels/left/AnimationList";
import GenerationPanel from "../panels/right/GenerationPanel";
import NumberControl from "../common/NumberControl";
import { useProject } from "../../contexts/ProjectContext";

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
  <div className="h-12 bg-white/5 flex items-center justify-between px-4 shrink-0 select-none border-b border-white/5 backdrop-blur-md">
    <div className="flex items-center gap-2">
      {Icon && <Icon size={18} className={colorClass} />}
      <span className="text-sm font-bold text-textMain tracking-wide">{title}</span>
    </div>
    {action}
  </div>
);

const ViewTools: React.FC = () => {
  const { templateConfig, setTemplateConfig, setExportModal } = useProject();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-panel-gradient">
      <SectionHeader title="Presentation" icon={Monitor} colorClass="text-blue-400" />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
        <div className="space-y-3">
          <label className="text-[10px] font-bold text-textMuted uppercase tracking-widest">
            Layout Style
          </label>
          <div className="space-y-2">
            {[
              { id: "full", label: "Consolidated Sheet", icon: ImageIcon },
              { id: "grid_only", label: "Reference Grid", icon: Grid3X3 },
              { id: "numbered", label: "Indexed View", icon: Layout },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTemplateConfig({ ...templateConfig, viewType: opt.id as any })}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-medium transition-all duration-200 border ${templateConfig.viewType === opt.id ? "bg-accent/10 border-accent/40 text-textMain shadow-glow-sm" : "bg-black/20 border-white/5 text-textMuted hover:bg-white/5"}`}
              >
                <div className="flex items-center gap-3">
                  <opt.icon
                    size={16}
                    className={templateConfig.viewType === opt.id ? "text-accent" : ""}
                  />
                  {opt.label}
                </div>
                {templateConfig.viewType === opt.id && (
                  <CheckCircle2 size={14} className="text-accent" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-white/5">
          <label className="text-[10px] font-bold text-textMuted uppercase tracking-widest">
            Aesthetics
          </label>
          <div className="space-y-4 bg-black/20 p-4 rounded-xl border border-white/5 shadow-inner-depth">
            <div className="flex items-center justify-between">
              <span className="text-xs text-textMuted">Background</span>
              <input
                type="color"
                value={templateConfig.backgroundColor}
                onChange={(e) =>
                  setTemplateConfig({ ...templateConfig, backgroundColor: e.target.value })
                }
                className="w-8 h-8 rounded-lg border-0 p-0 overflow-hidden cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-textMuted">Grid Color</span>
              <input
                type="color"
                value={templateConfig.gridColor}
                onChange={(e) =>
                  setTemplateConfig({ ...templateConfig, gridColor: e.target.value })
                }
                className="w-8 h-8 rounded-lg border-0 p-0 overflow-hidden cursor-pointer"
              />
            </div>
            <NumberControl
              label="Line Width"
              value={templateConfig.gridWidth || 1}
              onChange={(v) => setTemplateConfig({ ...templateConfig, gridWidth: v })}
              min={1}
              max={10}
              labelClassName="w-20"
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-white/5">
          <label className="text-[10px] font-bold text-textMuted uppercase tracking-widest">
            Master Exports
          </label>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => setExportModal({ isOpen: true, type: "zip" })}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-textMain transition-all active:scale-95 shadow-3d"
            >
              <Layers size={16} className="text-blue-400" /> Individual PNGs (.zip)
            </button>
            <button
              onClick={() => setExportModal({ isOpen: true, type: "gif" })}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-textMain transition-all active:scale-95 shadow-3d"
            >
              <Film size={16} className="text-purple-400" /> Animation Sequence (.gif)
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 bg-surface/50 border-t border-white/10 backdrop-blur-md">
        <button
          type="button"
          data-studio-action="export-snapshot"
          onClick={() => setExportModal({ isOpen: true, type: "png" })}
          className="w-full py-4 bg-accent hover:bg-accentHover text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-glow active:scale-95 transition-all"
        >
          <Camera size={18} /> Download Snapshot (PNG)
        </button>
      </div>
    </div>
  );
};

const BuildTools: React.FC = () => {
  const {
    builderCanvas,
    slicerImage,
    currentMode,
    handleSyncGrid,
    handleAutoSlice,
    isLoading,
    isMagicWandActive,
    setIsMagicWandActive,
    wandTolerance,
    setWandTolerance,
    activeGrid,
    handleSetGridConfig,
    frames,
    selectedIndex,
    handleDuplicateFrame,
    handleFrameToAsset,
    handleRemoveBackground,
    handlePreviewBackground,
    handleCancelPreview,
    isPreviewActive,
    handleDropContextToAI,
    handleClearAIContext,
    handleRunAIProjectGen,
    isEyedropperActive,
    setIsEyedropperActive,
    eyedropperColor,
    genPanel,
    setGenPanel,
  } = useProject();

  const [leftActiveTab, setLeftActiveTab] = useState<"tools" | "ai">("tools");
  const hasWorkspace = !!builderCanvas || !!slicerImage;
  const hasSourceImage = !!slicerImage;
  const selectedFrame = selectedIndex !== null ? frames[selectedIndex] : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-1 p-1 bg-white/5 border-b border-white/5">
        <button
          onClick={() => setLeftActiveTab("tools")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${leftActiveTab === "tools" ? "bg-accent text-white" : "text-textMuted hover:bg-white/5"}`}
        >
          <Monitor size={12} /> Tools
        </button>
        <button
          onClick={() => setLeftActiveTab("ai")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${leftActiveTab === "ai" ? "bg-accent text-white" : "text-textMuted hover:bg-white/5"}`}
        >
          <Sparkles size={12} /> AI Creator
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {leftActiveTab === "tools" ? (
          !hasWorkspace ? (
            <div className="p-4 animate-fade-in">
              <div className="bg-accent/10 border border-accent/20 p-6 rounded-xl text-center space-y-3">
                <PlusSquare size={32} className="mx-auto text-accent opacity-50" />
                <p className="text-xs text-textMuted leading-relaxed font-medium">
                  No Workspace Active.
                  <br />
                  Import an image or initialize a blank canvas.
                </p>
              </div>
            </div>
          ) : (
            <>
              <SlicerTools
                currentMode={currentMode}
                onSyncGridConfig={handleSyncGrid}
                onAutoSlice={handleAutoSlice}
                isLoading={isLoading}
                imageMeta={slicerImage}
                isMagicWandActive={isMagicWandActive}
                setIsMagicWandActive={setIsMagicWandActive}
                wandTolerance={wandTolerance}
                setWandTolerance={setWandTolerance}
                selectedFrame={selectedFrame}
                onDuplicateFrame={handleDuplicateFrame}
                onFrameToAsset={handleFrameToAsset}
                gridConfig={activeGrid}
                setGridConfig={handleSetGridConfig}
              />

              <BgRemovalTool
                onRemoveBackground={handleRemoveBackground}
                onPreviewBackground={handlePreviewBackground}
                onCancelPreview={handleCancelPreview}
                isPreviewActive={isPreviewActive}
                isEyedropperActive={isEyedropperActive}
                setIsEyedropperActive={setIsEyedropperActive}
                eyedropperColor={eyedropperColor}
                hasImage={hasSourceImage}
              />
            </>
          )
        ) : (
          <div className="animate-fade-in h-full">
            <GenerationPanel
              state={genPanel}
              setState={setGenPanel}
              onDrop={handleDropContextToAI}
              onClear={handleClearAIContext}
              onRun={handleRunAIProjectGen}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const LeftSidebar: React.FC = () => {
  const {
    currentMode,
    animations,
    activeAnimationId,
    handleAddAnimation,
    setActiveAnimationId,
    handleDeleteAnimation,
    handleDuplicateAnimation,
  } = useProject();

  if (currentMode === AppMode.TEMPLATE) return <ViewTools />;

  if (currentMode === AppMode.ANIMATION)
    return (
      <aside className="h-full flex flex-col overflow-hidden panel-gradient">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="shrink-0">
            <SectionHeader title="Sequence" icon={Layout} />
            <AnimationList
              animations={animations}
              activeAnimationId={activeAnimationId}
              onAddAnimation={handleAddAnimation}
              onSelectAnimation={setActiveAnimationId}
              onDeleteAnimation={handleDeleteAnimation}
              onDuplicateAnimation={handleDuplicateAnimation}
            />
          </div>
        </div>
      </aside>
    );

  return (
    <aside className="h-full flex flex-col overflow-hidden panel-gradient">
      <BuildTools />
    </aside>
  );
};

export default LeftSidebar;
