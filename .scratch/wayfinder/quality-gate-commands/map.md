# Wayfinder map — F8-02 stable quality commands

## Existing execution seams

- `package.json` aliases run Vite/Vitest/tsc/oxlint, but package is user-owned and read-only.
- `scripts/log-runner.mjs` accepts a shell command string and writes logs; it is not safe as a CI command boundary.
- `scripts/studio-baseline.mjs` is a good import-safe CLI pattern with pure parsing and tests.
- Vitest classifications are physical: contract, integration, components, hooks, scripts, types and utils.
- Browser journeys are modules or one-off scratch CDP scripts; no tracked command currently starts preview+Chrome and returns a machine-readable smoke verdict.

## Canonical route

1. `scripts/studio-gates.mjs` owns an immutable manifest of fixed executable+argv steps.
2. CLI resolves one named gate, prints its plan on dry-run, then spawns steps sequentially with `shell:false` and bounded timeouts.
3. Failure/timeout stops the plan and propagates a stable non-zero exit without printing environment values; lint ratchets the 47-warning inherited baseline.
4. `e2e` builds once, then invokes `scripts/studio-browser-smoke.mjs`.
5. Browser smoke starts Vite preview on an ephemeral localhost port, launches an owned temporary Chrome profile, connects by CDP, navigates product code and checks route/layout/console/runtime/log/HTTP/network.
6. Browser/preview/profile cleanup runs in `finally`; output is one JSON result with counts, never console/exception payloads.

## Gate classes

- `typecheck`, `lint`, `unit`, `contract`, `integration`, `build`, `e2e`, `all`.
- Unit excludes contract/integration and covers components/hooks/scripts/types/utils.
- E2E is product build + tracked Chrome smoke, not jsdom or a capability-only placeholder.
- `all` orders static checks, isolated test classes, build and browser smoke without repeating build.

## Security and portability

- Gate IDs are allowlisted; callers cannot inject executable or argv.
- Duplicate flags and list/dry-run conflicts fail with usage exit 2.
- No `cmd`, PowerShell, bash, interpolation or command-string execution.
- Browser path comes from `STUDIO_CHROME_PATH` or platform candidates; its value is never printed.
- Ports and user-data directories are ephemeral; deletion is limited to the created temp profile.
- Every CDP command has its own timeout; close/error rejects pending work before cleanup.
- Network diagnostics retain only resource type/status/boolean kind, never URLs or request IDs.
- Windows Chrome is a first-class path; Linux/macOS candidates remain explicit for later CI.

## Writable boundary

- `scripts/studio-gates.mjs`
- `scripts/studio-browser-smoke.mjs`
- `tests/scripts/studioGates.test.ts`
- `index.html` + `public/favicon.svg` for the network-error repair exposed by the smoke
- `.oxlintrc.json` to exclude local planning/browser artifacts from repository lint
- F8 ledgers/docs

No package alias, dependency, lock or workflow change is allowed in F8-02.
