# ADR-004: thumbnails sobre el compositor canónico

- Estado: accepted for F5-04
- Fecha: 2026-07-14
- Decisores: Studio Foundation
- Implementa: F5-04+

## Contexto

El host legacy mezcla `<img>` con crop CSS, `object-contain` y URLs directas; el
donante Animoto guarda frames generados como thumbnail. Reutilizar esas rutas
crearía una segunda interpretación de layer order, transforms, alpha y
background distinta de preview/export. Renderizar primero al tamaño fuente para
luego reducir también permitiría allocations enormes por cada card.

## Decisión

- Toda miniatura recibe una `SceneProjection` y se renderiza mediante
  `compositeScene`; no reinterpreta layers ni sources legacy.
- La salida conserva aspect ratio dentro de `maxWidth`/`maxHeight`, sin crop ni
  padding. No hace upscale salvo opción explícita; el card consumer decide su
  checker, padding y escalado CSS.
- El límite por eje es 2048. La surface recibe el layout final y transforma las
  coordenadas lógicas directamente: nunca existe un canvas intermedio del tamaño
  fuente.
- Una surface port obligatoria separa target, encode y dispose. Tests software
  prueban paridad pixel; el adapter browser usa OffscreenCanvas con fallback a
  HTMLCanvas y el mismo Canvas2D scene target.
- PNG es default; WebP debe devolver exactamente el MIME solicitado. Empty scene
  retorna `null` sin resolver assets ni crear surfaces. Dispose corre en éxito y
  fallo; un cleanup error no reemplaza el error primario.
- El resultado publica project/revision/workspace, layout, sampling y draw count
  para que un cache consumer pueda invalidar sin poseer semántica de render.

## Consecuencias

- Asset, region, composition, variant y cel heredan los mismos pixels del
  compositor y no pueden divergir por un helper UI.
- F5-05 puede compartir la frontera de compositor, pero conserva sus propias
  reglas de tamaño/format/artifact; thumbnail no se convierte en export.
- Object URLs, cache eviction y lifecycle React permanecen en sus consumers.

## Gate de aceptación

Goldens de los cinco roots, layout bound/upscale, transparencia/background,
OffscreenCanvas real-adapter trace, MIME mismatch, encode/cleanup failures,
empty scene y revisión independiente.
