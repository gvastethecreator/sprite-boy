# Decision: one focus owner per modal or drawer

## Question

Should each legacy overlay keep its own key/focus effects, or should the shell
introduce one shared owner before migrating them?

## Decision

Use one StudioDialog primitive for modal semantics, initial focus, cyclic Tab,
Escape, backdrop close and trigger restoration. Feature modals provide content
and labels only. Drawers reuse the same focus boundary around StudioPanel.

## Why

Local effects already disagree and cannot reliably coordinate stacked overlays.
A single owner is testable, prevents listener leaks and gives reduced-motion a
single behavior. It does not own project state or feature lifecycle.

## Rejected

- More per-modal listeners: duplicates bugs and leaves restoration inconsistent.
- A global modal store: expands F6-04 into state migration and risks a parallel
  interaction model before F6-06.
