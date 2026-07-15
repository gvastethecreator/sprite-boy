# ADR-006: lifecycle del viewport Canvas2D canónico

- Estado: accepted for F5-06
- Fecha: 2026-07-14
- Decisores: Studio Foundation
- Implementa: F5-06+

## Contexto

El `CanvasArea` legacy ajusta backing pixels desde React y mantiene un rAF
incondicional que relee refs mutables. No posee context-loss recovery y mezcla
escena, overlays, interacción y export. El compositor y scheduler canónicos ya
existen, pero sin un owner browser único DPR, resize, frames async y cleanup aún
podrían divergir entre workspaces.

## Decisión

- `BrowserSceneViewport` posee exactamente un HTML canvas y exige un container
  externo como resize target; nunca observa su propio backing store. También
  posee ResizeObserver, listener de resize/DPR, context lost/restored y
  `RenderScheduler`. Recibe una
  projection provider y resolver; F6/A1 conectarán stores y React.
- CSS size se observa como content box. El backing store usa
  `round(css * devicePixelRatio)` con límites 16384 por eje y 64M pixels. DPR se
  compone con scale/offset del `WorkspaceViewport` en una matriz base; el target
  Canvas2D aplica esa matriz tanto a background como draw operations.
- Scene/asset/viewport/overlay/resize dibujan por invalidación. Drag/playback
  usan leases. El scheduler queda en cero rAF cuando no hay dirty state o lease.
- Context loss llama `preventDefault`, incrementa generation y suspende scheduler
  sin perder dirty state ni leases. Restore readquiere Canvas2D, reaplica metrics,
  invalida resize+scene y reanuda una sola vez.
- Resize/restore durante resolución async retira el frame viejo como superseded,
  no como failure; la invalidación fresca conserva su follow-up. Una revision
  programada nunca acepta una proyección anterior.
- Dispose invalida completions tardías, cancela scheduler, desconecta observer,
  window/MQL/canvas listeners y reduce backing store a 0x0. Cleanup es best-effort
  por port para que un host roto no impida liberar los demás.

## Consecuencias

- Preview, thumbnail y export comparten plan/pixels; sólo el preview agrega
  DPR/viewport base transform.
- F6 puede registrar Slice/Compose/Animate/Collision/Export sobre el mismo owner
  sin reintroducir un loop por feature.
- Overlays, pointer tools, playback clock, checker/grid presentation y retiro de
  CanvasArea legacy permanecen en sus slices dependientes.

## Gate de aceptación

Contract tests de métricas/transform, zero-idle rAF, resize/DPR, async supersede,
stale revision, context suspend/restore, queued MQL after dispose, partial-init y
cleanup. Chrome real debe probar DPR 2, backing resize exacto, pixel no vacío,
frame count idle estable, restore redraw, 0x0 disposal, screenshot y cero errors.
