# ADR-001: modelo canónico del proyecto Studio

- Estado: accepted for F0
- Fecha: 2026-07-14
- Decisores: Studio Foundation
- Implementa: F0-F1

## Contexto

El modelo legacy mezcla documento durable, URLs runtime, estado de Builder y animación basada en índices. `FrameData.id` es numérico, varias operaciones reciben índices, `Keyframe.sourceIndex` puede referir tanto un frame como un slot y el JSON actual no tiene versión ni validación. Animoto y Grid Splitter agregan composiciones, variantes, procesamiento y assets derivados; portar sus stores produciría tres motores de proyecto incompatibles.

La integración necesita un único contrato durable, normalizado, JSON-safe y ajeno a React, DOM, IndexedDB y workers. F0 congela ese contrato; F1 implementa commands e inverses sobre él.

## Decisión

### Identidad y orden

- Toda entidad usa un `EntityId` string no vacío. El key de cada record debe ser idéntico a `entity.id`.
- Commands reciben un `IdFactory`; ningún reducer genera IDs con índice, `Date.now()` o `Math.random()`.
- Los arrays expresan orden, nunca identidad. El root mantiene órdenes explícitos de assets, regions, composiciones standalone y sequences.
- Cada ID aparece una sola vez en el array propietario. Drafts standalone sin consumidores son válidos; entidades internas sin owner son inválidas.
- Timestamps durables son strings ISO-8601. Tests y migraciones inyectan reloj.

### Ownership del grafo

- El proyecto posee assets, regions, recipes, artifacts y composiciones standalone.
- Una `Composition` declara owner discriminado:
  - `{ type: "project" }` para un draft o composición reutilizable del workspace Compose;
  - `{ type: "cel", celId }` para una composición privada de un cel;
  - `{ type: "variantSet", variantSetId, variant }` para una alternativa A/B/C/D.
- Una composición posee sus layers mediante `layerIds`; cada `Layer.compositionId` debe coincidir y una layer no puede aparecer en dos composiciones.
- Un layer sólo referencia `{ type: "asset" | "region", id }` en V1. Las composiciones anidadas están prohibidas.
- Una `Sequence` posee sus cels mediante `celIds`; cada `Cel.sequenceId` debe coincidir y un cel no puede pertenecer a dos sequences.
- `CelSource` es `region | composition | variantSet`. Una source composition debe estar poseída por ese cel. Un source variantSet debe declarar el mismo `celId`.
- Un `VariantSet` pertenece a un cel y posee de una a cuatro composiciones. Cada key de `variants` debe coincidir con el owner `{ variantSetId, variant }` de la composición referida.
- `CollisionSet.owner` referencia exactamente un region, composition o cel existente. Un owner puede tener como máximo un CollisionSet V1.

### Assets y límite de serialización

- `AssetRecord` contiene `blobKey`, `contentHash`, MIME, dimensiones, byte size y provenance; nunca contiene el Blob ni su URL.
- Object URLs se crean mediante leases runtime del `AssetRepository` y no entran al project store, history, commands, fixtures canónicos ni codec.
- El documento acepta sólo valores JSON: null, boolean, string, número finito, arrays y plain objects. Rechaza `undefined`, funciones, symbols, bigint, ciclos, `Date`, DOM nodes, typed arrays y prototypes de runtime.
- Strings que empiezan con `blob:` o `data:` son inválidos en el documento V1. El binario se guarda una sola vez fuera del JSON.
- Hover, drag, modal, progreso, errores temporales, selección transitoria, playback clock y URL leases pertenecen a stores efímeros.
- `generatedArtifacts` registra sólo resultados completados/aceptados y su provenance. `pending`, `failed`, progress y retries viven exclusivamente en JobStore.

### Copy, delete y referencias

- Duplicar una layer crea ID nuevo y comparte únicamente su asset/region source.
- Duplicar un cel crea un cel nuevo y hace deep-copy de su graph privado: VariantSet → Composition → Layer o Composition → Layer. Los assets siguen deduplicados.
- Duplicar una composición standalone hace deep-copy de sus layers.
- Delete nunca adivina una cascada. `analyzeImpact` enumera referencias; el command destructivo exige policy explícita y se aplica como una transacción atómica.
- Borrar un cel puede eliminar su graph privado sólo dentro de la misma transacción. Borrar un asset nunca borra owners silenciosamente.
- Undo restaura el grafo y sus órdenes; el lifecycle binario se coordina con AssetRepository, no con snapshots que contengan URLs.

### Migración legacy

- `imageMeta` y `builderAssets` se convierten a assets mediante un resolver binario externo. Un `blob:` perdido produce `needs-relink`; no se inventa contenido.
- `frames[]` se convierten en regions con IDs deterministas y orden preservado. Sus hitboxes se convierten en CollisionSets de owner region.
- Builder grid/free se migra a composiciones/layers conservando cell clip, fit, alignment, transforms y z-order; no se colapsa a un único scale aproximado.
- `animations[]` se convierten en sequences; cada keyframe usa su `uid` como semilla estable y sus overrides se preservan.
- Si `Keyframe.sourceIndex` coincide tanto con `FrameData.id` como con `SlotData.gridIndex`, la migración emite `AMBIGUOUS_LEGACY_CEL_SOURCE`. No elige silenciosamente entre preview slot-first y export frame-first.
- Valores creados durante migración (project ID, nombre y timestamps) provienen del contexto de migración y se registran en el report.

### Diagnostics mínimos

El validator devuelve diagnostics ordenados `{ code, path, message, entityId? }`. F0 reserva como mínimo:

- `INVALID_DOCUMENT`, `UNSUPPORTED_SCHEMA_VERSION`, `NON_JSON_VALUE`, `RUNTIME_URL`;
- `INVALID_ID`, `KEY_ID_MISMATCH`, `ORDER_MISMATCH`, `DUPLICATE_OWNERSHIP`;
- `MISSING_REFERENCE`, `OWNER_MISMATCH`, `NESTED_COMPOSITION_FORBIDDEN`;
- `INVALID_NUMBER`, `INVALID_TIMESTAMP`, `INVALID_DIMENSIONS`.

Validation no repara ni muta. Codec/migration pueden construir un recovery report usando estos diagnostics.

## Consecuencias

- Animoto y Grid Splitter se adaptan al mismo graph y command engine en vez de traer reducers raíz.
- La primera implementación es más estricta que el JSON legacy, pero los fallos son recuperables y visibles.
- Las composiciones privadas evitan que editar un cel cambie otros cels por referencia accidental.
- El contrato reserva provenance y recipes para procesamiento/AI/export sin introducir estado de jobs al documento.
- F1 debe mantener los invariants después de cada command; no basta validar sólo al guardar.

## Alternativas rechazadas

- Reutilizar `ProjectState`: conserva identidad por índice, URLs runtime y semántica ambigua de source.
- Portar el reducer de Animoto: crea un segundo engine y no cubre Slice/Collision/Builder.
- Persistir Blob/Data URLs: el proyecto deja de ser portable y rompe reload/revoke.
- Resolver automáticamente `sourceIndex` ambiguo: cambia silenciosamente preview o export histórico.
- Permitir composition-as-layer: introduce ciclos y ownership recursivo antes de existir un caso V1 probado.

## Gate de aceptación

F0 cierra cuando tipos, fixtures y validator ejecutan estas decisiones, los tests prueban hostile graphs y una revisión independiente devuelve `accept`.
