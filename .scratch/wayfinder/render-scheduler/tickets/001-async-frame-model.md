# Choose the async frame model

Type: decision
Status: resolved
Blocked by: None

## Question

Should continuous playback request a new rAF while the previous compositor call
is unresolved, or serialize frames and coalesce state changes?

## Answer

Serialize. A scheduler owns at most one requested callback and one render in
flight. Invalidations during a render accumulate in deterministic sets; when
the render settles, exactly one next callback is requested if dirty state or a
continuous lease remains.

Overlapping renders can commit stale assets after newer project revisions,
race one Canvas target and create unbounded work when decode is slower than the
display refresh. Serialized frames drop intermediate visual states naturally
while preserving the latest revision/changed IDs.

If a render rejects, restore that frame's invalidations/revision/changed IDs to
the dirty accumulator and halt automatic scheduling. The next external retry
therefore cannot lose the scene change that originally failed.

Drag and playback use independent reference-counted leases. Multiple consumers
of the same reason can release idempotently without stopping another owner.
When the last lease ends and no invalidation remains, cancel the queued callback
so idle has zero rAF work.
