# Ticket 001 — Canonical typed job contract

- **Status:** accepted
- **Owner:** `core/processing/jobLifecycle.ts`
- **Store seam:** `core/stores/contracts.ts`, `core/stores/localStores.ts`
- **Must preserve:** ephemeral/no-history JobStore policy, null-prototype job
  map, stable insertion order, no project/revision data in job entries.
- **Must reject:** wrong request IDs, stale timestamps, progress regression,
  illegal state changes, any write after terminal, retry of success or a
  non-retryable failure, duplicate retry identity.
- **Deferred:** timers/AbortController/worker ports (F7-02), retention/selectors
  (F7-03), Job Center UI (F7-04), ExportPort (F7-05).
- **Acceptance:** all legal and hostile state-machine paths executable in UT;
  reviewer verdict `accept` after focal and accumulated gates.
- **Outcome:** 29/29 focal, 38/38 contract files and 405/405 accumulated tests;
  typecheck, strict lint, build and diff-check green. Four adversarial rounds
  closed orphan lineage, impossible queued progress and identity recycling.
