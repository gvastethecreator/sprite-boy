# Wayfinder: F7-02 JobRunner ownership

## Question

Which boundary must own task start, AbortController, timeout and terminal commit
so worker, AI and export adapters cannot write after cancel/crash/disposal?

## Current host routes

- `utils/algorithms.ts` owns a shared Worker, random private IDs, one timer per
  promise and crash-wide teardown. It has no public cancel/progress contract and
  timeout only rejects a promise; the worker can still answer later.
- `utils/imageWorker.ts` already echoes an ID, but its protocol is untyped and
  only emits `SUCCESS | ERROR`. G1 will replace/adapt this worker after F7.
- Builder/Slicer/Export hooks toggle one UI boolean directly. They remain legacy
  consumers until their vertical streams; F7-02 must not migrate feature UI.
- Asset/persistence code proves useful host patterns: caller + lifetime abort,
  listener cleanup and ignoring non-cooperative completion after disposal.
- `core/processing/jobLifecycle.ts` is the accepted event/state boundary;
  `JobStore` enforces identity, lineage and tombstones.

## Canonical route

1. Add `core/processing/jobRunner.ts`, independent of Worker/AI/export payloads.
2. `run(queuedJob, task, options)` inserts the queued snapshot, owns one internal
   AbortController, commits start/progress/terminal through `transitionJob` and
   returns a typed handle/result.
3. A task receives only `{requestId, signal, reportProgress}`. It cannot mutate
   JobStore directly; adapters map their domain errors to display-safe
   `JobTaskError` codes.
4. Cancel, caller abort, timeout and dispose settle exactly once, clear timer and
   caller listener, abort cooperative work and remove the active entry.
5. Non-cooperative resolve/reject/progress after settlement observes a closed
   entry and produces no store write or result change.
6. Runner time/timer host is injectable for deterministic real-async tests;
   reentrant timeout scheduling is cleaned if callback fires before handle return.

## Deferred routes

- `utils/algorithms.ts`/real image Worker protocol migration: G1.
- AI provider adaptation: A7.
- Export adapters/artifact registry: F7-05/A11.
- Retention/selectors and Job Center: F7-03/F7-04.
- Full failure-injection matrix and diagnostics policy: F7-06/F7-07.

## Proof route

- Concurrent tasks route progress/results by job + request identity.
- Pre-abort, handle cancel, timeout, task crash and dispose reach the expected
  structured terminal once.
- Deferred task completion/progress/rejection after every terminal cannot write.
- Timer and AbortSignal listeners balance exactly, including reentrant hosts.
- Focal tests, typecheck, strict lint, accumulated processing/store contracts,
  independent adversarial review and build gate the slice.

