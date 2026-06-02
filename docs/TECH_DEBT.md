# Technical Debt - SpriteBoy Studio

Tracking document for improvements. **All items have been resolved.**

---

## High Priority

### 1. `CanvasArea.tsx` - Monolithic component

**Resolved:** Extracted 3 composable hooks:

- `hooks/canvas/useCanvasMouse.ts` - mouse events (drag, zoom, pan)
- `hooks/canvas/useCanvasKeyboard.ts` - canvas keyboard shortcuts
- `hooks/canvas/useCanvasRenderLoop.ts` - requestAnimationFrame loop + image loading + resize

CanvasArea reduced from ~600 to ~160 lines.

### 2. `useProjectController.ts` - Centralized controller

**Resolved:** Extracted 2 additional hooks:

- `hooks/domains/useExportLogic.ts` - export logic (PNG, JSON, Phaser, Godot)
- `hooks/domains/usePersistence.ts` - IndexedDB persistence (save/load/delete)

Controller reduced ~200 lines.

### 3. Insufficient test coverage

**Resolved:** 25 new hook tests implemented:

- `useUndo.test.ts` - history, ephemeral updates, limits
- `useAnimationLogic.test.ts` - animation CRUD, playback
- `useSlicerLogic.test.ts` - grid config, sprite detection

~56 tests passing.

---

## Medium Priority

### 4. Web Worker without robust error handling

**Resolved:** Added 30s timeout to Worker promises, global `onerror` handler, and automatic Worker instance recreation in case of crash.

### 5. Potential Blob URL memory leaks

**Resolved:** Audited all image loading flows. Added `URL.revokeObjectURL()` in cleanup of `AppLayout.tsx` when changing images.

### 6. `renderUtils.ts` - Static class with minified code

**Resolved:** Expanded 4 ultra-compressed methods (`drawPivotMarker`, `drawCheckerboard`, `drawPixelGrid`, `drawFrameLabel`) + `renderDualView` + slicer tail section + grid-stroke block into a readable multi-line format.

### 7. Weak typing in `exportFormats.ts`

**Resolved:** Created `ExportFrameInfo` and `CollisionInfo` interfaces. Removed the only `any` from the file. Fixed `HitboxData` import.

### 8. Google Fonts via CDN

**Resolved:** Installed `@fontsource/archivo` and `@fontsource/jetbrains-mono`. Removed `<link>` CDN from `index.html`. Fonts imported in `index.tsx`.

---

## Low Priority

### 9. Migrate CSS animations to GSAP

**Resolved:** Created `hooks/useGSAPAnimations.ts` with `useModalEntrance()` and `useLogoPop()` hooks. Applied to 5 modals, Header logo, and ToastContainer. Removed obsolete CSS keyframes (`logo-pop`, `progress`).

### 10. `NumberControl` component - Accessibility

**Resolved:** Added `role="spinbutton"`, `aria-valuemin/max/now`, `aria-label` on input/buttons/slider. Added keyboard navigation (ArrowUp/Down) and `decrement()` function.

### 11. `components/` folder structure

**Resolved:** Reorganized 17 files into subdirectories:

```text
components/
├── layout/      # AppLayout, Header, LeftSidebar, RightSidebar
├── canvas/      # CanvasArea, CanvasToolbar, CanvasStatusBar
├── overlays/    # ExportModal, SettingsModal, HelpModal, AnalysisModal, GenerationModal, CommandPalette, ToastContainer
├── panels/      # left/ + right/ (no changes)
└── common/      # NumberControl, Timeline, PanelComponents
```

All imports updated. `tsc --noEmit` clean.

### 12. Inline documentation

**Resolved:** JSDoc added to the public API of ~20 hooks and ~25 utility exports (`algorithms`, `canvasMath`, `db`, `exportFormats`, `renderUtils`, `uiFeedback`, `defaultAssets`).

---

## Current Metrics

| Metric             | Value                      |
| ------------------ | -------------------------- |
| Unit tests         | ~57                        |
| TypeScript files   | ~45                        |
| Estimated coverage | ~35% (utils + hooks)       |
| Components         | 18 main + 9 panels         |
| Hooks              | 7 (4 core + 3 domain)      |
| Total estimated LOC| ~8000                      |
