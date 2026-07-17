# Choose viewport lifecycle boundary

Type: decision
Status: resolved
Blocked by: None

## Question

Should F5-06 replace the legacy React CanvasArea now, or freeze and prove the
canonical browser viewport lifecycle consumed later by F6/A1?

## Answer

Implement the canonical lifecycle controller only. It receives a canvas, an
external content-box resize target, projection provider and image resolver; the
canvas itself is rejected as resize target to prevent intrinsic DPR feedback.
It owns a `RenderScheduler`, one
ResizeObserver, DPR listeners and context lost/restored listeners. It resizes
the physical backing store from CSS dimensions and DPR, composes DPR with the
projection viewport as the Canvas2D base matrix, and renders only after
invalidation or active scheduler leases.

Context loss suspends drawing and invalidates any in-flight generation.
Restoration reacquires Canvas2D, reapplies metrics and schedules a fresh scene
frame. Dispose cancels scheduler work, disconnects every observer/listener,
invalidates late completions and releases backing pixels by setting 0x0.

F6/A1 will bind ProjectStore/WorkspaceStore and replace the legacy CanvasArea
after workspace routes exist. This keeps F5-06 executable without creating a
second bridge from legacy ProjectState into canonical rendering.
