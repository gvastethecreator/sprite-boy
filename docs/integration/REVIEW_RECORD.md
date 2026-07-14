# Quality review record

Misión: producir planes completos para replicación nativa de Animoto y Grid Splitter dentro de un único SpriteBoy Studio. Modo: documentación `change`; sin implementación de producto.

## Resultado comparado con baseline

| Eje | Baseline | Resultado |
|---|---|---|
| Arquitectura | `FrameData` incompatible, controller/context amplio, persistencia JSON/Blob URL e history ambiguo | Modelo normalizado, ownership, commands/transactions, AssetRepository, codec, render/jobs/shell y migration gates |
| Paridad donante | Sin inventario/orden durable | 64 behaviors Animoto + 48 Grid, todos source→slice→journey |
| No regresión host | Riesgo de perder Builder/Slicer/AI/Collision/Export/preferences al reemplazar legacy | 47 behaviors H1-H6 y slices S1/B1 antes de quarantine/removal |
| Ejecución | Sin frontier ni dependencia cross-feature | Waves F0→R2, ownership/model/effort, writable, proof, return, flags y soak |
| Evidencia | Tests actuales bajos/no E2E y visual manual | Gate manifest, nueve journeys, golden/contract/property/E2E/visual/a11y/perf/security/recovery |

## Revisión independiente

Reviewer: `gpt-5.6-sol | xhigh`, read-only y con contexto mínimo.

Primera pasada:

- 0 P0.
- 6 P1: graph normalizado incompleto; retiro legacy pre-soak; missing Slice source session; missing user keyframe upload; pérdida de exports host; G7 dependía de un Export Center futuro.
- 2 P2: DAG/paralelización Grid contradictorios; faltaban Reset/Contain/Cover/Ghost.

Reconciliación:

- `Layer`, `Cel` y `VariantSet` ahora son stores con ownership/copy/cascade; `CelSource` acepta variant set y V1 prohíbe composition nesting.
- X1 sólo aísla/desactiva legacy; R2 lo elimina después del soak.
- G0 posee pick/drop/validate/decode/preview/replace/reset.
- A4.11 y `cel.replaceSource` cubren user keyframes.
- H1.1-H1.6 y A11 definen Export Center superset; F7 aporta ExportPort temprano.
- G0/G1 bifurcan desde F7 y convergen en G2; G8 depende G0-G7 y S1.
- A3.4-A3.8 preservan quick actions del gizmo.

Segunda pasada:

- Los 6 P1 quedaron cerrados.
- Detectó 2 contradicciones P2 residuales G0/G1/G8; se corrigieron en DAG, return/dependencies y hostile-path proof.
- Sin findings P1/P2 conocidos después de la reconciliación final.

## Adversarial pressure autopsy

### Scope drift

- No se portó código ni se tocaron donantes/dependencias.
- La ampliación H1-H6 está dentro del pedido “mejorar y ampliar todo el Studio”: evita que la paridad donante reduzca el producto host.
- Licensing se mantuvo fuera por confirmación explícita de propiedad.
- Compatibilidad binaria automática con IndexedDB de otros origins no es un gate; se replica el comportamiento de proyectos sobre ProjectCodec. Cualquier importer de donor sessions será un adapter explícito, nunca lectura cross-origin implícita.

### Interfaces ocultas auditadas

- Project graph: owner, source unions, duplication/cascade/orphans y stable identity.
- Storage: blob keys/hashes, runtime URL ownership, quota/integrity y package recovery.
- Async: request IDs, progress, abort, timeout, late writes, worker/provider/export cleanup.
- Visual: RenderEngine compartido entre canvas, thumbnails y artifacts.
- Shell: workspaces/commands/panels/modals/shortcuts/preferences bajo un registry.
- Release: feature flags, migration preview/backup, fallback quarantine, soak y physical removal.

### Hostile paths con gate

- Missing/corrupt/expired assets y relink.
- Delete/reorder/reslice con refs activas; undo/redo durante batch/drag/generation.
- Double-dispatch, project/workspace switch y close durante async.
- Cancel before/start/mid/after success; worker crash/messageerror/timeout.
- Fully transparent/huge/non-divisible images, many cells, quota/memory pressure.
- Provider/codec unsupported, partial generation, missing frames y export cancel.
- Keyboard-only, compact viewport, 200% zoom, reduced motion y hidden tab.

### Cinco regrets evitados

1. Copiar dos `FrameData` incompatibles y descubrir la pérdida de identidad/persistencia tarde.
2. Crear un segundo store/shell/renderer y volver imposible undo/autosave cross-feature.
3. Reemplazar Slicer/Builder con subconjuntos grid/layers perdiendo 47 behaviors host.
4. Eliminar fallback antes de probar migración/soak/rollback real.
5. Llamar “paridad” a una UI que compila sin golden artifacts, browser journeys o hostile recovery.

### Riesgos residuales controlados

- Los budgets numéricos deben medirse en B0 sobre hardware registrado. Relajarlos exige ADR/evidencia; no se actualizan para hacer verde una regresión.
- La migration fixture determinará cuántos legacy Blob URLs pueden relinkearse automáticamente; faltantes quedan `needs-relink`, nunca success vacío.
- Live AI/codec browser coverage depende de provider/codec disponibles; fake-provider y artifact contracts siguen siendo required.

## Loop 10

Artifact delta: reviewer reconciliation, host parity protection, corrected DAG/rollout and adversarial gates are part of the plan of record.

Loop 10 verdict: `stop`

Razón: la misión documental alcanzó su stop condition y no quedan findings P1/P2 conocidos. El siguiente trabajo es una nueva misión de implementación que comienza en F0, no una extensión silenciosa de este plan.
