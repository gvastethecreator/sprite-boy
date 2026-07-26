import { lazy, Suspense, useEffect, useState } from "react";
import { SegmentedControl } from "../../components/toolcraft";
import type { AssetRepository } from "../../core/assets";
import type { ProjectStore } from "../../core/stores";
import SliceGridInspector from "./grid/SliceGridInspector";
import SliceChromaControls from "./grid/SliceChromaControls";
import type { SliceGridController } from "./grid/useSliceGridController";

const LocalModelPanel = lazy(() => import("./backgroundRemoval/LocalModelPanel"));

export interface SlicePropertiesPanelProps {
  readonly controller: SliceGridController;
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly onCleanupDebtChange?: (projectId: string, assetId: string, pending: boolean) => void;
  readonly eyedropperActive?: boolean;
  readonly onEyedropperActiveChange?: (active: boolean) => void;
}

export function SlicePropertiesPanel({
  assets,
  controller,
  eyedropperActive,
  onCleanupDebtChange,
  onEyedropperActiveChange,
  store,
}: SlicePropertiesPanelProps) {
  const [tab, setTab] = useState("grid");
  const [backgroundMode, setBackgroundMode] = useState("color");
  useEffect(() => () => onEyedropperActiveChange?.(false), [onEyedropperActiveChange]);

  const selectTab = (nextTab: string) => {
    setTab(nextTab);
    if (nextTab !== "background") onEyedropperActiveChange?.(false);
  };
  const selectBackgroundMode = (nextMode: string) => {
    setBackgroundMode(nextMode);
    if (nextMode !== "color") onEyedropperActiveChange?.(false);
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="shrink-0 border-b border-white/8 p-2">
        <SegmentedControl
          name="Slice properties"
          options={[
            { value: "grid", label: "Grid" },
            { value: "background", label: "Background" },
          ]}
          value={tab}
          onValueChange={selectTab}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "background"
          ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-white/8 p-2">
                  <SegmentedControl
                    name="Background removal method"
                    options={[
                      { value: "color", label: "Color key" },
                      { value: "models", label: "AI model" },
                    ]}
                    value={backgroundMode}
                    onValueChange={selectBackgroundMode}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {backgroundMode === "models" ? (
                    <Suspense fallback={(
                      <div className="p-3 text-xs text-textMuted" role="status">
                        Loading models…
                      </div>
                    )}>
                      <LocalModelPanel assets={assets} store={store} onCleanupDebtChange={onCleanupDebtChange} />
                    </Suspense>
                  ) : (
                    <SliceChromaControls
                      controller={controller}
                      eyedropperActive={eyedropperActive}
                      onEyedropperActiveChange={onEyedropperActiveChange}
                    />
                  )}
                </div>
              </div>
            )
          : (
              <SliceGridInspector
                controller={controller}
                showChromaControls={false}
              />
            )}
      </div>
    </div>
  );
}

export default SlicePropertiesPanel;
