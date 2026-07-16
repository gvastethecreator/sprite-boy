# F8 bundle, performance and accessibility budget policy

Date: 2026-07-15
Task: F8-05
Status: done

## Enforced gates

`bun scripts/studio-gates.mjs --gate budgets` builds the production app, checks
the initial JavaScript bundle and runs fresh Chrome profiles at 1440x900 DPR 1.
`--gate all` includes the same checks. The scripts use fixed argv, no shell
strings and emit data-only summaries without URLs, labels or request IDs.

| Dimension | Ratchet/release threshold | Measured result | Status |
|---|---:|---:|---|
| Repository lint | 0 warnings | 0 | pass |
| Initial JS gzip ratchet | 156500 bytes | 155472 bytes | pass |
| Initial JS gzip release | 180000 bytes | 155472 bytes | pass |
| Deferred Export modal/AI/GIF/ZIP eager requests | 0 each | 0 each | pass |
| Deferred Export modal/AI/GIF/ZIP action requests | exactly 1 each | 1 each | pass |
| App rAF during 5 s idle | <=1 | 0 | pass |
| Warm route input-to-paint p95 | <=50 ms | 41.1 ms post-review / 34 ms full gate | pass |
| Main-thread long task maximum | <=100 ms | 0 ms | pass |
| Unlabeled native AX interactives | 0 | 0 / 15 | pass |
| Main landmarks | exactly 1 | 1 | pass |

The 47-warning F8-02 ratchet was removed by warning-only cleanup; future
warnings fail. The shell owns one canonical `main` landmark and the legacy
canvas landmark is now a named section, avoiding nested `main` semantics.

## Bundle measurement

Initial module scripts and module-preloads are discovered from `dist/index.html`
with an allowlisted `/assets/*.js` shape. A Node-only helper reads physical
files and uses zlib gzip level 9, avoiding runtime-specific compression drift.
The initial path fell from 245999 to 155472 bytes gzip by loading AI, JSZip,
gifshot and the Export modal only from their real actions. The policy requires
exactly one hashed chunk for the Export modal, AI, GIF and ZIP, rejects any of those chunks in
the initial scripts/preloads and keeps the 180000-byte release target intact.

## Browser measurement

The browser run waits for app readiness and network idle, then settles for one
second. It clears startup long tasks, counts app `requestAnimationFrame` calls
for five idle seconds and performs four warm traversals across the five Studio
workspaces. Every transition must prove the expected URL hash, active nav item
and visible workspace content; input-to-paint requires at least two painted
frames and is evaluated at p95 over all 20 samples. With 20 observations,
nearest-rank p95 selects sample 19 instead of collapsing to the maximum as it
did at 15. The evaluator recomputes p95
and requires Long Task API support so malformed or unsupported evidence cannot
become green.

Timeline remains mounted but native-hidden outside Animate, avoiding its cold
mount on the first measured visit while preserving layout and AX visibility.
Canonical workspace commands synchronize the legacy canvas mode in the same
event before navigation. Headless Chrome disables renderer/background timer
throttling and occlusion so Windows scheduling does not create a second,
non-product latency mode; three consecutive 20-transition runs measured
34.5/34.7/49.8 ms, the final full gate measured 34 ms and the post-review
affected-gate rerun measured 41.1 ms.

The smoke and budget runners stop their browser operations internally at 40
and 70 seconds respectively, reserving 50 seconds for bounded cleanup before
their outer gate timeouts. Real 100 ms failure injections in both modes left
zero Chrome/Vite processes and zero temporary profiles.

CDP supplies heap counters and the native accessibility tree. The stored result
contains only aggregate role counts; accessible labels and page URLs are never
persisted. The gate treats semantic control roles and every AX-focusable node as
interactive, requires each to have a name on the final Slice route and requires
the shell's single canonical `main` landmark.

A second production-browser journey loads a fixture through the real project
input, executes ZIP and GIF exports, then invokes AI with a deterministic
contained provider failure. Network evidence proves 0 eager and exactly 1
action request for the Export modal and each optional provider/codec. ZIP/GIF success, AI error feedback,
page fit and the final export dialog are asserted with zero console, runtime,
log, network or HTTP errors. The modal also gained a regression fix for an
animation list loaded after its first render, plus an accessible Suspense
loading state.

## Explicit remaining release work

This Foundation gate does not misrepresent broader feature budgets as tested.
Drag/gizmo frame time, 100-asset project open, large-image heap cleanup, Grid
processing/cancel timing and autosave blocking are owned
by their G/A/R slices. The native AX invariant is not a substitute for the
documented full WCAG 2.2 AA Axe/contrast/keyboard audit; adding Axe remains tied
to the separate F8-03 package/lock ownership decision or an approved no-dependency
equivalent. These items stay release blockers in `QUALITY_GATES.md`.

Evidence: [`budgets.json`](../../artifacts/quality/F8/2026-07-15/budgets.json).

The original independent review accepted the 20-sample stability, exhaustive
workspace mapping, Timeline hidden-transition cleanup and Windows lifecycle
repairs with no P0-P3 findings. The release closeout re-review found and closed
one P3 evidence mismatch plus one P2 missing Export-modal boundary, then accepted
with zero remaining P0-P3. `IMPLEMENTATION_REVIEW.md` records the final counts.

Commands:

```text
bun x oxlint . --deny-warnings
bun scripts/studio-quality-policy.mjs bundle --profile release
bun scripts/studio-gates.mjs --gate budgets
bun scripts/studio-gates.mjs --gate all
```
