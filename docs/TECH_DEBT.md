# ✅ Deuda Técnica – SpriteBoy Studio

Documento de seguimiento de mejoras. **Todos los ítems han sido resueltos.**

---

## 🔴 Prioridad Alta

### 1. ✅ `CanvasArea.tsx` – Componente monolítico

**Resuelto:** Extraídos 3 hooks composables:

- `hooks/canvas/useCanvasMouse.ts` – eventos de ratón (drag, zoom, pan)
- `hooks/canvas/useCanvasKeyboard.ts` – atajos de teclado del canvas
- `hooks/canvas/useCanvasRenderLoop.ts` – requestAnimationFrame loop + carga de imágenes + resize

CanvasArea reducido de ~600 a ~160 líneas.

### 2. ✅ `useProjectController.ts` – Controller centralizado

**Resuelto:** Extraídos 2 hooks adicionales:

- `hooks/domains/useExportLogic.ts` – lógica de exportación (PNG, JSON, Phaser, Godot)
- `hooks/domains/usePersistence.ts` – persistencia IndexedDB (guardar/cargar/borrar)

Controller reducido ~200 líneas.

### 3. ✅ Cobertura de Tests insuficiente

**Resuelto:** 25 nuevos tests de hooks implementados:

- `useUndo.test.ts` – historial, ephemeral updates, límites
- `useAnimationLogic.test.ts` – CRUD animaciones, playback
- `useSlicerLogic.test.ts` – grid config, detección de sprites

~56 tests totales pasando.

---

## 🟡 Prioridad Media

### 4. ✅ Web Worker sin gestión de errores robusta

**Resuelto:** Añadido timeout de 30s a promesas del Worker, handler `onerror` global, y recreación automática de la instancia Worker en caso de crash.

### 5. ✅ Blob URL memory leaks potenciales

**Resuelto:** Auditados todos los flujos de carga de imagen. Añadido `URL.revokeObjectURL()` en cleanup de `AppLayout.tsx` al cambiar de imagen.

### 6. ✅ `renderUtils.ts` – Clase estática con código minificado

**Resuelto:** Expandidos 4 métodos ultra-comprimidos (`drawPivotMarker`, `drawCheckerboard`, `drawPixelGrid`, `drawFrameLabel`) + `renderDualView` + sección slicer tail + grid-stroke block a formato legible multi-línea.

### 7. ✅ Tipado débil en `exportFormats.ts`

**Resuelto:** Creadas interfaces `ExportFrameInfo` y `CollisionInfo`. Eliminado el único `any` del archivo. Corregido import `HitboxData`.

### 8. ✅ Google Fonts via CDN

**Resuelto:** Instalados `@fontsource/archivo` y `@fontsource/jetbrains-mono`. Eliminados `<link>` CDN de `index.html`. Fuentes importadas en `index.tsx`.

---

## 🟢 Prioridad Baja

### 9. ✅ Migrar animaciones CSS a GSAP

**Resuelto:** Creado `hooks/useGSAPAnimations.ts` con hooks `useModalEntrance()` y `useLogoPop()`. Aplicado a 5 modales, Header logo, y ToastContainer. Eliminados keyframes CSS obsoletos (`logo-pop`, `progress`).

### 10. ✅ Componente `NumberControl` – Accesibilidad

**Resuelto:** Añadidos `role="spinbutton"`, `aria-valuemin/max/now`, `aria-label` en input/botones/slider. Añadida navegación por teclado (ArrowUp/Down) y función `decrement()`.

### 11. ✅ Estructura de carpetas `components/`

**Resuelto:** Reorganizados 17 archivos en subdirectorios:

```text
components/
├── layout/      # AppLayout, Header, LeftSidebar, RightSidebar
├── canvas/      # CanvasArea, CanvasToolbar, CanvasStatusBar
├── overlays/    # ExportModal, SettingsModal, HelpModal, AnalysisModal, GenerationModal, CommandPalette, ContextMenu, ToastContainer
├── panels/      # left/ + right/ (sin cambios)
└── common/      # NumberControl, Timeline, PanelComponents
```

Todos los imports actualizados. `tsc --noEmit` limpio.

### 12. ✅ Documentación inline

**Resuelto:** JSDoc añadido a la API pública de ~20 hooks y ~25 exports de utilidades (`algorithms`, `canvasMath`, `db`, `exportFormats`, `renderUtils`, `uiFeedback`, `defaultAssets`).

---

## 📊 Métricas actuales

| Métrica | Valor |
| --- | --- |
| Tests unitarios | ~56 |
| Archivos typescript | ~45 |
| Coverage estimado | ~35% (utils + hooks) |
| Componentes | 18 principales + 9 paneles |
| Hooks | 7 (4 core + 3 domain) |
| LOC total estimado | ~8000 |
