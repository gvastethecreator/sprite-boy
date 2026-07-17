# Separate navigable workspaces from the Assets support context

Type: decision
Status: resolved
Blocked by: None

## Question

Should F6 expose all six canonical `WorkspaceId` values as top-level Studio
destinations, or keep `assets` as shared support context while registering the
five workspaces named by the acceptance contract?

## Answer

Register exactly Slice, Compose, Animate, Collision and Export as navigable
Studio workspaces. Keep `assets` in the canonical `WorkspaceId` union because
the project, WorkspaceStore and renderer need raw-asset selection/viewport
context. Export a typed support-context partition and prove that the primary
and support unions exhaust canonical IDs.

When a durable project has `activeWorkspace: "assets"` or no active workspace,
the shell resolver selects Slice as the visible destination; the Asset Library
remains available inside the shell. F6-03 will perform the canonical
`workspace.update` transition when it binds navigation, avoiding UI/render
disagreement. No schema value is deleted or silently rewritten in F6-01.

Each primary definition receives a stable hash href, navigation command ID,
order, label/description and semantic capability contract. F6-02 supplies real
handlers; F6-03 consumes the registry. This preserves dependency direction and
prevents inert command placeholders.
