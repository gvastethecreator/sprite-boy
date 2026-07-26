import React from "react";
import { AppMode, type TemplateConfig } from "../../types";
import {
  Monitor,
  Image as ImageIcon,
  Grid3X3,
  Layout,
  Camera,
  PlusSquare,
  Layers,
  Film,
  Code2,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import SlicerTools from "../panels/left/SlicerTools";
import AnimationList from "../panels/left/AnimationList";
import NumberControl from "../common/NumberControl";
import { ColorControl } from "../toolcraft";
import { useProject } from "../../contexts/ProjectContext";

const SectionHeader = ({
  title,
  icon: Icon,
  colorClass = "text-textMuted",
  action,
}: {
  title: string;
  icon?: LucideIcon;
  colorClass?: string;
  action?: React.ReactNode;
}) => (
  <div className="flex h-10 shrink-0 select-none items-center justify-between border-b border-white/8 bg-panelHeader/95 px-3">
    <div className="flex items-center gap-2">
      {Icon && <Icon size={14} className={colorClass} aria-hidden="true" />}
      <span className="text-[11px] font-semibold tracking-wide text-textMain">{title}</span>
    </div>
    {action}
  </div>
);

const EXPORT_VIEW_OPTIONS = [
  { id: "full", label: "Full sheet", icon: ImageIcon },
  { id: "grid_only", label: "Grid only", icon: Grid3X3 },
  { id: "numbered", label: "Numbered", icon: Layout },
] as const satisfies readonly {
  readonly id: TemplateConfig["viewType"];
  readonly label: string;
  readonly icon: LucideIcon;
}[];

const ViewTools: React.FC = () => {
  const { templateConfig, setTemplateConfig, setExportModal } = useProject();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-panel-gradient">
      <SectionHeader title="Export view" icon={Monitor} />

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-2">
          <h3 className="studio-section-label">Layout</h3>
          <div className="space-y-1.5">
            {EXPORT_VIEW_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.id}
                aria-pressed={templateConfig.viewType === opt.id}
                onClick={() => setTemplateConfig({ ...templateConfig, viewType: opt.id })}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${templateConfig.viewType === opt.id ? "border-accent/40 bg-accent/10 text-textMain shadow-glow-sm" : "border-white/8 bg-black/20 text-textMuted hover:bg-white/5"}`}
              >
                <div className="flex items-center gap-2.5">
                  <opt.icon
                    size={14}
                    className={templateConfig.viewType === opt.id ? "text-textMain" : ""}
                    aria-hidden="true"
                  />
                  {opt.label}
                </div>
                {templateConfig.viewType === opt.id && (
                  <CheckCircle2 size={13} className="text-textMain" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 border-t border-white/6 pt-3">
          <h3 className="studio-section-label">Style</h3>
          <div className="space-y-3 rounded-md border border-white/8 bg-black/20 p-3 shadow-inner-depth">
            <div className="flex items-center justify-between">
              <span className="text-xs text-textMuted">Background</span>
              <ColorControl
                className="w-32"
                name="Background color"
                showLabel={false}
                hex={templateConfig.backgroundColor}
                onValueChange={({ hex }) =>
                  setTemplateConfig({ ...templateConfig, backgroundColor: hex.toLowerCase() })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-textMuted">Grid</span>
              <ColorControl
                className="w-32"
                name="Grid color"
                showLabel={false}
                hex={templateConfig.gridColor}
                onValueChange={({ hex }) =>
                  setTemplateConfig({ ...templateConfig, gridColor: hex.toLowerCase() })
                }
              />
            </div>
            <NumberControl
              label="Line"
              value={templateConfig.gridWidth || 1}
              onChange={(v) => setTemplateConfig({ ...templateConfig, gridWidth: v })}
              min={1}
              max={10}
              labelClassName="w-16"
            />
          </div>
        </div>

        <div className="space-y-2 border-t border-white/6 pt-3">
          <h3 className="studio-section-label">Exports</h3>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => setExportModal({ isOpen: true, type: "zip" })}
              className="flex w-full items-center gap-2.5 rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-textMain transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Layers size={14} className="text-textMuted" aria-hidden="true" /> PNG sequence (.zip)
            </button>
            <button
              type="button"
              onClick={() => setExportModal({ isOpen: true, type: "gif" })}
              className="flex w-full items-center gap-2.5 rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-textMain transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Film size={14} className="text-textMuted" aria-hidden="true" /> Animation (.gif)
            </button>
            <button
              type="button"
              onClick={() => setExportModal({ isOpen: true, type: "code" })}
              className="flex w-full items-center gap-2.5 rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-textMain transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Code2 size={14} className="text-textMuted" aria-hidden="true" /> Animation data
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-white/8 bg-surface/40 p-3">
        <button
          type="button"
          data-studio-action="export-snapshot"
          onClick={() => setExportModal({ isOpen: true, type: "png" })}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent py-2.5 text-xs font-semibold text-white shadow-glow transition-colors hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          <Camera size={15} aria-hidden="true" /> Snapshot PNG
        </button>
      </div>
    </div>
  );
};

interface BuildToolsProps {
  readonly isSliceWorkspace: boolean;
  readonly irregularTools?: React.ReactNode;
}

const BuildTools: React.FC<BuildToolsProps> = ({ isSliceWorkspace, irregularTools }) => {
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
  } = useProject();

  const hasWorkspace = !!builderCanvas || !!slicerImage;
  const selectedFrame = selectedIndex !== null ? frames[selectedIndex] : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!hasWorkspace ? (
            <div className="animate-fade-in p-3">
              <div className="space-y-2 rounded-md border border-white/8 bg-surface/50 p-4 text-center">
                <PlusSquare size={22} className="mx-auto text-textMuted opacity-70" />
                <p className="text-[11px] font-medium text-textMuted">No source</p>
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
                showLegacyGridControls={!isSliceWorkspace}
                showLegacySliceControls={!isSliceWorkspace}
              />

              {isSliceWorkspace ? irregularTools : null}

            </>
        )}
      </div>
    </div>
  );
};

interface LeftSidebarProps {
  readonly isSliceWorkspace?: boolean;
  readonly irregularTools?: React.ReactNode;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({ isSliceWorkspace = false, irregularTools }) => {
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
      <BuildTools isSliceWorkspace={isSliceWorkspace} irregularTools={irregularTools} />
    </aside>
  );
};

export default LeftSidebar;
