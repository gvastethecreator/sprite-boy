# F8-03 quality mission

Artifact and user outcome: one reviewed dependency truth that clean CI can
reconstruct, with deliberate drift rejected before any Studio gate runs.

Mission mode: goal.

In scope: accepted `package.json`, matching `bun.lock`, `.gitignore`, CI workflow,
reproducibility verifier/tests, F8 ledgers and evidence. Out of scope: dependency
upgrades beyond the accepted twelve, product behavior, donor repositories and
`.scratch` as a tracked artifact.

Baseline or acceptance target: twelve accepted manifest upgrades; ignored lock
whose root still reflects HEAD; no CI workflow. Acceptance requires a tracked
matching lock, isolated clean `bun install --frozen-lockfile`, injected drift
failure, stable CI gate orchestration and independent Sol/xhigh review.

Applicable gates and safe proof surfaces:

- Scope: explicit staged-path audit; required.
- Manifest/lock identity: repository verifier plus hostile fixtures; required.
- Frozen install: disposable copy outside the working tree; required.
- Drift failure injection: disposable manifest edit; required.
- CI contract: workflow/parser tests and command inspection; required.
- Regression: focused tests, then one full F8 gate batch; required.
- Independent judgment and adversarial autopsy: required before acceptance.
- Visual/runtime UI: N/A; no product UI changes.

Stop condition: F8-03 and F8-06 accepted with no P0/P1, all applicable gates
honest, Foundation frontier updated, and Grid/Editor streams explicitly released.

## Loop log

1 | owner decision resolved | accepted twelve upgrades become writable baseline | better | inspect exact Bun/CI contract
