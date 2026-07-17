# Wayfinder: F6-03 Studio shell bridge

## Destination

Replace the legacy three-tab header with a registry-driven five-workspace shell
whose URL, command palette and visible navigation agree while preserving the
still-active legacy editor surfaces behind one temporary adapter.

## Notes

- The app mounts canonical local stores but not a canonical ProjectStore; legacy
  `ProjectContext` still owns project content and `AppMode`.
- Creating an empty canonical ProjectStore only to hold activeWorkspace would be
  a second project engine and is forbidden.
- Slice and Compose both currently project to legacy Builder internals. Animate,
  Collision and Export map to Animation, Collision and Template respectively.
- F6-04 owns full focus/modal/compact contracts; F6-05 owns workspace states;
  F6-06 owns final keyboard/no-inert gate and legacy navigation removal.

## Decisions So Far

- [Use URL hash as the temporary shell route owner](tickets/001-navigation-owner.md)
  - no duplicate React state; `useSyncExternalStore` observes URL and legacy
    `AppMode` is a one-way compatibility projection.
- Build the header, nav and palette adapter from F6-01/F6-02 registries. Hidden
  file inputs are real handler ports for Open/Import; no no-op command survives.
- Route hrefs remain `#/studio/<id>` and support browser back/forward/direct
  load without adding a router dependency.

## Not Yet Specified

- Canonical document hydration from legacy project content, per-workspace panels
  and states, compact shell/focus restoration, feature command remapping.

## Out Of Scope

- A second ProjectStore, donor layouts, changing package dependencies, complete
  CanvasArea migration or implementing workspace feature bodies.

## Outcome

- Accepted. The hash owner, one-way legacy projection, registry-driven header
  and executable palette shipped without a second ProjectStore.
- Chrome 1440x900 proved direct/default routes, all five destinations,
  back/reload and Ctrl+K command execution with zero page errors.
- F6-04 inherits compact navigation, modal/focus restoration and reduced-motion
  contracts; F6-05 inherits workspace-specific states/bodies.
