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

## F2-05 — Transactional asset repository mutations

- **Estado:** `accept` después de reparaciones independientes de lifecycle,
  procedencia y exclusión mutación/lease.
- **Servicio:** import, replace y remove unen identidad SHA, IndexedDB y leases
  runtime detrás del contrato público. La frontera sólo acepta metadata propia,
  enumerable y data-only, y conserva los siete campos canónicos de provenance.
- **Atomicidad:** `put` obtiene el record anterior real dentro de la misma
  transacción que confirma metadata/blob; el blob reemplazado se elimina sólo
  al perder su última referencia global. La invalidación de URL ocurre después
  del commit exitoso, por lo que fallos inyectados conservan record, bytes y URL
  previos. Remove mantiene la misma garantía.
- **Concurrencia y cierre:** un gate por asset cubre la mutación completa y
  rechaza leases nuevas durante replace/remove. `dispose` aborta identity
  providers y storage waits pendientes antes de cerrar; una operación tardía
  termina tipada y no alcanza `put`.
- **Evidencia:** 23/23 tests focales; checkpoint acumulado 22 suites/216 tests,
  typecheck, build y lint exit 0. Chromium real en
  `../../artifacts/quality/F2/2026-07-14/repository-mutations-browser.json`
  verificó dedup, rollback/commit de replace y remove, provenance exacta,
  exclusión de leases durante mutación, dispose pendiente y balance 2 URL
  creadas/2 revocadas. Los probes post-revoke producen únicamente los dos
  `ERR_FILE_NOT_FOUND` esperados; cero page errors.
- **Revisión:** el reviewer reprodujo la pérdida de provenance, el provider de
  identidad no cooperativo y la ventana remove/lease; las regresiones finales
  pasan y el veredicto independiente es `accept`.

## F2-06 — Read-only integrity scan and garbage-collection preview

- **Estado:** `accept` después de una revisión independiente `repair` y dos
  reproducciones hostiles cerradas.
- **Snapshot:** metadata de todos los proyectos y blobs globales se capturan en
  una única transacción IndexedDB readonly. El reporte del proyecto ordena
  assets, hashea una sola vez cada blob compartido y distingue `ok`, faltante,
  tamaño y hash; issues del envelope quedan separados.
- **GC seguro:** un candidato requiere cero referencias de metadata globales,
  no sólo cero referencias del proyecto abierto. El resultado es explícitamente
  `mode: preview`, calcula bytes recuperables y no llama ni expone delete.
- **Boundary/lifecycle:** arrays, entries, hashes y records se leen sin getters;
  hashes exigen strings primitivas. Blob usa brand-check, slice y arrayBuffer
  nativos antes de un identity provider validado/abort-raced. Caller abort y
  `dispose` terminan scans aunque snapshot/provider no cooperen.
- **Reparación de review:** `String(contentHash)` ejecutaba `toString` hostil e
  `instanceof Blob` podía activar `getPrototypeOf` de un Proxy. Las regresiones
  finales observan cero coerciones y cero traps, sin errores crudos.
- **Evidencia:** 39/39 tests focales; checkpoint acumulado 23 suites/223 tests,
  typecheck, build y lint exit 0. Chromium real en
  `../../artifacts/quality/F2/2026-07-14/integrity-scan-browser.json` verificó
  `ok/blob-missing/hash-mismatch`, un único huérfano, blob de otro proyecto no
  recolectable, reporte repetible, conteos 4→4, pre-abort, boundary hostil,
  cleanup y cero page/console errors. Veredicto independiente final: `accept`.

## F2-07 — Real reload and cleanup browser journey

- **Estado:** `accept` después de una revisión independiente `repair` de dos
  posibles falsos positivos del harness. F2 queda cerrado.
- **Journey reproducible:** `tests/browser/assetRepositoryReloadJourney.ts`
  persiste un blob, crea una lease y registra `pagehide → dispose`; Playwright
  recarga el documento real y ejecuta la segunda etapa sobre la misma base.
- **Persistencia:** tras reload, metadata/hash y texto exacto reaparecen,
  `AssetIntegrity` es `ok` y el record durable no contiene `blob:`. La URL del
  documento anterior ya no es fetchable.
- **Cleanup:** dos owners comparten URL; sigue fetchable tras el primer release
  y deja de serlo tras el último. Una URL final deja de ser fetchable después
  de `dispose`, operaciones posteriores fallan tipadas y deleteDatabase termina
  `deleted`, no `blocked`, sin base listada.
- **Reparación de review:** contar 3 create/3 revoke podía ocultar revocaciones
  sobre URLs equivocadas y el artefacto no capturaba la consola observada. El
  harness ahora registra identidades después de cada llamada nativa, compara
  los multiconjuntos exactos y prueba ambos URLs revocados. El artefacto
  reconcilia tres `ERR_FILE_NOT_FOUND` intencionales y cero errores inesperados.
- **Evidencia:** typecheck y lint focal verdes; checkpoint producto permanece en
  23 suites/223 tests, build y lint exit 0. Chromium en
  `../../artifacts/quality/F2/2026-07-14/repository-reload-cleanup-browser.json`
  prueba reload, integridad, balance exacto 3/3, cleanup y cero page errors.
  Veredicto independiente final: `accept`.

## F3-01 — Canonical ProjectCodec and explicit version dispatch

- **Estado:** `accept` después de una revisión independiente `repair` de una
  fuga con Proxy revocado.
- **Encode:** valida el documento, crea snapshot recursivo sólo desde data
  properties propias, ordena keys por code unit, revalida y serializa el
  snapshot. No ejecuta accessors ni `toJSON`; ciclos, runtime values, non-finite
  y negative-zero no pueden producir JSON con round-trip ambiguo.
- **Decode/dispatch:** input debe ser string JSON. `schemaVersion` se extrae sin
  accessor, versiones futuras fallan como unsupported antes de V1, versiones
  ausentes/fraccionales/menores a uno son invalid document y V1 usa el validator
  canónico. La salida se normaliza de nuevo y re-encode es byte-estable.
- **Seguridad/exactitud:** diagnostics tipados no exponen `cause`; IDs como
  `__proto__` sobreviven como own data sin contaminar prototipos. Orden de
  inserción distinto produce el mismo JSON.
- **Reparación de review:** `Array.isArray` quedaba fuera del `try` de
  `readSchemaVersion`; un Proxy revocado filtraba `TypeError`. El preflight
  completo quedó contenido y la regresión exige `PROJECT_CODEC_INVALID_DOCUMENT`
  más diagnostic estable, sin causa pública.
- **Evidencia:** 44/44 tests focales; checkpoint 24 suites/235 tests, typecheck,
  build y lint exit 0 con deuda legacy/bundle sin cambios. Veredicto
  independiente final: `accept`.

## Frontier pendiente de review

- F3-02: migrator step interface y migration report tipado.
