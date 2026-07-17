# Wayfinder: F6-06 Shell keyboard and reachability

## Destination

Close the W2 shell gate with one canonical global-command keyboard path, scoped
domain shortcuts, five reachable workspaces and no visible or returned inert
legacy command surface.

## Decision

- [Registry event match plus one shell dispatcher](tickets/001-keyboard-owner.md):
  command metadata resolves `KeyboardEvent.code`, primary modifiers and editable
  policy; the existing application hook dispatches that result before local
  editor/animation keys.
- Modal suspension remains a UI concern. Escape closes the transient surface;
  all commands and domain keys are suspended so keyboard input cannot stack
  dialogs or mutate the project behind one. Editable policy applies otherwise.
- Canvas Space owns pan only while workspace content has focus and no active
  animation owns playback. Inputs, textareas, selects and contenteditable
  surfaces never reach canvas/domain handlers.
- Remove the unmounted legacy Header and controller-returned command palette
  array. It contains inert Open/Analyze callbacks and Builder/Animation routes
  that bypass the five-workspace registry.
- Wire the visible Export snapshot button to its real modal and remove inert
  copy/paste hitbox documentation until that feature exists.

## Proof

- Contract: event-code matching, Ctrl/Cmd parity, exact modifiers, editable
  policy and conflict-free command metadata.
- Hook: modal/editable guards, registry dispatch, local animation/editor keys.
- Static reachability: no legacy Header import/file, controller command array,
  no-op shortcut inputs or visible empty onClick.
- Browser J9: Ctrl/Cmd workspace routes, palette/preferences/help, focus transfer,
  editable/modal suppression and real Snapshot action with zero errors.

## Out Of Scope

- Feature-specific shortcut additions, hitbox clipboard implementation, command
  customization UI and removal of the AppMode compatibility projection used by
  legacy feature bodies.

## Outcome

- Implemented and accepted. Registry metadata now matches keyboard input and a
  single shell hook sequences command, modal/editable and domain ownership.
- Legacy Header/controller command arrays and visible no-op Snapshot were
  removed or wired; Help and Palette share canonical shortcut presentation.
- Production J9 passed five routes/focus, modal/editable guards, canvas reset and
  PNG Export with zero errors. Review found and closed Space-pan stuck on blur;
  key release and window-loss cleanup are covered explicitly.
