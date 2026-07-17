# Freeze painter and transform semantics

Type: decision
Status: resolved
Blocked by: None

## Question

What order and origin make canonical layers/cels reproduce both legacy Builder
and Animoto without embedding donor-specific state in the renderer?

## Answer

- `Composition.layerIds` is canonical painter order from bottom to top. The
  compositor draws it forward. An Animoto importer must reverse the donor's
  top-first array once at its adapter boundary.
- Layer `x/y` is the center anchor. Apply translate(x,y), rotation in degrees,
  signed scale/flip, then translate by negative half source dimensions.
- Asset/region roots draw at the canvas origin using their natural crop size.
- Cel transform applies to the flattened visual source: place `cel.pivot` (or
  source center when absent) at canvas center plus cel x/y, then rotate,
  scale/flip and multiply opacity. Negative/out-of-bounds pivots remain valid.
- Composition background is canvas-fixed. It is filled once and is not rotated
  with cel content.
- Invisible layers and direct hidden region roots/cel sources emit no draw
  operations. An explicit composition layer is governed by its own `visible`
  flag; source-library hiding does not silently override it. Locked is an
  interaction constraint and does not affect pixels.

This matches legacy migration, which converts Builder slots/free objects to
center coordinates and ascending z-order, while keeping donor reversal in a
future import adapter rather than leaking it into the shared compositor.
