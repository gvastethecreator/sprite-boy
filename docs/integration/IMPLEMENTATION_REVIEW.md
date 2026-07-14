# Implementation quality review

Este registro empieza después del cierre de la misión documental. No reemplaza
`REVIEW_RECORD.md`: conserva decisiones, findings, reparaciones y evidencia de
los lotes que sí modifican producto.

## F0 — Canonical project contract

- **Estado:** `accept`.
- **Superficie:** `docs/architecture/ADR-001-canonical-project-model.md`,
  `core/project/**`, fixtures y contract tests F0.
- **Evidencia focalizada:** 35/35 contract tests.
- **Evidencia acumulada al cierre del lote:** 9 suites, 92 tests, typecheck,
  lint focalizado y build de producción aprobados.
- **Revisión independiente:** primera pasada `repair`; segunda pasada `accept`.
- **Reparaciones relevantes:** root V1 closed-world, validación total de valores
  hostiles, ownership bidireccional, artifact/provenance consistency, guards de
  factory y manifest regenerado.
- **Snapshot histórico:**
  `../../artifacts/quality/F0/2026-07-14/manifest.json`. Sus hashes representan
  exactamente el cierre F0; slices posteriores pueden extender barrels sin
  invalidar ese snapshot histórico.

## B0-01 — Deterministic source inventory

- **Estado:** `accept` después de reparación Sol.
- **Superficie:** `scripts/studio-baseline.mjs` y su test focalizado.
- **Evidencia:** 7/7 tests, lint focalizado sin warnings y dos ejecuciones con
  salida byte-identical sobre el mismo árbol.
- **Finding:** la primera versión seguía symlinks de archivos y podía leer un
  destino externo al root seleccionado.
- **Reparación:** el inventario admite sólo archivos físicos regulares y el contrato
  publica `symlinkPolicy: "exclude"`.

## B0-02 — Repository baseline

- **Estado:** `accept` como baseline con deuda separada.
- **Tests:** 12 suites, 118 tests, todos verdes.
- **Typecheck/build:** exit 0.
- **Lint:** exit 0 con 144 warnings legacy; archivos F0/F1/B0 focalizados,
  cero warnings.
- **Bundle:** main JS 841827 bytes (`227.48 kB` gzip reportado por Vite), por
  encima del budget release de 180 kB gzip. Queda como deuda medible B0-04, no
  como regresión introducida por este lote.

## F1-03 — Project, asset and region commands

- **Estado:** `accept` después de reparación Sol.
- **Evidencia focalizada:** 19/19 tests del contrato/primer reducer, typecheck y
  lint focalizado verdes.
- **Finding:** payloads runtime sparse/nulos o con getter/Proxy podían escapar
  como excepción antes de publicar diagnostics.
- **Reparación:** la frontera contiene lecturas hostiles como `INVALID_PATCH`,
  devuelve la identidad original y publica el reducer desde `core/project`.
- **Límite deliberado:** las inverses de remove se ejecutarán cuando F1-04/F1-07
  complete destructive commands y batch/round-trip; este lote sólo garantiza
  su forma tipada.

## B0-03/B0-04 — Fixtures, journeys, coverage and bundle

- **Estado:** `accept` como inventario/baseline; no es aceptación release.
- **Fixtures disponibles:** legacy V0 sanitizado y V1 representativo; ambos
  paths existen y tienen contract tests.
- **Fixtures faltantes:** Grid 3x3/irregular, recovery/migration hostile,
  export schemas y fake-provider generation.
- **Journeys:** J1-J9 están definidos, pero no existen `playwright.config.ts`,
  `tests/e2e` ni `tests/visual`; los nueve quedan `missing`, no `pass`.
- **Coverage:** 8.75% lines / 5.32% branches global sobre 54 archivos. El include
  actual omite `core/project/**`, por lo que no puede probar aún el threshold
  90/85 del ProjectEngine.
- **Bundle:** 841827 bytes raw / 224866 bytes gzip level 9; baseline sobre el
  budget y pendiente de code splitting.
- **Artifacts:** `../../artifacts/quality/B0/2026-07-14/fixtures-journeys.json`
  y `../../artifacts/quality/B0/2026-07-14/coverage-bundle.json`.

## B0-05 — Wave 0 acceptance

- **Estado:** `accept`.
- **Gate W0:** contrato V1 decidido; fixture legacy sanitizado disponible;
  manifest Grid fuente con 4/4 hashes reproducibles; baseline legacy separado.
- **Budget policy:** release targets no se relajan. El bundle actual queda como
  ratchet provisional de no-crecimiento y coverage canónica sigue `not-run`
  hasta incluir `core/project/**`.
- **Límite:** inputs donantes están congelados, pero outputs pixel-golden y
  fixtures copiadas al host continúan en G1/G2.

## F1-04 — Composition, layer and variant commands

- **Estado:** `accept` e integrado en el dispatcher público.
- **Comandos:** `composition.create`, `layer.add`, `layer.update`,
  `layer.reorder`, `variant.activate`.
- **Evidencia:** 10 tests propios; 20/20 al combinar con F1-03, typecheck y lint
  focalizado verdes.
- **Review:** ownership project/composition, payload order, optional deletion,
  invalid refs/indices, candidate invariants y getter payload containment.
- **Límite:** removes, duplicate/sync y variantes destructivas siguen en
  F1-06/F1-07; las inverses actuales congelan su shape tipada.

## F1-05 — Sequence, cel and collision commands

- **Estado:** `accept` después de dos rondas independientes `repair` y auditoría
  final Sol/xhigh local.
- **Comandos:** `sequence.create/update`, `cel.add/update/reorder`,
  `collisionSet.create` y `collision.add/update/remove`.
- **Evidencia:** 10 tests propios; 43/43 al combinar las cuatro suites del
  command kernel, typecheck y lint focalizado verdes.
- **Reparaciones de review:** `cel.update` ya no acepta `source`; shapes de
  command y patches son closed-world incluso ante symbols/no-enumerables;
  escrituras con ID `__proto__` no contaminan records; updates/reorders vacíos
  conservan identidad y no publican revisiones; timestamps e inverses restauran
  estado; comparaciones no normalizan prototypes/descriptors hostiles.
- **Límite:** payloads de graph privado en `cel.add` fallan explícitamente hasta
  que F1-06/F1-07 puedan calcular impacto y restaurar el graph atómicamente.
- **Independencia:** un tercer arranque de reviewer no pudo ejecutarse por
  límite de uso; no sustituyó los dos findings ya reproducidos y reparados. El
  cierre final fue una revisión Sol del source más las regresiones ejecutables.

## Frontier pendiente de review

## F1-06 — Impact analysis and prospective orphans

- **Estado:** `accept` después de tres pasadas independientes con reparaciones.
- **Superficie:** `core/project/impact.ts`, barrel público, matriz contract y
  reconciliación de semántica huérfana en Foundation/Index.
- **Evidencia focalizada:** 11/11 tests, typecheck y lint focalizado verdes.
- **Evidencia acumulada:** 15 suites, 153 tests, typecheck, build y lint exit 0;
  permanecen los 144 warnings legacy y el bundle baseline de 227.48 kB gzip.
- **Cobertura:** remove de todas las colecciones destructivas, ownership
  transitivo/cíclico, `reject | cascade`, reslice por batch, relink de cel y
  layer, owned graph nuevo, active variant, missing targets y graph inválido.
- **Reparaciones de review:** owned sources ahora se analizan dentro del mismo
  command; ownership ajeno bloquea; accessors/symbol/no-enumerable no se
  ejecutan ni normalizan; unknown/batch no pasan silenciosamente; batch separa
  mutaciones de deletes y mantiene estado prospectivo last-write. Double relink
  y referencias creadas hacia un target eliminado conservan blockers.
- **Decisión:** los “huérfanos” sólo existen como impacto prospectivo o recovery
  externo. Ningún command aceptado puede persistir dangling refs en V1.

- F1-07: aplicación atómica e inverse round-trip.
## F1-07 — Atomic apply, changed IDs and executable inverses

- **Estado:** `accept` después de una revisión independiente `repair` y su
  reproducción final.
- **Superficie:** deletes y cascades sobre candidate único, batches con
  delete-set combinado, `variant.remove/replace`, `cel.replaceSource`,
  changed-ID sets e inversas snapshot estructuradas y ejecutables.
- **Evidencia:** 52/52 tests en las cinco suites del command kernel,
  `tsc --noEmit` y lint focalizado verdes.
- **Reparaciones de review:** ciclos de referencias explícitamente borrados ya
  se aplican en una sola transacción; las fronteras command/inverse sólo leen
  propiedades top-level propias, enumerables y data-only. Los getters hostiles
  de `type`, ID y snapshot se rechazan con `INVALID_PATCH`, cero lecturas y la
  identidad original intacta.
- **Round-trip:** toda mutación aceptada emite snapshot exacto; la inverse
  restaura records, orders, workspace y timestamps sin depender de una inverse
  semántica incompleta.

## F1-08 — Seeded graph properties and native duplication

- **Estado:** `accept` después de una reproducción independiente `repair` y
  veredicto final.
- **Comandos:** `layer.duplicate` con inserción adyacente por defecto y
  `cel.duplicate` con deep copy de Composition/VariantSet/Layer y CollisionSet
  privados; Asset/Region binarios permanecen compartidos.
- **Evidencia:** 100 operaciones seeded delete/reorder/duplicate, seguidas de
  100 undo y 100 redo exactos; invariantes validadas en cada transición. Suite
  F1-08 4/4; checkpoint acumulado 17 suites/164 tests, typecheck/build verdes y
  lint exit 0 con los mismos 144 warnings legacy.
- **Reparación de review:** changed-ID sets y direct impact multi-entidad se
  deduplican y ordenan aun con allocator adversarial; la regresión reproduce
  IDs deliberadamente fuera de orden. El reviewer verificó además IDs hostiles
  como `__proto__`, owners de colisión remapeados y rollback exacto.

## F2-01 — AssetRepository boundary and recoverable errors

- **Estado:** `accept` después de reparar la lectura de `DOMException` nativa.
- **Contrato:** repositorio scoped por proyecto, metadata/blob separados,
  list/verify/remove/export, abort signals y leases de Object URL con
  `releaseOwner`/`dispose` fuera del documento durable.
- **Errores:** ocho códigos estables para not-found, blob-missing, integrity,
  quota, invalid-input, storage, abort y lease-conflict; recovery actions
  explícitas y diagnostic seguro sin `cause` privada.
- **Evidencia:** 8/8 tests, typecheck y lint focal verdes. La revisión reprodujo
  DOMException quota/not-found/abort/data, getter override con cero lecturas y
  Proxy contenido como storage-unavailable.
- **Decisión:** F2-02 implementa storage IndexedDB; hashing/content identity y
  URL refcount permanecen en F2-03/F2-04 para no mezclar responsabilidades.

## F2-02 — IndexedDB metadata/blob adapter

- **Estado:** `accept` tras dos rondas `repair` y reproducción final.
- **Storage:** metadata compound key por project/asset, índices project,
  project+hash y blobKey; blobs globales por key para deduplicación posterior.
  Put usa una transacción; remove conserva blobs compartidos y borra sólo al
  último metadata ref.
- **Lifecycle:** abort signals, close/reopen, versionchange y destroy bloqueado
  esperan eventos terminales. Opens tardíos se invalidan por generation y
  jamás reinstalan una conexión después de close.
- **Errores:** fallos sync/async de transaction/store/index y callbacks quedan
  tipados. `transaction.onerror` registra, pero el await sólo settle en
  complete/abort, después del rollback real.
- **Evidencia:** 17/17 tests focales y checkpoint acumulado 19 suites/181 tests,
  build, typecheck y lint; Chromium real en
  `../../artifacts/quality/F2/2026-07-14/indexeddb-browser.json` verificó reopen,
  dos proyectos, blob compartido, último-ref GC, DataClone rollback metadata y
  blob, abort, close-during-open y delete blocked; cero page errors.

## F2-03 — Content identity y deduplicación binaria

- **Estado:** `accept` tras una ronda `repair` independiente y reproducción de
  todos los hallazgos.
- **Identidad:** SHA-256 hex lowercase produce `sha256:<hash>`; SHA-512 queda
  como verificador independiente. Metadata hash/key/size/MIME debe describir
  exactamente el Blob antes de abrir storage.
- **Dedup/colisión:** dos metadata pueden compartir un único blob. Una misma
  key con verifier o tamaño distinto aborta la transacción con
  `ASSET_INTEGRITY_MISMATCH` y conserva blob/metadata anteriores.
- **Aborto/boundary:** `arrayBuffer`, digest e identity providers no
  cooperativos compiten con AbortSignal; outputs malformados y accessors
  hostiles quedan tipados sin lecturas ni promises pendientes.
- **Compatibilidad:** IndexedDB v2 prelee y hashea entries v1, revalida dentro
  del write transaction y backfillea identidad junto con metadata. Estados
  parciales o bytes diferentes fallan cerrados.
- **Evidencia:** 26/26 tests focales; checkpoint 20 suites/190 tests, build,
  typecheck y lint. Chromium real en
  `../../artifacts/quality/F2/2026-07-14/content-identity-browser.json` probó
  known vector, 2 metadata/1 blob, MIME wrapper, colisión con rollback, upgrade
  v1→v2, provider bloqueado abortado antes de abrir DB y cleanup sin errores.

## F2-04 — Runtime Object URL leases

- **Estado:** `accept` tras una ronda `repair` independiente y reproducción de
  sus dos carreras.
- **Ownership:** una lease idempotente por owner/asset; todos los owners de un
  asset comparten carga y URL. `releaseOwner`, `releaseAsset` y `dispose`
  limpian en forma determinista sin tocar el documento durable.
- **Lifecycle:** el último release aborta la carga interna y hace settle del
  acquire público aunque el loader no coopere. Una URL creada tarde se revoca;
  una generación stale nunca revoca la URL registrada por la generación viva.
- **Errores:** host ausente falla antes del loader. Loader/blob/create errors se
  tipan como create-url; revoke/observer failures no interrumpen cleanup y
  producen diagnostic release-url cuando existe observer.
- **Evidencia:** 12/12 tests focales; checkpoint 21 suites/202 tests, build,
  typecheck y lint. Chromium real en
  `../../artifacts/quality/F2/2026-07-14/runtime-url-browser.json` verificó URL
  fetchable con un owner, revocada al último release/dispose, carga tardía y
  balance final 3 creadas/3 revocadas. Los dos ERR_FILE_NOT_FOUND son probes
  intencionales después de revoke; cero page errors.

## Frontier pendiente de review

- F2-05: import/replace/remove service y rollback boundary.
