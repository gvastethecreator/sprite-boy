# Plan de paridad nativa: Grid Splitter

Objetivo: replicar todo Grid Splitter como el pipeline avanzado del workspace `Slice`. Sus algoritmos pueden portarse; su `App.tsx`, estado local, landing, estilos y worker singleton no se integran como unidades.

## Inventario de referencia

Fuentes principales:

- UI/estado/recorrido: `D:\DEV\grid-splitter\src\App.tsx`.
- Contratos: `src\types\index.ts`.
- Procesamiento: `src\workers\gridSplitter.worker.ts`.
- Adapter actual: `src\services\gridSplitterService.ts`.
- Validación, grid, colores y download: `src\lib\**`.
- Fixtures/tests: `src\test\**`, `src\*.test.tsx`, `src\services\*.test.ts`.

El donante tiene una base unitaria útil (80.75% de líneas), pero el worker de procesamiento no está cubierto por la suite: la llamada actual no incluye `requestId`, cancelación, timeout, progress o recovery y múltiples listeners pueden resolver con la misma primera respuesta. Antes de trasladar algoritmos, se reemplaza ese protocolo.

## Adaptación de interfaz

| Grid Splitter actual | SpriteBoy Studio destino | Regla de adaptación |
|---|---|---|
| Hero/landing y uploader central | Asset Library + empty state de Slice | No crear landing interna; drop abre/importa asset y entra a Slice |
| Preview de source y metadata | Canvas central + status bar | Overlay de grid/crop/chroma no destructivo |
| Controles en página larga | Inspector derecho por secciones | `Grid`, `Crop`, `Background`, `Pixel`, `Palette`; valores forman una recipe |
| Results grid | Tray/bottom panel `Slices` | Resultados staged antes de commit; selección y zoom compartidos |
| Download por tile/todos | Commit to Project + Export Center | Mantener descarga rápida, pero priorizar crear `Region`/`Asset` dentro del proyecto |
| Toasts propios | Feedback/Job Center Studio | Progress, cancel, retry y error details unificados |
| Tips/summary | Contextual help + result summary | Mostrar sólo cuando aporta una decisión o warning |
| Atajos Esc/Ctrl+E | Command registry Studio | Sin colisiones; discoverable y remapeable |

## ProcessingRecipe

La UI modifica un draft serializable, nunca procesa en cada evento sin control:

```ts
interface GridSplitRecipeV1 {
  version: 1;
  sourceAssetId: EntityId;
  layout: { mode: "auto" } | { mode: "manual"; rows: number; cols: number };
  crop: { threshold: number; padding: number };
  chroma: {
    enabled: boolean;
    color: string;
    tolerance: number;
    smoothness: number;
    spill: number;
  };
  pixel: {
    enabled: boolean;
    size: number;
    quantize: boolean;
    colors: number;
    palette?: string[];
  };
}
```

La recipe tiene defaults versionados y validación compartida entre UI/worker. Los resultados staged contienen bounds, output dimensions, reduction, warnings y un blob temporal; al hacer commit se crean `Region` cuando basta una referencia al source o nuevos `Asset` cuando chroma/crop/resize/quantization altera píxeles.

## Matriz funcional completa

| ID | Capacidad donante | Comportamiento que debe preservarse | Destino Studio | Prueba mínima de paridad |
|---|---|---|---|---|
| G1.1 | File picker | Aceptar imagen válida y empezar flujo | Asset Library/Slice empty state | PNG/JPEG/WebP reales; cancel no altera estado |
| G1.2 | Drag & drop | Drop zone con estado visual | Shell drop router | Drop sobre canvas/sidebar, keyboard alternative y multi-file policy |
| G1.3 | Validación | Tipo permitido, tamaño ≤10 MB y decode válido | Asset validation | Extensión falsa, corrupta, oversized, zero dimensions |
| G1.4 | Source preview | Mostrar imagen sin deformación | Canvas central | DPR/zoom, alpha checkerboard y compact layout |
| G1.5 | Metadata source | Nombre, dimensiones y file size | Asset details/status bar | Valores correctos y filename seguro |
| G1.6 | Replace/reset | Cambiar source y limpiar resultados/URLs | Recipe session | No conservar slices/palette/jobs del source anterior |
| G1.7 | Palette extraction | Colores dominantes del source | Palette section | Alpha ignorado según policy; resultado estable y usable |
| G2.1 | Auto-detect grid | Inferir rows/cols por energy profiles/segments | Processing worker | Fixtures 2x4/3x3 y hojas con spacing/transparency |
| G2.2 | Manual grid | Rows/cols configurables | Grid inspector | Límites, 1x1, non-square, huge-count guard |
| G2.3 | Switch auto/manual | Cambiar modo sin perder último manual | Recipe draft | UI/serialized recipe y undo correctos |
| G2.4 | Detected layout feedback | Exponer rows/cols inferidos | Grid overlay/summary | Overlay y output count coinciden |
| G2.5 | Row-major order | Índices/nombres predecibles | Staged slices | Orden estable después de retry/reload recipe |
| G2.6 | Cell geometry | Cubrir bounds sin gaps/overlaps inesperados | Worker/grid library | Dimensiones no divisibles y último row/col |
| G3.1 | Auto-crop | Recortar contenido por alpha/diferencia | Crop recipe | Transparent border, solid tile, fully transparent tile |
| G3.2 | Threshold | Sensibilidad de content bounds | Crop inspector | 0/min/max y monotonicidad esperada |
| G3.3 | Padding | Expandir bounds sin salir de la celda | Crop inspector | Clamp en cuatro bordes y tiny content |
| G3.4 | Reduction percentage | Informar ahorro dimensional | Result metadata | Cálculo consistente y sin negativos/NaN |
| G4.1 | Chroma toggle | Activar/desactivar remoción | Background section | Disabled produce pixels idénticos |
| G4.2 | Color input | Hex editable | Background section | Valid/invalid/normalization y undo |
| G4.3 | Eyedropper | Elegir pixel del preview | Canvas tool | Zoom/DPR/scroll, alpha y cancel con Esc |
| G4.4 | Tolerance | Controlar distancia de color removida | Recipe/worker | 0/max, near colors y foreground preservation |
| G4.5 | Smoothness | Feather del alpha en borde | Recipe/worker | Edge visual regression, sin halos duros |
| G4.6 | Spill suppression | Reducir contaminación del chroma | Recipe/worker | Green/blue screen fixtures y skin/foreground safety |
| G4.7 | Chroma + crop order | Crop usa el alpha resultante | Pipeline explícito | Output bounds verifican orden de operaciones |
| G5.1 | Pixel snapping toggle | Activar pipeline pixel-art | Pixel section | Disabled es lossless respecto al stage previo |
| G5.2 | Target size | Resize cuadrado pixel-perfect | Worker | Nearest-neighbor, límites, 16/32/64/128 y custom policy |
| G5.3 | Quantization toggle | Reducir colores opcionalmente | Pixel section | Disabled preserva colores; alpha correcto |
| G5.4 | Color count | K colores configurables | Worker | Límites, fewer-source-colors y determinismo |
| G5.5 | Auto palette | Derivar palette de cada output/source según policy | Worker/recipe | Repetición produce mismo resultado/hash |
| G5.6 | Fixed palettes | Aplicar presets de `palettePresets.ts` | Studio preset catalog | Colores de salida pertenecen al preset |
| G5.7 | Palette selection UI | Auto/preset seleccionado visible | Palette section | Keyboard/focus/undo/save recipe |
| G5.8 | Pipeline composition | Chroma → crop → resize → quantize documentado | Processing job | Golden tests demuestran el orden |
| G6.1 | Process action | Ejecutar recipe explícitamente | Slice toolbar | Disabled/dirty/progress/cancel states correctos |
| G6.2 | Processing status | Idle/processing/completed/error | Job Center/status bar | State machine sin estados imposibles |
| G6.3 | Result previews | Grid de tiles con dimensiones/reduction | Slices tray | Virtualización si count alto; checkerboard/zoom |
| G6.4 | Per-result download | PNG individual | Result action/Export Center | Blob válido, filename/index/dimensions correctos |
| G6.5 | Download all | Export batch | Export Center | Todos los resultados, orden y cleanup |
| G6.6 | Commit as regions | Crear regiones no destructivas cuando no hay raster ops | `regions.commitRecipe` | Bounds/source/provenance y undo batch |
| G6.7 | Commit as assets | Persistir outputs transformados | AssetRepository + regions | Blobs durables, hashes, reload y undo refs |
| G6.8 | Result summary | Count/layout/output size/reduction/warnings | Slice summary | Coincide con manifest real |
| G6.9 | Tips/next action | Orientar a Animate/Compose/Export | Contextual empty/completed state | Acciones alcanzables y focus correcto |
| G7.1 | Toasts | Success/error/info/magic equivalentes | Studio feedback | Announced, deduplicated y actionable |
| G7.2 | Error boundary | Crash local no derriba proyecto | Feature boundary | Worker/UI throw muestra retry/report y preserva project |
| G7.3 | Skip links/landmarks | Navegación rápida | Studio shell | Keyboard/screen-reader smoke |
| G7.4 | Focus visible/labels | Controles entendibles sin mouse | Shared primitives | Axe/manual keyboard pass |
| G7.5 | Reduced motion | Desactivar transiciones no esenciales | Global preference | Media query + setting verificados |
| G7.6 | Esc shortcut | Cancelar eyedropper/operación contextual | Command registry | Prioridad modal/tool correcta |
| G7.7 | Ctrl/Cmd+E | Exportar resultados | Command registry | No dispara en input; plataforma correcta |

## Contrato del worker

```ts
type ProcessingRequest = {
  type: "process";
  requestId: string;
  source: ImageBitmap;
  recipe: GridSplitRecipeV1;
};

type ProcessingResponse =
  | { type: "progress"; requestId: string; stage: string; completed: number; total: number }
  | { type: "success"; requestId: string; result: WorkerProcessResult }
  | { type: "error"; requestId: string; error: ProcessingError }
  | { type: "cancelled"; requestId: string };
```

El adapter:

- Mantiene un map `requestId → resolver/job` y nunca un listener por promise sin routing.
- Usa una cola inicialmente serial para limitar memoria; el pool sólo crece con profiling.
- Acepta `AbortSignal`; cancel termina trabajo cooperativamente o recicla el worker si no responde.
- Define timeout por stage/tamaño, no un número mágico único.
- Maneja `error`/`messageerror`, rechaza jobs pendientes y crea un worker limpio.
- Cierra `ImageBitmap`, revoca URLs staged y elimina blobs no committed.
- Emite progreso throttled y errores tipados (`invalid-input`, `decode`, `detect`, `memory`, `cancelled`, `worker-crash`, `timeout`).
- No transfiere el source si otra feature lo necesita sin poder recrearlo desde AssetRepository.

## Equivalencia algorítmica

Antes de optimizar, el port debe congelar resultados del donante mediante golden fixtures:

1. Ejecutar el worker donante sobre las cuatro fixtures existentes y una suite ampliada.
2. Guardar manifest de bounds, layout, dimensiones, reduction y SHA-256 de pixels normalizados.
3. Portar funciones en unidades: chroma, trim, quantization, resize, energy profile, segments, detect y process grid.
4. Comparar exacto donde el algoritmo es determinista; usar tolerancia pixel documentada sólo en feather/color math.
5. Toda divergencia intencional requiere fixture, explicación y aprobación en ADR.

Fixtures adicionales obligatorias:

- Grid con gutters irregulares y dimensiones no divisibles.
- Fondo verde/azul con anti-alias y foreground cercano al chroma.
- Celdas vacías, completamente opacas y completamente transparentes.
- Sprites tocando bordes, un solo pixel y padding mayor al margen.
- Imagen grande cerca del límite, alta cantidad de celdas y cancel mid-job.
- Palette menor/mayor que colores reales, alpha parcial y mismo RGB con distinto alpha.

## Slices de implementación

### G0 — Slice source session

- **Owner:** `[gpt-5.6-sol | xhigh]` contract/flows; `[gpt-5.6-luna | max]` primitives acotados.
- **Dependencias:** Foundation F2, F5-F7.
- **Writable:** `features/slice/source/**`, drop router/Asset Library adapters y tests G1.1-G1.6.
- **Entregable:** file picker/drop, validación/decode, source preview/metadata y replace/reset con lifecycle limpio.
- **Prueba:** PNG/JPEG/WebP, corrupt/oversized/false MIME, drop/keyboard, replace durante/tras job y URL cleanup.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh; G2 no empieza sin su source contract estable.

### G1 — Worker protocol y golden harness

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** Foundation F1, F2, F7.
- **Writable:** `core/processing/**`, `features/slice/processing/**`, golden fixtures/tests.
- **Entregable:** request-scoped adapter, cancel/progress/error/recovery y harness del worker donante.
- **Prueba:** concurrent requests no se cruzan; cancel/crash/timeout limpian recursos; golden baseline capturado.
- **Retorno:** `done` antes de portar UI que consuma payloads del worker; G0 puede avanzar en paralelo porque sólo depende del AssetRepository/source contract.

### G2 — Grid detection/manual layout

- **Owner:** `[gpt-5.6-sol | xhigh]` algoritmo; `[gpt-5.6-luna | max]` controles UI.
- **Dependencias:** G0-G1, Foundation F5/F6.
- **Writable:** `features/slice/grid/**`, worker grid stages y tests G2.*.
- **Entregable:** auto/manual, rows/cols, detected feedback y overlay Studio.
- **Prueba:** golden + geometry/property tests + screenshot overlay.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh.

### G3 — Crop threshold y padding

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** G2.
- **Writable:** crop stage/inspector y fixtures.
- **Entregable:** trim/crop reproducible, threshold, padding y reduction metadata.
- **Prueba:** G3.* y edge fixtures; no out-of-bounds.
- **Retorno:** `done` con exact/tolerance report.

### G4 — Chroma key y eyedropper

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** G1, G3, Foundation F5.
- **Writable:** chroma stage, background inspector y canvas eyedropper tool.
- **Entregable:** color/tolerance/smoothness/spill y orden chroma→crop.
- **Prueba:** visual goldens, zoom/DPR picking, keyboard cancel, foreground safety.
- **Retorno:** `done` con evidencia comparativa y accessibility checks.

### G5 — Pixel snapping, quantization y palettes

- **Owner:** `[gpt-5.6-sol | xhigh]` algoritmo/determinismo; `[gpt-5.6-luna | max]` preset UI.
- **Dependencias:** G3-G4.
- **Writable:** pixel/quantization stages, palette catalog/inspector y tests.
- **Entregable:** resize nearest-neighbor, quantize count, auto/fixed palettes y recipe persistence.
- **Prueba:** hashes repetibles, palette membership, alpha y performance.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh.

### G6 — Staged results y commit transaccional

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** G2-G5, Foundation F1-F3.
- **Writable:** results tray, region/asset commands y AssetRepository adapter.
- **Entregable:** previews, selection, summary, commit as regions/assets y un undo batch.
- **Prueba:** process→commit→save→reload→undo; no URL/blob leaks.
- **Retorno:** `done` con graph integrity y portable package checks.

### G7 — Downloads/export y workflow handoff

- **Owner:** `[gpt-5.6-luna | max]`, revisión `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** G6, Foundation F7 `ExportPort`/format registry.
- **Writable:** result actions, export adapter y contextual next actions.
- **Entregable:** download one/all mediante ExportPort, safe names, manifest y navegación a Compose/Animate/Export; A11 sólo adopta estas acciones en el Center.
- **Prueba:** blobs/nombres/count/orden y keyboard shortcut.
- **Retorno:** `needs-review` con artifact samples.

### G8 — Accessibility, resilience y cuarentena legacy

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** G0-G7.
- **Writable:** Slice feature boundary, shared primitives, obsolete host slicer adapter y docs.
- **Entregable:** keyboard/screen reader/reduced-motion/error recovery; el slicer legacy queda fallback-only detrás de flag, sin nuevos consumidores. Su eliminación física espera R2.
- **Prueba:** G7.*, hostile paths de import/replace/reset, worker crash/retry, compact desktop, no console warnings y full parity matrix.
- **Retorno:** `done` cuando no queda `App`/store/worker donante en runtime y el path host legacy está aislado para rollback, no mezclado con el canonical.

## Gate de paridad Grid Splitter

Desde un proyecto Studio, una persona debe poder importar la fixture 3x3, detectar nueve celdas, cambiar a manual, ajustar crop/chroma/pixel/palette, cancelar/reintentar, revisar resultados, hacer commit, guardar/reabrir y exportar uno/todos. Los outputs deben cumplir el manifest golden y poder usarse inmediatamente en Compose/Animate sin reimportación.

Las 48 filas G1.1-G7.7 requieren trazabilidad a test automatizado o evidencia manual registrada; el worker real, no sólo helpers y fixtures estáticos, debe ejecutarse en CI/E2E.
