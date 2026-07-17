# Wayfinder map — F8-01 package and lock ownership

## Current owners

- `package.json`: tracked source of dependency ranges and npm scripts; the owner accepted all twelve working-tree upgrades on 2026-07-15.
- `bun.lock`: present but ignored by `.gitignore:40`; F8-03 must regenerate it from the accepted manifest and track it atomically.
- `scripts/log-runner.mjs`: tracked log wrapper with shell-string execution; not yet a reproducible gate manifest.
- `scripts/studio-baseline.mjs`: tracked read-only inventory command.
- `.github/**`: templates only; no tracked workflow owns CI.
- `node_modules`, `dist`, logs and coverage: ignored generated state, never sources of reproducibility truth.

## Dependency truth split

1. HEAD `package.json` and ignored `bun.lock.workspaces[""]` agree.
2. Working `package.json` contains twelve user-owned dependency-range upgrades.
3. The ignored lock has no tracked review history and does not represent those working ranges.
4. Current green tests/build prove the installed environment, not a frozen clean install.

## Decisions so far

- [Accept the twelve dependency upgrades](tickets/001-accept-upgrades.md) — accepted as the new manifest baseline; F8-03 owns matching lock and frozen CI.
- F8-01 remains the read-only historical ownership snapshot.
- No workflow may install unfrozen dependencies and call that CI reproducibility.

## Frontier

F8-03: reconcile package+lock, track the lock, prove clean frozen install and
prove deliberate manifest/lock drift blocks the same install path.
