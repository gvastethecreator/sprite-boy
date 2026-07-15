# ADR-007: export providers, artifacts and destination writers

- Estado: accepted for F7-05
- Fecha: 2026-07-15
- Decisores: Studio Foundation
- Implementa: F7-05+

## Contexto

El host legacy y los dos donantes mezclan demasiados owners en una sola acción.
`useExportLogic` y Animoto `useExporter` codifican, reportan progreso, crean
object URLs, eligen filename, pulsan anchors y notifican UI. Grid Splitter hace
download individual/batch directamente desde URLs de resultado. Ninguna ruta
tiene identidad request/artifact, registry ejecutable, límite binario ni recibo
verificable.

F5-05 ya congeló los pixels PNG/WebP en `SceneExportResult`. F7-01..F7-04 ya
poseen lifecycle, abort, retención y presentación de jobs. F7-05 debe crear el
límite exportable sin migrar todavía codecs, workers, descarga browser o UI.

## Decisión

- `ExportFormatRegistry` se construye únicamente con providers ejecutables.
  Captura descriptor y función, rechaza IDs duplicados y devuelve snapshots
  frozen en orden determinista.
- `ExportPort` vuelve a capturar el registry como un mapa exacto
  descriptor→provider. Un formato oculto, inerte o con drift de label,
  categoría, extensión o MIME bloquea construcción/ejecución.
- Cada request captura `requestId`, `artifactId`, `projectId`, revision,
  format y base name antes de cruzar el primer boundary async. `source` es una
  referencia opaca: el port no la recorre, clona, persiste ni interpreta.
- El provider sólo codifica y devuelve un Blob. Filename, MIME, extensión y
  byte budget pertenecen al port. Se leen slots nativos Blob para impedir que
  getters propios falsifiquen tamaño o tipo.
- Los filenames aplican NFKC, eliminan separators/control/bidi/surrogates,
  evitan extensión duplicada, limitan longitud y protegen device names Windows,
  incluso stems como `CON.txt`.
- El writer posee el destino, pero no recibe project stores ni source. Recibe
  un artifact frozen y AbortSignal; su receipt debe coincidir exactamente con
  request/artifact/filename/bytes. El port añade writer ID y timestamp ISO.
- El límite default es 512 MiB y el máximo configurable 2,147,483,647 bytes.
  Cero bytes, Blob falsificado, MIME distinto o exceso nunca llegan al writer.
- AbortSignal se valida y observa mediante slots/métodos nativos; propiedades
  propias hostiles no pueden esconder cancelación ni filtrar detalles.
- Fallos de provider/writer se redactan y son retryable. Invalid request,
  unsupported/drift, artifact/receipt inválido, exceso y cancel no lo son.

## Consecuencias

- Los adapters futuros de PNG/ZIP/GIF/video/data pueden compartir identidad,
  validación y destino sin compartir codec o UI.
- Browser download, filesystem, cloud upload o test memory writer implementan el
  mismo port y pueden verificarse por receipts.
- Sólo un resultado completado/aceptado puede convertirse después en
  `GeneratedArtifact`; pending, progress, error y retries siguen en JobStore.
- F7-06 puede inyectar quota, writer crash, abort y timeout sobre un único seam.
  G7/A11 pueden añadir providers y batch manifests sin redefinir el contrato.

## Gate de aceptación

Fake writer con artifact exacto; registry frozen/ejecutable; mutations/getters
hostiles; safe names portables; Blob native-slot/MIME/size; budget; receipts;
abort pre/provider/writer; late completion suppression; provider/writer error
redaction; typecheck, strict lint y revisión independiente.
