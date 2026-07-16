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

## F3-02 — Ordered migrator and typed migration report

- **Estado:** `accept` después de revisión independiente `repair` sobre dos
  límites hostiles reproducidos.
- **Orden/atomicidad:** el constructor exige IDs/source versions únicos y pasos
  contiguos. `migrate` preflighta la ruta completa antes de invocar un paso,
  entrega a cada uno una copia data-only congelada y conserva el último
  documento aplicado si el siguiente queda `needs-input`.
- **Report:** `unchanged | migrated | needs-input`, versiones source/target/
  reached, pasos applied/pending e issues discriminados `change`, `warning`,
  `loss`, `needs-relink` y `ambiguity`. Un completed no admite blockers y un
  needs-input exige al menos uno.
- **Frontera hostil:** requests/resultados se leen por descriptors; ciclos,
  accessors, arrays sparse/no-enumerables, símbolos, prototypes runtime y
  Proxies se contienen como errores tipados. Abort compite con pasos async no
  cooperativos y los diagnostics no exponen la causa privada.
- **Reparación de review:** índices no enumerables se clonaban como visibles y
  la asimilación Promise podía ejecutar un getter `then` antes del validator.
  El clonado ahora preserva semántica data-only y la adopción de PromiseLike
  sólo acepta métodos `then` obtenidos por descriptor, sin ejecutar accessors.
- **Evidencia:** 14/14 tests del migrator; checkpoint 25 suites/249 tests,
  typecheck, build y lint exit 0 con las mismas 144 warnings legacy y warning
  de bundle. Veredicto independiente final: `repair+accept`.

## F3-03 — Real legacy V0 fixture migration to canonical V1

- **Estado:** `accept` después de dos rondas independientes `repair` y
  regresiones para cada hallazgo reproducido.
- **Preview/resolution:** sin contexto devuelve `needs-input` con dos
  `LEGACY_ASSET_NEEDS_RELINK` y `AMBIGUOUS_LEGACY_CEL_SOURCE`; no aplica el step
  ni adivina precedencia. Asset resolutions requieren hash/blobKey/bytes/MIME
  coherentes y la cel ambigua exige elección frame o Builder slot.
- **Conversión:** produce IDs estables, AssetRecords deduplicados por content
  hash, Regions y CollisionSets, composición Builder con slot/free layers,
  Sequences/Cels con `1000/fps`, pivots incluso negativos, recipe de grilla y
  workspace durable. La elección Builder crea una composición propiedad del
  cel; la elección frame referencia la Region.
- **Pérdida visible:** constraints fit/alignment quedan aplanados al transform
  visual actual; `aspectRatio`, labels/colores/onion y spacing no representable
  aparecen como issues tipados. Campos legacy desconocidos fallan: no se
  descarta estado durable silenciosamente.
- **Reparaciones de review:** context/resolution accessors podían ejecutarse;
  un builder asset llamado `source-sheet` pisaba el rol sintético; hash iguales
  no se deduplicaban; `aspectRatio` se descartaba; pivots negativos válidos se
  rechazaban. Todos tienen regresión y frontera descriptor-safe.
- **Evidencia:** 11/11 tests del fixture/migration, ProjectCodec round-trip y
  validator V1; checkpoint 26 suites/260 tests, typecheck, build y lint exit 0
  con deuda legacy/bundle sin cambios. Veredicto final: `repair+accept`.

## F3-04 — Portable `.spriteboy` package

- **Estado:** `accept` después de revisión independiente `repair+accept` y
  regresiones para cada límite reparado.
- **Formato:** ZIP determinista con `manifest.json`, `project.json` y blobs
  deduplicados en `assets/<sha256>.<ext>`. El manifest conserva hash, MIME,
  bytes, dimensiones y los asset IDs consumidores; el proyecto pasa por
  `ProjectCodec` antes de exportar y después de importar.
- **Integridad:** export confirma la identidad binaria de cada blob. Import
  valida tamaño/hash del package, documento y assets, entradas requeridas y
  extra, paths seguros, versiones y coherencia de metadata antes de devolver un
  batch. No existe persistencia parcial dentro de esta frontera.
- **Reparaciones de review:** JSZip ocultaba duplicados físicos al sobrescribir
  nombres; ahora un preflight del directorio central rechaza duplicados,
  directorios, ZIP64/multidisk, cifrado, métodos no soportados e inconsistencias
  local/central antes de inflar. Señales, options y asset sources se normalizan
  por descriptors; abort compite con trabajo no cooperativo y limpia listeners.
  Assets que comparten hash también deben compartir dimensiones.
- **Evidencia:** 9/9 tests focales; checkpoint 27 suites/269 tests, typecheck,
  build y lint exit 0 con las mismas warnings legacy y warning de bundle. Lint
  focal `--deny-warnings` y `git diff --check` verdes. Veredicto independiente:
  `repair+accept`.

## F3-05 — Autosave journal and atomic recovery candidate

- **Estado:** `accept` después de revisión independiente `repair+accept` y
  checkpoint acumulado verde.
- **Contrato:** cada proyecto conserva un checkpoint confirmado y como máximo
  un journal pendiente con revision, base checkpoint, JSON canónico, SHA-256 y
  bytes. Otro autosave no puede pisar un recovery candidate sin commit o
  descarte explícito.
- **Atomicidad:** stage usa compare-and-write contra el checkpoint observado.
  Commit relee base+journal y escribe checkpoint+borrado dentro de una única
  transacción IndexedDB `readwrite`; stale writers fallan tipados.
- **Crash/recovery:** un fallo antes o durante commit deja intacto el último
  checkpoint y preserva el journal. Inspect verifica hash/bytes, codec y
  re-encode canónico antes de exponerlo como recovery candidate; nunca reemplaza
  el proyecto UI activo.
- **Reparaciones de review:** `QuotaExceededError` nativo se mapea sin ejecutar
  accessors; apertura IDB no cooperativa compite con abort y limpia listeners;
  options del adapter y resultados Promise-like son descriptor-safe; JSON
  válido pero no canónico ya no pasa integridad.
- **Evidencia:** 10/10 tests focales, incluido mock IDB con rollback de
  checkpoint+delete ante quota; checkpoint 28 suites/279 tests, typecheck,
  build y lint exit 0 con deuda legacy/bundle sin cambios. Lint focal estricto
  y diff check verdes. Veredicto independiente: `repair+accept`.

## F3-06 — Quarantined hostile recovery report

- **Estado:** `accept` después de revisión independiente `repair+accept` y
  matriz hostile completa.
- **Cuarentena:** el analyzer sólo recibe JSON, source, signal y un verifier de
  assets; no tiene setter/persistence callback. El proyecto decodificado y todo
  el report quedan deep-frozen. `canActivate` sólo es true con documento actual
  y todos los assets sanos.
- **Clasificación:** schema futuro, JSON/schema inválido, verifier ausente o
  fallido, metadata/blob missing y size/hash/MIME mismatch producen disposition,
  issue y acción deterministas sin reemplazar el activo ni esconder causa.
- **Integridad:** status y campos `expected*` del adapter no son autoridad. Las
  observaciones reales se comparan de nuevo con cada `AssetRecord` candidato;
  un falso mismatch saludable no bloquea y un falso `ok` no puede ocultar bytes
  ajenos.
- **Reparaciones de review:** los estados no-`ok` inicialmente se confiaban y
  podían crear falsos corruptos; la resolución nativa de un PromiseLike podía
  asimilar un `then` hostil anidado. Ahora toda observación se reclasifica y el
  valor resuelto se boxea antes de validar.
- **Evidencia:** 13/13 tests focales; checkpoint 29 suites/292 tests, typecheck,
  build y lint exit 0 con deuda legacy/bundle sin cambios. Accessors/Proxies,
  thenables anidados, abort/listener balance, frozen graph y causa privada
  cubiertos. Veredicto independiente final: `repair+accept`.

## F4-01 — Store boundary contracts

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Fronteras:** ProjectStore contiene el documento/revision y es el único con
  history por commands. WorkspaceStore conserva layout/viewport/preferencias
  parcialmente persistibles sin duplicar `project.workspace`. Interaction,
  Job y Playback son efímeros y sin history.
- **API:** cinco aliases concretos ligan kind, state, action y policy. Sólo
  exponen snapshot, subscribe y dispatch; la base genérica no es pública.
  Snapshots y resultados del proyecto son deep-readonly.
- **Reparaciones de review:** se incorporó WorkspaceStore, se cerró el bypass
  mutable de ProjectSnapshot/result, se eliminaron genéricos públicos capaces
  de mezclar estado/acción y jobs ausentes quedaron tipados como `undefined`.
  Registry y policies están congelados y ligados por tipo.
- **Evidencia:** 2/2 tests focales con checks negativos de compilación y API
  exacta; typecheck, lint focal `--deny-warnings` y diff-check verdes.
  Veredicto independiente final: `repair+accept`.

## F4-02 — Canonical ProjectStore dispatch and revision

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Dispatch:** el constructor valida V1 y revision. Cada envelope exacto y su
  metadata data-only se normalizan antes del reducer. Failed/no-op conservan
  snapshot/revision; un cambio crea un snapshot nuevo, incrementa una vez y
  notifica sólo después del commit.
- **Suscripción:** unsubscribe es idempotente; dispatch desde un listener se
  rechaza como precondition y no altera la revision. Un listener que lanza no
  impide los siguientes ni convierte un commit exitoso en excepción; el canal
  opcional recibe sólo un diagnostic frozen genérico.
- **Reparaciones de review:** la primera versión devolvía revision incorrecta
  con reentrancia, duplicaba observers, filtraba errores privados y aceptaba
  `metadata: null`. Options/context y metadata ahora son descriptor-safe y el
  overflow se decide antes de consumir reloj/IdFactory.
- **Evidencia:** 9/9 tests focales de ProjectStore y 2/2 de contracts; typecheck,
  lint focal `--deny-warnings` y diff-check verdes. Reproducciones de
  reentrancia, listener failure, metadata/accessors y providers en overflow
  incluidas. Veredicto independiente final: `repair+accept`.

## F4-03 — Isolated local stores

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Stores:** Workspace parcial y Interaction/Job/Playback efímeros comparten
  sólo una runtime privada de snapshot/subscription. Las factories públicas
  siguen concretas, frozen y sin APIs serialize/hydrate/history.
- **Aislamiento:** actions/snapshots son data-only; records aceptan IDs hostiles
  como `__proto__` sin pollution. Jobs rechazan project/revision y conservan
  extensiones lifecycle plain-data para F7. Un store nunca notifica a otro.
- **Reparaciones de review:** playback inicialmente permitía seek/advance sin
  sequence/playing; resets y reemplazos equivalentes cambiaban identity; un
  Proxy filtraba su mensaje privado. Se añadieron invariantes, igualdad
  estructural data-only y redacción de traps externos con estado estable.
- **Evidencia:** 9/9 tests focales locales y 2/2 de contracts; typecheck, lint
  focal `--deny-warnings` y diff-check verdes. Fixtures cubren no-op/reset,
  freeze, accessors, Proxy, ciclos, sparse arrays, prototypes runtime,
  reentrancia/observer failure, job order/pollution y playback inválido.
  Veredicto independiente final: `repair+accept`.

## F4-04 — Transactional project history

- **Estado:** `accept` después de tres rondas independientes `repair+accept`.
- **Semántica:** el controller separado registra, agrupa por transaction o
  ignora commands sin serializar inverses. Undo/redo aplican snapshots por el
  runtime interno del ProjectStore, generan una nueva revision y publican
  summaries frozen sólo después del commit.
- **Boundaries:** un ignore documental invalida ambos stacks; un
  `workspace.update` ignorado rebasa workspace y `updatedAt`, poda selecciones
  inexistentes por snapshot y valida el target. Undo/redo cierran el epoch para
  que una branch nueva no coalesce con historia recuperada.
- **Reparaciones de review:** se cerraron el undo de cambios ignorados, snapshots
  inválidos por selecciones nuevas, pérdida de `updatedAt`, reapertura de una
  transaction tras undo/redo, lectura Proxy de `selectedCelIds.length` y el
  guard booleano que fallaba durante notifications anidadas. El command
  `workspace.update` quedó implementado data-only, atómico y con inverse exacta.
- **Evidencia:** 34/34 tests focales de history/store/command, typecheck, lint
  focal `--deny-warnings` y diff-check verdes. Las reproducciones import→select
  ignored→undo/redo, transaction reuse y clear→dispatch anidado→undo pasan.
  Veredicto independiente final: `repair+accept`.
- **Diferido:** guard de mutación externa y retención/tamaño de snapshots son
  gates explícitos de F4-06, no blockers de F4-04.

## F4-05 — Granular selectors and timeline-layout consumer batch

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Selectors:** Project/Workspace/Interaction/Job/Playback exponen slices
  puros por referencia y lookups own-property. Los hooks concretos usan
  `useSyncExternalStore`, memo por render, equality opcional y el último valor
  committed; no mutan selector/equality refs durante render concurrente.
- **Consumer batch:** `StudioLocalStoresProvider` conserva lifetime estable y
  `TimelinePanel` consume exclusivamente `panelSizes.timeline`. `React.memo`
  evita que rerenders del ProjectContext legacy atraviesen el leaf; AppLayout
  dejó de leer decenas de controller fields muertos.
- **Reparaciones de review/autopsia:** la primera cache podía observar selector
  de un render abortado; se reemplazó por el patrón with-selector. Un tamaño
  externo 900/20 podía contradecir ARIA y viewport; el selector de lectura ahora
  clampa 120..500 además de teclado/drag.
- **Evidencia:** 26/26 gate focal inicial y 6/6 selectors+timeline tras repairs;
  typecheck, lint focal `--deny-warnings`, build y diff-check verdes. El warning
  de chunk >500 kB continúa como baseline previo. Revisión final: `accept`.

## F4-06 — Atomic batches, mutation boundary and history retention

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Batch/history:** `command.batch` analiza y ejecuta una única copia estable,
  publica una revisión y registra una entrada. Un child fallido revierte todo;
  el batch vacío es no-op y `project.restoreSnapshot` continúa privado para
  undo/redo. Retención por cantidad conserva las 100 entradas más recientes por
  defecto y acepta límites data-only de 1 a 1000.
- **Mutation guard:** initialProject se preflighta como data-only, se aísla con
  `structuredClone` y se valida otra vez. Todo comando público se clona
  recursivamente por descriptors antes del reducer y del hook de history;
  accessors, Proxies vivos, `toJSON`, ciclos, arrays sparse/custom y prototipos
  exóticos quedan rechazados o separados sin ejecutar getters. Snapshots,
  resultados, diagnostics e inverses se recorren y deep-freezean incluso si un
  root ya estaba shallow-frozen.
- **Reparaciones de review:** se eliminó la lectura directa repetida de
  `batch.commands`; después se cerraron tres escapes adicionales: history
  releía el batch externo, nested accessors sobrevivían el primer clon y los
  comandos individuales conservaban su Proxy. Los repros finales observan cero
  traps/getters y rollback/revision/history estables.
- **Evidencia:** gate focal 29/29; suite completo 37/37 archivos y 343/343 tests;
  typecheck, lint focal `--deny-warnings`, build y diff-check verdes. El warning
  de chunk >500 kB continúa como baseline previo. Veredicto final: `accept`.
- **Alcance del gate:** F4 y el store gate de W1 quedan aceptados. W1 global no
  se declara cerrado mientras F3-07 no ejecute J1/J8 en Chrome real.

## F5-01 — Canonical scene projection

- **Estado:** `accept` después de revisión independiente sin findings P0-P3.
- **Contrato:** `createSceneProjection` transforma revision de proyecto más
  viewport del workspace activo en un árbol data-only, copiado y deep-frozen.
  Panel sizes, preferences, interaction, playback, Canvas, object URLs y caches
  quedan fuera de la frontera.
- **Resolución:** Assets/Slice priorizan su selección pertinente; Compose usa
  composition/layer/variant y orden raíz; Animate/Collision/Export usan cel y
  orden de sequence antes del fallback visual. Un proyecto vacío produce root y
  canvas nulos con viewport determinista.
- **Árbol:** asset, region, composition, variant y cel normalizan descriptores
  binarios, source rects, transforms completos, dimensions/background y layers
  en orden canónico, conservando `visible`/`locked` para que F5-02 decida draw.
- **Evidencia:** gate focal 12/12; suite acumulada 38/38 archivos y 355/355
  tests; typecheck, lint focal `--deny-warnings`, build y diff-check verdes. La
  primera suite completa pasó 335 tests pero dos forks no iniciaron por timeout;
  ambos archivos pasaron 20/20 con un worker y la repetición unificada con tres
  workers cerró verde. El warning de chunk >500 kB continúa como baseline.

## F5-02 — Shared scene compositor

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Semántica:** ADR-002 fija `layerIds` bottom-to-top, x/y de layer como centro,
  transform afín translate/rotate/scale+flip/origin, y pivot de cel colocado en
  centro de canvas más offset. El background queda fijo al canvas.
- **Pipeline:** `createSceneDrawPlan` produce operaciones JSON-safe, copiadas y
  frozen; `compositeScene` resuelve assets únicos antes de `beginFrame`, dibuja
  en orden y devuelve error estable sin éxito parcial. Viewport/UI/playback no
  entran en el plan.
- **Canvas:** el target lógico limpia, normaliza alpha/composite/filter/shadow,
  aplica crop/matriz/opacity/sampling y restaura el estado externo incluso ante
  throw. DPR/resize/base viewport quedan explícitamente para F5-06.
- **Repair de review:** `abortFrame` era opcional y permitía que un target
  fallido retuviera estado/output parcial. Ahora es obligatorio (no-op para
  targets stateless) y draw/end failures prueban rollback exacto.
- **Evidencia:** 30/30 focales con pixel goldens de cinco roots, crop, painter
  order, flip, rotation, pivot, alpha y background; suite acumulada 39/39
  archivos y 373/373 tests; typecheck, lint focal `--deny-warnings`, build y
  diff-check verdes. Warning chunk >500 kB permanece como baseline.

## F5-03 — Invalidation-driven render scheduler

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Contrato:** scene/asset/viewport/overlay/resize coalescen en un frame
  determinista; revision máxima y changed IDs ordenados viajan con el snapshot.
  Drag/playback usan leases tokenizados y el último release cancela la cola
  vacía, dejando cero callbacks host en idle.
- **Concurrencia:** existe como máximo un request y un render async en vuelo.
  Invalidaciones durante render forman el frame siguiente. Un fallo restaura el
  dirty snapshot y corta la continuidad hasta una actividad externa posterior;
  dispose ignora completions tardías.
- **Repairs de review:** el primer request guard permitía recursión síncrona si
  `requestFrame` arrojaba y `onError` reinvalidaba. Además, release/dispose antes
  de que el host devolviera handle dejaba un callback huérfano. `requestingFrame`
  bloquea el reingreso; callback consumido y token cancelado se distinguen para
  cancelar el handle tardío sin tocar callbacks síncronos ya ejecutados.
- **Evidencia:** 14/14 focales; suite acumulada 40/40 archivos y 387/387 tests;
  typecheck, lint focal `--deny-warnings`, build y diff-check verdes. Revisión
  final independiente: `accept`. Warning chunk >500 kB permanece como baseline.

## F5-04 — Shared-compositor thumbnail adapter

- **Estado:** `accept` después de revisión independiente `repair+repair+accept`.
- **Contrato:** layout aspect-fit acotado a 2048 por eje, sin crop/padding ni
  upscale implícito. Empty scene no crea surface ni resuelve assets. Resultado
  frozen publica project/revision/workspace, source/output size, sampling, MIME y
  draw count para caches externos.
- **Pipeline:** `renderSceneThumbnail` entrega la proyección al compositor
  compartido y exige surface target/encode/dispose. El browser path transforma
  directamente al tamaño final sobre OffscreenCanvas o HTMLCanvas fallback; no
  aloja un canvas intermedio source-sized. Background, alpha, painter order y
  transforms provienen exclusivamente del compositor.
- **Repairs de review:** `instanceof Blob` rechazaba encoders de otro realm. La
  primera corrección por `toStringTag` aceptaba impostores estructurales. El gate
  final usa `Blob.prototype.slice` como brand check de internal slot: acepta
  iframe Blob real y rechaza spoof, conservando size/MIME exacto y cleanup.
- **Evidencia:** 16/16 focales y 32/32 compositor+thumbnail; suite acumulada
  41/41 archivos y 403/403 tests; typecheck, lint focal `--deny-warnings`, build
  y diff-check verdes. Revisión final: `accept`; warning >500 kB es baseline.

## F5-05 — Full-resolution scene export adapter

- **Estado:** `accept` después de revisión independiente `repair+accept`.
- **Contrato:** raster de una escena a resolución lógica exacta, PNG default o
  WebP con quality normalizada, sin crop/resize/padding. Rechaza más de 16384 por
  eje o 64M pixels antes de allocation; empty scene no toca ports. Resultado
  frozen publica project/revision/workspace, canvas, sampling, extensión, draw
  count, byte size y Blob con MIME exacto.
- **Pipeline:** export y thumbnail capturan un único `SceneDrawPlan` y lo
  ejecutan por el compositor compartido. Browser surface usa OffscreenCanvas o
  HTMLCanvas fallback, Canvas2D target común y cleanup 0x0 aun cuando una
  allocation no entrega contexto.
- **Artifact proof:** los cinco roots producen PNG con signature, chunks, CRC e
  inflate de scanlines válidos; pixels decodificados coinciden con los goldens
  del compositor. WebP prueba MIME/quality/metadata sin convertir F5-05 en codec
  de secuencia o download manager.
- **Repair de review:** validar el plan antes de `surfaceFactory.create` pero
  recompilar `request.projection` después permitía que una factory reentrante
  desacoplara límites, metadata y pixels. `compositeSceneDrawPlan` copia el plan
  defensivamente antes de awaits; regresiones mutan la proyección durante create
  en export y thumbnail y confirman que ambos conservan el snapshot inicial.
- **Evidencia:** 47/47 compositor+thumbnail+export; suite acumulada 42/42 archivos
  y 416/416 tests; typecheck, lint focal `--deny-warnings`, build y diff-check
  verdes. Ledger: 198/198 IDs únicos. Revisión final: `accept`; warning chunk
  >500 kB permanece como baseline.

## F5-06 — Browser scene viewport lifecycle

- **Estado:** `accept` después de revisión independiente
  `repair+accept+repair+accept` y gate Chrome real.
- **Contrato:** un owner por HTML canvas, container externo obligatorio como
  content-box resize target, backing `round(css × DPR)` acotado, y matriz base
  DPR × workspace scale/offset. Canvas2D background/draw comparten transform;
  exports/thumbnails permanecen en coordenadas lógicas.
- **Scheduling:** scene/asset/viewport/overlay/resize son one-shot; drag/playback
  usan leases. Context loss suspende scheduler conservando dirty/leases; restore
  readquiere contexto, invalida y reanuda una vez. Resize/restore durante asset
  resolve retira la generación vieja sin marcar failure ni perder follow-up.
- **Cleanup:** dispose invalida completions tardías, cancela rAF, desconecta
  ResizeObserver, window/MQL/canvas listeners y libera backing 0x0. Callbacks MQL
  ya encolados no pueden rearmar listeners. Init parcial hace rollback por port.
- **Repairs de review/browser:** una generación stale inicialmente marcaba el
  scheduler failed y varaba el resize nuevo; un callback DPR tardío rearmaba MQL
  tras dispose. Chrome detectó mezcla border-box/content-box. Review final halló
  feedback destructivo si el canvas se observaba a sí mismo en DPR>1
  (`300→600→1200…`). Suspend/resume, stale-neutral, guards post-dispose,
  content-box único y container externo obligatorio cierran los cuatro paths.
- **Browser/PERF:** Chrome headless real, URL
  `/tests/browser/sceneViewportHarness.html`, viewport 900×700 y DPR 2: backing
  640×360→400×200, pixel `[255,48,64,255]`, frame count idle estable `2`, restore
  redraw `3`, cleanup `0×0`, screenshot legible y `errors: []`.
- **Evidencia:** 45/45 compositor+scheduler+viewport; suite acumulada 43/43
  archivos y 429/429 tests; typecheck, lint focal `--deny-warnings`, build y
  diff-check verdes. Ledger 198/198. Revisión final: `accept`; warning chunk
  >500 kB permanece como baseline.

## F6-01 — Exhaustive Studio workspace registry

- **Estado:** `accept` después de revisión independiente sin hallazgos.
- **Vocabulario:** Slice, Compose, Animate, Collision y Export son los cinco
  destinos navegables. `assets` conserva su semántica durable y de proyección,
  pero se alcanza mediante Asset Library compartida. Contexto ausente/Assets se
  resuelve a Slice hasta que F6-03 despache `workspace.update`.
- **Contrato:** cada definición frozen enlaza ID, orden, label, descripción,
  href `#/studio/<id>`, command ID y capacidades de source/interacción/timeline.
  Rutas y command IDs se derivan del ID para impedir drift.
- **Exhaustividad:** `WORKSPACE_IDS` es la única lista canónica consumida por
  validator, command reducer y WorkspaceStore. Un tripwire TypeScript y la
  partición runtime prueban cinco destinos + `assets` sin IDs omitidos.
- **Evidencia:** 20/20 focales incluyendo regresiones de reducer/store; suite
  acumulada 44/44 archivos y 435/435 tests; typecheck, lint focal
  `--deny-warnings`, build y diff-check verdes. Revisión final: `accept`; warning
  de chunk >500 kB permanece como baseline.

## F6-02 — Typed executable command registry

- **Estado:** `accept` después de revisión independiente sin hallazgos.
- **Superficie:** 15 comandos ordenados para project new/open/save, asset
  import, undo/redo, cinco workspaces, canvas reset, palette, preferences y help.
  Analyze se omite porque no posee handler real; metadata no publica `action`.
- **Ejecución:** factory exige y captura un port exhaustivo de own-data
  functions. Cada ID tiene mapping compile-time exhaustivo; disabled retorna un
  resultado tipado sin invocar, mientras throws/rejections atraviesan el límite.
- **Shortcuts:** `KeyboardEvent.code`, modifiers semánticos primary/alt/shift y
  policy editable producen firmas canónicas. Auditoría determinista detecta IDs
  duplicados y chords compartidos antes de construir consumers.
- **Evidencia:** 15/15 registry+workspace focales; suite acumulada 45/45 archivos
  y 444/444 tests; typecheck, lint focal `--deny-warnings`, build y diff-check
  verdes. Revisión final: `accept`; warning chunk >500 kB sigue como baseline.

## F6-03 — Registry-driven Studio shell

- **Estado:** `accept` después de ejecución Luna acotada, integración Sol y
  revisión independiente sin defectos reproducibles.
- **Ruta:** `useStudioNavigation` normaliza `#/studio/<workspace>`, expone una
  subscription concurrent-safe a hash/history y conserva `history.state`.
  Back/forward, reload y links modificados no dependen de estado React duplicado.
- **Bridge:** la ruta activa se proyecta one-way a Builder/Animation/Collision/
  Template legacy. No existe ProjectStore paralelo; Slice y Compose comparten
  temporalmente Builder hasta que sus bodies migren en F6-05 y streams feature.
- **Shell:** header, cinco destinos, Project menu, undo/redo, Export CTA y palette
  se derivan de workspace/command registries. Disabled reasons se muestran sin
  dispatch; Open/Import alcanzan inputs reales y el timeline respeta capability.
- **Browser:** Chrome limpio 1440x900 probó invalid→Slice, Compose, Collision,
  back→Compose, reload→Compose y Ctrl+K/Export→Export. Los cinco links fueron
  visibles, label/URL concordaron y no hubo console errors ni exceptions.
- **Evidencia:** 27/27 focales; typecheck, lint focal `--deny-warnings`, build y
  diff-check verdes; review final `accept`. La baseline acumulada previa es
  45/45 archivos y 444/444 tests. El nuevo full run monolítico y shard 1/4
  agotaron 10/5 minutos bajo saturación externa sin publicar resultados; no se
  contabilizan como green ni como failure funcional.

## F6-04 — Shared modal/panel and compact accessibility contract

- **Estado:** `accept` después de implementación Luna acotada, repairs Sol,
  browser gate productivo y revisión independiente sin findings P0-P3.
- **Dialog:** `StudioDialog` concentra role/name/aria-modal, foco inicial,
  Tab/Shift+Tab cíclico, Escape, backdrop y restore exacto en close/unmount. No
  deja listeners/timers; `matchMedia` se suscribe sólo mientras está abierto.
- **Migración:** Settings, Help, Analysis, Generation, Export y Command Palette
  usan el primitive. Generation/Export movieron todos sus hooks antes de guards,
  eliminando hook-order variable. CSS global y GSAP compatibility path respetan
  `prefers-reduced-motion`.
- **Panels:** `StudioPanel` conserva un único árbol de Left/RightSidebar. A
  1440x900 se monta como Tools/Properties inline; a 1024x768 sólo existe el
  drawer solicitado dentro del focus boundary. Resize y workspace change cierran
  estado compacto transitorio.
- **Header compacto:** Project y workspace menus implementan roles, Arrow/Home/
  End/Escape, disabled filtering y restore. El breakpoint `xl` coincide con el
  layout; los cinco IDs/hrefs salen del registry.
- **Browser:** build productivo con reduced-motion forzado pasó 1440x900 y
  1024x768: cinco nav desktop/compact, dos panels desktop, Tools drawer, Collision,
  Settings y palette; foco interno/restaurado, page fit, cero errores/excepciones.
- **Evidencia:** primitives 8/8, header 6/6, palette 3/3; typecheck, lint focal
  `--deny-warnings`, build y diff-check verdes. La primera combinación ejecutó
  16/17 pero palette excedió el timeout fijo de 5s bajo saturación; aislada con
  ventana 20s terminó en 2.28s. Revisión final: `accept`.

## F6-05 — Workspace-aware empty/loading/error states

- **Estado:** `accept` después de browser repair y segunda revisión
  independiente. El primer review devolvió `repair` por pérdida de foco al
  desmontar la acción Compose→Slice; el journey endurecido prueba ahora foco en
  `Slice workspace content`.
- **Contrato:** `resolveStudioWorkspaceState` devuelve un union frozen y
  exhaustivo. Loading precede error; error precede ready/empty. Readiness usa
  source para Slice, canvas para Compose, cualquier escena para Animate/Export
  y al menos un frame seguro para Collision.
- **Presentación:** cada workspace tiene heading, descripción, icono y recovery
  distintos. Loading usa status/busy, error usa alert/retry/dismiss y empty sólo
  expone commands reales con disabled reason. No se agregó store ni placeholder.
- **Shell:** CanvasArea sólo monta para ready. Un shell failure conserva
  workspace/command para retry; cambiar de workspace limpia error transitorio.
  Navegar enfoca el contenido central nombrado. View transitions rápidas
  consumen su rejection de presentación sin ocultar ni cancelar el state update.
- **Browser:** build productivo recorrió cinco empty states, commands/recovery,
  Compose→Slice con foco y Slice empty→ready tras importar una imagen. Todos los
  layouts entraron en viewport; cero console errors y excepciones.
- **Evidencia:** 15/15 focales tras repair, gate acumulado F6 57/57, typecheck,
  lint focal `--deny-warnings`, build y diff-check verdes. Revisión final:
  `accept`; warning chunk >500 kB continúa como baseline.

## F6-06 — W2 keyboard, reachability and no-inert shell gate

- **Estado:** `accept` después de J9 y repair independiente. El review inicial
  encontró stuck Space-pan al perder focus antes del keyup; `window.blur` ahora
  resetea pan/modifiers y el listener se limpia en unmount.
- **Keyboard owner:** `StudioCommandRegistry.findByKeyboardInput` usa `code`,
  Ctrl o Cmd como primary, modificadores exactos y policy editable. Un único
  `useKeyboardShortcuts` ejecuta command IDs; modal/editable guards preceden a
  arrows, Delete, frame stepping y playback locales. Repeat no reabre comandos
  ni alterna playback varias veces.
- **Canvas:** Space-pan sólo captura cuando el contenido central tiene foco y no
  hay animación activa. Pointer sobre canvas transfiere ese foco; textarea,
  select, input, role textbox y contenteditable quedan excluidos. Keyup conserva
  modificadores restantes y blur limpia todos.
- **Reachability:** se eliminaron `components/layout/Header.tsx`, el array
  `CommandPaletteItem` del controller y sus Open/Analyze vacíos o rutas AppMode
  paralelas. El botón Snapshot ejecuta Export PNG real. Help sale de los mismos
  shortcuts frozen y ya no promete Hitbox copy/paste inexistente.
- **Browser J9:** Ctrl+1..5 alcanzó cinco hashes y focalizó cada destino;
  Preferences, Help y Palette respetaron modal/input guards; Ctrl+0 llevó zoom
  125%→100% y Snapshot abrió `Export Spritesheet`. 15 comandos documentados,
  cero console errors/exceptions.
- **Evidencia:** 20/20 focales iniciales, 65/65 acumulados F6, repair 17/17,
  typecheck, lint focal, build, diff/static reachability y review final `accept`.
  El primer server browser eligió un puerto ocupado y no contó; el harness final
  cerró verde con procesos/perfil propios.

## F7-01 — Typed job lifecycle and retry identity

- **Estado:** `accept` tras cuatro rondas independientes de `repair` y repro
  directo de cada bypass. Ningún worker, timer, Job Center o exporter fue
  adelantado desde F7-02..F7-05.
- **Máquina:** `createQueuedJob`, `transitionJob` y `retryJob` producen snapshots
  data-only/frozen para queued, running, succeeded, failed, cancelled y
  timed-out. Cada evento lleva request ID; tiempo/progreso nunca retroceden y
  un terminal ignora duplicados, conflictos, progreso o failures tardíos.
- **Errores:** failure codes cubren input/support/worker/provider/export/storage/
  quota/runtime. Cancel y timeout generan terminales estructurados retryable;
  no se persiste cause, payload privado ni documento en JobStore.
- **Retry:** un intento nuevo hereda kind/label/timeout, incrementa attempt y
  enlaza root/previous. El source debe existir, ser terminal/retryable y sólo
  puede consumirse una vez. IDs de job y request son single-use por sesión.
- **Retention temporal:** remove/reset ocultan jobs pero retienen tombstones de
  job/request y source consumido. Esto evita que una respuesta tardía coincida
  con una lifecycle reencarnada; la poda atómica y política visible son F7-03.
- **Repairs:** se cerraron retries huérfanos/branched, request duplicado,
  cancel/timeout sin start con progreso inventado, reuso tras remove y reuso de
  job/request tras reset. El pase final reprobó también una cadena fresca legal.
- **Evidencia:** focal 29/29; suite contract completa 38/38 archivos y 405/405
  tests; typecheck, lint focal `--deny-warnings`, build y diff-check verdes.
  Revisión final independiente: `accept`.

## F7-02 — Abortable JobRunner and late-write suppression

- **Boundary:** `core/processing/jobRunner.ts` recibe un queued snapshot y una
  tarea payload-agnostic. El runner reserva identidad antes del publish, toma el
  snapshot canónico de JobStore y posee start/progress/terminal, timer,
  AbortController, caller signal y cleanup. Worker/AI/export adapters reales
  permanecen en G1/A7/F7-05.
- **Semántica:** cancel, caller abort, dispose y timeout resuelven una sola vez.
  Progress/result/error tardío devuelve false o se descarta; un terminal que ya
  entró en commit no puede ser abortado falsamente por un subscriber reentrante.
  Fallos desconocidos se redactan y un `JobTaskError` mutable/adulterado se
  revalida o degrada a `runtime-failure` seguro.
- **Timers:** delays superiores a `2_147_483_647` se dividen en tramos para no
  sufrir el overflow de `setTimeout`; callbacks reentrantes, scheduling throw,
  cancel intermedio y handle cleanup conservan un solo terminal.
- **Repairs:** la revisión reprodujo y cerró dispose durante queued publish,
  cancel durante terminal commit, caller input mutable, error tipado mutable y
  timeout overflow. También se probó rechazo de identidad por JobStore sin fuga
  de active map ni invocación de tarea.
- **Evidencia:** 19/19 runner focal; 42/42 runner+lifecycle+store; suite contract
  completa 39/39 archivos y 424/424 tests; typecheck, lint focal
  `--deny-warnings`, build y diff-check verdes. Revisión independiente final:
  `accept`.

## F7-03 — Atomic Job Center retention and selectors

- **Ownership:** JobStore sigue siendo el único estado writable. La policy
  inmutable conserva 50 familias terminales por defecto y nunca crea otro store,
  history o persistencia. Animoto/Grid sólo aportan sus estados/toasts como
  evidencia; no tenían una retención portable.
- **Retention:** una familia se agrupa por `rootJobId`. Cualquier queued/running
  pinnea toda la ancestry; sólo familias completamente terminales excedentes se
  podan oldest-first en el mismo reducer commit. IDs de job/request pasan a
  tombstones y consumed retry sources nunca se olvidan ni reciclan.
- **Selectors:** factories memoizadas exponen entries active-first, familias y
  summary exacto por status. `retryable` cuenta sólo terminales con error
  retryable que aún no consumieron su único child.
- **Reentrancia:** `LocalStoreDispatchBusyError` permite que JobRunner difiera
  cancel/timeout cross-job hasta terminar el publish actual. First-terminal se
  reserva antes del microtask; caller abort/dispose usan la misma ruta y progress
  cross-notify devuelve false sin fallo estructural ni running huérfano.
- **Repairs:** review cerró summary de retry engañoso, cancel cross-job orphan y
  reemplazo de la primera razón terminal antes del flush. Reproducciones extra
  caller abort, dispose, timeout y completion ya encolada quedaron verdes.
- **Evidencia:** 43/43 focales locales y 52/52 del pase independiente; suite
  contract completa 40/40 archivos y 434/434 tests; typecheck, lint focal
  `--deny-warnings`, build y diff-check verdes. Revisión final: `accept`.

## F7-04 — Accessible global Job Center

- **Ownership:** `AppLayout` monta un solo drawer global sobre
  `StudioDialog`/`StudioPanel`; `StudioHeader` sólo expone el trigger y
  badge active/total. Abrirlo cierra cualquier menú del header. JobStore conserva
  todo el estado y los selectors F7-03; la UI no introdujo otro engine.
- **Acciones reales:** cancel invoca el JobRunner compartido por el provider.
  Retry sólo existe con un adapter inyectado y source retryable no consumido;
  throws síncronos o async se contienen sin exponer detalles privados. El
  provider cancela/dispose sólo su runner propio y nunca uno inyectado.
- **A11Y:** progressbar expone ratio, cada status anuncia label/attempt sin
  narrar cada tick y el resumen live distingue active/history con singular
  correcto. Details, Cancel y Retry tienen nombres contextuales. El drawer
  hereda trap, Escape, restore, backdrop y reduced-motion de los primitives.
- **Repairs:** la revisión cerró retry síncrono escapado, controles ambiguos,
  copy de historial incorrecto, transición queued→running silenciosa, badge sin
  total accesible y menú persistente debajo del drawer.
- **Browser:** build productivo en 1440x900 y 1024x768 confirmó drawer derecho de
  420 px/full-height, foco inicial/trap/restore, Escape y close, empty state,
  page-fit y cero console errors/exceptions.
- **Evidencia:** 55/55 focales del pase independiente, typecheck, lint focal
  `--deny-warnings`, build y diff-check verdes. Revisión final: `accept`.

## F7-05 — Deterministic ExportPort and bounded artifact writer

- **Boundary:** `core/export/**` separa provider/codec, validación del artifact
  y writer/destino. No importa DOM, URL, ProjectStore, JobStore ni commands; el
  caller puede mapear sólo un éxito completado a `GeneratedArtifact`.
- **Registry:** cada descriptor tiene provider ejecutable capturado. ExportPort
  vuelve a snapshottear list→provider y exige igualdad completa de ID, label,
  category, extension y MIME; duplicates, inert/drift y formatos ocultos fallan.
- **Artifact:** request/artifact/project/revision y base name se capturan antes
  del boundary async. Filename aplica NFKC y elimina traversal, device stems
  Windows, controles, bidi y surrogates. MIME/size se leen desde slots Blob
  nativos; cero bytes, falsificación, mismatch o >budget nunca llegan al writer.
- **Writer:** recibe un artifact frozen y devuelve receipt exacto de request,
  artifact, filename y bytes. El port añade writer ID capturado y timestamp ISO.
  Default 512 MiB; hard max 2,147,483,647 bytes.
- **Abort/errors:** slots y add/remove nativos de AbortSignal ignoran own
  properties hostiles. Pre-abort, provider pending y writer pending rechazan sin
  publicar late success. Provider/writer failures se redactan; errores
  `ExportPortError` spoofed no atraviesan el boundary.
- **Repairs:** review cerró AbortSignal sombreado, Windows `CON.txt`, controles
  bidi/Cf/Cs, drift/hidden registry y accessor hostil dentro de `list()`.
- **Evidencia:** 20/20 focales; gate acumulado F7 4 archivos/62 tests; typecheck,
  lint focal `--deny-warnings`, build y diff-check verdes. Revisión final:
  `accept`. Arquitectura: [ADR-007](../architecture/ADR-007-export-port-and-writers.md).

## F7-06 — Deterministic JobRunner + ExportPort failure injection

- **Harness:** un host manual controla clock/timers y adapters inyectables
  cubren quota, provider crash, worker crash, provider pending y writers
  cooperativos/hostiles sin depender de tiempo real ni filesystem.
- **Terminales:** quota/provider desconocidos quedan redactados por el boundary
  actual; worker crash conserva su `JobTaskError` tipado. F7-07 decidirá la
  traducción final Export→Job sin debilitar esta contención.
- **Races:** timeout durante encode nunca alcanza al writer. Cancel durante
  write aborta al writer cooperativo; cancel en la misma frontera que un receipt
  ya resuelto obliga a la Promise real de ExportPort a rechazar
  `EXPORT_ABORTED`, con cero resultados publicados.
- **Cleanup:** después de late resolve/reject, el snapshot completo de JobStore
  conserva identidad, active count y listener inventory son cero, y cada timer
  fue cleared o fired exactamente una vez.
- **Repairs:** la revisión cerró tres falsos positivos: observar sólo el terminal
  del runner, comparar sólo un job deep-equal y no auditar cardinalidad de
  timers. También exigió exactamente dos listeners durante writer pending.
- **Evidencia:** 6/6 focales; gate F7 acumulado 5 archivos/68 tests; typecheck,
  lint focal `--deny-warnings` y build verdes. Revisión final: `accept`.

## F7-07 — Export job adapter, safe diagnostics and W2 gate

- **Boundary:** `core/processing/exportJobTask.ts` es el único adapter. Captura
  port/request/source, omite identidad/signal del config y los deriva siempre
  del `JobTaskContext` del intento. ExportPort continúa job/store/UI-agnostic.
- **Policy:** once códigos ExportPort mapean exhaustivamente a Job code, copy y
  retry. Invalid/unsupported/config/artifact/receipt son terminales; provider,
  storage, unknown y quota son retryable. Quota indica liberar espacio.
- **Security:** ExportPortError tiene brand privado, validación runtime y freeze.
  DOMException quota usa el getter nativo. Getters, proxies, prototype spoof,
  causes, stacks y mensajes privados nunca cruzan al Job Center.
- **Authority:** cancel/timeout del runner ganan antes de abort; el posterior
  failure del adapter se ignora. Retry crea un request ID nuevo y conserva root,
  parent y terminal fuente.
- **Repair:** review reprodujo fuga P1 en `createExportFormatRegistry`: un getter
  del array externo podía lanzar un error prototype-spoofed o branded privado y
  atravesar el catch por `instanceof`. El registry ahora snapshottea el array en
  un catch siempre redactado y valida/conflicta fuera de él.
- **Evidencia:** 27/27 adapter+port; 74/74 F7; 42 archivos/461 contract tests;
  suite completa 61 archivos/579 tests; typecheck, lint focal `--deny-warnings`
  y build verdes. Reviewer añadió timeout adversarial con snapshot estable,
  writer/listeners/active cero. Revisión final: `accept`. Arquitectura:
  [ADR-008](../architecture/ADR-008-export-job-diagnostics.md).

## F8-01 — Package and lock ownership reconciliation

- **Estado actual:** `package.json` y `bun.lock` forman el par aceptado por el
  owner. Los doce upgrades fueron aceptados; `packageManager` es `bun@1.3.14`,
  Node es `>=24.0.0` y los overrides son `protobufjs` 7.6.5, `undici` 7.28.0 y
  `ws` 8.21.1. El lock está trackeable y su SHA-256 es
  `96e66bbcff3dc338ab95b6bf5c4396fc73af6863c040b7135eb5eb88c02f44e5`.
- **Workflow:** Ubuntu 24.04, Node 24.18.0/Bun 1.3.14, actions fijadas por SHA,
  install frozen, audit high, `all` y `e2e`.
- **Evidencia:** el verificador real pasó baseline (exit 0) y rechazó drift (exit
  1) sin mutar el lock; la revisión Sol focal aceptó 29/29 + lint. El snapshot
  `f90d8d2/tree60b742` pasó clean checkout, `all`, E2E y todos los gates técnicos.
  El review final cerró `ACCEPT`, P0-P3 en cero.
- **Baseline histórico:** la inspección read-only anterior decía package
  user-owned, lock ignorado, sin workflow ni manager/engines. Se conserva sólo
  en el [record de reproducibilidad](./F8_REPRODUCIBILITY_OWNERSHIP.md), no como
  estado actual.

> **Reconciliación de evidencia:** Las cifras históricas de las secciones
> F8-02/F8-04/F8-05 se conservan como baseline. El snapshot staged actual
> `f90d8d2/tree60b742` aporta la evidencia final de clean checkout, `all`, E2E y
> gates técnicos; la matriz final registra también el review `ACCEPT`.

## F8-02 — Stable local quality gates and production browser smoke

- **Estado focal:** `accept` después de revisión independiente histórica
  `repair+accept`; el cierre actual de F8-03 está `done`.
- **Manifest:** `scripts/studio-gates.mjs` expone ocho gates data-only con argv
  fijo, ejecución secuencial, `shell:false`, timeout por step, list/dry-run y
  propagación exacta del primer failure. No usa ni modifica aliases del package.
- **Ratchet:** lint acepta como máximo los 47 warnings heredados observados;
  47 devuelve 0 y el fail deliberado con 46 devuelve 1. F8-05 debe reducir el
  límite al retirar esa deuda, nunca aumentarlo para hacer verde una regresión.
- **Browser:** el e2e construye y sirve `dist`, arranca sólo procesos propios y
  usa Chrome/CDP con perfil temporal. Cada command está acotado; close/error
  rechaza pendientes y finally cierra browser/preview y retira el perfil.
- **Observabilidad:** el smoke exige Slice activa y visible a 1440x900, page-fit
  y cero console errors, exceptions, log errors, `Network.loadingFailed` o
  respuestas HTTP >=400. Los diagnostics no conservan URLs ni request IDs.
- **Repairs:** revisión inicial encontró lint sin ratchet, comandos CDP que
  podían quedar pendientes, red incompleta y flags duplicados last-wins. Las
  cuatro reproducciones quedaron cerradas; segunda revisión sin P0-P3.
- **Evidencia focal/final:** 29/29 focales; typecheck, lint `--deny-warnings`,
  verifier, audit y parser adversarial verdes. El snapshot staged confirma
  `all` 14/14 y E2E build+browser-smoke con Slice visible, page-fit y errores
  console/network/HTTP en cero.

## F8-04 — Canonical coverage and fixture/golden retention

- **Estado focal:** `accept` después de revisión independiente histórica
  `repair+repair+accept`; el snapshot staged confirma sus gates técnicos y no
  quedan checks técnicos pendientes de F8-03.
- **Scope:** el corpus completo mide 54/54 fuentes runtime `core/**/*.ts`
  no-barrel, incluidas 13 de `core/project`. El summary anterior se elimina y
  totals/pct/core-project se validan antes de aceptar resultado.
- **Profiles:** el cierre release elevó el resultado a 90.01 statements, 86.08
  branches, 94.83 functions y 92.65 lines. Release 90/85/90/90 y el ratchet
  elevado al resultado medido están verdes.
- **Retention:** manifest exhaustivo de dos roots/siete archivos tracked con
  path/kind/owner/mode/bytes/SHA-256. `text-lf` estabiliza Windows/Linux; missing,
  unmanifested, untracked, drift y cualquier root/descendant symlink fallan.
- **Repairs:** root symlink podía seguirse antes del walk; coverage aceptaba
  `skipped` imposible. Ambos límites se endurecieron y probaron junto con
  stale summary, pct inconsistente, rm/spawn throw, traversal y hash drift.
- **Evidencia focal/final:** 29/29 focales, fixtures 7/7 exit 0, coverage
  82 archivos/695 tests con 90.01 statements, 86.08 branches, 94.83 functions
  y 92.65 lines; typecheck y lint `--deny-warnings` verdes. El gate `all` y el
  snapshot clean están cerrados técnicamente.
  Policy: [F8 quality policy](./F8_QUALITY_POLICY.md).

## F8-05 — Bundle, performance and accessibility budgets

- **Estado focal:** `accept` después del repair final de estabilidad browser y
  re-revisión independiente histórica sin P0-P3; no es el review final de
  F8-03.
- **Lint:** el ratchet heredado de 47 warnings pasa a cero con cleanup acotado;
  `--deny-warnings` es ahora el gate estable.
- **Bundle:** HTML productivo descubre sólo assets iniciales allowlisted y un
  helper Node mide gzip level 9 sobre archivos físicos. AI, GIF, ZIP y el modal
  Export se cargan por acción; 155474 bytes pasan ratchet 156500 y release
  180000 sin modificar dependencias.
- **Browser:** perfil Chrome efímero, settle y Long Task API obligatoria; 5 s
  idle, 4 recorridos/20 transiciones afirmadas y p95 recomputado. Resultado
  estable en tres repeticiones: 0 rAF, 34.5/34.7/49.8 ms p95 y 0 long tasks;
  el `all` final midió 34 ms.
- **A11y:** árbol AX nativo agregado sin labels/URLs: 65 nodos, 15 interactivos,
  cero sin nombre y un `main`. El canvas dejó de anidar otro landmark.
- **Límite declarado:** no sustituye Axe/WCAG completo ni los budgets de los
  features G/A/R. El par package/lock reconciliado permanece intacto; este
  baseline no cierra el review final de F8-03.
- **Repairs de review:** cada muestra ahora afirma hash/nav/content; roles AX
  interactivos cubren option/search/menu/tree/scrollbar; `main` es exactamente
  uno; Long Tasks conserva agregados sin cap y drena records pendientes. El
  segundo pase añadió nodos AX focusable, rect visible positivo y parsing HTML
  case-insensitive/token-list para no subcontar controles, rutas o preload. El
  pase final corrigió p95=max con n=15, cold mount de Timeline, throttling
  headless y liveness/retry de cleanup Windows sin subir thresholds. La última
  revisión añadió deadlines internos 40/70 s, exhaustividad del workspace map y
  cleanup de resize al ocultar Timeline; ambos timeouts inyectados dejaron cero
  huérfanos y perfiles.
- **Coverage repair:** el cierre staged mide 90.01% statements, 86.08% branches,
  94.83% functions y 92.65% lines en 82 archivos/695 tests.
- **Evidencia focal/final:** 29/29 focales; `all` 14/14 con unit 168, contract
  521, integration 6, coverage 82/695, fixtures 7/7, persistence, build,
  bundle/browser budgets y deferred checks verdes. Policy:
  [F8 budget policy](./F8_BUDGET_POLICY.md).

## F8 release thresholds and deferred-feature closeout

- **Estado:** `accept` para thresholds/deferred técnicos; F8-03/F8-06 están
  `done` después del review final `ACCEPT`.
- **Coverage:** 82 archivos/695 tests; 90.01% statements, 86.08% branches,
  94.83% functions y 92.65% lines. Se elevó el ratchet al resultado medido.
- **Matrices:** validación, animation/composition/destructive commands,
  `applyCommand`, impact, V0 migration, project migration, local stores,
  IndexedDB asset lifecycle, asset identity, autosave journal y package ZIP.
  `derivedAssets: null` ya falla como patch inválido en vez de normalizarse.
- **Carga diferida:** AI, gifshot y JSZip salen del entry; `ExportModal` tiene
  su propio boundary con fallback accesible. Initial 522217 raw / 155474 gzip;
  ambos perfiles pasan y el policy exige exactamente cuatro chunks diferidos:
  modal Export, AI, GIF y ZIP.
- **Browser:** proyecto cargado por input real, ZIP y GIF exitosos y AI con
  fallo determinista contenido. Cada chunk diferido pasa de 0 requests eager a
  exactamente 1 al invocarlo; página, modal y cinco contadores de error quedan
  verdes. La revisión visual rechazó una captura tomada durante Suspense y el
  journey ahora exige título/rect real y settle antes del screenshot.
- **Repair visible:** un proyecto cargado después del primer render ya habilita
  GIF seleccionando una animación válida; regresión cubierta por componente y
  Chrome productivo.
- **Evidencia staged final:** `--gate all` 14/14, build y browser-smoke pass;
  route Slice visible, pageFits true, deferred checks pass y console/network/HTTP
  en cero.
- **Revisión:** los repairs documentales/técnicos están cerrados. El primer pase
  final encontró un P3 de temp hygiene; el repair registró el temporal test-owned
  y el recheck 29/29 verificó conteo `0 -> 0`. Veredicto final: `ACCEPT`, P0-P3=0.

## F8-03/F8-06 — Matriz de cierre final

| Check | Resultado | Estado |
|---|---|---|
| Owner/manifest/lock | 12 upgrades aceptados; packageManager, engines, overrides y lock SHA verificados | pass |
| Sol focal review | 29/29 + lint | pass (focal) |
| High audit | exit 0 | pass |
| Repro baseline | exit 0; lock unchanged | pass |
| Repro drift | exit 1; lock unchanged | pass |
| Clean checkout | `f90d8d2/tree60b742`: 302 tracked, status 0, lock 64864 bytes, CRLF 0 | pass |
| Install frozen + audit | Bun 1.3.14, frozen install limpio, audit high exit 0 | pass |
| Full `all` | 14/14; unit 168, contract 521, integration 6, coverage 82/695 | pass |
| Fixtures/persistence/build/budgets | fixtures 7/7, persistence/build/browser budgets pass; gzip 155474 | pass |
| Full E2E | build + browser-smoke; Slice/pageFits y console/network/HTTP 0 | pass |
| Independent final review | repair P3 + recheck 29/29, temp `0 -> 0` | ACCEPT; P0-P3=0 |

**Estado F8-03/F8-06:** `done`. Los repairs TS6, child Bun e higiene temporal
quedaron cerrados con 29/29 focales, temp `0 -> 0`, typecheck/lint/verifier/audit
verdes y review final `ACCEPT`. Ver el [artifact final](../../artifacts/quality/F8/2026-07-15/reproducibility.json) y el [record de ownership](./F8_REPRODUCIBILITY_OWNERSHIP.md).

## F3-07 — Durable reload and clean portable import

- **Estado:** `accept`; PID/profile cleanup y ambos paths están verdes. La
  revisión incremental no encontró P0-P3 y cierra W1.
- **Journey:** tres documentos en un perfil Chrome temporal. Prepare persiste
  V1+assets+checkpoint+package; dos pagehide/reload prueban reopen, borrado de
  storage, import limpio y reopen final.
- **Migration/J8:** fixture V0 con dos Blob URLs expiradas produce preview con
  tres blockers (dos relink + una ambigüedad); resoluciones explícitas migran a
  V1 válido y reemplazan runtime provenance por IDs durables.
- **Asset real:** PNG alpha 192x64 se codifica y decodifica; un pixel alpha 128 y
  otro transparente se afirman antes de persistir. Dos assets comparten un blob.
- **Exactitud:** JSON del codec, content hashes y ZIP/hash/bytes permanecen
  exactos. El segundo package mide 2633 bytes y ambas revisions son 1.
- **Cleanup/privacidad:** dos DB con nombres por run se eliminan y verifican
  ausentes. El perfil se retira sólo tras verificar runtime terminado; si no
  puede terminar, el gate falla cerrado y no borra archivos en uso. El resultado
  no contiene nombres, nonces ni hashes; éstos sólo cruzan reload dentro de
  sessionStorage del perfil temporal. Cinco contadores browser terminan en cero.
- **Repairs de review:** CLI valida y sanitiza el resultado público; revisions y
  dedupe/hash cardinality deben ser coherentes. Child cleanup verifica exit,
  escala a SIGKILL y falla si Chrome/Vite permanece vivo. El package runner que
  fugaba servidores Vite se reemplazó por el CLI local como child Node directo.
  Una primera corrida `all` reveló que 10/20 s eran insuficientes bajo carga;
  CDP/readiness pasaron a 30/60 s sin cambiar el timeout del gate ni reintentar.
  La auditoría incremental detectó que el timeout externo podía matar Bun antes
  del `finally`; un deadline interno de 130 s reserva cleanup bounded. Una
  inyección real a 100 ms dejó procesos y perfiles en cero.
  El pase posterior reemplazó metadata de exit no fiable bajo Bun por sondeo de
  PID y `rmSync` por retries async acotados; failure y success volvieron a cero.
- **Evidencia final:** 34/34 focales, typecheck, lint focal cero y tres gates
  `persistence` consecutivos exit 0 con `ORPHANS=0`. Revisions 1→1, assets 2 /
  blob único 1, legacy 2 URLs / 3 blockers / 5 notas, dos reloads, DB cero y
  cinco contadores de error cero. `all` completó 11 steps: 23/150 unit,
  43/464 contract, 1/6 integration y 67/620 coverage con
  82.31/76.82/91.79/86.17; build/bundle/browser verdes y 0 huérfanos. Policy:
  [F3 persistence browser](./F3_PERSISTENCE_BROWSER.md).

## Grid checkpoint — G0-01..G0-04 y G1-01..G1-05

- **Source session:** selección/drag, validación, decode y preview tienen owner
  local, generaciones contra carreras y leases URL idempotentes. Replace/reset
  limpia graph e interacción derivados sin tocar assets, preferencias o aspect;
  aliases Blob de la librería quedan protegidos. Metadata validada prevalece y
  proyectos legacy muestran inferencia explícita o `Unknown`.
- **Frontera terminal:** después del commit no existe retorno a failure. Setters,
  cleanup, revoke, resolve y feedback hostiles se aíslan; AbortSignal/accessors
  externos no dejan promises pendientes. El review G0-04 cerró tres rondas de
  repairs con `ACCEPT`, P0-P3=0.
- **Worker:** protocolo V1 exacto con requestId/progress/result/error/cancel,
  transferencia de ownership, Worker módulo Vite real y adapter JobRunner
  one-shot. Diagnósticos conservan etapa pública sin filtrar error privado.
- **Lifecycle hostil:** workers concurrentes quedan aislados; cancel antes,
  durante y después, crash, messageerror, timeout y respuesta tardía tienen un
  solo terminal. Registro/retiro reentrante u hostil no reabre listeners ni
  publica mensajes post-terminal. Review G1-04: `ACCEPT`, P0-P3=0.
- **Baseline:** ocho fixtures deterministas y 59 outputs congelan layout, bounds,
  dimensiones, reduction, operations/warnings y SHA-256 RGBA row-major. CLI
  normal sólo compara; `--capture` explícito escribe stdout. Worker real, drift,
  tamper y schema cerrado pasan. Review G1-05: `ACCEPT`, P0-P3=0.
- **Evidencia:** artifacts versionados en
  `artifacts/quality/GRID/2026-07-16/`; Chromium productivo confirma Worker
  módulo y journey source con cinco contadores de error en cero. Commits de
  cierre: `178761e`, `17fdefe`, `321537a`, `922cf0c`.

### G0-05 — Error, focus and retry hostile gate

- **Boundary:** picker, Replace, Reset y Retry contienen throws y rechazos
  asíncronos sin renderizar payloads privados. La fuente vigente permanece
  autoritativa y Reset sigue disponible para abortar trabajo busy.
- **Focus/a11y:** cancelación, error retryable, fallo de retry, recuperación y
  reset restauran foco al trigger alcanzable. El boundary se rearma durante el
  replay de efectos de React StrictMode y tiene regresión dedicada.
- **Browser:** Chrome productivo valida 23 métricas del journey completo, route
  Slice y page-fit; console, exception, log, network y HTTP terminan en cero.
- **Evidencia:** 54/54 focales, typecheck y lint scoped verdes. Revisión
  independiente final `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/g0-05-source-recovery.json`.

**Transición:** G0 queda cerrado; el checkpoint siguiente acepta el contrato
layout/inference G2 antes de abrir sus superficies UI y overlay.

### G2-01/G2-02 — Layout contract and auto inference

- **Draft único:** auto/manual comparten validación source-aware; cambiar modo
  conserva exactamente el último rows/cols manual y la recipe serializada usa
  el mismo seam que el Worker.
- **Detección:** perfiles premultiplied-alpha ignoran RGB oculto y conservan
  bordes sólo-alpha. Segmentos e inferencia producen celdas source-space
  row-major congeladas; Worker y consumidores de preview llaman al mismo owner.
- **Refinamiento:** el análisis coarse queda acotado a 600 px de ancho y una
  detección creíble se refina sobre pixels fuente. La regresión 4097×2049 con
  gutter alpha de 1 px conserva ocho celdas exactas de 1023×1023, sin crop
  parcial por redondeo.
- **Confianza:** vacío, imagen ambigua y ruido opaco 32×32 retornan fallback 1×1
  con warning; grids claros 1×N/N×1 siguen detectándose.
- **Rendimiento/evidencia:** landscape 4096×2048 + portrait 600×16384 tienen
  presupuesto combinado automatizado `<5000 ms`; cinco rechecks midieron
  2116–2667 ms. Focal completo 23/23, Worker real, golden, typecheck, lint y
  diff-check verdes. Revisión final `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/g2-02-detection-inference.json`.

**Siguiente frontera:** G2-03 controls/detected feedback está activo; G2-04
overlay puede avanzar desde el mismo contrato aceptado. El checkpoint siguiente
cierra el adapter irregular independiente S1-01.

### S1-01 — Connected-component irregular detection

- **Contrato:** detección RGBA pura con alpha threshold estricto, conectividad
  4/8 explícita, mínimos configurables, ausencia de merge y bounds source-space
  congelados en orden de descubrimiento row-major.
- **Límites:** working set acotado a 16,777,216 pixels y 4096 regiones; inputs
  typed-array/detached/shared/cross-realm y options con accessors tienen matriz
  hostil. Empty, transparent, edge, single-pixel y noise están congelados.
- **Cancelación:** checks antes de trabajo, por fila y cada 4096 pixels del flood.
  El review rechazó el primer test porque abortaba antes del flood; la reparación
  separa 1×2 row-boundary y 8193×1 que cancela exactamente en `head=4096`.
- **Evidencia:** 10/10 focales, property 80 samples, flood 1MP bajo 2500 ms,
  typecheck/lint/diff-check verdes. Revisión final `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/s1-01-connected-components.json`.

**Siguiente frontera irregular:** S1-02 wand selection/add-remove está activo;
S1-03 puede avanzar en paralelo sobre commands manuales sin tocar este adapter.

## Editor/Animoto checkpoint — A1-01 composition entry

- **Owner canónico:** Asset o Region se resuelve contra `StudioProjectV1` y se
  abre mediante un único `ProjectStore`; no existe shell/store/persistencia del
  donante ni estado UI paralelo.
- **Creación atómica:** `composition.create` + `workspace.update` comparten un
  `command.batch`/envelope y una revisión. Asset usa dimensiones intrínsecas;
  Region usa bounds conservando el Asset backing y source durable.
- **Identidad/reopen:** Composition y Layer derivan IDs deterministas del tipo
  y source ID. Already-open no despacha; reopen reutiliza el mismo graph.
- **Repair P1:** el review reprodujo una Composition válida en el ID reservado
  cuya Layer apuntaba a otra fuente. La adopción ahora exige owner project,
  canvas exacto, una sola reserved Layer, compositionId y source `{type,id}`
  exactos mediante data descriptors; kind/id/dimensions/extra-layer hostiles
  retornan `IDENTITY_CONFLICT`.
- **Evidencia:** 13/13 contract+integration, ProjectCodec reload/re-encode,
  StudioProjectV1 validation, typecheck/lint/diff-check verdes. Revisión final
  `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/EDITOR/2026-07-16/a1-01-composition-entry.json`.

### A1-03 prerequisite — Canonical `composition.update`

- **Contrato:** patch exacto y no vacío para `name`, dimensiones, fondo y
  `updatedAt`; límites de eje/producto, color hex/transparent y timestamp se
  validan sin ejecutar accessors hostiles.
- **Persistencia:** actualiza la Composition canónica sin reemplazar identidad,
  owner, layers ni referencias. No-op conserva referencia/revisión; undo/redo,
  batch e impacto mínimo atraviesan ProjectEngine y ProjectStore.
- **Evidencia:** focal 8/8, core acumulado 198/198, lint/diff verdes y revisión
  independiente `ACCEPT`, P0-P3=0. El typecheck global quedó bloqueado sólo por
  la reparación S1-02 concurrente. Artifact:
  `artifacts/quality/EDITOR/2026-07-16/a1-03-composition-update-kernel.json`.

**Siguiente frontera Editor:** A1-02 Project menu y Compose bootstrap UI y
A1-03 composition dimensions/aspect/background están activos. La descripción
legacy rename/save/reopen se reconcilió con el behavior autoritativo A1.4.

### G2-03 — Native Grid controls and detected feedback

- **Owner UI:** un controller feature-local vive una vez en `AppLayout` y se
  comparte entre sidebar desktop y drawer compacto. Slice oculta el Grid/Sync
  legacy; no adopta `activeGrid`, `slicerGrid` ni un segundo store.
- **Draft/a11y:** radiogroup Auto/Manual conserva el último manual; intentos
  inválidos permanecen visibles sin clamp con `aria-invalid/describedby`.
  Detected, fallback 1×1 y error tienen feedback inline; Retry conserva foco a
  través de detecting→detected/fallback.
- **Off-main real:** main sólo clona un ImageBitmap owner y transfiere el clone,
  o envía una URL same-origin; Worker posee decode, OffscreenCanvas, RGBA e
  inferencia. Límites/producto se validan antes de asignar y el owner nunca se
  transfiere/cierra.
- **Boundary hostil:** requests/responses exact-own-data, warnings cerrados,
  bounds/no-overlap/row-major y fallback coherence; el resultado se reconstruye
  frozen. Cleanup es exhaustivo/no-throw ante abort, reentrancia y late messages.
- **Evidencia:** 29/29 G2-03 + 54/54 support, lint/build/diff verdes. Chrome
  productivo prueba Worker módulo real, 4/4 terminados, cancelación, desktop y
  compact drawer, 2×4, page-fit y cinco contadores de error en cero. Revisión
  final `ACCEPT`, P0-P3=0. Artifact y screenshot:
  `artifacts/quality/GRID/2026-07-16/g2-03-grid-controls.{json,png}`.

### G2-04 — Canonical grid overlay geometry

- **Geometría:** cells source-space enteras se proyectan a CSS/device pixels
  con pan/zoom fraccional y DPR explícitos, preservando remainder, gaps, shared
  edges y bounds sin acumular snapping.
- **Runtime:** Canvas absoluto `aria-hidden`/`pointer-events:none`, sin store ni
  recompute de layout, sin loop rAF. ResizeObserver/window/visualViewport tienen
  cleanup defensivo y callbacks tardíos inertes.
- **Seam:** G2-05 montará `SliceGridOverlay` como sibling del source canvas con
  `controller.sourceDimensions`, `controller.effectiveLayout` y el viewport ya
  existente; no se abre otra fuente de verdad.
- **Evidencia:** 6/6, lint/bundle focal verdes. Chrome prueba resize, DPR 1→2,
  zoom 27.5×, pan negativo, pointer passthrough, idle sin redraw, cleanup 0×0 y
  cinco contadores de error en cero. Revisión `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/g2-04-grid-overlay.{json,png}`.

**Siguiente frontera Grid:** G2-05 manual/auto switching, recipe state y montaje
del overlay en el journey real está activo.

### S1-02 — Canonical wand selection and Region semantics

- **Selección:** flood seed-local alpha-aware con connectivity 4/8, identidad
  SHA-256/source exacta, replace/add/subtract y aggregate mask/bounds frozen;
  componentes ajenos y `maxRegions` no contaminan el hit.
- **Comandos:** add cruza un adapter closed-world. Subtract resuelve dentro de
  una vista canónica una única Region por asset+bounds+provenance wand/sourceId
  y construye internamente `region.remove/reject`; no existe callback capaz de
  autocertificar ownership ni ejecutar efectos antes de validar.
- **Hostile:** accessors, proxies/revoked, callbacks y cancelación se contienen
  y redactan. Cero/múltiples matches fallan antes de efectos; apply+undo real
  conserva el proyecto.
- **Evidencia:** 16/16, typecheck/lint/diff verdes, 1 MP 126–403 ms <2500.
  Chrome fail-closed con cinco contadores en cero y PNG/hash reproducidos.
  Quinta revisión `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/s1-02-wand-selection.{json,png}`.

**Siguiente frontera irregular:** S1-03 manual Region commands está activo;
S1-04 espera el cierre conjunto de wand + manual tools.

### A1-03 — Composition canvas settings (preparatory slice)

- **Feature:** inspector de dimensiones, ratios soportados/custom y fondo
  transparent/color escribe un único `composition.update`; drafts inválidos o
  stale permanecen locales y recuperables.
- **Boundary:** resultado de dispatch se valida O(target) por descriptors contra
  `result.project`, revision/changedIds e identidad/owner/layer order. Éxitos
  falsos, accessors, proxies/revoked y callbacks hostiles fallan redactados sin
  recorrer project/inverse/unrelated graph.
- **Paridad:** ProjectCodec, SceneProjection y export raster coinciden en
  128×72/#3157a4; short/alpha hex y transparent se preservan.
- **Evidencia:** 16/16, typecheck/lint/diff verdes. Chrome primer intento:
  history/reload/export/focus/page-fit, cinco errores en cero y cleanup
  CDP/Chrome/server/profile/build 5/5 sin residuos. Tercera revisión `ACCEPT`,
  P0-P3=0. Artifact:
  `artifacts/quality/EDITOR/2026-07-16/a1-03-composition-canvas.{json,png}`.
- **Límite honesto:** este slice es preparatorio; A1-04 montará el ProjectStore
  canónico y el inspector en la ruta Compose real. No se creó provider paralelo.

**Siguiente frontera Editor:** A1-02 Project menu/bootstrap Compose sigue
activo; A1-04 portable first-composition acceptance espera ese cierre.

### G3-02 — Reduction and empty/transparent cell policy

- **Política:** la reducción es la fracción exacta de área removida; el resumen
  pondera por área source de cada celda. `0` queda normalizado y el rango es
  siempre finito `0..1`.
- **Celdas vacías:** nunca se omiten. Conservan índice/fila/columna, exponen
  `contentBounds: null`, una superficie RGBA8 transparente `1×1`, reducción
  `1` y warning `empty-output` individual/agregado.
- **Compatibilidad:** crop `threshold: 0` conserva el sentinel desactivado y el
  output donor; G1 mantiene 8 fixtures/59 outputs sin drift.
- **Evidencia:** 32 tests combinados, Worker real con alpha 127/128, padding,
  layout no divisible, all-empty y máximo 4096; typecheck/lint/diff/JSON verdes.
  Revisión independiente `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/g3-02-reduction-empty-policy.json`.

### S1-03 — Manual Region command contract

- **Core seam:** `region.create` exact-own-data, ID único, Asset owner existente,
  bounds source-space safe/in-bounds, `atIndex`, impact mínimo e inverse
  `region.remove/reject`; no inventa ProcessingRecipe/provenance.
- **Adapter:** create/move/resize/delete; geometría usa `region.update` sin
  recrear identidad, delete conserva policy/blockers, no-op no abre history.
  ProjectStore/history/reload/selection y undo exacto están cubiertos.
- **Hostile:** inputs/project se reconstruyen data-only y todos los lookups son
  descriptor own-only. IDs heredados `toString|constructor|__proto__` fallan;
  los mismos IDs como records own canónicos se comportan correctamente.
- **Evidencia:** 9/9 focal, 118/118 acumulado, typecheck/lint/diff verdes y
  segunda revisión `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/s1-03-manual-region-commands.json`.
- **Riesgo acotado:** el command path valida/clona el proyecto completo; S1-04
  debe invocarlo al confirmar el gesto, nunca durante cada `pointermove`.

**Siguiente frontera irregular:** S1-04 UI wand/manual está activo; S1-05 puede
avanzar sobre Region-to-Asset y preservación de margins/gaps.

### G2-05 — Integrated canonical Grid ownership

- **Estado:** una instancia del controller conserva Auto/Manual draft y emite
  `GridSplitRecipeV1` determinista. El key transicional versionado usa el mismo
  ProjectState/undo/save/load; hydrate es descriptor-safe y reemplaza payloads
  inválidos antes del siguiente save.
- **Ownership único:** Slice/Export desconectan renderer, mouse/drop/selection,
  keyboard y offscreen export legacy. Otras workspaces mantienen su renderer.
  Source dimensions son autoritativas sobre builderCanvas en render, viewport,
  overlay y PNG source-only.
- **Transición:** Compose→Slice limpia selection/playback/drag/eyedropper/wand
  aunque comparten AppMode. Preview/apply de background usan AbortController;
  canonical ownership aborta late writes y revoca URLs activas/tardías.
- **Evidencia:** 44/44, typecheck/lint/build/diff verdes. Chrome productivo
  prueba source 400×200 vs builder 1024², manual 3×2, invalid draft, undo/redo,
  reload, DPR2, compact, project unchanged, export decodificado 400×200 y cero
  canonical legacy strokes/errores. Revisión final `ACCEPT`, P0-P3=0. Artifact:
  `artifacts/quality/GRID/2026-07-16/g2-05-grid-integration.{json,png}`.
- **Límite:** el recipe es draft transicional, no ProcessingRecipe falsa; G6
  debe enlazar el AssetRecord canónico antes de `regions.commitRecipe`.

**Siguiente frontera Grid:** G3-01 threshold/padding trim está activo.

### S1-05 — Canonical Region-to-Asset

- **Pixels/identity:** lee el source Blob canónico sin reimport, verifica
  blobKey/hash/bytes/MIME, recorta PNG alpha exacto y genera ID Region+SHA.
  Provenance v2 conserva sourceContentHash, bounds, margins y gaps.
- **Transacción:** graph `asset.import` es autoritativo; throw-after-commit se
  reconcilia contra snapshot descriptor-safe. Convert nunca elimina storage;
  convert/retry serializan por assetId y sólo conditional cleanup puede borrar
  tras fingerprint+Blob+graph rechecks.
- **Carreras:** storage preexistente nunca se compensa. Metadata inaccesible,
  cambiada u ownership adquirido preservan. Si el graph adquiere durante remove,
  el exact record+Blob se restaura antes de retornar/deuda.
- **Evidencia:** 18/18, typecheck/lint/build/diff. Chrome 4×3 conserva alpha 0
  y 128, golden/hash reproducibles, visual inspeccionada y cinco errores en cero;
  failure diagnostics son acotados/redactados. Revisión `ACCEPT`, P0-P3=0.
  Artifact: `artifacts/quality/GRID/2026-07-16/s1-05-region-to-asset.json`.
- **Límite honesto:** no existe transacción compartida Repository+ProjectStore;
  el adapter ofrece graph atomicity + compensación serializada/deuda, sin claim
  de cold-run (el harness usa prewarm explícito).

**Siguiente frontera irregular:** S1-04 UI sigue activo; S1-06 espera su cierre
para ejecutar el journey completo con undo/save/export.

### G3-01 — Alpha threshold and padding trim stage

- **Semántica:** stage puro full-source/cell usa
  `alpha > floor(threshold×255/100)`, devuelve bounds local+absoluto frozen o
  null; padding expande simétrico y clampa dentro de la celda.
- **Compatibilidad:** llamadas directas cubren 0/50/99/100; en Worker,
  `crop.threshold=0` conserva el sentinel donor crop-disabled para no alterar el
  baseline G1-05. Threshold no-cero usa el stage canónico y recipe queda intacta.
- **Hostile/perf:** records exact-own-data, typed arrays detached/shared/wrong/
  cross-realm y método sombreado, OOB/product limits, cancel pre/row/4096.
  Fixture 2 MP 703 ms <2500.
- **Evidencia:** 18/18 focal, 80 properties, Worker real y 8 fixtures/59 outputs
  frozen sin drift; typecheck/lint/diff verdes. Revisión `ACCEPT`, P0-P3=0.
  Artifact: `artifacts/quality/GRID/2026-07-16/g3-01-threshold-padding-trim.json`.

**Siguiente frontera Grid:** G3-02 reduction y empty/transparent policy activo.

## Frontiers abiertos

- F3-07: `accept`; lifecycle browser y W1 cerrados.
- F8-03/F8-06: `done`; package/lock, clean checkout, `all`, E2E y revisión final
  `ACCEPT` están verdes. Grid G0/G1 autorizado.
- F8-05: `accept`; budgets, lazy boundaries y cleanup browser cerrados.
