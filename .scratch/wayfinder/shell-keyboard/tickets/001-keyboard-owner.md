# Decision: registry matching plus one shell keyboard dispatcher

## Question

Should the command registry install a global DOM listener, or should the shell
translate keyboard events and execute registry IDs?

## Decision

Keep the registry pure. Add a typed keyboard-input matcher to its public port.
The existing `useKeyboardShortcuts` remains the only global command dispatcher,
receives registry/context/execute, then handles genuinely local editor and
animation keys only when no command, modal or editable target owns the event.

## Why

DOM listeners inside the registry would mix platform policy with metadata and
make multiple app roots conflict. A second React listener would duplicate
ordering and preventDefault behavior. One hook can sequence command, modal and
domain ownership deterministically while the registry stays testable.

## Rejected

- Keep hand-written Ctrl+Z/Ctrl+K checks: duplicates code/modifiers and drifts
  from visible command metadata.
- Add a second command-only window listener: listener order becomes observable
  and Canvas Space conflicts remain.
- Move editor arrows/delete/playback into the global registry: these require
  feature selection/playback state and belong to their domain slices.
