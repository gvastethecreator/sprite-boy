# Ledger atómico de implementación

Este ledger es la autoridad de ejecución debajo de [WORKPLAN.md](./WORKPLAN.md). `WORKPLAN.md` decide el orden entre slices; estos archivos deciden cada cambio individual, su dependencia y la evidencia necesaria para cerrarlo.

## Contrato de una tarea

Una tarea sólo pasa a `done` cuando su dependencia está cerrada, cambia únicamente la superficie writable de su slice, entrega un resultado ejecutable, pasa su prueba focalizada y actualiza la trazabilidad afectada. Si fue ejecutada por Luna/max, un revisor Sol/xhigh debe leer el diff y la evidencia y devolver `accept`; `repair` o `reset` mantienen la tarea abierta.

Estados: `todo`, `active`, `needs-review`, `done`, `blocked`. Un blocker incluye comando, error exacto y condición para reanudar.

## Claves

| Clave | Significado |
|---|---|
| J | Juicio: `gpt-5.6-sol` con esfuerzo `xhigh` |
| E | Ejecución acotada: `gpt-5.6-luna` con esfuerzo `max`; requiere audit J |
| CT | `bun run typecheck` |
| UT | Vitest focalizado |
| RT | Round-trip/contract test |
| IT | Integration test con adapters reales |
| BR | Browser journey reproducible |
| VIS | Golden/screenshot/pixel diff |
| A11Y | Teclado, foco, ARIA y reduced-motion |
| PERF | Budget medido |
| ART | Artifact decode/schema/content verification |
| MIG | Fixture legacy/future/corrupt + recovery proof |
| SEC | Redaction, secret y hostile-input checks |
| REV | Raw diff + evidence audit independiente |

## Archivos propietarios

- [Foundation tasks](./tasks/FOUNDATION.md): F0-F8 y B0.
- [Grid/Slice tasks](./tasks/GRID.md): G0-G8 y S1.
- [Editor/Release tasks](./tasks/EDITOR.md): A1-A12, B1, I1, C1, X1 y R1-R2.
- [Implementation quality review](./IMPLEMENTATION_REVIEW.md): findings,
  reparaciones y evidencia aceptada por lote.

## Frontier activo

Foundation F0-F8 y W1/W2 están cerrados. `F8-03` y `F8-06` pasaron clean
worktree, frozen install, audit, baseline/drift, `all` 14/14, fixtures,
persistence, build, budgets, E2E y revisión independiente final `ACCEPT` con
P0-P3 en cero. El repair P3 de higiene temporal quedó verificado 29/29 y con
conteo `%TEMP%/sprite-boy-repro-*` `0 -> 0`.

El frontier activo es Grid: G0 y G1 están autorizados. Editor conserva sus
dependencias declaradas y no se adelanta a los gates Grid/Compose.

La inspección read-only previa que describía package/lock como user-owned y sin
workflow se conserva sólo como baseline histórico en
[F8_REPRODUCIBILITY_OWNERSHIP.md](./F8_REPRODUCIBILITY_OWNERSHIP.md); no es el
estado vigente.

## Conteo y cobertura

| Stream | Tareas | Behaviors cubiertos | Estado inicial |
|---|---:|---:|---|
| Foundation | 65 | Contratos transversales de los 159 outcomes | F0 y primer kernel accepted; B0/F1 activos |
| Grid/Slice | 49 | 48 Grid + 8 host H4 | todo |
| Editor/Release | 84 | 64 Animoto + 39 host restantes | todo |
| **Total** | **198** | **159 outcomes; algunos requieren varias tareas** | — |

Los behavior IDs siguen definidos en [TRACEABILITY.md](./TRACEABILITY.md). Una tarea puede cerrar varios IDs relacionados, pero ningún ID puede quedar sin slice, journey y gate.

## Política de actualización

- La tarea cambia a `active` antes de editar producto.
- Una tarea E cambia a `needs-review` al terminar la ejecución; nunca directamente a `done`.
- El reviewer registra `accept | repair | reset`. Sólo `accept` permite `done`.
- Cada cinco loops se revisa qué falta, cuál es el mayor riesgo y si conviene continuar, preguntar o detenerse.
- Los suites completos se agrupan después de varios tasks aceptados; no sustituyen checks focalizados.
