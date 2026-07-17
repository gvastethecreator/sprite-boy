# Use URL hash as the temporary shell route owner

Type: decision
Status: resolved
Blocked by: canonical ProjectStore is not mounted by the legacy runtime

## Question

How can F6-03 expose five real routes without creating a second active workspace
state beside legacy `AppMode` or inventing an empty canonical project engine?

## Answer

Treat the canonical hash href from F6-01 as the shell route owner. A
`useSyncExternalStore` adapter reads it, normalizes invalid/Assets hashes to
Slice, publishes push/back/forward changes and has no independently mutable
React state. The active route projects one way into legacy `AppMode` solely to
keep current panes operational:

- Slice/Compose -> Builder
- Animate -> Animation
- Collision -> Collision
- Export -> Template

No legacy mode projects back after mount. Header, palette and keyboard commands
all call the same route navigation port. When the canonical ProjectStore becomes
the live document owner, this adapter must additionally dispatch
`workspace.update` and then retire `AppMode`; F6-06/X1 retain that removal gate.
Creating a standalone empty ProjectStore now would violate the one-engine rule.
