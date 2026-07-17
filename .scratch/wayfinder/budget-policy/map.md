# Wayfinder map — F8-05 runtime and accessibility budgets

## Current truth

- The F8-02 lint gate allowed the measured 47-warning legacy ratchet.
- The production entry chunk is 918655 raw bytes / 245999 gzip level 9. The
  release target remains 180000 gzip bytes and is deliberately red.
- The Foundation shell has five workspace routes and an invalidation-based
  renderer, but no single command previously proved idle, interaction, long
  task and accessibility invariants together in production Chrome.
- `package.json` and `bun.lock` remain outside this slice under the accepted
  F8-01 ownership record.

## Canonical route

1. `studio-gates.mjs` owns a zero-warning lint command and the composed
   `budgets`/`all` routes.
2. `studio-quality-policy.mjs` discovers initial module assets from built HTML
   and delegates deterministic level-9 gzip measurement to Node.
3. `studio-browser-smoke.mjs` optionally instruments a fresh production page;
   the normal browser smoke remains unchanged when budgets are not requested.
4. `studio-browser-budget.mjs` validates 5 seconds idle, 15 input-to-paint
   samples, Long Task API availability and the native accessibility tree.
5. Ratchet failures block local gates. Release bundle debt stays visible rather
   than weakening the 180000-byte target.

## Writable boundary

- Quality scripts and their focused tests.
- Warning-only cleanup in the files reported by oxlint.
- Canonical `main` landmark ownership in `AppLayout`; nested canvas becomes a
  named `section`.
- F8 policy, ledger and evidence documents.

The user-owned package/lock, donor repositories and the untracked F3-07 browser
journey remain read-only.

## Evidence route

- `bun x oxlint . --deny-warnings`
- `bun x tsc --noEmit`
- `bun scripts/studio-quality-policy.mjs bundle --profile release`
- `bun scripts/studio-gates.mjs --gate budgets`
- `bun scripts/studio-gates.mjs --gate all`

Independent review must inspect the raw warning cleanup, metric consistency,
redaction, browser cleanup, thresholds and deliberate red release proof before
F8-05 can become accepted.
