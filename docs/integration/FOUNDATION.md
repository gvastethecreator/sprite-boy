# Foundation del Studio unificado

Este plan crea el suelo común requerido para replicar Animoto y Grid Splitter sin convertir SpriteBoy en tres aplicaciones acopladas. Ningún slice de paridad puede saltarse F0-F6.

## Deuda que bloquea la integración

| Riesgo actual | Evidencia | Resolución requerida |
|---|---|---|
| Dos significados incompatibles de frame | `types/core.ts:34` frente a `D:\DEV\animoto\types\index.ts:60` | Sustituir el concepto transversal por `Region`, `Composition` y `Cel` |
| Identidad por índice | `hooks/useProjectController.ts:329` borra por índice y `:424` entrega `frame.id` | Commands basados en IDs estables y tests de delete/reorder |
| Reslicing rompe referencias | `handleSetGridConfig` regenera `frames` sin reparar animaciones/colisiones | Impact preview + transaction + orphan policy |
| Proyecto no portable | `hooks/domains/usePersistence.ts:37` serializa JSON con URLs runtime | Asset repository + codec versionado + package con blobs |
| Historial ambiguo | `hooks/useUndo.ts:57` compara JSON completo; drag ephemeral/final puede colapsar | Command log/snapshots estructurados y transaction boundaries |
| Estado y render demasiado amplios | `ProjectContext` publica el controller completo; `AppLayout` lo consume masivamente | Selectores granulares y stores durable/ephemeral separados |
| Render idle continuo | `hooks/canvas/useCanvasRenderLoop.ts` mantiene rAF | Scheduler por invalidación con loop sólo durante playback/drag |
| Modos/acciones incompletos | `COLLISION` no está en el header; Open/Analyze tienen acciones vacías | Registry tipado de workspaces/commands, sin handlers placeholder |
| Assets divididos | `utils/db.ts` persiste sólo builder assets mientras proyecto usa otras fuentes | Repositorio binario único para todos los asset kinds |

## Estructura destino

La migración es incremental; no se mueve todo el repositorio en un commit. Los nuevos límites viven en:

```text
core/
  project/          schema, commands, reducer, transactions, selectors
  assets/           repository, runtime URLs, hashes, garbage collection
  persistence/      codec, migrations, package import/export, recovery
  processing/       typed jobs, worker pool, cancellation, progress
  render/           scene projection, invalidation, compositing
  ai/               provider-neutral jobs, provenance, cost
  export/           artifact jobs, writers y format registry
features/
  assets/
  slice/
  compose/
  animate/
  collision/
  export/
components/studio/  shell, workspace registry, shared panels/modals
tests/
  contract/
  integration/
  e2e/
```

El código legacy permanece detrás de adapters hasta que su slice haya pasado parity y migration gates; entonces se elimina en el mismo slice o en un cleanup inmediatamente posterior con pruebas verdes.

## Esquema canónico

El primer formato durable se denomina `StudioProjectV1`. La versión refiere al formato, no al producto.

```ts
type EntityId = string;

interface StudioProjectV1 {
  schemaVersion: 1;
  id: EntityId;
  name: string;
  createdAt: string;
  updatedAt: string;
  rootOrder: {
    assetIds: EntityId[];
    regionIds: EntityId[];
    compositionIds: EntityId[];
    sequenceIds: EntityId[];
  };
  assets: Record<EntityId, AssetRecord>;
  regions: Record<EntityId, Region>;
  layers: Record<EntityId, Layer>;
  compositions: Record<EntityId, Composition>;
  variantSets: Record<EntityId, VariantSet>;
  cels: Record<EntityId, Cel>;
  sequences: Record<EntityId, Sequence>;
  collisionSets: Record<EntityId, CollisionSet>;
  processingRecipes: Record<EntityId, ProcessingRecipe>;
  generatedArtifacts: Record<EntityId, GeneratedArtifact>;
  workspace: ProjectWorkspaceState;
}
```

Reglas:

- Los records normalizados son fuente de verdad. El orden se expresa con arrays de IDs en el owner; `rootOrder` contiene sólo entidades poseídas directamente por el proyecto.
- Todo owner almacena `id`, `createdAt`/`updatedAt` cuando corresponda y procedencia suficiente para repair/audit.
- `AssetRecord` referencia `blobKey` y `contentHash`; el blob no se duplica en el documento.
- `Composition.owner` es `project | cel | variantSet`. `Composition.layerIds` mantiene IDs ordenados; cada `Layer.compositionId` coincide con un único owner y su source es sólo `asset | region` en V1. No se permiten composiciones anidadas ni ciclos.
- `VariantSet` pertenece a un cel y posee composiciones alternativas por clave A/B/C/D; cambiar la variante activa no destruye las demás.
- `Sequence.celIds` contiene IDs de `Cel` y cada `Cel.sequenceId` coincide con un único owner. `CelSource` es `region | composition | variantSet`; las dos últimas fuentes deben pertenecer a ese cel y pueden agregar duration/transform/pivot overrides.
- `CollisionSet.owner` es una unión discriminada (`region`, `composition` o `cel`).
- `workspace` guarda selección durable útil al reabrir, pero no hover, drag, modal, object URL, progreso o playback clock.

Ownership/copy/cascade:

- Composition posee sus layers; una layer no se comparte. Duplicarla crea ID nuevo y comparte sólo el asset/region source.
- VariantSet posee sus composiciones alternativas. Un cel con variant set referencia exactamente el set que lo declara como owner.
- `cel.duplicate` hace deep copy de su graph privado (`VariantSet → Composition → Layer` o `Composition → Layer`) para permitir edición independiente, pero deduplica los assets binarios.
- Borrar un cel elimina su graph poseído sólo cuando no quedan referencias; borrar assets siempre usa impact analysis y confirmación.
- Validators rechazan IDs ausentes, owners múltiples y cualquier intento de introducir composición como layer source.

## Commands y transacciones

Las features nunca hacen `setProject({...})`. Ejecutan commands tipados:

```ts
dispatch(command, {
  transactionId?: string,
  history: "record" | "coalesce" | "ignore",
  origin: "user" | "migration" | "ai" | "worker",
});
```

Familias mínimas:

- Assets: `asset.import`, `asset.replace`, `asset.rename`, `asset.remove`.
- Regions: `regions.commitRecipe`, `region.update`, `region.remove`, `region.reorder`.
- Composition: `composition.create`, `layer.add/update/remove/reorder/duplicate/sync`.
- Variants: `variant.create`, `variant.activate`, `variant.replace`, `variant.remove`.
- Sequence: `sequence.create/update`, `cel.add/remove/reorder/duplicate/swap/batchUpdate`.
- User keyframes: `cel.replaceSource` importa/centra una composition de una layer, conserva lock/prompt según policy y registra un solo history entry.
- Collision: `collisionSet.create`, `collision.add/update/remove`.
- AI: `generation.plan/apply/cancel/accept/reject`.
- Project: `project.rename`, `project.import`, `project.relink`, `project.recover`.
- Export: `export.request`, `export.cancel`, `export.retry`; nunca muta el documento salvo guardar provenance opcional del artifact.

Cada reducer valida precondiciones y devuelve `CommandResult` con `changedIds`, warnings, impactos de huérfanos prospectivos y una inverse operation o snapshot estructurado. Un huérfano prospectivo nunca se persiste como referencia colgante en V1: bloquea la operación hasta relink/reemplazo o una cascada legal. Las actualizaciones continuas de gizmo usan un `transactionId`; pointer-down abre, pointer-move coalesce y pointer-up confirma una sola entrada.

Operaciones destructivas con referencias:

1. `analyzeImpact(command)` calcula owners afectados.
2. La UI muestra summary cuando el impacto no es local.
3. El usuario elige cancelar y conservar el grafo intacto, relinkear/reemplazar antes de borrar, o cascada cuando sea legal.
4. El command aplica una transacción atómica.
5. Undo restaura todo el grafo, no sólo la colección primaria.

## Estado durable y efímero

| Store | Contenido | Persistencia | History |
|---|---|---|---|
| `ProjectStore` | Documento normalizado y revision | Sí | Sí |
| `WorkspaceStore` | workspace activo, panel sizes, selección, viewport, preferencias | Parcial por proyecto/usuario | Sólo selección durable si aporta valor |
| `InteractionStore` | hover, drag, guides, marquee, modal, context menu | No | No |
| `PlaybackStore` | playing, cursor, accumulator, dropped frames | No | No |
| `JobStore` | worker/AI/export jobs, progress, cancel, logs | Sólo resumen/provenance final | No |

Los componentes se suscriben a selectores mínimos con igualdad estable. `AppLayout` sólo orquesta regiones del shell; no recibe ni redistribuye el controller completo.

## AssetRepository

Contrato requerido:

```ts
interface AssetRepository {
  readonly projectId: EntityId;
  put(blob: Blob, metadata: AssetMetadata, options?: AssetOperationOptions): Promise<AssetRecord>;
  getMetadata(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetRecord>;
  getBlob(assetId: EntityId, options?: AssetOperationOptions): Promise<Blob>;
  list(options?: AssetListOptions): Promise<readonly AssetRecord[]>;
  verify(assetId: EntityId, options?: AssetOperationOptions): Promise<AssetIntegrity>;
  remove(assetId: EntityId, policy: AssetRemovalPolicy, options?: AssetOperationOptions): Promise<void>;
  exportMany(assetIds: readonly EntityId[], options?: AssetOperationOptions): AsyncIterable<AssetPayload>;
  createRuntimeUrl(assetId: EntityId, owner: object, options?: AssetOperationOptions): Promise<string>;
  releaseRuntimeUrl(assetId: EntityId, owner: object): void;
  releaseOwner(owner: object): void;
  dispose(): void;
}
```

- SHA-256 evita duplicados accidentales y permite integrity checks.
- IndexedDB contiene blobs y metadata indexada por project/content hash.
- El runtime URL manager usa reference counting y revoca al desmontar/reemplazar/cerrar proyecto.
- Borrado sólo ocurre cuando no hay referencias o después de una cascada confirmada.
- Importación valida MIME real, dimensiones, límites y decode; filename no basta.
- Una cuota insuficiente produce error recuperable y ofrece exportar/limpiar/reintentar.
- Not-found, blob-missing, integrity, quota, invalid-input, storage, abort y
  lease-conflict cruzan la frontera como `AssetRepositoryError` tipado; nunca
  como strings del adapter. Los diagnostics no serializan la causa privada.

## ProjectCodec y paquetes

Formato de trabajo:

- Autosave: documento JSON versionado + blobs deduplicados en IndexedDB.
- Export portable: archivo `.spriteboy` ZIP con `manifest.json`, `assets/<hash>.<ext>` y checksums.
- Legacy import: JSON actual de SpriteBoy, proyectos/sesiones Animoto cuando sea razonable y assets sueltos.
- Recovery journal: último manifest confirmado y transacción pendiente para detectar escrituras interrumpidas.

Pipeline al abrir:

1. Parsear como `unknown`; nunca castear JSON directamente.
2. Validar envelope y versión.
3. Migrar paso a paso sobre copia inmutable.
4. Verificar assets y referencias.
5. Reparar sólo transformaciones deterministas; listar pérdidas/huérfanos.
6. Confirmar documento nuevo en storage.
7. Recién entonces reemplazar el proyecto activo.

La importación no modifica el proyecto activo hasta que todo el pipeline pasa o el usuario acepta un recovery report.

### Migración desde SpriteBoy legacy

| Legacy | Destino | Regla |
|---|---|---|
| `imageMeta` | `AssetRecord` | Resolver binario; si la URL expiró, pedir relink y verificar dimensiones/hash |
| `frames[]` | `Region` | Crear IDs estables y conservar `hidden`; extraer hitboxes |
| `frame.hitboxes` | `CollisionSet` owner region | Mantener tipo/tag/geometría |
| `builderAssets[]` | `AssetRecord` | Deduplicar contra asset principal por hash |
| `builderSlots` | `Composition` + layers | Una composición para el canvas; cada slot se vuelve layer con transform calculado |
| `builderFreeObjects` | layers | Conservar z-index, rotation, flip, opacity y bounds |
| `animations[]` | `Sequence` + cels | Traducir `sourceIndex` mediante mapa legacy-index → stable source ID |
| grid/template/onion/mode | project/workspace preferences | Separar durable de efímero |

Si falta el binario de una URL legacy, la migración queda `needs-relink`; nunca crea un asset vacío fingiendo éxito.

## RenderEngine

- Proyección pura `project revision + workspace state -> render scene`.
- Caches por asset/composition revision; invalidación por `changedIds` del command.
- Un scheduler dibuja al cambiar escena, viewport o overlay. Playback y drag habilitan rAF temporal y lo detienen al finalizar.
- El mismo compositor produce preview, onion skin, thumbnails y export; evita divergencia visual.
- Canvas principal mantiene device-pixel-ratio, pixel-perfect nearest-neighbor cuando corresponda y límites de zoom.
- Operaciones costosas se miden y se mueven a worker/OffscreenCanvas sólo con contract tests y fallback.

## StudioShell

El registry de workspaces reemplaza condicionales dispersos:

```ts
interface WorkspaceDefinition {
  id: "assets" | "slice" | "compose" | "animate" | "collision";
  label: string;
  icon: IconName;
  canEnter(context: WorkspaceContext): GateResult;
  leftPanel: ComponentType;
  toolbar: ComponentType;
  inspector: ComponentType;
  bottomPanel?: ComponentType;
  commands: CommandId[];
}
```

Todos los entries aparecen en header/command palette cuando son aplicables. Si falta input, el entry se mantiene alcanzable con empty state y acción de resolución; no desaparece silenciosamente. Paneles, dialogs, tooltips, toasts y shortcuts usan primitives compartidos y tokens de `index.css`.

## Slices de Foundation

### F0 — ADR y contract tests

- **Owner:** `[gpt-5.6-sol | xhigh]`
- **Dependencias:** ninguna.
- **Writable:** `docs/architecture/`, `core/project/` types de contrato, `tests/contract/`.
- **Entregable:** ADR del modelo/commands y tests de invariantes que fallen contra el legacy.
- **Prueba:** fixtures prueban IDs estables, no Blob URLs y referencias válidas.
- **Retorno:** `done` con ADR aceptada; `needs-review` ante cualquier concepto ambiguo.

### F1 — Schema normalizado y commands puros

- **Owner:** `[gpt-5.6-sol | xhigh]` diseño; `[gpt-5.6-luna | max]` implementación acotada.
- **Dependencias:** F0.
- **Writable:** `core/project/**`, `tests/contract/project-*`.
- **Entregable:** `StudioProjectV1`, validadores, reducer/commands, impact analysis e inverse operations.
- **Prueba:** unit/property tests de add/update/delete/reorder/cascade y 100 operaciones undo/redo aleatorias sin violar invariantes.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh del diff y los tests.

### F2 — AssetRepository y runtime URL lifecycle

- **Owner:** `[gpt-5.6-sol | xhigh]` contrato/edge cases; `[gpt-5.6-luna | max]` adapter IndexedDB.
- **Dependencias:** F1 IDs/schema.
- **Writable:** `core/assets/**`, migration adapter de `utils/db.ts`, tests de assets.
- **Entregable:** storage deduplicado, validation, reference-counted URLs, quota/integrity errors.
- **Prueba:** reload real conserva imágenes; replace/remove revoca URLs; corrupt/missing/quota paths son recuperables.
- **Retorno:** `needs-review` hasta browser + diff audit Sol/xhigh.

### F3 — ProjectCodec, autosave y migration legacy

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** F1-F2.
- **Writable:** `core/persistence/**`, legacy persistence adapter, migration fixtures.
- **Entregable:** validate/migrate/recover, `.spriteboy` import/export y autosave transaccional.
- **Prueba:** fixtures current/legacy/malformed/future/corrupt; save-close-reload; portable export en un browser profile limpio.
- **Retorno:** `done` sólo con recovery report verificado y cero pérdida silenciosa.

### F4 — Store split, selectors e history transactions

- **Owner:** `[gpt-5.6-sol | xhigh]` arquitectura; `[gpt-5.6-luna | max]` migración de consumidores por lotes.
- **Dependencias:** F1.
- **Writable:** `core/project/**`, stores, `ProjectContext`, hooks consumidores acordados.
- **Entregable:** Project/Workspace/Interaction/Playback/Job stores y selectores granulares.
- **Prueba:** render-count tests; un drag = un undo; batch = un undo; transient state no ensucia autosave.
- **Retorno:** cada lote `needs-review`; no retirar controller legacy hasta migrar todos sus consumidores.

### F5 — RenderEngine por invalidación

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** F1, F4.
- **Writable:** `core/render/**`, canvas hooks/render utils y tests visuales.
- **Entregable:** scene projection, scheduler, compositor compartido y adapter al canvas actual.
- **Prueba:** 0 rAF sostenido idle; visual parity baseline; playback estable; DPR/zoom/pixel grid correctos.
- **Retorno:** `done` con performance trace y screenshots aprobados.

### F6 — StudioShell y command/workspace registry

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** F4-F5.
- **Writable:** `components/studio/**`, layout/header/palette y shared primitives.
- **Entregable:** workspaces alcanzables, panel contracts, command registry sin placeholders y layout persistence.
- **Prueba:** keyboard navigation y E2E de entrada/empty-state para cinco workspaces; Collision visible.
- **Retorno:** `done` con desktop 1440x900, compact desktop y reduced-motion verificados.

### F7 — Observabilidad, jobs y error taxonomy

- **Owner:** `[gpt-5.6-sol | xhigh]`.
- **Dependencias:** F1, F4.
- **Writable:** `core/processing/**`, `core/export/**`, Job Center, error boundary/toasts.
- **Entregable:** request IDs, status/progress/cancel/retry, structured errors, `ExportPort`/format registry mínimo y debug summaries sin secretos.
- **Prueba:** cancel/timeout/worker-crash/provider/export-error no dejan state o URL leaks; reintento controlado y artifact manifest validado.
- **Retorno:** `done` cuando todos los ports pueden usar el contrato.

### F8 — CI y baseline de calidad

- **Owner:** `[gpt-5.6-sol | xhigh]` estrategia; `[gpt-5.6-luna | max]` configuración.
- **Dependencias:** F0-F7.
- **Writable:** `.github/workflows/**`, config de lint/test/E2E, scripts y tests.
- **Entregable:** pipeline reproducible con lockfile trackeado, lint sin warnings, unit/integration/E2E/build y budgets.
- **Prueba:** ejecución local y CI verdes; failure injection demuestra que cada gate bloquea.
- **Retorno:** `needs-review` hasta auditoría Sol/xhigh del workflow y supply chain.

## Gate de salida de Foundation

Foundation está completa cuando:

- Un proyecto legacy real migra, se guarda, recarga y exporta/importa portablemente.
- Commands preservan invariantes bajo delete/reorder/reslice y undo/redo.
- Asset lifecycle no persiste URLs runtime ni pierde blobs.
- El shell expone todos los workspaces y no contiene acciones placeholder.
- El canvas queda idle sin rAF continuo y sus renders no divergen del export.
- CI y los gates F0-F8 están verdes.

Hasta ese punto, los features nuevos pueden usar prototypes detrás de flags, pero no reemplazar recorridos productivos.
