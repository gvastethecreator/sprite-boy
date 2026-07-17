# Wayfinder: F4-06 history retention

## Destination

Choose an implementation-ready retention boundary for snapshot history without
weakening single-step undo or adding unmeasured hot-path cost.

## Notes

- StudioProjectV1 is JSON-safe metadata and excludes blobs/runtime URLs.
- Each history entry currently retains one exact project snapshot.
- F4-06 must close a deterministic guard; heap telemetry belongs to a measured
  performance gate rather than an estimated JSON proxy.

## Decisions So Far

- [Choose the retention budget](tickets/001-retention-budget.md) - bound total retained entries to 100 by default; do not stringify every command to estimate heap.

## Not Yet Specified

- None for the F4-06 implementation frontier.

## Out Of Scope

- Production heap telemetry and adaptive budgets; require representative large
  projects and belong to a later measured performance gate.

## Outcome Evidence

- Implemented default 100 with explicit data-only range 1..1000.
- Retention keeps the newest undo entries and preserves exact undo/redo across
  the retained boundary.
- Independent review verified default 100 plus limits 1 and 1000; F4-06 gate
  passed 29/29 focused and 343/343 full-suite tests.
