# F8 reproducibility ownership record

Fecha de inspección: 2026-07-15

Task: F8-01

Modo: read-only sobre package/lock

## Resultado

El repositorio no tiene hoy una fuente versionada única para una instalación
reproducible. `package.json` está tracked pero contiene un diff local propiedad
del usuario. `bun.lock` existe, está ignorado y su workspace root conserva los
ranges de HEAD. Los tests/build verdes describen el entorno instalado actual;
no prueban que un checkout limpio pueda reconstruirlo.

F8-01 congela esa situación sin modificar, restaurar, stagear ni regenerar
ninguno de los dos archivos.

## Inventario verificable

| Superficie | Estado | Evidencia | Owner/decisión |
|---|---|---|---|
| `package.json` | tracked + modified | `git status --short`; diff sólo en dependency ranges | usuario; read-only |
| `bun.lock` | presente + ignored | `.gitignore:40`; `git check-ignore -v bun.lock` | no versionado; no regenerar |
| otros locks | ausentes | no `package-lock`, `pnpm-lock`, `yarn.lock`, `bun.lockb` | ninguno |
| package manager | Bun 1.3.14 local | `bun --version` | evidencia de host, todavía no policy |
| Node | 25.5.0 local | `node --version` | evidencia de host, todavía no engine gate |
| scripts tracked | `log-runner.mjs`, `studio-baseline.mjs` | `git ls-files scripts` | repo |
| CI | sin workflows | `.github` contiene sólo templates | F8-03 pendiente |

`package.json` tampoco declara `packageManager` ni `engines`; añadirlos sería un
cambio de package policy y queda fuera de esta reconciliación read-only.

## Diff local preservado

| Dependencia | HEAD | Working tree |
|---|---:|---:|
| `lucide-react` | `^1.17.0` | `^1.24.0` |
| `react` | `^19.2.6` | `^19.2.7` |
| `react-dom` | `^19.2.6` | `^19.2.7` |
| `@tailwindcss/vite` | `^4.3.0` | `^4.3.2` |
| `@types/node` | `^25.9.1` | `^25.9.5` |
| `@types/react` | `^19.2.15` | `^19.2.17` |
| `@vitejs/plugin-react` | `^6.0.2` | `^6.0.3` |
| `@vitest/coverage-v8` | `^4.1.7` | `^4.1.10` |
| `oxlint` | `^1.67.0` | `^1.73.0` |
| `tailwindcss` | `^4.3.0` | `^4.3.2` |
| `vite` | `^8.0.14` | `^8.1.4` |
| `vitest` | `^4.1.7` | `^4.1.10` |

El root workspace de `bun.lock` mantiene los doce ranges de HEAD. Aunque su
grafo incluye resoluciones compatibles más recientes, no es un lock aceptable
para el working manifest: está ignorado y la declaración root diverge.

## Boundary writable aprobado

Mientras package/lock sigan bajo ownership externo:

- F8-02 puede crear commands directos bajo `scripts/**` y tests equivalentes.
- F8-04/F8-05 pueden definir y probar coverage, fixture y budget policy sin
  añadir dependencias.
- No se cambia `.gitignore`, `package.json`, `bun.lock` ni `node_modules`.
- F8-03 queda condicionado a una decisión explícita del owner sobre aceptar o
  revertir los doce ranges y versionar después el lock correspondiente.
- No se declara “frozen install” ni CI reproducible usando rangos sin lock.

## Condición de reanudación para install/CI

1. El owner confirma si los doce upgrades son el nuevo manifest o deben salir.
2. Package y lock se reconcilian en el mismo patch deliberado.
3. El lock deja de estar ignorado y queda tracked.
4. Un checkout limpio ejecuta install frozen, gates y una failure injection que
   demuestre que drift de manifest/lock bloquea CI.
