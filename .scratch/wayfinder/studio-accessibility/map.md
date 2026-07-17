# Wayfinder: F6-04 Shell accessibility and compact layout

## Destination

Give every shell overlay and side panel one focus/keyboard contract while
keeping all five workspaces and both tool panels reachable below the full
desktop breakpoint.

## Observed Terrain

- Six overlays implement backdrop, Escape, autofocus and animation differently;
  most lack dialog semantics, a focus trap or trigger restoration.
- The five-workspace nav disappears below `lg` with no alternative route.
- Left/right editor panels consume 560px permanently and need a compact drawer
  presentation without duplicating their feature state.
- GSAP modal entrance ignores the OS reduced-motion preference.

## Decision

- [One focus owner per modal or drawer](tickets/001-one-focus-owner.md): shared
  StudioDialog owns trap, Escape, backdrop close, initial focus and restoration.
- StudioPanel owns semantic labeling/presentation only; the same children render
  inline at `xl` and inside StudioDialog below it.
- Header exposes a compact registry-derived workspace menu; no sixth route and
  no alternate navigation state.
- Global CSS and the remaining GSAP compatibility hook honor reduced motion.

## Out Of Scope

- Workspace-specific empty/loading/error bodies (F6-05), final shortcut
  consolidation (F6-06), feature panel redesign and donor visual replication.

## Outcome

- Implemented. Six legacy overlays now share StudioDialog; desktop panels and
  compact drawers share StudioPanel without mounting duplicate feature trees.
- Header and layout use the same `xl` breakpoint, with five registry-derived
  destinations available in the compact menu.
- Chrome production build passed at 1440x900 and 1024x768 with focus trap/
  restoration, Escape, reduced motion, no page overflow and zero runtime errors.
- Independent review: `accept`, no reproducible P0-P3 findings.
