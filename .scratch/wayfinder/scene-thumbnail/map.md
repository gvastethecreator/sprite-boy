# Wayfinder: F5-04 scene thumbnail adapter

## Destination

Render bounded thumbnails from the canonical SceneProjection through the shared
compositor, preserving the same painter order, transforms, alpha and background
without importing legacy UI thumbnail rules.

## Notes

- Host thumbnails currently mix CSS cropping, object-contain and direct legacy
  image URLs; Animoto also stores arbitrary generated-frame URLs as project
  thumbnails. None is a stable canonical render contract.
- Rendering at full source size before downscaling can allocate an unbounded
  intermediate canvas for large projects.
- Unit parity must not depend on jsdom Canvas support.

## Decisions So Far

- [Choose thumbnail sizing and surface boundary](tickets/001-sizing-and-surface.md)
  - aspect-fit output, no crop/padding, bounded dimensions and no upscale by
  default; a mandatory surface port makes compositor usage testable.

## Not Yet Specified

- Consumer cache eviction and React lifecycle; F5-04 returns revision/workspace
  metadata but does not own a UI cache.

## Out Of Scope

- Preview DPR/viewport, context-loss recovery, export format registry and object
  URL ownership.

## Outcome

- Implemented and independently accepted in F5-04.
- Five-root software goldens match the canonical compositor; Browser
  OffscreenCanvas traces use the same transformed matrices and final-size surface.
- Cross-realm Blob is accepted through an intrinsic internal-slot brand check;
  MIME fallback and `Symbol.toStringTag` impostors fail typed.
- Evidence: 16 focused tests, 41 suites/403 accumulated tests, typecheck, strict
  focused lint, production build and final reviewer `accept`.
