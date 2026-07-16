# F8 reproducibility ownership record

Fecha de reconciliación: 2026-07-15
Evidencia de referencia: 2026-07-15
Tasks: F8-01 / F8-03

## Estado actual

**F8-03 y F8-06 están `done`.** El owner aceptó los doce upgrades del manifest y
el par package/lock es coherente. El worktree de implementación
`f90d8d2/tree60b742` pasó checkout limpio, install frozen, audit, `all`, fixtures,
persistence, build, budgets y E2E. El delta posterior se limitó al ledger y al
repair test-only de higiene temporal; la revisión independiente final devolvió
`ACCEPT` con P0-P3 en cero. La etiqueta es un commit temporal de verificación y
su tree; no es un commit de rama.

## Contrato vigente

| Superficie | Estado | Evidencia actual | Nota de cierre |
|---|---|---|---|
| `package.json` | aceptado y tracked | `packageManager: bun@1.3.14`, `engines.node: >=24.0.0`, doce upgrades aceptados por el owner | mantener junto al lock |
| overrides | aceptado | `protobufjs: 7.6.5`, `undici: 7.28.0`, `ws: 8.21.1` | contrato de supply chain |
| `bun.lock` | tracked / no ignorado | SHA-256 `96e66bbcff3dc338ab95b6bf5c4396fc73af6863c040b7135eb5eb88c02f44e5` | el digest debe permanecer estable |
| lock EOL | policy tracked | `.gitattributes`: `bun.lock text eol=lf` | snapshot staged confirmó LF |
| otros locks | ausentes | no hay `package-lock`, `pnpm-lock`, `yarn.lock`, `bun.lockb` | no introducir un segundo manager |
| workflow | presente | `.github/workflows/studio-quality.yml`, runner `ubuntu-24.04`, actions fijadas por SHA | incluye install frozen, audit, `all` y `e2e` |
| runtime CI | definido | Node `24.18.0`, Bun `1.3.14` | debe reproducirse en clean checkout |

## Evidencia disponible

| Check | Resultado | Interpretación |
|---|---|---|
| Revisión Sol focal | `ACCEPT` | 29/29 checks de implementación y lint focal |
| `bun audit --audit-level=high` | exit 0 | no high alcanzable en la evidencia disponible |
| Verificador real, baseline | pass / exit 0 | install frozen acepta el par manifest/lock; lock unchanged |
| Verificador real, drift | rejected / exit 1 | el drift de manifest bloquea; lock unchanged |
| Workflow contract | pass | `ubuntu-24.04`, Node/Bun fijados, actions por SHA, `--frozen-lockfile`, audit, `all`, `e2e` |
| Checkout limpio (`f90d8d2/tree60b742`) | pass | 302 tracked, status 0, `bun.lock` 64864 bytes y CRLF 0 |
| Install frozen + audit | pass | Bun 1.3.14, frozen install limpio y audit high exit 0 |
| `--gate all` completo | pass | 14/14 steps; unit 168, contract 521, integration 6, coverage 82 archivos/695 tests |
| Fixtures/persistence/build/budgets | pass | 7 fixtures; persistence, build y budgets browser verdes; bundle gzip 155474 <= 156500 |
| E2E completo | pass | build + browser-smoke; Slice visible, page-fit y cero console/network/HTTP |
| Revisión independiente final | `ACCEPT` | P0=0, P1=0, P2=0, P3=0; Grid G0/G1 autorizado |

El artefacto final es
[`reproducibility.json`](../../artifacts/quality/F8/2026-07-15/reproducibility.json).
El review inicial encontró un P3 de higiene temporal en una prueba; se reparó sin
relajar cleanup productivo, se eliminaron 21 residuos verificados y el recheck
independiente confirmó 29/29 y conteo temporal `0 -> 0`.

## Baseline histórico (2026-07-15, superseded)

La inspección read-only inicial registró que `package.json` tenía un diff
propiedad del usuario, que `bun.lock` estaba ignorado, que no había workflow y
que no estaban declarados `packageManager` ni `engines`. Ese registro explica el
motivo de F8-01 y se conserva sólo como baseline histórico; no describe el
estado vigente después de la aceptación del owner y la reconciliación
manifest/lock.

## Cierre de F8-03/F8-06

La revisión independiente final aceptó workflow, supply chain, diff, cleanup y
evidencia. F8-03 y F8-06 pasan a `done`; Grid G0/G1 queda autorizado.
