# Wayfinder: F5-02 scene compositor

## Destination

Define one render-plan and execution contract that composites every F5-01 scene
root consistently for preview, thumbnails and export without importing UI state.

## Notes

- Legacy Builder migration stores layer x/y as the transformed source center.
- Animoto stores index zero as topmost and reverses before Canvas drawing.
- Canonical migration appends Builder layers in ascending painter/z order.
- Cel pivots are pixel coordinates and may be outside the source bounds.

## Decisions So Far

- [Freeze painter and transform semantics](tickets/001-transform-semantics.md) -
  `layerIds` is bottom-to-top painter order; layer transforms use a center
  anchor; cel transforms place their pivot at canvas center plus x/y offset.
- Compile a frozen affine draw plan before touching runtime images.
- Resolve images through an injected asset port and execute through an injected
  compositor target; failures reject the frame and require target rollback
  instead of silently skipping or retaining partial output.
- Default to nearest-neighbor sampling. Smooth sampling is an explicit render
  option, not a project/document field.

## Not Yet Specified

- DPR/base viewport matrices and physical canvas resize belong to F5-06.
- Playback-frame selection and onion neighbors remain explicit adapters.

## Out Of Scope

- Asset decoding implementation, caches, scheduler, overlays and export codecs.

## Outcome Evidence

- ADR-002 and implementation agree on bottom-to-top painter order, center-origin
  layers, pivoted cels, fixed backgrounds and explicit hidden/visible behavior.
- Five-root pixel goldens plus rotation, flip, alpha and crop pass 30/30 focused
  tests; the accumulated repository gate passes 39 files and 373 tests.
- Independent review found optional rollback; `abortFrame` is now mandatory and
  draw/end failure tests prove the target returns to a clean state. Final verdict
  is `accept`; typecheck, strict lint, build and diff-check pass.
