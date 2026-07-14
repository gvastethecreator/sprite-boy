# ADR-005: export raster sobre snapshot canónico

- Estado: accepted for F5-05
- Fecha: 2026-07-14
- Decisores: Studio Foundation
- Implementa: F5-05+

## Contexto

El host legacy vuelve a interpretar el estado al exportar y puede mezclar grid,
selección y URLs de descarga. Animoto parte de frames ya generados y acopla
render, ZIP, GIF, video y descarga. Reutilizar cualquiera de esas rutas crearía
pixels distintos de preview/thumbnail y adelantaría lifecycle de jobs/codecs que
pertenece a F7/A11.

## Decisión

- `renderSceneExport` produce un único raster PNG o WebP a la resolución lógica
  exacta de una `SceneProjection`; no redimensiona, recorta ni agrega padding.
- Dimensiones mayores a 16384 por eje o 64 millones de pixels se rechazan antes
  de crear una surface. Una escena vacía retorna `null` sin tocar ports.
- Proyección, límites, metadata y pixels comparten un único `SceneDrawPlan`
  defensivo capturado antes de cualquier boundary reentrante. Export y thumbnail
  ejecutan ese plan mediante `compositeSceneDrawPlan`; una factory no puede
  cambiar la revisión renderizada mutando el input original.
- La surface port separa target, encode y dispose. El browser adapter usa
  OffscreenCanvas con fallback a HTMLCanvas, tamaño exacto y Canvas2D target
  compartido. Toda allocation incompleta se reduce a cero antes de fallback o
  error.
- PNG es default. WebP acepta quality normalizada. El Blob debe tener internal
  slot real, bytes no vacíos y MIME exacto. El resultado frozen publica
  project/revision/workspace, canvas, sampling, extensión, draw count y byteSize.
- Dispose corre en éxito y fallo; un cleanup error no reemplaza el error primario.
  ZIP/GIF/video, filenames, object URLs, hash/persistence, download y jobs quedan
  fuera de esta frontera.

## Consecuencias

- Preview, thumbnail y export derivan painter order, crop, transforms, opacity y
  background del mismo plan; los adapters sólo controlan surface/encode.
- F7 puede componer este raster como `GeneratedArtifact` sin redefinir pixels.
- A11 puede ensamblar secuencias y codecs manteniendo resolución, MIME y
  provenance verificables.

## Gate de aceptación

Goldens de asset/region/composition/variant/cel, PNG realmente decodificable con
chunks/CRC/scanlines válidos, WebP metadata/quality, límites pre-allocation,
mutación reentrante, Offscreen/HTML fallback, MIME/encode/surface/cleanup errors,
empty scene y revisión independiente.
