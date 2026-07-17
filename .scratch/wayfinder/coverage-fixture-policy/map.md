# Wayfinder map — F8-04 coverage and fixture retention

## Current truth

- `vitest.config.ts` measures only legacy `utils/hooks/components/types`; it
  omits every canonical `core/**` module.
- The full 62-file/591-test corpus measures `core/**/*.ts` (excluding barrels)
  at 82.29 statements, 76.75 branches, 91.72 functions and 86.15 lines.
- The release target remains 90 statements/functions/lines and 85 branches;
  current code therefore needs a ratchet profile plus an explicitly red release
  profile rather than silently weakening the target.
- Authoritative fixtures are three tracked contract modules and the four B0
  quality artifacts. No copied Grid pixel fixture exists yet; G1/G2 still own it.

## Canonical route

1. `scripts/studio-quality-policy.mjs` owns fixed coverage scope, ratchet and
   release thresholds, Vitest argv and result evaluation.
2. `coverage --profile ratchet` is the green local regression gate.
3. `coverage --profile release` is the deliberate red proof until tests/features
   raise canonical coverage to the documented target; F8-06 must use release.
4. `quality/fixture-retention.json` owns exhaustive roots and SHA-256/byte-size
   identity for retained fixture/golden artifacts.
5. `fixtures` rejects missing/untracked/symlinked/drifted/unmanifested files.
6. `scripts/studio-gates.mjs` exposes coverage and fixture gates without package
   aliases, dependency, lock or shell-string changes.

## Writable boundary

- `scripts/studio-quality-policy.mjs`
- `scripts/studio-gates.mjs`
- `quality/fixture-retention.json`
- `tests/scripts/studioQualityPolicy.test.ts`
- `tests/scripts/studioGates.test.ts`
- F8 ledgers and scratch evidence

`package.json`, locks, canonical product modules and donor repositories remain
read-only in F8-04.
