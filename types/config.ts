export interface GridConfig {
  rows: number;
  cols: number;
  marginX: number;
  marginY: number;
  paddingX: number;
  paddingY: number;
}

export type FrameLabelPosition =
  | "outside-top"
  | "inside-top-left"
  | "inside-top-right"
  | "inside-bottom-left"
  | "inside-bottom-right"
  | "center";

export interface FrameLabelConfig {
  visible: boolean;
  fontSize: number;
  position: FrameLabelPosition;
  color: string;
  opacity: number;
}

export interface UserPreferences {
  theme: "dark" | "light";
  accentColor: string;
  uiDensity: "compact" | "comfortable";
  autoSaveGrid: boolean;
  showTooltips: boolean;
  defaultFps: number;
  soundEnabled: boolean;
  snapEnabled: boolean;
  snapThreshold: number;
  frameLabel: FrameLabelConfig;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "dark",
  accentColor: "0 0 0",
  uiDensity: "comfortable",
  autoSaveGrid: true,
  showTooltips: true,
  defaultFps: 12,
  soundEnabled: true,
  snapEnabled: true,
  snapThreshold: 10,
  frameLabel: {
    visible: true,
    fontSize: 12,
    position: "outside-top",
    color: "#3b82f6",
    opacity: 1.0,
  },
};

export interface TemplateConfig {
  viewType: "full" | "grid_only" | "numbered";
  showIndices: boolean;
  gridColor: string;
  gridWidth: number;
  backgroundColor: string;
}

export interface OnionSkinConfig {
  enabled: boolean;
  opacity: number;
  showHitboxes: boolean;
}
