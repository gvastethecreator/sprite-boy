# Choose the retention budget

Type: research
Status: resolved
Blocked by: None

## Question

Should F4-06 bound snapshot history by entry count, estimated JSON bytes, or both?

## Answer

Use a total entry-count limit: default 100, configurable with a conservative
upper bound. Undo/redo only move entries, coalesce does not add entries, and a
new branch trims the oldest undo entries after clearing redo. This is cheap,
deterministic and directly limits the number of full snapshots.

Do not stringify each inverse to estimate bytes: StudioProjectV1 already
excludes binary payloads, serialization would add O(document) work to every
command, and JSON byte length is not a reliable JS heap measure. Measure real
heap with representative documents before adding an adaptive byte budget.

