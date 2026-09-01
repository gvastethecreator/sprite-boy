# Contributing

Thanks for improving SpriteBoy Studio.

## Setup

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
```

## Verification

Choose the smallest repository gate that covers your change. Before a broad or dependency-changing pull request, run:

```bash
bun scripts/studio-gates.mjs --gate all
bun scripts/studio-gates.mjs --gate e2e
git diff --check
```

Browser evidence must use real product state and a committed or clearly documented fixture. Keep application copy, runtime errors, documentation, and new screenshot surfaces in English.

## Pull requests

- Describe the user-visible result and the exact checks you ran.
- Preserve the local-first storage and export boundaries.
- Add one focused regression test when behavior changes and a nearby public seam exists.
- Do not add new durable behavior to the frozen legacy bridge.
- Do not include personal assets, local databases, model weights, logs, or generated coverage.

By contributing, you agree that your work is licensed under the repository's [MIT license](LICENSE).