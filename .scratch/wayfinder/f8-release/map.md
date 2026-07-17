# Wayfinder map — F8 release debt

## Current truth

- F3-07 and F8-05 are accepted; the 11-step ratchet gate is green.
- F8-03 cannot claim frozen install while the user-owned twelve-range
  `package.json` diff and ignored divergent `bun.lock` remain unreconciled.
- F8-06 release checks are still red: initial JS gzip must fall from 245999 to
  180000 bytes and coverage must reach 90/85/90/90.

## Current route

1. Keep `package.json`, `bun.lock`, `.gitignore` and `node_modules` read-only.
2. Remove optional AI/ZIP/GIF implementations from the initial graph through
   native dynamic imports at their existing user actions.
3. Preserve loading/error/finally behavior and add focused hook tests.
4. Build and run both ratchet and release bundle gates; record physical chunks.
5. Continue with the next largest initial-only dependency until release passes.
6. Raise coverage through behavioral tests, never by lowering thresholds or
   excluding runtime sources.

## Acceptance

- No package/lock diff owned by this task.
- Existing actions retain behavior and stable user feedback.
- Initial gzip is at or below 180000 bytes; every emitted lazy chunk is covered
  by browser journeys before F8-06 closes.
- Coverage reaches release thresholds with the same canonical source scope.
