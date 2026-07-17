# Wayfinder: F5-06 browser scene viewport

## Destination

Provide one Browser Canvas2D viewport lifecycle that executes canonical scene
plans through the invalidation scheduler while keeping CSS size, backing pixels,
DPR, context recovery and cleanup coherent.

## Notes

- Legacy `useCanvasRenderLoop` owns an unconditional rAF, reads mutable refs,
  writes canvas backing dimensions from React state and has no context-loss path.
- Canonical scheduler/compositor/thumbnail/export already exist independently.
- F6/A1 own workspace registration and React/store wiring. Replacing CanvasArea
  now would cross the declared dependency frontier and keep legacy document
  semantics inside the new renderer.

## Decisions So Far

- [Choose viewport ownership boundary](tickets/001-viewport-lifecycle-boundary.md)
  - low-level controller owns only one HTML canvas, observers/listeners,
  scheduler, projection provider, resolver and diagnostics.

## Not Yet Specified

- Overlay model, pointer tools, checker/grid presentation, React component,
  workspace registry and legacy CanvasArea removal.

## Out Of Scope

- UI migration, interactions, playback clock, onion skin, selection/guides,
  export controls and donor-specific canvas branches.

## Outcome

- Implemented content-box/DPR metrics, base transform, invalidation scheduler
  lifecycle, context suspend/resume and complete disposal.
- Independent review exposed async resize/restore deadlock and queued MQL cleanup;
  both received focused regressions. Chrome real then exposed border-box versus
  content-box drift, fixed before acceptance.
- Chrome DPR 2 gate: 640x360 initial, 400x200 resize, RGBA [255,48,64,255], idle
  frame count stable, restore redraw, cleanup 0x0 and no page errors.
- Contract accepted; UI/store wiring remains routed to F6/A1.
