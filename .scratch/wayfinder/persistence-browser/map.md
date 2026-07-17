# Wayfinder map — F3-07 durable browser journey

## Current truth

- The V1 codec, IndexedDB asset repository, autosave journal and deterministic
  `.spriteboy` package are accepted independently.
- `tests/browser/studioPersistenceJourney.ts`, its harness and the shell-free
  runner now own an accepted three-document Chrome journey and artifact.
- F3-07 revalidated timeout/cleanup after adding PID liveness and async profile
  retries. Independent re-review accepted F3-07/F8-05 without P0-P3; W1 closed.

## Canonical route

1. A Vite harness exposes only the three existing journey functions.
2. A fresh temporary Chrome profile opens two unique IndexedDB databases.
3. Prepare previews a legacy V0 fixture with two expired Blob URLs, resolves two
   relinks plus cel ambiguity, migrates to V1, persists two logical assets
   sharing one real alpha-PNG blob, checkpoints the exact document and retains
   a deterministic portable package in session storage.
4. A real trusted pagehide + reload proves durable document/assets, erases both
   databases and imports the package into clean storage.
5. A second pagehide + reload proves the clean import and byte-identical package,
   then deletes both databases and the session state.
6. The Node runner validates only structural booleans/counts and never emits
   database names, document IDs, asset hashes or package hashes. Those values
   exist temporarily in session storage solely to bridge the two reloads.
7. The local Vite CLI runs as a directly owned Node child; cleanup verifies
   Chrome and Vite exit. Three consecutive journeys ended with zero orphans.
8. CDP command/readiness windows are 30/60 seconds inside the unchanged
   180-second persistence step. The final 11-step `all` gate passes under full
   load with 23/150 unit, 43/464 contract and 67/620 coverage tests.
9. A 130-second internal deadline reserves cleanup margin; a real 100 ms forced
   timeout removed both children and the profile with zero orphans.

## Writable boundary

- Existing F3-07 journey and browser harness.
- Shell-free runner and focused script/gate tests.
- F3 evidence artifact and integration ledgers after real proof.

`package.json`, locks, donor repositories and unrelated user changes stay
read-only. F3-07/F8-05 are done; F8-03 remains separately ownership-blocked.
