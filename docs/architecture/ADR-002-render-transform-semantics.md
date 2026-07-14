# ADR-002: orden y transformaciones del compositor canónico

- Estado: accepted for F5-02
- Fecha: 2026-07-14
- Decisores: Studio Foundation
- Implementa: F5-02+

## Contexto

El Builder legacy dibuja slots y objetos alrededor de un centro, mientras que
Animoto guarda layers top-first y las invierte antes de componer. Sin una regla
canónica, preview, thumbnails y export podrían producir z-order, pivots o flips
distintos aunque consuman el mismo proyecto.

## Decisión

- `Composition.layerIds` expresa painter order de fondo a frente y se recorre
  hacia adelante. El adapter de Animoto invierte su array top-first al importar.
- `LayerTransform.x/y` es el centro del source. El orden afín es translate,
  rotate (grados), scale/flip y translate(-width/2,-height/2).
- Un asset/region raíz conserva origen superior izquierdo y dimensiones
  naturales del crop.
- El transform de cel coloca `pivot` (o el centro si falta) en el centro del
  canvas más x/y, y después aplica rotation, scale/flip y opacity al visual
  completo. Pivots negativos o externos siguen siendo válidos.
- El background pertenece al canvas y no rota con el cel. Layers invisibles y
  region roots/cel sources hidden no emiten draw; una layer explícita obedece
  su propio `visible`, y `locked` no cambia pixels.
- El compositor compila primero un plan data-only con matrices y luego resuelve
  imágenes por port. El default es nearest-neighbor; smooth debe pedirse.
- Un asset/target fallido aborta el frame y devuelve error estable. Nunca se
  omite una capa silenciosamente para producir éxito parcial. Todo target debe
  implementar rollback explícito mediante `abortFrame` (no-op si es stateless).

## Consecuencias

- Preview, onion, thumbnail y export pueden compartir exactamente el mismo plan.
- DPR, resize y viewport pueden componerse como matriz base en F5-06 sin cambiar
  geometría documental.
- El import de Animoto y la migración Builder asumen adaptadores explícitos en
  lugar de condicionales de origen dentro del renderer.

## Gate de aceptación

F5-02 requiere pixel goldens pequeños para asset, region, layer order, variant y
cel transform, más error/cleanup y revisión independiente.
