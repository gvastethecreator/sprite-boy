# F8 canonical coverage and fixture retention policy

Date: 2026-07-15
Task: F8-04
Status: accepted

## Coverage scope

The coverage command runs the complete Vitest corpus and measures
`core/**/*.ts`, excluding only `core/**/index.ts` barrels. This fixes the W0
instrumentation gap: `core/project/**` is present in the generated summary and
cannot be replaced by legacy UI/global coverage.

Two profiles are intentionally distinct:

| Profile | Statements | Branches | Functions | Lines | Meaning |
|---|---:|---:|---:|---:|---|
| `ratchet` | 82.29 | 76.75 | 91.72 | 86.15 | Current non-regression floor |
| `release` | 90 | 85 | 90 | 90 | Required release target |

The ratchet is green. The release profile is deliberately red on statements,
branches and lines; this is recorded debt, not a relaxed target. A future
change may raise ratchet values after measured improvement. Lowering a ratchet
requires an owner, an explanation and comparative coverage evidence. F8-06
cannot accept release readiness until the `release` profile passes.

Commands:

```text
bun scripts/studio-gates.mjs --gate coverage
bun scripts/studio-quality-policy.mjs coverage --profile release
```

The runner deletes the previous JSON summary, launches Vitest with fixed argv
and `shell:false`, validates totals and their reported percentages, requires a
`core/project/**` entry and emits one machine-readable result. A stale, absent,
malformed or inconsistent summary fails closed.

## Fixture and golden retention

[`quality/fixture-retention.json`](../../quality/fixture-retention.json) is the
authority for retained fixture/golden roots. It currently owns seven tracked
files:

- three contract fixtures under `tests/contract/fixtures`;
- four W0/B0 quality and donor-source manifests.

Every entry records relative path, kind, owner, content mode, canonical byte
count and SHA-256. `text-lf` normalizes CRLF/CR to LF before identity so Windows
and Linux checkouts agree; future binary assets use `binary`.

The gate rejects:

- missing or untracked entries;
- undeclared files inside a retained root;
- changed byte count or hash;
- symlink/junction roots or symlinked descendants;
- traversal, absolute, duplicate or unsorted manifest paths.

Command:

```text
bun scripts/studio-gates.mjs --gate fixtures
```

When an intentional fixture changes, update its behavior tests and provenance,
then update the manifest identity in the same reviewed change. New Grid source
fixtures and processed pixel goldens remain G1/G2-owned and must enter a
retained root when copied into SpriteBoy; the donor repository stays read-only.

## Package ownership

F8-04 does not modify package aliases, dependencies or locks. The coverage
provider already exists in the user-owned install; frozen-install ownership
remains the separate F8-03 decision recorded in
[`F8_REPRODUCIBILITY_OWNERSHIP.md`](./F8_REPRODUCIBILITY_OWNERSHIP.md).
