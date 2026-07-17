# Decision: pure resolver plus shell presenter

## Question

Should each workspace own independent loading/error/empty state, or should the
shell derive it from existing project/UI facts?

## Decision

Use a pure exhaustive resolver keyed by StudioWorkspaceId. It receives only
loading, optional shell error, source/canvas/frame/animation availability and
returns a frozen discriminated union. A single presenter renders it.

## Why

Five local states would drift and become parallel engines. The shell already
knows route and command availability; feature jobs will later contribute typed
errors without changing the presentation contract.

## Rejected

- Reuse CanvasArea empty screen: misleading Builder actions for every route.
- New global workspace-state store: duplicates facts and creates persistence
  ambiguity.
- Placeholder feature commands: violates F6-02/F6-06 no-inert gate.
