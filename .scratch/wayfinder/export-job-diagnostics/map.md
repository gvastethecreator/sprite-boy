# Wayfinder map — F7-07 export job diagnostics

## Canonical route

1. A producer creates a queued export job with the attempt-specific request ID.
2. `core/processing/exportJobTask.ts` captures one ExportPort plus immutable export input that deliberately omits request ID and signal.
3. At run time the adapter injects `JobTaskContext.requestId` and the runner-owned native `AbortSignal` into ExportPort.
4. ExportPort returns an exact artifact/receipt or throws one branded ExportPortError.
5. The adapter maps every branded export code to one safe `JobTaskError`; unknown, spoofed or hostile errors become a generic export failure.
6. JobRunner remains the sole terminal owner. Cancel/timeout win before abort reaches the port, so `EXPORT_ABORTED` cannot replace their structured terminal.

## Ownership

- `core/export/**`: format/provider/artifact/writer validation. It remains independent of JobStore and JobRunner.
- `core/processing/exportJobTask.ts`: the only Job↔Export adapter and diagnostic policy.
- `core/processing/jobRunner.ts`: start/progress/terminal/timeout/cancel and signal lifecycle.
- `core/stores/JobStore`: the only writable job state and retry ancestry.
- Job Center UI: renders already-sanitized JobError and may offer retry only from `retryable` plus unconsumed ancestry.

## Diagnostic policy

- Invalid request → `invalid-input`, not retryable.
- Unsupported format → `unsupported`, not retryable.
- Provider failure → `provider-failure`, retryable.
- Native quota failure → `quota-exceeded`, retryable after the user frees space.
- Destination failure → `storage-failure`, retryable.
- Invalid/conflicting format config, invalid/oversized artifact or invalid receipt → `export-failure`, not retryable.
- Unexpected/spoofed boundary failure → `export-failure`, retryable, generic message.
- Export abort fallback → `export-failure`, retryable; under JobRunner the already-reserved cancel/timeout terminal remains authoritative.

## Security gates

- ExportPortError has a runtime brand and frozen code/message/retryable fields.
- Native `DOMException.name` identifies `QuotaExceededError`; own getters and plain-object spoofing are ignored.
- The adapter never forwards `error.message`, `cause`, stack, provider output or destination detail.
- Options, request fields and port method are captured from own enumerable data properties; accessors and extra request identity/signal fields are rejected before work.
- The opaque source is captured by reference and never traversed.

## Writable boundary

- `core/export/contracts.ts`, `core/export/exportPort.ts`
- `core/processing/exportJobTask.ts`, `core/processing/index.ts`
- focused contract/integration evidence and F7 ledgers

Concrete codecs, browser writers, modal migration and generated-artifact project commits remain in A11.
