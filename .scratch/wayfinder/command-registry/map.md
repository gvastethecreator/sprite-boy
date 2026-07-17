# Wayfinder: F6-02 Studio command registry

## Destination

Provide one typed executable command registry for shell/project/workspace
actions, including enablement and deterministic shortcut conflict detection,
without carrying legacy no-op palette actions forward.

## Notes

- Legacy palette entries are mutable objects created inside
  `useProjectController`; Open Project and Analyze contain empty callbacks.
- `useKeyboardShortcuts` independently hardcodes undo/redo, palette and reset,
  although it correctly guards editable controls.
- A12 later owns feature-level remapping and complete editor shortcuts. F6-02
  owns the shell-level foundation and must stay extensible without claiming
  future timeline/tool commands.

## Decisions So Far

- [Keep command metadata data-only and execution port-bound](tickets/001-executable-boundary.md)
  - published commands cannot hide placeholder callbacks; registry construction
    requires every shell port.
- Represent shortcuts by `KeyboardEvent.code` plus ordered semantic modifiers
  (`primary`, `alt`, `shift`) and editable policy. This avoids locale-sensitive
  `event.key` drift and Ctrl/Cmd duplication.
- Every visible workspace remains enabled even without content, routing to its
  F6-05 empty state. Document mutations use explicit project/busy/canUndo/
  canRedo/canvas enablement.

## Not Yet Specified

- React event binding, command palette UI, feature-level shortcuts, user
  remapping, precedence between canvas tools and shell commands.

## Out Of Scope

- Donor command handlers, AI Analyze visibility, feature jobs, React wiring,
  palette redesign or changing legacy `useKeyboardShortcuts` before F6-03/06.

## Outcome

- Implemented 15 deeply immutable shell commands, exhaustive handler capture,
  typed enablement/execution, canonical code-based shortcuts and deterministic
  duplicate/conflict audit. Analyze remains absent until a real port exists.
- Focused 15/15 registry+workspace, accumulated 45 files/444 tests, typecheck,
  strict lint, build and diff-check passed. Independent review returned accept.
