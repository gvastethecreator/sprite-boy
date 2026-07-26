import React from "react";
import {
  X,
  Palette,
  Monitor,
  Save,
  HelpCircle,
  Volume2,
  Magnet,
  Tag,
} from "lucide-react";
import type { FrameLabelConfig, FrameLabelPosition, UserPreferences } from "../../types";
import { ColorControl, SegmentedControl, SelectControl, SliderControl } from "../toolcraft";
import { StudioDialog } from "../studio/StudioDialog";
import { ControlBridgeSettings } from "../../features/control/ControlBridgeSettings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onUpdatePreferences: (newPrefs: UserPreferences) => void;
}

const COLORS = [
  { name: "Indigo", value: "99 102 241" },
  { name: "Blue", value: "15 100 210" },
  { name: "Purple", value: "139 92 246" },
  { name: "Green", value: "34 197 94" },
  { name: "Orange", value: "249 115 22" },
  { name: "Red", value: "239 68 68" },
];

const LABEL_COLORS = [
  { name: "Blue", value: "#3b82f6", class: "bg-blue-500" },
  { name: "Red", value: "#ef4444", class: "bg-red-500" },
  { name: "Green", value: "#22c55e", class: "bg-green-500" },
  { name: "Orange", value: "#f97316", class: "bg-orange-500" },
  { name: "Purple", value: "#a855f7", class: "bg-purple-500" },
  { name: "Black", value: "#18181b", class: "bg-zinc-900" },
];

const POSITIONS: { value: FrameLabelPosition; label: string }[] = [
  { value: "outside-top", label: "Outside Top" },
  { value: "inside-top-left", label: "Inside Top-Left" },
  { value: "inside-top-right", label: "Inside Top-Right" },
  { value: "inside-bottom-left", label: "Inside Bottom-Left" },
  { value: "inside-bottom-right", label: "Inside Bottom-Right" },
  { value: "center", label: "Center" },
];

type BooleanPreferenceKey = "autoSaveGrid" | "soundEnabled" | "showTooltips" | "snapEnabled";

const SYSTEM_PREFERENCES = [
  { label: "Auto-Save Grid", sub: "Preserve grid settings", key: "autoSaveGrid", icon: Save },
  { label: "Sound Effects", sub: "UI feedback audio", key: "soundEnabled", icon: Volume2 },
  { label: "Show Tooltips", sub: "Helper hints", key: "showTooltips", icon: HelpCircle },
  { label: "Smart Snapping", sub: "Align to objects", key: "snapEnabled", icon: Magnet },
] as const satisfies readonly {
  readonly label: string;
  readonly sub: string;
  readonly key: BooleanPreferenceKey;
  readonly icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;
}[];

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  preferences,
  onUpdatePreferences,
}) => {
  const updateLabel = <Key extends keyof FrameLabelConfig,>(
    key: Key,
    value: FrameLabelConfig[Key],
  ) => {
    onUpdatePreferences({
      ...preferences,
      frameLabel: { ...preferences.frameLabel, [key]: value },
    });
  };

  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="studio-settings-title"
      backdropClassName="items-center bg-black/80 pt-4"
      panelClassName="max-w-lg border-border shadow-modal"
    >
        <div className="flex items-center justify-between border-b border-border bg-panelHeader px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="studio-settings-title" className="text-base font-bold text-textMain">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="custom-scrollbar space-y-6 overflow-y-auto bg-app p-4 sm:space-y-8 sm:p-6">
          <section>
            <h3 className="studio-section-label mb-3 flex items-center gap-2">
              <Palette size={12} aria-hidden="true" /> Appearance
            </h3>
            <div className="space-y-4">
              <SegmentedControl
                name="Theme"
                value={preferences.theme}
                options={[
                  { label: "Dark", value: "dark" },
                  { label: "Light", value: "light" },
                ]}
                onValueChange={(theme) => onUpdatePreferences({
                  ...preferences,
                  theme: theme as UserPreferences["theme"],
                })}
              />
              <SegmentedControl
                name="Accent color"
                value={preferences.accentColor}
                variant="dots"
                className="[&_[role=radiogroup]]:grid-flow-row [&_[role=radiogroup]]:grid-cols-3"
                options={COLORS.map((color) => ({
                  label: color.name,
                  value: color.value,
                  indicatorColor: `rgb(${color.value})`,
                }))}
                onValueChange={(accentColor) => onUpdatePreferences({ ...preferences, accentColor })}
              />
            </div>
          </section>

          <section className="border-t border-border/20 pt-6">
            <h3 className="studio-section-label mb-4 flex items-center gap-2">
              <Tag size={14} aria-hidden="true" /> Frame Labels
            </h3>
            <div className="space-y-4 rounded-lg border border-border/50 bg-surface/30 p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences.frameLabel.visible}
                  onChange={(e) => updateLabel("visible", e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-input text-accent"
                />
                <span className="text-sm font-medium text-textMain">Show Frame Indices</span>
              </label>

              <fieldset
                disabled={!preferences.frameLabel.visible}
                aria-describedby={!preferences.frameLabel.visible ? "frame-label-controls-state" : undefined}
                className={`space-y-5 transition-opacity ${preferences.frameLabel.visible ? "opacity-100" : "opacity-45"}`}
              >
                <legend className="sr-only">Frame label options</legend>
                {!preferences.frameLabel.visible ? (
                  <p id="frame-label-controls-state" className="text-[11px] text-textMuted">
                    Turn on frame indices to edit these options.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SelectControl
                    name="Position"
                    disabled={!preferences.frameLabel.visible}
                    value={preferences.frameLabel.position}
                    options={POSITIONS}
                    onValueChange={(position) => updateLabel(
                      "position",
                      position as FrameLabelPosition,
                    )}
                  />
                  <SliderControl
                    name="Font size"
                    disabled={!preferences.frameLabel.visible}
                    value={preferences.frameLabel.fontSize}
                    min={8}
                    max={40}
                    unit="px"
                    onValueChange={(fontSize) => updateLabel("fontSize", fontSize)}
                  />
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-textMuted">
                    Background color
                  </div>
                  <div role="group" aria-label="Frame label color presets" className="flex flex-wrap gap-2">
                    {LABEL_COLORS.map((c) => (
                      <button
                        type="button"
                        key={c.name}
                        aria-label={`${c.name} frame label color`}
                        aria-pressed={preferences.frameLabel.color === c.value}
                        onClick={() => updateLabel("color", c.value)}
                        className={`h-8 w-8 rounded-md border border-white/10 ${c.class} transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${preferences.frameLabel.color === c.value ? "ring-2 ring-white ring-offset-1 ring-offset-black" : ""}`}
                      />
                    ))}
                    <ColorControl
                      className="min-w-36 flex-1"
                      name="Frame label color"
                      disabled={!preferences.frameLabel.visible}
                      showLabel={false}
                      hex={preferences.frameLabel.color}
                      onValueChange={({ hex }) => updateLabel("color", hex.toLowerCase())}
                    />
                  </div>
                </div>

                <div className="pt-1">
                  <SliderControl
                    name="Opacity"
                    disabled={!preferences.frameLabel.visible}
                    value={preferences.frameLabel.opacity}
                    min={0}
                    max={1}
                    step={0.1}
                    onValueChange={(opacity) => updateLabel("opacity", opacity)}
                  />
                </div>
              </fieldset>
            </div>
          </section>

          <section className="border-t border-border/20 pt-6">
            <h3 className="studio-section-label mb-4 flex items-center gap-2">
              <Monitor size={14} aria-hidden="true" /> System
            </h3>
            <div className="space-y-3">
              {SYSTEM_PREFERENCES.map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-surface/30 hover:bg-surface/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <item.icon size={16} className="text-textMuted" aria-hidden="true" />
                    <div>
                      <span className="text-sm text-textMain block font-medium">{item.label}</span>
                      <span className="text-xs text-textMuted block">{item.sub}</span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences[item.key]}
                    onChange={(e) =>
                      onUpdatePreferences({ ...preferences, [item.key]: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-border bg-input text-accent"
                  />
                </label>
              ))}
              {preferences.snapEnabled && (
                <div className="ml-4 border-l-2 border-border/30 pl-4">
                  <SliderControl
                    name="Snap threshold"
                    value={preferences.snapThreshold}
                    min={1}
                    max={50}
                    unit="px"
                    onValueChange={(snapThreshold) => onUpdatePreferences({
                      ...preferences,
                      snapThreshold,
                    })}
                  />
                </div>
              )}
            </div>
          </section>

          <ControlBridgeSettings />
        </div>
        <div className="flex justify-end border-t border-border bg-panel p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md bg-textMain px-6 py-2 font-semibold text-app shadow-depth-sm hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel sm:w-auto"
          >
            Done
          </button>
        </div>
    </StudioDialog>
  );
};

export default SettingsModal;
