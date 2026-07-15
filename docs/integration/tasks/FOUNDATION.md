# Tareas Foundation

Superficies propietarias: `core/project/**`, `core/assets/**`, `core/persistence/**`, `core/render/**`, `core/processing/**`, `core/export/**`, `components/studio/**`, adapters legacy declarados y tests equivalentes. Cambios fuera de estas superficies requieren actualizar el workplan antes de editar.

## Wave 0 — Contrato y baseline

| ID | Tipo | Dep. | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|
| F0-01 | J | — | Inventario exacto del modelo legacy, referencias por índice y fuentes de fixture | Punteros revisados + scope diff | done |
| F0-02 | J | F0-01 | Fixture legacy sanitizado y fixture V1 representativo, sin blobs/secretos | Fixture parse + provenance note | done |
| F0-03 | J | F0-01 | ADR de identidad, ownership, copy, cascade, drafts y serialization boundary | REV de decisiones ambiguas | done |
| F0-04 | E | F0-03 | Tipos `StudioProjectV1` y entidades JSON-safe en `core/project/**` | CT + edited-file check | done |
| F0-05 | E | F0-04 | Validator con diagnostics estables para shape, IDs, references, ownership y runtime values | UT contract validator | done |
| F0-06 | J | F0-02,F0-05 | Contract tests de empty, representative, legacy boundary y malformed graphs | CT + UT `tests/contract/**` | done |
| F0-07 | J | F0-03,F0-06 | Auditoría independiente del lote F0 y reconciliación de docs/ledger | REV `accept` + doc integrity | done |
| B0-01 | E | F0-07 | Script de inventario reproducible de LOC/lenguajes/superficies | Snapshot estable + REV | done |
| B0-02 | E | B0-01 | Baseline de unit/type/lint/build con fallos previos separados | Comandos/salidas versionadas + REV | done |
| B0-03 | E | B0-02 | Manifest de fixtures y journeys disponibles/faltantes | Paths existentes validados + REV | done |
| B0-04 | E | B0-02 | Baseline de bundle y cobertura con método reproducible | ART coverage/bundle summary + REV | done |
| B0-05 | J | B0-03,B0-04 | Aceptación W0 y budgets provisionales marcados como calibrables | `QUALITY_GATES.md` actualizado | done |

## Wave 1 — ProjectEngine y persistencia

| ID | Tipo | Dep. | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|
| F1-01 | J | F0-07 | Union de commands, metadata, diagnostics y `CommandResult` | Exhaustiveness CT + contract review | done |
| F1-02 | J | F1-01 | Helpers inmutables de graph lookup/clone y revision | UT identity/immutability | done |
| F1-03 | E | F1-02 | Commands project/asset/region mínimos con precondiciones | UT por familia + REV | done |
| F1-04 | E | F1-02 | Commands composition/layer/variant mínimos | UT por familia + REV | done |
| F1-05 | E | F1-02 | Commands sequence/cel/collision mínimos | UT por familia + REV | done |
| F1-06 | J | F1-03,F1-04,F1-05 | `analyzeImpact` para remove/relink/reslice y orphan policy | UT hostile graph matrix | done |
| F1-07 | J | F1-06 | Aplicación atómica, structured inverse y changed-ID sets | RT command→inverse | done |
| F1-08 | J | F1-07 | Property tests de delete/reorder/duplicate y graph invariants | UT seeded/property suite | done |
| F2-01 | J | F1-08 | Contrato `AssetRepository` y errores integrity/quota/not-found | Type contract + REV | done |
| F2-02 | E | F2-01 | Adapter IndexedDB para put/get/remove/list metadata/blob | IT real IndexedDB + REV | done |
| F2-03 | J | F2-02 | Hash/content identity y deduplicación binaria | UT known hashes + collision path | done |
| F2-04 | E | F2-02 | Runtime URL lease/revoke registry separado del documento | UT leak/refcount + REV | done |
| F2-05 | J | F2-03,F2-04 | Import/replace/remove service con transaction boundary | IT rollback on failure | done |
| F2-06 | J | F2-05 | Integrity scan y garbage-collection preview sin borrado implícito | IT missing/orphan blobs | done |
| F2-07 | J | F2-06 | Reload/cleanup browser journey del repository | BR + no leaked URLs | done |
| F3-01 | J | F1-08,F2-07 | `ProjectCodec` encode/decode con version dispatch | RT V1 exactness | done |
| F3-02 | J | F3-01 | Migrator step interface y migration report tipado | MIG ordered steps | done |
| F3-03 | J | F3-02 | Migración del fixture legacy real al V1 | MIG + invariant validation | done |
| F3-04 | E | F3-01,F2-07 | Package `.spriteboy` document+blobs import/export | ART unzip/hash + REV | done |
| F3-05 | J | F3-03,F3-04 | Autosave journal, atomic checkpoint y recovery candidate | IT crash/partial write | done |
| F3-06 | J | F3-05 | Future/corrupt/missing-asset recovery report sin pisar activo | MIG hostile fixture matrix | done |
| F3-07 | J | F3-06 | Journey save-close-reload + portable export/import | BR J1/J8 | active |
| F4-01 | J | F1-08 | Contratos separados Project/Workspace/Interaction/Job/Playback store | Type/API review | done |
| F4-02 | J | F4-01 | ProjectStore con revision y dispatch canónico | UT dispatch/subscription | done |
| F4-03 | E | F4-01 | Stores efímeros sin serialization/history | UT isolation + REV | done |
| F4-04 | J | F4-02 | History transactions record/coalesce/ignore | UT drag→single undo | done |
| F4-05 | E | F4-02,F4-03 | Selectores granulares y primer consumer batch declarado | Render-count UT + REV | done |
| F4-06 | J | F4-04,F4-05 | Batch undo/redo, external mutation guard y W1 store gate | IT + CT + REV | done |

## Wave 2 — Render, shell, jobs y CI

| ID | Tipo | Dep. | Resultado individual | Prueba de cierre | Estado |
|---|---|---|---|---|---|
| F5-01 | J | F1-08,F4-06 | `SceneProjection` canónica desde project+workspace | UT deterministic projection | done |
| F5-02 | J | F5-01 | Compositor asset/region/layer/variant/cel sin UI state | VIS fixture goldens | done |
| F5-03 | J | F5-02 | Invalidation scheduler; rAF sólo durante drag/playback | PERF 0 rAF idle | done |
| F5-04 | E | F5-02 | Thumbnail adapter sobre el compositor compartido | VIS parity + REV | done |
| F5-05 | E | F5-02 | Export render adapter sobre el compositor compartido | ART/VIS parity + REV | done |
| F5-06 | J | F5-03,F5-04,F5-05 | DPR/resize/context-loss/cleanup render gate | BR + PERF + REV | done |
| F6-01 | J | F4-06,F5-06 | Workspace registry Slice/Compose/Animate/Collision/Export | CT exhaustive registry | done |
| F6-02 | J | F6-01 | Command registry tipado, enablement y shortcut conflicts | UT no placeholder handler | done |
| F6-03 | E | F6-01 | Shell layout/header/nav usando registry | BR navigation + REV | done |
| F6-04 | E | F6-03 | Panel/modal primitives, focus contract y compact layout | A11Y + viewport proof + REV | done |
| F6-05 | J | F6-02,F6-04 | Empty/error/loading states de cinco workspaces | BR + A11Y | done |
| F6-06 | J | F6-05 | W2 shell gate: keyboard, no unreachable mode, no inert command | J9 + REV | done |
| F7-01 | J | F1-08,F4-06 | Typed Job lifecycle/progress/cancel/retry/timeout contracts | State-machine UT | done |
| F7-02 | J | F7-01 | Worker/job runner con abort y late-write suppression | IT cancel/crash/timeout | active |
| F7-03 | J | F7-02 | Job Center store/selectors and retention policy | UT state isolation | todo |
| F7-04 | E | F7-03,F6-04 | Job Center UI con progress/cancel/retry/errors | BR/A11Y + REV | todo |
| F7-05 | J | F7-01 | `ExportPort`, artifact writer y format registry contracts | CT + ART fake writer | todo |
| F7-06 | J | F7-02,F7-05 | Failure injection: quota, worker crash, timeout, cancel race | IT no late writes/leaks | todo |
| F7-07 | J | F7-04,F7-06 | W2 job/export gate y diagnostics policy | SEC + REV | todo |
| F8-01 | J | B0-05,F7-07 | Reconciliar ownership de `package.json`/lock antes de editar | Explicit diff/owner record | todo |
| F8-02 | E | F8-01 | Scripts estables type/lint/unit/integration/e2e/build | Command smoke + REV | todo |
| F8-03 | E | F8-02 | CI reproducible con lockfile e install congelado | CI failure injection + REV | todo |
| F8-04 | J | F8-02 | Coverage thresholds y fixture/golden retention policy | Deliberate fail/pass proof | todo |
| F8-05 | J | F8-02 | Bundle/performance/a11y budgets medidos y automatizados | PERF/A11Y artifact | todo |
| F8-06 | J | F8-03,F8-04,F8-05 | Full Foundation manifest y autorización de streams paralelos | All F gates + REV | todo |
