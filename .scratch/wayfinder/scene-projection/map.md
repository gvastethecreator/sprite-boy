# Wayfinder: F5-01 scene projection

## Destination

Define one deterministic, UI-independent `SceneProjection` contract that turns
the canonical project snapshot plus local workspace viewport into the render
input shared by preview, thumbnails and export.

## Notes

- Durable selection and active workspace live in `project.workspace`.
- Local `WorkspaceState` owns viewport, panel sizes and preferences only.
- Playback and interaction stores are intentionally excluded from F5-01.
- The canonical project validator guarantees references and ownership before a
  ProjectStore snapshot reaches the projector.

## Decisions So Far

- [Choose the render root](tickets/001-render-root.md) - resolve a stable root
  from active workspace and durable selection, with root-order fallbacks.
- Project only the active workspace viewport. Panel sizes and preferences do
  not affect scene identity.
- Emit normalized data-only render nodes and asset descriptors; do not resolve
  blobs, object URLs, Canvas APIs or caches in the projector.
- Preserve composition layer order and visibility metadata. F5-02 owns draw
  policy and pixel composition.

## Not Yet Specified

- Playback-frame override and onion-skin neighbors; these require the later
  playback/render integration rather than hidden state in F5-01.
- Collision overlays; F5-01 chooses the visual owner, while collision rendering
  belongs to its feature slice.

## Out Of Scope

- Rasterization, asset decoding, scheduling, caching, DPR and context recovery.

## Outcome Evidence

- Implemented immutable asset, region, composition, variant and cel nodes with
  normalized source descriptors and transforms.
- Deterministic gate passed 12/12 including empty document, selection/root-order
  fallback, active viewport isolation, JSON round-trip and deep freeze.
- Independent review returned `accept` with no P0-P3 findings; accumulated gate
  passed 38 files and 355 tests plus typecheck, strict lint and production build.
