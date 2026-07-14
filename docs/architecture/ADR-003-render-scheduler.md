# ADR-003: scheduler de render por invalidación

- Estado: accepted for F5-03
- Fecha: 2026-07-14
- Decisores: Studio Foundation
- Implementa: F5-03+

## Contexto

El Canvas legacy mantiene un loop rAF aunque no cambie nada. El compositor nuevo
puede resolver assets de forma asíncrona; iniciar otro frame antes de terminar
el anterior produciría solapamiento, commits viejos y trabajo sin límite.

## Decisión

- Scene, asset, viewport, overlay y resize son invalidaciones one-shot. Se
  coalescen en un único rAF con reasons ordenados, latest revision y changed IDs
  deduplicados/ordenados.
- Sólo drag y playback abren continuidad. Cada owner obtiene un lease idempotente;
  razones y owners concurrentes no se apagan entre sí.
- Existe como máximo un rAF pendiente y un render async en vuelo. Cambios durante
  render quedan dirty y solicitan exactamente un frame al settle.
- Al liberar el último lease se cancela un rAF vacío. Después de un frame sin
  dirty/continuidad, el host queda con cero callbacks pendientes.
- Dispose cancela callbacks, borra dirty/leases y una completion tardía no puede
  reactivar el scheduler.
- El host puede llamar el callback, liberar/disponer o arrojar síncronamente
  durante `requestFrame`. El scheduler distingue callback consumido de request
  cancelado, cancela el handle que retorne tarde y bloquea rescheduling dentro
  del mismo stack de diagnóstico.
- Un fallo se reporta con diagnostic estable y corta continuidad para evitar un
  error loop. El dirty snapshot fallido se conserva; una invalidación o lease
  externo posterior puede reintentar sin perder revision/changed IDs.

## Consecuencias

- El preview reacciona al cambio sin consumir CPU/GPU en idle.
- Playback lento descarta estados visuales intermedios en vez de superponer draws.
- F5-06 puede enlazar stores/viewport/context loss sin cambiar el scheduler.

## Gate de aceptación

Fake-host PERF tests deben probar cero rAF idle, coalescing, leases solapados,
async serialization, invalidation reentrante, error, host reentrante y dispose
tardío.
