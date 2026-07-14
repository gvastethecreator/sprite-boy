# Trazabilidad de paridad

Este ledger demuestra que los inventarios donantes llegan a slices y evidencia. La enumeración actual contiene **64 behaviors Animoto** y **48 behaviors Grid Splitter**: 112 capacidades donantes verificables, más **47 behaviors host** de no regresión; 159 resultados en total, sin filas asignadas a eliminación.

## Animoto: source → behavior → slice → journey

| Behavior IDs | Fuente primaria | Slice propietario | Evidencia/Journey |
|---|---|---|---|
| A1.1-A1.4 | `D:\DEV\animoto\components\layout\Header.tsx`, `hooks\useProjectPersistence.ts`, `utils\storage.ts`, reducer project cases | A1 | J1 + codec/migration gates |
| A2.1-A2.2 | `hooks\useEditorActions.ts`, reducer `SET_IMAGE`/`ADD_LAYER` | A1 | J1/J3 |
| A2.3-A2.8 | `useEditorActions.ts`, reducer layer remove/duplicate/sync/reorder/visibility/update | A2 | J3 + command/history tests |
| A2.9-A2.11 | `TransformGizmo.tsx`, `LayerItem.tsx`, reducer `UPDATE_LAYER`/`COMMIT_LAYER_UPDATE`/`UPDATE_COMPOSITE` | A3-A4 | J3 + visual/render gate |
| A3.1-A3.8 | `MainViewer.tsx`, `SnapGuidesOverlay.tsx`, toolbar de `TransformGizmo.tsx`, responsive panel state in `App.tsx` | A3/A12 | J3/J9 + quick-action/visual gate |
| A4.1-A4.11 | `Timeline.tsx`, `SortableFrame.tsx`, `useEditorActions.ts:196`, reducer frame/select/edit/hover/swap/`SET_USER_KEYFRAME` cases | A5 | J4 + identity/keyframe import stress tests |
| A5.1-A5.3 | reducer `SET_VARIANT`, regenerate y batch update cases | A4/A8/A9 | J3/J5 |
| A6.1-A6.6 | `useAnimationPlayer.ts`, `AnimationPlayer.tsx`, `OnionSkinOverlay.tsx`, controls/reducer settings | A6 | J4 + timing/render gates |
| A7.1-A7.4 | `ControlsPanel.tsx`, `useAnimationGenerator.ts`, Gemini prompt/plan services | A7 | J5 fake-provider |
| A7.5-A7.10 | `useAnimationGenerator.ts` sequential/recursive/audit/fill/cancel/progress/cost paths | A8-A9 | J5 + job lifecycle gate |
| A8.1 | `FrameCorrectionModal.tsx` | A9 | J5 correction path |
| A8.2 | `FrameAlignmentModal.tsx` | A10 | J6 + visual/export parity |
| A9.1-A9.5 | `useExporter.ts` ZIP/GIF/MediaBunny paths | A11 | J7 + artifact decode gate |
| A10.1-A10.4 | reducer history, `useKeyboardShortcuts.ts`, Header mute, `utils\audio.ts`, toasts/loading state | A12 | J4/J9 + accessibility/feedback gates |

Reconciliación del reducer: sus 60 `case` arms representan operaciones o transiciones internas. Las operaciones de dominio están cubiertas por A1-A10; start/success/failure/progress/loading/cost se consolidan en A7.9-A7.10 y JobStore, por lo que no se portan como 1:1 state setters.

## Grid Splitter: source → behavior → slice → journey

| Behavior IDs | Fuente primaria | Slice propietario | Evidencia/Journey |
|---|---|---|---|
| G1.1-G1.6 | `src\components\ImageUploader.tsx`, `src\lib\files.ts`, source/reset state de `src\App.tsx` | G0 Slice source session | J2 + validation/cleanup |
| G1.7 | palette extraction state/lib colors | G5 | J2 + deterministic palette tests |
| G2.1-G2.6 | worker `getEnergyProfile`, `findSegments`, `detectGrid`, `processGrid`; `src\lib\grid.ts` | G2 | J2 + golden/property tests |
| G3.1-G3.4 | worker `trimCanvas` y crop controls | G3 | J2 + bounds fixtures |
| G4.1-G4.7 | worker `applyAdvancedChromaKey`, color input/eyedropper de `App.tsx` | G4 | J2 + visual goldens |
| G5.1-G5.8 | worker `applyPixelSnapping`/`quantizeCanvasColors`, `palettePresets.ts` | G5 | J2 + pixel/hash/performance gates |
| G6.1-G6.3 | status/process/results sections de `App.tsx` | G1/G6 | J2 + job state machine |
| G6.4-G6.5 | `src\lib\download.ts`, per/all handlers | G7 | J2/J7 + artifact checks |
| G6.6-G6.9 | Nueva adaptación Studio sobre resultados donantes | G6-G7 | J2 + project round-trip |
| G7.1-G7.5 | toasts, ErrorBoundary, skip/ARIA/focus/reduced-motion | G8 | J9 + a11y/resilience |
| G7.6-G7.7 | keyboard effect en `App.tsx`: Escape y Ctrl/Cmd+E | G8/G7 | J2/J9 |

Los 12 helpers principales del worker quedan cubiertos por G2-G5 y contract/worker tests. Los behavior IDs G6.6-G6.9 no inventan features ajenas: adaptan “resultado listo/summary/tips” al requisito seamless, agregando commit al proyecto además de conservar download.

## SpriteBoy host: no regresión de export

| Behavior IDs | Fuente primaria | Slice propietario | Evidencia/Journey |
|---|---|---|---|
| H1.1 | `components\overlays\ExportModal.tsx`, `components\canvas\CanvasArea.tsx` PNG snapshot | A11 | J7 pixel/dimensions/grid toggle |
| H1.2-H1.3 | `hooks\domains\useExportLogic.ts` ZIP/GIF | A11 | J7 count/timing/alpha |
| H1.4-H1.6 | `utils\exportFormats.ts`, code format UI | A11 | J7 schema/engine fixtures |

H1.1-H1.6 forman el gate de no regresión antes de X1/R2; los nuevos formatos Animoto se suman y no los reemplazan.

## SpriteBoy host: source → behavior → slice → journey

| Behavior IDs | Fuente primaria | Slice propietario | Evidencia/Journey |
|---|---|---|---|
| H2.1-H2.8 | `GenerationPanel.tsx`, `GenerationModal.tsx`, `AnalysisModal.tsx`, `utils\aiService.ts`, `types\ui.ts` | A7-A9 | J5 + provider/job/security gates |
| H3.1-H3.10 | `AssetLibrary.tsx`, `useBuilderLogic.ts`, `types\core.ts`, builder canvas/render paths | B1 + A1-A3/F2 | J3 + migration/render goldens |
| H4.1-H4.8 | `SlicerTools.tsx`, `FrameProperties.tsx`, `useSlicerLogic.ts`, `utils\algorithms.ts` | S1 + G2/G4 | J2 irregular + processing/undo gates |
| H5.1-H5.5 | animation list/properties/timeline, `useAnimationLogic.ts`, playback/render paths | A5-A6 | J4/J6 + timing/history gates |
| H5.6-H5.7 | `CollisionTools.tsx`, hitbox types/render/export | C1/A11 | J6/J7 + owner/metadata gates |
| H6.1-H6.8 | `types\config.ts`, Settings/Help/CommandPalette, UI/keyboard controllers | F5-F6/A12 | J9 + visual/a11y/persistence gates |

## Host/Foundation: riesgo → slice → gate

| Riesgo host | Source actual | Slice | Gate |
|---|---|---|---|
| Frame ID vs index | `hooks\useProjectController.ts:329`, `:424` | F0-F1/F4 | Property + J4 identity stress |
| Reslice references | `handleSetGridConfig` | F1/F4/G6 | Impact analysis + atomic undo |
| JSON/Blob URL persistence | `hooks\domains\usePersistence.ts` | F2-F3 | J1/J8 |
| Whole-project JSON history | `hooks\useUndo.ts` | F1/F4 | Command/history gates |
| Mega controller/context | `hooks\useProjectController.ts`, `contexts\ProjectContext.tsx` | F4/F6/X1 | Render counts + removal gate |
| Continuous rAF | `hooks\canvas\useCanvasRenderLoop.ts` | F5 | Idle performance budget |
| Collision unreachable | enum/panel vs `components\layout\Header.tsx` | F6/C1 | J6 + workspace navigation |
| Placeholder commands | controller command definitions | F6/X1 | Command registry completeness |
| Dependency/lock/CI debt | `package.json`, `.gitignore`, missing workflows | F8 | Reproducible install + CI failure injection |

## Slice → acceptance closure

| Slice group | Cierra | No puede cerrarse sin |
|---|---|---|
| F0-F4 | Canonical document/assets/persistence/history | Contract/property, J1 y J8 |
| F5-F8 | Render/shell/jobs/CI | Visual/perf/a11y, failure injection y CI |
| G0-G5/S1 | Source session + grid/irregular processing parity | Input/decode/cleanup + worker real + golden/edge/perf evidence |
| G6-G8 | Seamless Slice workflow | J2, H4, round-trip, accessibility y fallback quarantine |
| A1-A4/B1 | Project/Compose/variants/Builder superset | J1/J3, H3 y render/export match |
| A5-A6 | Timeline/playback | J4, identity/timing/idle gates |
| A7-A10 | AI/correction/alignment | J5/J6, fake provider, cancellation y provenance |
| A11-A12 | Export/interaction parity | J7/J9, H1/H6, decode/browser/a11y y adapter consolidation |
| C1/X1/R1-R2 | Collision/consolidation/release | Full manifest, migration/soak, fallback aislado y retiro físico post-soak |

## Regla de mantenimiento

- Agregar un behavior exige source, slice y journey/gate en este ledger.
- Renombrar/eliminar un behavior exige explicar su consolidación y preservar el outcome del usuario.
- Un slice no pasa `done` con behavior IDs `not-run`, salvo gate conditional explícitamente N/A con razón.
- Los conteos se verifican desde las filas `| A… |`, `| G… |` y `| H… |`; no se mantienen a mano sin esa comprobación.
