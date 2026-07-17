# Wayfinder: F5-03 render scheduler

## Destination

Build an invalidation-driven scheduler with zero idle animation-frame requests,
no overlapping async renders and continuous frames only while drag or playback
leases remain active.

## Notes

- Scene composition may be async because runtime assets resolve through a port.
- Viewport/overlay changes must coalesce with document invalidation.
- Drag and playback may overlap; boolean ownership would stop one too early.
- Component cleanup can race with an in-flight render callback.

## Decisions So Far

- [Choose the async frame model](tickets/001-async-frame-model.md) - one render
  in flight; accumulate new invalidations and schedule one next frame on settle.
- Continuous activity uses idempotent leases keyed by drag/playback, not global
  booleans. The final release cancels an otherwise-empty pending frame.
- A one-shot invalidation may request one rAF. Idle means no scheduled callback
  after it settles, not that invalidation renders synchronously.
- Dispose cancels pending host work, clears dirty/continuous state and suppresses
  rescheduling from late async completion.

## Not Yet Specified

- Cache eviction and changed-ID consumers; scheduler only transports revision
  and deterministic changed IDs in F5-03.

## Out Of Scope

- React/store binding, DPR/context loss, asset cache implementation and workers.

## Outcome

- Implemented and independently accepted in F5-03.
- Host request reentrancy is part of the contract: diagnostic observers cannot
  recursively request in the same stack, and a handle returned after
  release/dispose is cancelled unless its callback already ran synchronously.
- Evidence: 14 focused tests, 40 suites/387 tests accumulated, typecheck, strict
  focused lint, production build and final reviewer `accept`.
