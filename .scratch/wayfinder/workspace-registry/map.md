# Wayfinder: F6-01 Studio workspace registry

## Destination

Freeze one typed registry for the five reachable Studio destinations — Slice,
Compose, Animate, Collision and Export — without turning the global Asset
Library into a competing top-level workspace.

## Notes

- The canonical document `WorkspaceId` also contains `assets` because durable
  selection, per-context viewports and scene projection can display a raw asset.
- F6 acceptance consistently calls for five reachable workspaces and an E2E
  empty state for each one. Integration plans describe Asset Library as a shared
  sidebar/source, not a sixth destination.
- The legacy shell exposes Build/Animate/View from `AppMode`, hides Collision,
  has no Compose/Slice distinction and does not provide direct routes.
- F6-02 owns executable commands. F6-03 owns React/header/hash wiring. This
  slice must not create placeholder handlers or a second state engine.

## Decisions So Far

- [Separate navigable workspaces from the Assets support context](tickets/001-workspace-vocabulary.md)
  - all canonical IDs remain covered; exactly five definitions enter primary
    navigation.
- Use dependency-free hash hrefs (`#/studio/<id>`) so every definition can be
  addressed and restored without introducing a router package.
- Registry capabilities describe render source, interaction mode, timeline and
  project-write intent. Panel structure and empty-state copy remain owned by
  F6-04/F6-05.

## Not Yet Specified

- Command execution/enablement, shell component ownership, panel sizes, focus
  restoration, empty/loading/error presentation and legacy `AppMode` removal.

## Out Of Scope

- Editing `package.json`, integrating donor shells, wiring React, replacing
  CanvasArea, or implementing feature-specific Slice/Compose behavior.

## Outcome

- Implemented a deeply immutable five-workspace registry plus the explicit
  Assets support partition. Canonical workspace IDs now have one runtime source
  consumed by validation, reducer and WorkspaceStore.
- Focused 20/20, accumulated 44 files/435 tests, typecheck, strict lint, build
  and diff-check passed. Independent review returned `accept` without findings.
