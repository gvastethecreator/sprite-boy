# No regresión y ampliación de SpriteBoy

Animoto y Grid Splitter amplían el Studio; no reemplazan capacidades existentes por un subconjunto. Esta matriz protege **47 behaviors host** hasta que el path canónico los absorba.

Fuentes principales: `types/core.ts`, `types/config.ts`, `types/ui.ts`, `components/panels/**`, `components/overlays/**`, `hooks/domains/**`, `hooks/canvas/**`, `utils/aiService.ts`, `utils/exportFormats.ts` y `utils/algorithms.ts`.

## Export (H1)

| ID | Capacidad actual | Destino/slice | Gate |
|---|---|---|---|
| H1.1 | PNG del spritesheet, con opción de grid | A11 Export Center/RenderEngine | Decode, dimensions, pixels y grid toggle |
| H1.2 | ZIP de frames transparentes | A11 | Count/order/names/alpha |
| H1.3 | GIF por animación | A11 | FPS/duration/loop y preview parity |
| H1.4 | Generic/Unity-compatible JSON | A11 format registry | Schema fixture, stable IDs y collisions |
| H1.5 | Phaser 3 config | A11 format registry | Contract fixture parseable |
| H1.6 | Godot animation data | A11 format registry | Contract fixture parseable/import smoke viable |

## AI actual (H2)

| ID | Capacidad actual | Destino/slice | Gate |
|---|---|---|---|
| H2.1 | Generar imagen nueva desde prompt | A7-A8 AI port/jobs | Fake-provider + accept/reject/provenance |
| H2.2 | Generar variación de attachments | A7-A8 | Asset/keyframe/frame context y style continuity |
| H2.3 | Generar in-between con dos contextos | A7-A9 | Orden prev/next, atomic accept y undo |
| H2.4 | Editar con contexto | A7-A9 | Prompt/context mapping y no overwrite silencioso |
| H2.5 | Generar hoja completa | A7-A8 + Slice handoff | Output durable, recipe/handoff y cancel |
| H2.6 | Elegir modelo compatible | A7 provider capability registry | Unsupported model/mode explicado y fallback explícito |
| H2.7 | Drop de asset/keyframe/frame como contexto | A7 inspector/drop router | Correct source IDs, keyboard alternative y cleanup |
| H2.8 | Análisis técnico de spritesheet | A7 Job Center/Analysis report | Acción alcanzable, Markdown seguro, save/copy y provider errors |

## Assets y Builder (H3)

| ID | Capacidad actual | Destino/slice | Gate |
|---|---|---|---|
| H3.1 | Importar/persistir assets y default assets | F2/A1/B1 | Save/reload, dedupe, integrity y portable package |
| H3.2 | Borrar/reordenar assets | F1-F2/B1 | Impact preview, DnD keyboard, undo y no dangling refs |
| H3.3 | Crear/redimensionar builder canvas | A1/B1 | Dimensions/aspect, migration y export match |
| H3.4 | Layout grid y free | B1 | Switch sin pérdida; save/reload/undo |
| H3.5 | Place/remove/swap/smart-fill de slots | B1 | DnD, identity, single transaction y reload |
| H3.6 | Fit modes fit/fill/original/stretch | B1/RenderEngine | Golden visual por aspect ratio |
| H3.7 | Nueve alineaciones de slot | B1/RenderEngine | Position fixtures y keyboard control |
| H3.8 | Scale X/Y, lock aspect, rotation, opacity, offsets y flips | B1/A3 | Pointer/numeric, one undo y export match |
| H3.9 | Free objects con bounds/rotation/flip/opacity/z-order | B1/A3 | Move/resize/reorder/undo/save/export |
| H3.10 | Grid rows/cols, margins, gaps y sync grids | B1/S1 | Geometry fixtures, impact preview y no ref loss |

## Slicing host irregular (H4)

| ID | Capacidad actual | Destino/slice | Gate |
|---|---|---|---|
| H4.1 | Auto-detect sprites por componentes, no sólo grid | S1 processing port | Irregular/transparent/touching fixtures |
| H4.2 | Magic wand detect-at-point con tolerance | S1 canvas tool | Zoom/DPR/alpha/tolerance y Escape |
| H4.3 | Crear región manual en canvas | S1 | Drag threshold, bounds y keyboard alternative |
| H4.4 | Mover/redimensionar región y editar X/Y/W/H | S1 | Pointer/numeric, snap, clamp y one undo |
| H4.5 | Duplicate/delete/hide región | S1 | Stable IDs, impact analysis, undo y export behavior |
| H4.6 | Convertir región a asset | S1/F2 | Pixel bounds, alpha, provenance y reload |
| H4.7 | Background removal color/tolerance/softness | G4/S1 | Preview/apply/cancel, visual golden y cleanup |
| H4.8 | Grid manual con margins X/Y y gaps X/Y | S1/G2 | Non-divisible geometry, sync y migration |

## Animation y Collision actuales (H5)

| ID | Capacidad actual | Destino/slice | Gate |
|---|---|---|---|
| H5.1 | Crear/renombrar/borrar animaciones | A5 | Stable IDs, confirm/impact, undo/reload |
| H5.2 | Agregar/reordenar/borrar keyframes | A5 | DnD/keyboard, identity y undo |
| H5.3 | Pivot, rotation, scale X/Y y opacity por keyframe | A5-A6 | Canvas/numeric, playback/export match |
| H5.4 | FPS/loop y preview dual/real-time | A6 | Timing/hidden-tab/idle budgets |
| H5.5 | Onion skin con opción de hitboxes | A6/C1 | Visual overlay, opacity y no export |
| H5.6 | Hurtbox/hitbox/solid/trigger con tag | C1 | Create/edit/delete/type/tag/save/undo |
| H5.7 | Collision ownership por source/cel y metadata export | C1/A11 | Variant/cel switch, reload y H1.4-H1.6 fixtures |

## Shell y preferencias (H6)

| ID | Capacidad actual | Destino/slice | Gate |
|---|---|---|---|
| H6.1 | Theme dark/light, accent y UI density | F6/A12 | Tokens completos, reload y contrast |
| H6.2 | Sound enabled y tooltips preference | F6/A12 | Mute/discovery/reduced-motion behavior |
| H6.3 | Snap enabled y threshold | F5-F6/A3 | Canvas tools comparten preference |
| H6.4 | Frame labels: visible/size/position/color/opacity | F5-F6/S1 | Canvas-only overlay, save/reload y a11y |
| H6.5 | Template view full/grid-only/numbered y grid styling | F5-F6 | Visual fixtures y export inclusion explícita |
| H6.6 | Command palette, help y settings | F6/A12 | Todas las acciones reales, keyboard/focus |
| H6.7 | Save/open/import project | F3/F6/A1 | J1/J8 y command shortcuts |
| H6.8 | Undo/redo/delete/play/navigation shortcuts | F4/F6/A12 | Input exclusion, platform keys y discoverability |

## Slices host adicionales

### S1 — Irregular Region Tools

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** Foundation F1-F7, Grid G0/G3-G4.
- **Writable:** `features/slice/regions/**`, processing adapters de connected-components/detect-at-point y canvas tools.
- **Entregable:** H4.1-H4.8 sobre `Region`/AssetRepository/commands canónicos.
- **Prueba:** J2 irregular path, geometry/visual fixtures, hostile import/reset/reslice y full undo/save/export.
- **Retorno:** `done` antes de G8/X1; el slicer legacy permanece fallback-only hasta R2.

### B1 — Builder Superset

- **Owner:** `[gpt-5.6-sol | xhigh]` diseño/render; `[gpt-5.6-luna | max]` inspector controls acotados.
- **Dependencias:** Foundation F1-F6, Animoto A1-A3.
- **Writable:** `features/compose/builder/**`, Composition commands/selectors y RenderEngine adapters.
- **Entregable:** H3.1-H3.10 sobre compositions/layers canónicas, preservando grid/free y slot/free-object semantics.
- **Prueba:** J3 Builder path, migration fixture, DnD/keyboard, undo/save/reload y preview/export goldens.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh; X1 no puede cerrar sin B1 verde.

## Gate host

Los 47 behaviors H1-H6 deben pasar antes de hacer canonical el default. G8/A12 pueden aislar el legacy, pero R2 no lo elimina físicamente hasta que esta matriz, migration fixtures y rollback soak estén verdes.
