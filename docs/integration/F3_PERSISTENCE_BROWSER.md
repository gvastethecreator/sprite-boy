# F3 durable persistence browser journey

Date: 2026-07-15
Task: F3-07
Status: done

## Journey

`bun scripts/studio-gates.mjs --gate persistence` starts a Vite source harness
and a fresh temporary Chrome profile. The harness calls the accepted canonical
AssetRepository, autosave journal, codec and `.spriteboy` package ports; it does
not copy their implementation or use the legacy persistence hook.
Vite runs through its resolved local CLI as one directly owned Node child, so
cleanup verifies the actual server process instead of an intermediate package
runner.

The run crosses three distinct browser documents:

1. Prepare starts from the sanitized legacy V0 fixture with two expired Blob
   URLs. Migration preview requires two relinks plus one ambiguous-cel choice;
   explicit resolutions migrate to valid V1 without persisting runtime URLs.
   A real 192x64 alpha PNG backs two logical assets sharing one content blob;
   the journey checkpoints V1 and exports a deterministic portable package.
2. A trusted `pagehide` closes both storage boundaries. After real reload, the
   journey reopens the checkpoint, verifies exact document/asset identities,
   deletes both databases and imports the package into clean storage.
3. A second trusted `pagehide` and reload reopens the clean import, reproduces
   the package byte-for-byte, then deletes both databases and session state.

Each document has a random nonce; the runner cannot mistake the old execution
context for a completed reload. The browser profile is temporary and is removed
after successful runs and failures whose browser runtime terminates. If Chrome
cannot be terminated, the gate fails closed and preserves the profile instead
of deleting files that remain in use.

## Evidence and privacy

The public result stores counts and exactness booleans only. Database names,
document nonces, asset hashes and package hashes are used for comparison inside
the browser and temporarily cross reloads in session storage inside the
throwaway profile, but are never emitted or written to the public artifact. CLI
failures collapse to one stable reason.
Console, runtime, browser log, network and HTTP errors must all remain zero.

Measured result:

| Invariant | Result |
|---|---:|
| Real reloads / trusted pagehide cleanup | 2 / 2 |
| Expired Blob URLs / preview blockers | 2 / 3 |
| Legacy V0 -> V1 | applied; 5 non-blocking notes |
| Logical assets / unique blobs | 2 / 1 |
| V1 document JSON | exact |
| Asset content hashes | exact |
| Portable package bytes + hash | exact |
| Databases after final cleanup | 0 |
| Vite server processes after each run | 0 |
| Browser/console/network errors | 0 |

Evidence artifact:
[`persistence-browser.json`](../../artifacts/quality/F3/2026-07-15/persistence-browser.json).
After widening only the CDP command/readiness windows to 30/60 seconds inside
the unchanged 180-second gate timeout, the final `--gate all` completed 11 steps:
23 files/150 unit tests, 43/464 contract, 1/6 integration and 67/620 coverage
tests. Coverage remained above ratchet at 82.31/76.82/91.79/86.17, persistence
kept the metrics above, and post-run Vite process count remained zero.
The runner now has its own 130-second deadline, leaving 50 seconds for bounded
cleanup before the outer gate can terminate Bun. Failure injection at 100 ms
closed the CDP client, directly owned Vite/Chrome processes and temporary
profile: orphan count and profile delta both remained zero. The success gate
then passed again with the exact metrics above.
PID liveness is probed when Bun does not publish child exit metadata, and
profile removal uses bounded asynchronous retries rather than runtime-specific
`rmSync` behavior. Shared smoke/budget deadlines at 40/70 seconds also passed
100 ms failure injection with zero orphan processes and zero profile delta.
Independent re-review returned `accept` with no P0-P3 findings; 34/34 focal
tests and the final full gate are green.

## Scope boundary

This closes the Foundation persistence and migration portion of J1/J8: browser
legacy preview/relink/migrate, save-close-reload, clean portable import and
cleanup. The full product J1 UI
journey (Compose creation and screenshot parity) remains owned by A1/A3, while
future/corrupt/quota recovery cases remain backed by accepted F3-03..F3-06
contract/integration suites and later R1/R2 fallback proof. No dependency or
package/lock change is part of F3-07.
