# Plan de paridad nativa: Animoto

Objetivo: replicar el editor de Animoto como capacidades `Compose`, `Animate`, `AI` y `Export` de SpriteBoy Studio. No se porta `App.tsx`, Zustand, sus estilos globales ni su layout como unidad.

## Inventario de referencia

Fuentes principales:

- Estado y operaciones: `D:\DEV\animoto\types\index.ts`, `state\reducer.ts`.
- Orquestación: `App.tsx`.
- Canvas/capas/timeline: `components\editor\**`.
- Controles y navegación: `components\layout\Header.tsx`, `components\panels\**`.
- Generación: `hooks\useAnimationGenerator.ts`, `services\gemini.ts`.
- Corrección/alineación: `components\modals\FrameCorrectionModal.tsx`, `FrameAlignmentModal.tsx`.
- Persistencia/export: `hooks\useProjectPersistence.ts`, `utils\storage.ts`, `hooks\useExporter.ts`.

El comportamiento actual es referencia de paridad, no implementación destino: el coverage de líneas del donante es 2.09%, su `App` se suscribe al store completo para persistencia y el exportador incluye un worker GIF minificado y fallback CDN. Esos detalles no se trasladan sin rediseño.

## Adaptación de interfaz

| Animoto actual | SpriteBoy Studio destino | Regla de adaptación |
|---|---|---|
| Header propio con sesiones/new/save/name/ratio/color/undo/mute | Header Studio + Project menu + command palette | No duplicar header; conservar todas las acciones y sus estados disabled/dirty |
| LeftPanel de layers | `Layers` tab en sidebar izquierdo, junto a Assets | Usar primitives, densidad, iconografía y tokens del Studio |
| ControlsPanel de prompt/generation/settings | Inspector derecho contextual en Compose/Animate | Secciones colapsables; no panel permanente si no aplica |
| MainViewer | Canvas central compartido | RenderEngine único con herramientas/overlays por workspace |
| TransformGizmo + snap guides | Tool overlay del canvas | Misma semántica de move/scale/snap con history transaccional |
| Timeline propia | Timeline Studio extendida | Reutilizar shell, reemplazar su modelo index-based por cels con IDs |
| Frame preview popup | Preview/quick actions en cel | Portal dentro del z-index contract del Studio |
| Correction/Alignment modals | Modales Studio y Job Center | Focus trap, cancelación, progress y recovery compartidos |
| Toast/sonner y sonidos propios | Feedback service Studio | Un solo toast stack; sonidos respetan mute/reduced motion/preferences |
| Fondo visual shader | Ninguno como requisito | Decoración sólo si encaja con el diseño Studio y no compite con el canvas |

## Matriz funcional completa

| ID | Capacidad donante | Comportamiento que debe preservarse | Destino canónico | Prueba mínima de paridad |
|---|---|---|---|---|
| A1.1 | Nueva sesión/proyecto | Crear estado limpio sin afectar proyectos guardados | Project menu + `project.create` | Crear, nombrar, guardar y volver al anterior |
| A1.2 | Guardar/listar/cargar/borrar proyectos | Thumbnail/metadata, last modified y proyecto activo | ProjectCodec/Project Browser | Persistencia real tras reload y delete confirmado |
| A1.3 | Renombrar proyecto | Edición inline y nombre usado en exports | `project.rename` | Rename, undo si aplica, reload y filename sanitizado |
| A1.4 | Dimensiones/aspect ratio/background | Ajustar canvas y fondo transparente/color | Composition + workspace inspector | 1:1, ratios soportados, color/transparent idénticos en preview/export |
| A2.1 | Importar imagen inicial | Imagen usable como primera capa/source | Asset Library → Composition | Drop/file picker, validación, decode error y reload |
| A2.2 | Agregar capa a un frame | Nueva layer preservando source y dimensiones | `layer.add` | Layer visible en canvas, panel, undo y save |
| A2.3 | Eliminar capa | Remove no destructivo para asset compartido | `layer.remove` | Referencias/asset intactos; undo restaura orden/transform |
| A2.4 | Duplicar capa | Clonar propiedades con ID nuevo | `layer.duplicate` | Independencia de transforms y orden correcto |
| A2.5 | Sincronizar capa a todos los frames | Propagar contenido/transform coherentemente | Batch command sobre compositions | Un undo revierte todo; conflictos reportados |
| A2.6 | Reordenar capas | DnD cambia z-order | `layer.reorder` | Canvas, thumbnails y export reflejan el mismo orden |
| A2.7 | Visibilidad | Toggle por capa sin destruirla | `layer.update(visible)` | Preview/export omiten layer; undo/save correctos |
| A2.8 | Opacidad | Valor editable y render compositado | `layer.update(opacity)` | 0/50/100%, scrub coalesced, export match |
| A2.9 | Transform de layer | x/y/scale mediante gizmo y controles | `layer.transform` transaction | Pointer + keyboard, guides, bounds, un undo por gesto |
| A2.10 | Selección/hover de layer | Canvas y panel sincronizados | Workspace/Interaction stores | Click desde ambos lados, focus visible, delete correcto |
| A2.11 | Recalcular composite | Active variant deriva del graph de capas | RenderEngine cache | No guardar data URL derivada como fuente de verdad |
| A3.1 | Snap guides | Guías durante transform | Canvas overlay | Snap on/off, zoom/DPR y no exportar overlays |
| A3.2 | Viewer de composición | Escala/centra respetando aspect/background | Canvas shared viewport | Resize de panel, compact desktop y pixel-perfect |
| A3.3 | Panel de layers responsive | Mostrar/ocultar en poco ancho | Studio panel layout | Estado persistente y sin scroll horizontal accidental |
| A3.4 | Reset transform | Restaurar posición/escala base desde el gizmo | Quick action `layer.transform.reset` | Resultado determinista, keyboard, undo y tooltip/label |
| A3.5 | Fit/Contain | Centrar y escalar toda la layer dentro del canvas | Quick action `layer.transform.contain` | Portrait/landscape/square, undo y export match |
| A3.6 | Fill/Cover | Cubrir canvas centrado, permitiendo crop visual | Quick action `layer.transform.cover` | Aspectos opuestos, bounds, undo y export match |
| A3.7 | Ghost Mode | Toggle rápido de opacidad 100% ↔ 50% | Quick action `layer.opacity.toggleGhost` | Preserva/explica opacity custom, undo y accessible state |
| A3.8 | Deselect | Cerrar gizmo sin mutar layer | Interaction command | Focus retorna al canvas/panel y history no cambia |
| A4.1 | Crear cantidad de frames | Ajustar secuencia al target | Sequence command | Grow/shrink con impact report; no pérdida silenciosa |
| A4.2 | Agregar frame | Cel/composition nueva | `cel.add` | Inserción determinista, selección y undo |
| A4.3 | Duplicar frame | Copiar source/config con IDs nuevos donde corresponde | `cel.duplicate` | Variante/capas no se corrompen; provenance preservada |
| A4.4 | Borrar frame | Remove por ID estable | `cel.remove` | Tras reorder sigue borrando el cel correcto; undo |
| A4.5 | Reordenar frames DnD | Orden visual/durable | `cel.reorder` | Mouse/touch/keyboard DnD y reload |
| A4.6 | Swap de frames | Intercambiar posiciones explícitamente | `cel.swap` | Source/metadata permanecen con cada cel |
| A4.7 | Multi-selección | Toggle/range y edición batch | Workspace selection + batch commands | Ctrl/Cmd, Shift, clear y keyboard |
| A4.8 | Hover/preview popup | Preview grande y quick actions | Cel preview portal | Correcto tras scroll/reorder; z-order/focus |
| A4.9 | Prompt por frame | Prompt override por cel | Cel metadata | Save/reload y fallback al prompt global |
| A4.10 | Lock/keyframe | Proteger endpoints o cels definidos por usuario | Cel `locked`/generation constraints | Generation/fill respeta locks; UI explica por qué |
| A4.11 | Upload user keyframe | Importar/reemplazar un cel con imagen elegida, contenida y centrada | AssetRepository + `cel.replaceSource` | Reemplaza la composición del cel, conserva policy de lock/prompt, undo/reload y generation usa sus vecinos |
| A5.1 | Variantes A/B/C/D | Cuatro alternativas y active variant | `VariantSet` | Cambiar sin destruir; save/reload; export usa activa |
| A5.2 | Regenerar frame | Reemplazar/crear variante con contexto vecino | AI job + variant command | Cancel/error/accept/reject; provenance/cost |
| A5.3 | Batch update de frames | Aplicar múltiples resultados atómicamente | Transaction | Un undo; parcial no se confirma |
| A6.1 | FPS | Velocidad de preview/export | Sequence | Límites, teclado, save/reload y export timing |
| A6.2 | Loop/cyclic | Loop de playback y generación | Sequence | Primer/último frame y export repeat correctos |
| A6.3 | Pin edges | Mantener endpoints en generation flow | Generation constraints | Recursive/sequential respetan configuración |
| A6.4 | Play/pause/scrub | Preview por tiempo acumulado | PlaybackStore | Sin drift significativo, hidden-tab resume seguro |
| A6.5 | Onion skin | Overlay vecino con opacidad | Render overlay | Toggle/opacity/edges, no aparece en export |
| A6.6 | Generation flow visualization | Mostrar orden recursive/sequential y keyframes | Inspector AI | Orden coincide con job real y locks |
| A7.1 | Prompt global | Describir movimiento | AI inspector | Autosave y validación empty/long |
| A7.2 | Smart prompt | Inferir prompt desde imagen/preset/cyclic | AI job | Progress/cancel/error; resultado editable y auditable |
| A7.3 | Presets | Aplicar plantilla de prompt/estilo | Preset catalog Studio | No sobrescribir texto sin confirmación; provenance |
| A7.4 | Frame plan | Planificar prompts/keyframes por cel | Generation plan artifact | Preview editable antes de ejecutar; count exacto |
| A7.5 | Sequential generation | Cada frame usa contexto anterior | Job graph | Orden determinista, locks y cancelación intermedia |
| A7.6 | Recursive generation | Generar edges/midpoints recursivamente | Job graph | Plan/orden visible; odd/even counts y endpoints |
| A7.7 | Consistency audit | Auditar cada resultado respecto a referencias | AI audit artifact | Logs estructurados, no sólo texto de loading |
| A7.8 | Fill missing | Detectar huecos y completar con vecinos | AI batch job | Sólo missing; atomic commit; cancel/retry |
| A7.9 | Cancel generation | Detener flujo y dejar estado coherente | Job Center | No late writes; coste/progreso final conocidos |
| A7.10 | Cost/progress/details | Mostrar avance, etapa, logs y coste | JobStore/Job Center | Cierre/reapertura no falsifica estado; sin secretos |
| A8.1 | Correct selected frames | Prompt de corrección con previous/current/next y style lock | Correction job/modal | Multi-select, contexto correcto, preview/accept y atomic apply |
| A8.2 | Align frame | Pan/zoom/reset y aplicar frame alineado | Non-destructive transform or rasterize command | Cancel no cambia; apply/undo/save/export match |
| A9.1 | Export ZIP | PNG por frame con naming ordenado | Export Center | ZIP abre, count/nombres/dimensiones correctos |
| A9.2 | Export GIF | FPS, loop, background/transparency y progreso | Export worker port | Decode y playback externo; cancel/cleanup |
| A9.3 | Export MP4 | Codec compatible, timing y download | Export worker/MediaBunny adapter | Archivo reproducible y duración esperada |
| A9.4 | Export WebM | Selección de codec soportado y timing | Export worker/MediaBunny adapter | Fallback explícito y archivo válido |
| A9.5 | Export con frames incompletos | Definir skip/block/placeholder visible | Export validation | Nunca producir éxito silencioso con huecos |
| A10.1 | Undo/redo | Operaciones editables, layers y timeline | ProjectEngine history | Todas las filas mutables tienen round-trip test |
| A10.2 | Keyboard shortcuts | Undo/redo/save/play/delete/navigation | Command registry | No disparar al escribir; discoverable y remapeable |
| A10.3 | Mute/sound feedback | Preferencia global | Studio preferences | Respeta mute/reduced motion y no duplica sonidos |
| A10.4 | Loading/errors/toasts | Estado comprensible y accionable | Job Center + toast/error boundary | Error tipado con retry/cancel/details |

## Reglas de estado y render

- `generatedFrames` no se porta: es caché derivada. La fuente de verdad es el graph `VariantSet → Composition → Layer → Asset`.
- Las variantes generadas son assets con procedencia AI; activar una variante cambia la referencia, no copia data URLs.
- `selectedFrameIndices`, hover, editing y swap source pasan al Workspace/Interaction store; sólo la selección útil al reabrir puede persistir.
- `history` del reducer Animoto no se porta; cada command entra en el historial canónico.
- Corrección, generación y alignment producen draft artifacts. Sólo `accept` muta el proyecto.
- Upload user keyframe crea un asset durable y una composición de una layer con contain/center; no guarda data URL ni borra el source anterior hasta confirmar la transacción.
- Un resultado rasterizado por alignment debe mantener vínculo opcional con su source/transform para provenance; si se modela como transform no destructivo, el export usa el compositor compartido.

## Slices de implementación

### A1 — Projects y Composition bootstrap

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** Foundation F1-F4, F6.
- **Writable:** `features/compose/**`, Project menu adapters y tests A1.1-A2.2.
- **Entregable:** crear/abrir/guardar proyecto y composición con primera layer desde Asset Library.
- **Prueba:** jornada new → import → save → reload → reopen; navegador limpio para package portable.
- **Retorno:** `done` cuando no queda data URL/Blob URL durable.

### A2 — Layers panel y commands

- **Owner:** `[gpt-5.6-luna | max]`, revisión `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A1.
- **Writable:** `features/compose/layers/**`, shared DnD primitives y tests A2.3-A2.8.
- **Entregable:** add/remove/duplicate/sync/reorder/visibility/opacity nativos.
- **Prueba:** matriz de commands + E2E de DnD/undo/reload.
- **Retorno:** `needs-review` con diff, tests y video/screenshot del journey.

### A3 — Canvas transform, selection y guides

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A2, Foundation F5.
- **Writable:** `features/compose/canvas/**`, render overlays y interaction store.
- **Entregable:** gizmo move/scale, numeric controls, selection sync, snap guides y quick actions Reset/Contain/Cover/Ghost/Deselect.
- **Prueba:** pointer/keyboard, quick-action matrix, DPR/zoom, un undo por gesto y visual regression.
- **Retorno:** `done` con trace de render y accesibilidad del gizmo.

### A4 — Variants y compositor

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A2-A3.
- **Writable:** `features/compose/variants/**`, RenderEngine composition cache.
- **Entregable:** A/B/C/D, active variant, thumbnails y composite compartido con export.
- **Prueba:** A5.1 y reload/export visual match.
- **Retorno:** `done` sin caché derivada en schema.

### A5 — Timeline parity

- **Owner:** `[gpt-5.6-sol | xhigh]` diseño/DnD; `[gpt-5.6-luna | max]` controles acotados.
- **Dependencias:** A1, A4, Foundation F4/F6.
- **Writable:** `features/animate/timeline/**`, timeline legacy adapter y tests A4.*.
- **Entregable:** add/delete/duplicate/reorder/swap/multi-select/preview/prompts/locks y upload/replace de user keyframe.
- **Prueba:** mouse, keyboard y touch; identity regression tras múltiples reorders; keyframe import/replace/undo/save/generation context.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh.

### A6 — Playback y onion skin

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A5, Foundation F5.
- **Writable:** `features/animate/playback/**`, PlaybackStore y overlays.
- **Entregable:** FPS, play/pause/scrub, loop, pin edges, onion skin y opacidad.
- **Prueba:** timing trace, hidden tab, edges, export isolation y visual regression.
- **Retorno:** `done` con idle/playback budgets verdes.

### A7 — AI port y generation plan

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A4-A6, Foundation F7.
- **Writable:** `core/ai/**`, `features/animate/generation/**`; secretos/config fuera del project.
- **Entregable:** provider port, prompt/presets, smart prompt y plan editable con provenance, preservando host modes new-image/variation/in-between/edit-context/full-sheet, model capability y technical analysis H2.
- **Prueba:** fake provider contract para donor + H2, real-provider smoke opcional, errors/redaction/cost/cancel.
- **Retorno:** `done` sin llamadas Gemini directas desde componentes.

### A8 — Sequential/recursive generation y audit

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A7.
- **Writable:** job graph/generation feature y tests A7.5-A7.10.
- **Entregable:** ambos métodos, locks/pin, per-cel audit, progress/log/cost y atomic accept.
- **Prueba:** deterministic fake-provider scenarios para 1/2/odd/even cels, cancel y provider failure.
- **Retorno:** `done` con cero late writes y consistency artifacts consultables.

### A9 — Regenerate, fill y correction

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A8.
- **Writable:** generation jobs y Correction modal Studio.
- **Entregable:** regenerate single, fill missing y correct selection con neighbor context.
- **Prueba:** locks, missing only, partial failure, atomic batch, accept/reject/undo.
- **Retorno:** `done` con A5.2, A7.8 y A8.1 verdes.

### A10 — Alignment

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A3-A5.
- **Writable:** alignment tool/modal y compositor.
- **Entregable:** pan/zoom/reset, reference overlay y apply no destructivo o rasterizado explícito.
- **Prueba:** cancel/apply/undo, transparency, bounds y preview/export parity.
- **Retorno:** `done` con decisión ADR sobre transform vs rasterize.

### A11 — Export ZIP/GIF/MP4/WebM

- **Owner:** `[gpt-5.6-sol | xhigh]` contrato/codecs; `[gpt-5.6-luna | max]` UI adapter.
- **Dependencias:** A4-A6, Foundation F7.
- **Writable:** `features/export/**`, worker adapters, Export Center.
- **Entregable:** Export Center superset: ZIP frames, GIF, MP4 y WebM de Animoto más PNG spritesheet, ZIP host y metadata Generic JSON/Phaser/Godot preservados.
- **Prueba:** decode externo automatizado, duración/FPS/count/names, alpha/background y browser matrix.
- **Retorno:** `needs-review`; prohibido el fallback CDN y el worker minificado inline sin procedencia/build step.

### A12 — Interaction/accessibility parity y retiro legacy

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** A1-A11.
- **Writable:** command registry, shared primitives, obsolete Animoto adapters y docs.
- **Entregable:** shortcuts, sound/tooltips/theme/density/snap/label/template preferences H6, responsive panels, focus/labels y cleanup del código transitorio.
- **Prueba:** journey keyboard-only, reduced-motion, screen reader smoke, compact desktop, no console warnings.
- **Retorno:** `done` cuando toda la matriz A1-A10 tiene evidencia y no queda segundo store/shell.

## Gate de paridad Animoto

Un proyecto creado sólo con herramientas Studio debe poder:

1. Importar assets, construir una composición por capas y editarla con gizmo/guides.
2. Crear una secuencia con variantes, reordenar/duplicar/borrar, usar prompts/locks y onion skin.
3. Generar por ambos métodos, cancelar, rellenar huecos, regenerar/corregir/alinear y deshacer.
4. Guardarse, cerrarse y reabrirse sin perder binarios o metadata.
5. Exportarse a ZIP, GIF, MP4 y WebM, sin perder PNG spritesheet ni metadata Generic JSON/Phaser/Godot del Studio, con el mismo contenido que muestra el preview.

La fase no termina con “equivalencia aproximada”: las 64 filas A1.1-A10.4 deben estar trazadas a tests o evidencia manual registrada.
