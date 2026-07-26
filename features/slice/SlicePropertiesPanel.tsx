import { useState } from "react";
import { SegmentedControl } from "../../components/toolcraft";
import LocalModelPanel from "./backgroundRemoval/LocalModelPanel";
import SliceGridInspector from "./grid/SliceGridInspector";
import type { SliceGridController } from "./grid/useSliceGridController";

export function SlicePropertiesPanel({ controller }: { readonly controller: SliceGridController }) {
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
        {tab === "models" ? <LocalModelPanel /> : <SliceGridInspector controller={controller} />}
      </div>
    </div>
  );
}

export default SlicePropertiesPanel;
