# Ticket 001 — Single JobRunner owner

- **Status:** accepted
- **Owner:** `core/processing/jobRunner.ts`
- **Consumes:** accepted `jobLifecycle.ts` + ephemeral `JobStore`.
- **Must reject:** non-queued start, duplicate active identity, invalid task or
  signal, run after dispose.
- **Must suppress:** progress/result/error after cancel, timeout, failure or
  disposal; wrong attempt delivery stays impossible by closure request ID.
- **Must clean:** timeout handle, caller abort listener, active map and internal
  signal exactly once.
- **Acceptance:** deterministic concurrent/cancel/crash/timeout/dispose IT and
  reviewer verdict `accept`.
