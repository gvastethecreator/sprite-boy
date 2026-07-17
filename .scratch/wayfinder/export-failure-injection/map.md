# Wayfinder map — F7-06 export failure injection

## Canonical route

1. A producer creates one immutable queued job and gives it to `JobRunner`.
2. The task passes the runner-owned `AbortSignal` into `ExportPort.run`.
3. `ExportPort` resolves exactly one captured provider, validates its Blob and invokes exactly one captured writer.
4. Success is publishable only after the writer returns an exact receipt while the signal is still open.
5. Cancel or timeout commits one JobStore terminal, aborts the shared signal and closes runner timers/listeners/active ownership.
6. Provider/writer work that settles later cannot change the terminal or return an export result.

## Injection seams

- **Quota:** writer rejects with native `QuotaExceededError`; the port redacts it at the writer boundary.
- **Provider crash:** provider rejects before artifact creation; the writer must remain untouched.
- **Worker crash:** worker adapter reports a typed `JobTaskError("worker-crash", ...)`; JobRunner owns the safe terminal.
- **Timeout during provider:** manual runner clock fires while encode is pending; abort prevents any later writer invocation.
- **Cancel during writer:** cancellation aborts a cooperative writer and suppresses receipt/result publication.
- **Non-cooperative late settlement:** a hostile provider or writer may ignore cancellation, but its late promise settlement cannot mutate JobStore or reopen the run.

## Observable cleanup

- JobStore snapshot stays byte-for-byte equal to the first terminal after every late settlement.
- `JobRunner.getActiveCount()` returns zero.
- Manual timer inventory returns zero and every scheduled live handle is cleared or consumed once.
- Native AbortSignal add/remove calls balance after queued async work drains.
- No writer call occurs after a provider-stage cancel/timeout.
- No successful `ExportResult` or receipt escapes after writer-stage cancel.

## Ownership decisions

- F7-06 owns deterministic integration fixtures and hostile race evidence, not another runtime state engine.
- `JobStore` remains the only writable lifecycle state; export artifacts and receipts remain values.
- ExportPort keeps provider/writer errors generic and redacted. F7-07 owns the final Job/Export diagnostic mapping and security review.
- A concrete writer must honor the provided signal to prevent destination side effects. The port still protects its own success publication when a hostile writer ignores it.

## Writable boundary

- `tests/integration/exportJobFailureInjection.test.ts`
- F7-06 evidence/status sections in the durable plan and integration ledgers.

Product contracts change only if the integration matrix exposes a real cleanup or late-publication defect.
