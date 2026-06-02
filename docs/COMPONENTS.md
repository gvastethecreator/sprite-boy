# Components Guide - SpriteBoy Studio

This document breaks down the user interface structure and the responsibility of each component.

## Main Hierarchy

```
App
└── AppLayout (Main layout, CSS Grid/Flex)
    ├── Header (Top bar)
    ├── LeftSidebar (Tools, Library, Animations)
    ├── CanvasArea (Central viewport, <canvas>)
    ├── Timeline (Lower sequencer)
    ├── RightSidebar (Properties, Inspector)
    └── Modals (Export, Settings, Help, Generation, Analysis, Command Palette)
```

## Component Descriptions

### 1. `AppLayout.tsx`

- **Responsibility:** Main orchestrator. Receives the `controller` and distributes state and functions to children.
- **Layout:** Manages responsive panel layout and modal dialogs.

### 2. `CanvasArea.tsx`

- **Responsibility:** Handles direct interaction with the workspace.
- **Features:**
  - Contains the `<canvas>` element.
  - Captures mouse (Drag, Drop, Click) and keyboard events.
  - Implements "Camera" logic (Zoom, Pan).
  - Translates screen coordinates to world coordinates (World Space).
  - Calls `CanvasRenderer` to draw.

### 3. `LeftSidebar.tsx`

Changes its content dynamically based on the current `AppMode`.

- **Builder tab (default):** Tools panel (Grid config, Auto-slice, Magic wand) + AI Creator panel.
- **Animation tab:** Sequence panel with the list of animations.
- **Template/View tab:** Presentation panel with export options (Consolidated sheet, Reference grid, Indexed view), aesthetics (background, grid color), and master exports (PNG zip, GIF).

### 4. `RightSidebar.tsx`

Acts as a "Properties Inspector". Shows contextual information based on the current selection.

- **If a Frame is selected:** Shows X, Y, W, H and frame tools.
- **If a Hitbox is selected:** Shows Tag, Type, Dimensions.
- **If an Animation is active:** Shows name, FPS, Loop, and current Keyframe properties (Pivot, rotation, scale, opacity).
- **If a Builder Slot is selected:** Shows image adjustments (Fit/Fill, Flip, Offset, rotation).

### 5. `Timeline.tsx`

- **Responsibility:** Visualization and manipulation of the animation sequence.
- **Features:**
  - Horizontal list of frames.
  - Drag & drop to reorder (using the native HTML5 DnD API).
  - Playback controls (Play, Pause, Step).
  - "Tray" (drawer) deployable to add new frames from the available source.

### 6. `Header.tsx`

- **Responsibility:** Global navigation and file-level actions.
- **Controls:** Mode selector (Build, Animate, View), Undo/Redo, Open/Save Project, Settings, Help, Export.

### 7. Modals

- **`ExportModal.tsx`**: Code generator and PNG download. Shows a real-time preview of the generated code.
- **`SettingsModal.tsx`**: User preferences (Theme, Accent color, UI density).
- **`HelpModal.tsx`**: Keyboard shortcut reference.
- **`GenerationModal.tsx`**: AI generation flow.
- **`AnalysisModal.tsx`**: AI-powered sprite-sheet analysis report.
- **`CommandPalette.tsx`**: Quick command launcher.

## Reusable UI Components

- **`NumberControl.tsx`**: Advanced numeric input. Allows dragging the label to scrub the value, arrow keys, or typing directly. Supports optional sliders.
- **`PanelComponents.tsx`**: Small primitives used by the side panels (`Section`, `SectionHeader`, `PropRow`, `TextInput`, `Checkbox`).
