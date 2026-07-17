# Wayfinder: F7-03 Job Center retention ownership

## Question

How can JobStore expose stable Job Center projections and bounded visible
history without pruning active work, breaking retry lineage or recycling an ID
that a late completion could still carry?

## Current and donor routes

- `core/stores/localStores.ts` already owns ephemeral JobStore snapshots,
  legal lifecycle replacement and session tombstones. It is the only writable
  state boundary; F7-03 must not create another Job Center store.
- `core/stores/selectors.ts` exposes only one job and raw insertion order. It has
  no active-first projection, status summary or retry-family view.
- Animoto distributes generation/export progress across reducer booleans,
  component state and Sonner toasts. Grid Splitter has transient processing
  feedback/toasts. Neither donor has a retention or lineage-safe Job Center to
  port; their behavior is input evidence, not an implementation owner.
- F7-01 makes job/request IDs single-use for the JobStore session. Removing a
  visible job must retain tombstones and consumed retry sources.
- F7-02 guarantees task late-write suppression, but concrete worker/provider/
  export migrations remain in G1/A7/F7-05.

## Canonical route

1. Extend `createJobStore` with a validated immutable retention policy; keep the
   default store ephemeral and history-free.
2. Retain active retry families unconditionally. Count terminal history by root
   family, not attempt, so pruning never leaves a child with missing ancestry.
3. After each replacement, atomically prune the oldest fully-terminal families
   beyond the configured budget. Preserve job/request tombstones and consumed
   retry-source IDs for the full store session.
4. Add memoized Job Center entry/summary/family selectors. Entries present
   active work first, then terminal work by latest update, with stable tie-breaks.
5. Keep UI, live regions, buttons and dialogs in F7-04; F7-03 is a pure store and
   selector contract only.

## Proof route

- Independent completed families prune oldest-first with tombstones intact.
- Active/queued retry families pin their whole ancestry; completion prunes only
  a different whole terminal family and never splits lineage.
- Policy input is exact, bounded and descriptor-safe; default behavior remains
  compatible with existing JobStore tests.
- Selectors are memoized, active-first, deterministic and expose exact counts
  without project/workspace/history state.
- Focal retention/store/runner tests, typecheck, strict lint, full contract
  checkpoint and independent adversarial review gate the slice.

