# F8 bundle, performance and accessibility budget policy

Date: 2026-07-15
Task: F8-05
Status: accepted

## Enforced gates

`bun scripts/studio-gates.mjs --gate budgets` builds the production app, checks
the initial JavaScript bundle and runs a fresh Chrome profile at 1440x900 DPR 1.
`--gate all` includes the same checks. The scripts use fixed argv, no shell
strings and emit data-only summaries without URLs, labels or request IDs.

| Dimension | Ratchet/release threshold | Measured result | Status |
|---|---:|---:|---|
| Repository lint | 0 warnings | 0 | pass |
| Initial JS gzip ratchet | 245999 bytes | 245999 bytes | pass |
| Initial JS gzip release | 180000 bytes | 245999 bytes | deliberate fail |
| App rAF during 5 s idle | <=1 | 0 | pass |
| Warm route input-to-paint p95 | <=50 ms | 46.4 ms / 15 verified transitions | pass |
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
The current 245999-byte value is a no-regression floor, not a release waiver.
The 180000-byte release target stays red and blocks release readiness until
code splitting or equivalent reduction closes the gap.

## Browser measurement

The browser run waits for app readiness and network idle, then settles for one
second. It clears startup long tasks, counts app `requestAnimationFrame` calls
for five idle seconds and performs three warm traversals across the five Studio
workspaces. Every transition must prove the expected URL hash, active nav item
and visible workspace content; input-to-paint requires at least two painted
frames and is evaluated at p95 over all 15 samples. The evaluator recomputes p95
and requires Long Task API support so malformed or unsupported evidence cannot
become green.

CDP supplies heap counters and the native accessibility tree. The stored result
contains only aggregate role counts; accessible labels and page URLs are never
persisted. The gate treats semantic control roles and every AX-focusable node as
interactive, requires each to have a name on the final Slice route and requires
the shell's single canonical `main` landmark.

## Explicit remaining release work

This Foundation gate does not misrepresent broader feature budgets as tested.
Drag/gizmo frame time, 100-asset project open, large-image heap cleanup, Grid
processing/cancel timing, AI/codec lazy chunks and autosave blocking are owned
by their G/A/R slices. The native AX invariant is not a substitute for the
documented full WCAG 2.2 AA Axe/contrast/keyboard audit; adding Axe remains tied
to the separate F8-03 package/lock ownership decision or an approved no-dependency
equivalent. These items stay release blockers in `QUALITY_GATES.md`.

Evidence: [`budgets.json`](../../artifacts/quality/F8/2026-07-15/budgets.json).

The final independent review returned `accept` with no remaining P0-P3. The
complete gate passed 22/138 unit, 43/463 contract, 1/6 integration and 66/607
coverage tests; canonical coverage is 82.31/76.81/91.79/86.17 and retained
fixtures remain 7/7.

Commands:

```text
bun x oxlint . --deny-warnings
bun scripts/studio-quality-policy.mjs bundle --profile release
bun scripts/studio-gates.mjs --gate budgets
bun scripts/studio-gates.mjs --gate all
```
