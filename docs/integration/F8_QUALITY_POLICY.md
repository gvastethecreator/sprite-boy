# F8 canonical coverage and fixture retention policy

Date: 2026-07-15 (reconciled 2026-07-15)
Task: F8-04
Status: accepted

The coverage and fixture policy is accepted on its focal evidence. The staged
snapshot `f90d8d2/tree60b742` also passed clean checkout, full `all`/E2E and the
technical gates. F8-03/F8-06 are `done` after the independent final `ACCEPT`.

## Coverage scope

The coverage command runs the complete Vitest corpus and measures
`core/**/*.ts`, excluding only `core/**/index.ts` barrels. This fixes the W0
instrumentation gap: `core/project/**` is present in the generated summary and
cannot be replaced by legacy UI/global coverage.

Two profiles are intentionally distinct:

| Profile | Statements | Branches | Functions | Lines | Meaning |
|---|---:|---:|---:|---:|---|
| `ratchet` | 90.01 | 86.08 | 94.83 | 92.65 | Raised measured non-regression floor |
| `release` | 90 | 85 | 90 | 90 | Required release target |

Both profiles are green. The release run on 2026-07-15 measured 90.01%
statements, 86.08% branches, 94.83% functions and 92.65% lines over 9,170
statements and 6,753 branches; the final full corpus was 81 files/684 tests.
The ratchet was raised to that measured result,
so the former 82.29/76.75 floor can no longer mask a regression. Lowering a
ratchet requires an owner, an explanation and comparative coverage evidence.

Commands:

```text
bun scripts/studio-gates.mjs --gate coverage
bun scripts/studio-quality-policy.mjs coverage --profile release
```

The runner deletes the previous JSON summary, launches Vitest with fixed argv
and `shell:false`, validates totals and their reported percentages, requires a
`core/project/**` entry and emits one machine-readable result. A stale, absent,
malformed or inconsistent summary fails closed.

The closing corpus added hostile boundary matrices for project validation,
commands, impact analysis, migrations, durable storage, package archives and
asset identity. It also repaired one runtime inconsistency: a
`regions.commitRecipe` command with `derivedAssets: null` is now rejected rather
than silently treated as an empty array.

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

## Package and lock boundary

F8-04 consumes the reconciled package contract and does not add dependencies.
The owner accepted the twelve manifest upgrades; `packageManager` is
`bun@1.3.14`, Node is `>=24.0.0`, and the overrides are pinned to `protobufjs`
7.6.5, `undici` 7.28.0 and `ws` 8.21.1. The tracked `bun.lock` identity is
SHA-256 `96e66bbcff3dc338ab95b6bf5c4396fc73af6863c040b7135eb5eb88c02f44e5`.

Frozen-install ownership and final review are closed. See
[`F8_REPRODUCIBILITY_OWNERSHIP.md`](./F8_REPRODUCIBILITY_OWNERSHIP.md) and the
final reproducibility artifact.
