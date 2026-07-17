# Choose the render root

Type: decision
Status: resolved
Blocked by: None

## Question

Which canonical entity should F5-01 project when a workspace may select an
asset, region, composition, sequence or cel?

## Answer

Resolve the root deterministically from `project.workspace`, without reading
PlaybackStore or InteractionStore:

1. `assets`: selected asset, selected region, first ordered asset, first ordered
   region. `slice`: selected region, selected asset, first ordered region, first
   ordered asset.
2. `compose`: selected composition, selected layer's owning composition,
   selected variant set, first ordered project-owned composition, then
   region/asset fallback.
3. `animate`, `collision` and `export`: first selected cel that belongs to the
   selected sequence, first cel in the selected sequence, then composition,
   region and asset fallbacks.
4. If no active workspace is stored, use `assets` as the deterministic default.
5. A valid empty project yields `root: null`; it is not an exceptional state.

Selection fallback uses document ordering (`rootOrder` and `sequence.celIds`),
never record insertion order. The resulting projection includes only copied,
normalized data and the viewport for the resolved workspace. This keeps UI
layout changes from invalidating render data and leaves runtime frame selection
to an explicit later adapter.

## Evidence

- `StudioProjectV1.workspace` is the durable selection contract.
- `WorkspaceState` documents that active workspace and selections are not
  duplicated locally.
- The representative fixture covers region, project composition, cel
  composition and active variant-set sources.
- Animoto's donor viewer separates edit selection from playback frame state;
  F5-01 preserves that boundary instead of importing component state.
