
import { AppMode } from './enums';
import { ImageMeta, FrameData, BuilderAsset, SpriteAnimation, SlotData } from './core';
import { GridConfig, TemplateConfig, OnionSkinConfig } from './config';

export interface ViewportState {
  scale: number;
  offset: { x: number; y: number };
}

export interface SidebarProps {
  currentMode: AppMode;
  gridConfig?: GridConfig;
  setGridConfig?: (config: GridConfig) => void;
  imageMeta?: ImageMeta | null;
  frames?: FrameData[];
  selectedFrame?: FrameData | null;
  selectedFrameIndex?: number | null;
  onSelectFrame?: (index: number | null) => void;
  onUpdateFrame?: (id: number, data: Partial<FrameData>) => void;
  onDeleteFrame?: (index: number) => void;
  onDuplicateFrame?: (id: number) => void;
  onToggleFrameVisibility?: (id: number) => void; 
  builderAssets?: BuilderAsset[];
  onAddAsset?: (file: File) => void;
  onDeleteAsset?: (id: string) => void;
  onDragStartAsset?: (assetId: string) => void;
  onReorderAssets?: (fromIndex: number, toIndex: number) => void;
  animations?: SpriteAnimation[];
  activeAnimationId?: string | null;
  onAddAnimation?: () => void;
  onSelectAnimation?: (id: string | null) => void;
  onDeleteAnimation?: (id: string) => void;
  onDuplicateAnimation?: (id: string) => void;
  templateConfig?: TemplateConfig;
  setTemplateConfig?: (config: TemplateConfig) => void;
  onDownloadSnapshot?: () => void;
  onAutoSlice?: () => void;
  onRemoveBackground?: (color: string, tolerance: number, softness: number) => void; 
  onPreviewBackground?: (color: string, tolerance: number, softness: number) => void; 
  onCancelPreview?: () => void;
  isEyedropperActive?: boolean;
  setIsEyedropperActive?: (active: boolean) => void;
  isMagicWandActive?: boolean;
  setIsMagicWandActive?: (active: boolean) => void;
  eyedropperColor?: string | null;
  isLoading?: boolean;
  onFrameToAsset?: (frameId: number) => void;
  onSyncGridConfig?: () => void;
  
  builderSlots?: Record<number, SlotData>;
  builderLayoutMode?: string;
  onSetBuilderLayoutMode?: (mode: any) => void;
}

export interface RightSidebarProps {
  currentMode?: AppMode;
  imageMeta?: ImageMeta | null;
  frames?: FrameData[];
  selectedFrame?: FrameData | null;
  selectedFrameIndex?: number | null;
  onSelectFrame?: (index: number | null) => void;
  onUpdateFrame?: (id: number, data: Partial<FrameData>) => void;
  onUpdateFrameEphemeral?: (id: number, data: Partial<FrameData>) => void;
  onDeleteFrame?: (index: number) => void;
  onDuplicateFrame?: (id: number) => void; 
  onToggleFrameVisibility?: (id: number) => void; 
  onFrameToAsset?: (id: number) => void;
  builderCanvas?: BuilderCanvasSize | null;
  onCreateCanvas?: (w: number, h: number) => void;
  selectedSlotIndex?: number | null;
  builderSlots?: Record<number, SlotData>;
  gridConfig?: GridConfig;
  setGridConfig?: (config: GridConfig) => void;
  builderAssets?: BuilderAsset[];
  onAddAsset?: (file: File) => void;
  onDeleteAsset?: (id: string) => void;
  onUpdateSlot?: (index: number, data: SlotData | null) => void;
  activeAnimation?: SpriteAnimation | null;
  onUpdateAnimation?: (id: string, data: Partial<SpriteAnimation>) => void;
  selectedKeyframeIndex?: number | null;
  onUpdateKeyframe?: (index: number, data: Partial<Keyframe>) => void;
  onDeleteKeyframe?: (index: number) => void;
  onDuplicateKeyframe?: (index: number) => void;
  onionSkin?: OnionSkinConfig;
  setOnionSkin?: (config: OnionSkinConfig) => void;
  templateConfig?: TemplateConfig;
  setTemplateConfig?: (config: TemplateConfig) => void;
  genPanel?: GenerationPanelState;
  setGenPanel?: (state: GenerationPanelState) => void;
  currentAspectRatio?: string;
  onSetAspectRatio?: (ratio: string) => void;
}

export interface BuilderCanvasSize {
  width: number;
  height: number;
}

export type ExportType = 'png' | 'code' | 'zip' | 'gif' | null;
export type CodeFormat = 'json_generic' | 'phaser' | 'godot' | 'unity_json';

export interface ExportModalState {
  isOpen: boolean;
  type: ExportType;
  animationId?: string;
}

export interface GenerationModalState {
  isOpen: boolean;
  targetSlotIndex: number | null;
  contextAssetId?: string;
}

export interface GenerationContextSlot {
  id: number;
  type: 'asset' | 'keyframe' | 'slot' | 'frame';
  dataId: string;
  previewSrc: string;
}

export type AIModelId = 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image' | 'imagen-4.0-generate-001';
export type AIGenerationMode = 'new_image' | 'variation' | 'inbetween' | 'edit_context' | 'full_sheet';

export interface GenerationPanelState {
    model: AIModelId;
    prompt: string;
    mode: AIGenerationMode;
    contextSlots: (GenerationContextSlot | null)[];
}

export interface ToastData {
    id: string;
    msg: string;
    type: 'success' | 'error' | 'info';
}

export interface CanvasHandle {
  exportSnapshot: (includeGrid: boolean) => Promise<Blob | null>;
  exportFrame: (frameId: number) => Promise<string | null>;
  resetView: () => void;
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface SnappingGuide {
    type: 'vertical' | 'horizontal';
    position: number;
    start: number;
    end: number;
}

export interface CommandPaletteItem {
    id: string;
    label: string;
    icon?: any;
    shortcut?: string[];
    action: () => void;
    category: 'General' | 'Edit' | 'View' | 'Tools' | 'AI';
}

export interface ContextMenuItem {
    label: string;
    icon?: any;
    action: () => void;
    danger?: boolean;
    shortcut?: string;
}

export interface ContextMenuState {
    isOpen: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}
