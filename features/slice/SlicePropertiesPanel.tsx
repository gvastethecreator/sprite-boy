import { useState } from "react";
import { SegmentedControl } from "../../components/toolcraft";
import type { AssetRepository } from "../../core/assets";
import type { ProjectStore } from "../../core/stores";
import LocalModelPanel from "./backgroundRemoval/LocalModelPanel";
import SliceGridInspector from "./grid/SliceGridInspector";
import type { SliceGridController } from "./grid/useSliceGridController";

export interface SlicePropertiesPanelProps {
  readonly controller: SliceGridController;
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly onCleanupDebtChange?: (projectId: string, assetId: string, pending: boolean) => void;
}

export function SlicePropertiesPanel({ assets, controller, onCleanupDebtChange, store }: SlicePropertiesPanelProps) {
  const [tab, setTab] = useState("grid");
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="shrink-0 border-b border-white/8 p-2">
        <SegmentedControl
          name="Slice properties"
          options={[
            { value: "grid", label: "Grid" },
            { value: "models", label: "Models" },
          ]}
          value={tab}
          onValueChange={setTab}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "models"
          ? <LocalModelPanel assets={assets} store={store} onCleanupDebtChange={onCleanupDebtChange} />
          : <SliceGridInspector controller={controller} />}
      </div>
    </div>
  );
}

export default SlicePropertiesPanel;
