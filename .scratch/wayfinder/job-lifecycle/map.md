# Wayfinder: F7-01 typed job lifecycle

## Question

Where must the canonical job lifecycle live so worker, AI and export work can
share request identity, progress, cancellation, timeout and retry semantics
without copying either donor's transient UI state?

## Current host routes

- `core/stores/contracts.ts` owns the ephemeral `JobStore` boundary, but its
  `JobStoreEntry` is still the F4 placeholder `{ id, kind }`.
- `core/stores/localStores.ts` accepts `job.replace/remove/reset`; it protects
  project isolation and insertion order but does not validate lifecycle state.
- `hooks/useUIController.ts` owns one global `isLoading/loadingMessage` pair.
  Slicer, Builder, export and analysis hooks mutate it independently, so it
  cannot represent concurrency, terminal cause, retry lineage or late writes.
- `utils/algorithms.ts` has worker IDs and a 30 s timeout, but only private
  promises; cancel/progress/retry are absent and crashes collapse to `Error`.
- `core/render/sceneExport.ts` has a useful typed error precedent, not a job
  lifecycle. F7-05 will adapt export ports after this contract is frozen.

## Donor routes (read-only)

- `D:/DEV/animoto/state/reducer.ts` flattens generation into global booleans,
  strings and a numeric progress value. Cancel resets UI but does not abort
  provider calls; late generation writes remain possible.
- `D:/DEV/animoto/hooks/useAnimationGenerator.ts` uses a shared ref flag for
  cooperative cancellation and has no request identity or retry lineage.
- `D:/DEV/animoto/hooks/useExporter.ts` has a separate export progress tuple;
  useful stages exist, but there is no shared terminal/error contract.
- `D:/DEV/grid-splitter/src/services/gridSplitterService.ts` attaches one
  listener per request to a shared worker without request IDs. The first reply
  can resolve concurrent callers; there is no cancel, timeout or progress.
- `D:/DEV/grid-splitter/src/workers/gridSplitter.worker.ts` emits only
  `SUCCESS | ERROR`, while `ProcessingStatus` is a UI-only four-state enum.

## Canonical route

1. Add a pure, dependency-light contract in `core/processing/jobLifecycle.ts`.
2. Keep job ID and request ID distinct. Every event carries request identity so
   late messages from an earlier attempt are rejected.
3. Model `queued -> running -> succeeded|failed|cancelled|timed-out`; terminal
   records are immutable/idempotent and progress is globally monotonic.
4. Retry creates a new queued identity with root/previous/attempt lineage; it
   never rewrites the terminal source job.
5. Store only structured, display-safe error fields. Raw causes/provider data
   stay at adapters and diagnostics boundaries.
6. Replace the F4 placeholder entry with this snapshot and validate it at the
   existing `job.replace` boundary. Runner/store/UI work remains F7-02..F7-04.

## Proof route

- State-machine contract tests cover every legal transition.
- Hostile tests cover request mismatch, stale time, progress regression,
  progress/terminal races, terminal duplication/conflict and retry lineage.
- Existing local-store/selectors tests prove isolation/order with valid jobs.
- Focused typecheck, strict lint, accumulated contract tests and independent
  review gate the slice before documentation and commit.

