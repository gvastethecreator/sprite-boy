# Wayfinder: F5-05 scene export adapter

## Destination

Encode a canonical SceneProjection at full logical resolution through the shared
compositor, producing a typed raster artifact whose pixels match preview and
thumbnail source pixels.

## Notes

- Legacy host export re-runs `CanvasRenderer`, may include grid/selection state
  and owns direct download URLs. Animoto starts from generated-frame URLs and
  mixes ZIP/GIF/video lifecycle with rendering.
- F7 owns ExportPort, job lifecycle, format registry, download and retry/cancel.
- Thumbnail max-size/no-upscale policy must not leak into master export.

## Decisions So Far

- [Choose raster artifact boundary](tickets/001-raster-artifact-boundary.md) -
  single-scene PNG/WebP at exact scene dimensions, typed metadata, mandatory
  surface cleanup and no download/container concerns.

## Not Yet Specified

- Multi-frame sequence containers, filenames, bundle manifests, platform codec
  selection and persistence as GeneratedArtifact.

## Out Of Scope

- ZIP/GIF/video, object URLs, downloads, JobStore, progress/cancel/retry and
  export UI.

## Outcome

- Implemented as `SceneDrawPlan` snapshot -> shared compositor execution ->
  exact-size PNG/WebP surface.
- Independent review found projection TOCTOU across a reentrant surface factory.
  Export and thumbnail now execute the same defensively copied plan captured
  before allocation; regression tests cover both paths.
- Contract accepted. Container/codecs/download/job decisions remain routed to
  F7/A11 as specified.
