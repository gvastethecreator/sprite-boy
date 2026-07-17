# Wayfinder: F6-05 Workspace states

## Destination

Replace the shared legacy Builder empty screen with honest loading, error,
empty and ready decisions for Slice, Compose, Animate, Collision and Export.

## Decision

- [Pure resolver, shell presenter](tickets/001-state-owner.md): `core/studio`
  resolves state from a small availability snapshot; `components/studio` owns
  copy, semantics and registry-backed resolution actions.
- Loading comes from the existing UI controller. Shell command failures become
  retryable workspace-local error state; feature/provider jobs remain F7/A7.
- Empty-state buttons use existing executable command IDs only. No placeholder
  create/generate/export command is added to satisfy presentation.
- CanvasArea mounts only for `ready`; therefore non-Slice destinations never
  leak the legacy generic Import/Create Builder empty screen.

## Readiness

- Slice: source image.
- Compose: builder canvas.
- Animate: any scene; animation creation stays in its real Tools consumer.
- Collision: at least one sliced frame; otherwise route back to Slice/import.
- Export: any scene.

## Out Of Scope

- Feature bodies, job/provider errors, generation/loading telemetry, canonical
  document migration and F6-06 shortcut/no-inert consolidation.

## Outcome

- Implemented and accepted. The pure resolver/presenter owns all four states;
  CanvasArea mounts only for ready and no extra store/placeholder was added.
- Production Chrome proved five distinct empty routes, registry recovery,
  empty-to-ready import, viewport fit and zero console errors/exceptions.
- Review found one focus-loss repair: route changes now focus a stable named
  workspace-content boundary. The hardened journey verifies that owner.
