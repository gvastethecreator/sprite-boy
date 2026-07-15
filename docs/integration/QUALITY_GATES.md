# Quality gates y evidencia

Este manifiesto define qué prueba significa “integrado”. Compilar es un prerequisito, no la aceptación. Cada evidencia se asocia a behavior IDs de `ANIMOTO.md`/`GRID_SPLITTER.md` o a slices F/C/R de `WORKPLAN.md`.

## Estados

- `required`: bloquea merge/release.
- `conditional`: se vuelve required cuando el slice toca esa superficie.
- `N/A`: inaplicable con razón explícita; no equivale a “no se ejecutó”.
- Resultado: `pass`, `fail`, `blocked` o `not-run`.

## Ledger de evidencia

Cada slice agrega una entrada versionada, preferentemente `artifacts/quality/<slice>/<date>/manifest.json` ignorando binarios pesados cuando corresponda:

```json
{
  "slice": "G4",
  "commit": "<sha>",
  "environment": "Windows / Chrome / release build / 1440x900 / DPR 1",
  "behaviorIds": ["G4.1", "G4.2", "G4.3", "G4.4", "G4.5", "G4.6", "G4.7"],
  "checks": [{ "name": "chroma-golden", "result": "pass", "artifact": "..." }],
  "hostilePaths": [{ "scenario": "cancel eyedropper with Escape", "result": "pass" }],
  "review": { "model": "gpt-5.6-sol", "effort": "xhigh", "verdict": "approved" }
}
```

No guardar API keys, prompts privados o imágenes del usuario en artifacts. Las fixtures del repositorio sí pueden versionarse.

## Manifiesto de gates de implementación

| Gate | Estado | Cuándo aplica | Evidencia requerida |
|---|---|---|---|
| Scope/ownership | required | Todos los slices | Diff sólo en writable surface o workplan actualizado |
| Typecheck | required | Todos | `bun run typecheck` exit 0 |
| Lint | required | Todos | Exit 0 y cero warnings al release; ratchet sin nuevos warnings durante migración |
| Unit/contract | required | Todos | Tests focalizados + invariantes del ProjectEngine |
| Integration | required | Mutaciones multi-módulo | Proyecto/store/repository/worker/render juntos |
| E2E browser | required | Todo behavior visible | Journey real en release build |
| Visual regression | conditional | Canvas, layout, overlay, modal, timeline, export preview | Screenshots aprobados en viewports objetivo |
| Data round-trip | required | Todo estado durable | Save-close-reload y package export/import |
| Migration/recovery | conditional | Schema/storage/import | Fixtures legacy/corrupt/future/missing/quota |
| Undo/redo | conditional | Todo command mutable | Round-trip y transaction-boundary tests |
| Worker lifecycle | conditional | Slice/export/off-main-thread | Concurrent/cancel/timeout/crash/messageerror/cleanup |
| AI fake-provider | conditional | AI/generation/correction | Deterministic job graph, cost, cancel, retry, redaction |
| AI live smoke | conditional | Release con provider configurado | Ejecución manual controlada sin loggear secretos; no bloquea desarrollo sin credencial |
| Export artifact | conditional | Export | Decode, count, timing, dimensions, alpha/background, filenames |
| Accessibility | required | Toda UI nueva | Keyboard-only, focus, labels, axe y reduced-motion |
| Performance | required | Todo slice interactivo/costoso | Trace/budget según sección |
| Resource cleanup | required | Assets/jobs/workers/export | URLs, ImageBitmaps, workers, timers y listeners liberados |
| Security/privacy | required | Import/storage/AI/export/deps | Threat cases, redaction, dependency audit y no remote worker/CDN |
| Browser compatibility | required | Release | Chromium + Firefox; Edge smoke sobre Chromium |
| Safari | conditional | Si el deployment declara Safari/iOS | Manual/remote smoke y codec fallbacks |
| Documentation | required | Todos | Matrices, source pointers, commands y migration notes actualizados |
| Reviewer | required | Slice substantial/high-risk | Revisión fresca Sol/xhigh de diff + evidencia |

## Journeys E2E obligatorios

### J1 — Proyecto durable

1. Crear proyecto, nombrar e importar PNG con alpha.
2. Guardar, cerrar, recargar la página y reabrir.
3. Exportar `.spriteboy`, borrar storage local e importar el package.
4. Comparar document graph, content hashes y screenshot.

Cubre F1-F3, A1.1-A2.2. Falla ante Blob URL persistida, asset faltante o reemplazo parcial.

### J2 — Grid completo

1. Importar `grid_3x3_green_bg.png`.
2. Auto-detect → nueve celdas; cambiar a manual y volver.
3. Ajustar crop, eyedrop green, tolerance/smoothness/spill.
4. Activar pixel 32/quantize/fixed palette.
5. Cancelar una ejecución, reintentar, revisar previews y commit as assets.
6. Guardar/reload; descargar uno/todos; abrir outputs.
7. Con fixture irregular: auto-detect por componentes, magic wand, crear/mover/redimensionar/duplicar/ocultar región, convertir a asset y probar margins/gaps.

Cubre G1.1-G7.7 y H4.1-H4.8.

### J3 — Compose completo

1. Crear composición desde un output Grid y agregar segunda layer.
2. Mover/escalar/snap y ejecutar Reset/Contain/Cover/Ghost/Deselect; editar opacity/visibility, duplicar/reordenar/sync.
3. Probar Builder grid/free, slot place/remove/swap/smart-fill, cuatro fit modes, nueve alignments, full transform y free-object z-order.
4. Crear/cambiar variantes, undo/redo de cada operación.
5. Guardar/reload y comparar canvas/thumbnail/export projection.

Cubre A2.1-A5.1 y H3.1-H3.10.

### J4 — Timeline y playback

1. Crear cels, duplicar, reorder, swap, multi-select y delete después de varios reorders.
2. Importar/reemplazar un user keyframe; editar prompts/locks, FPS/loop/pin y onion skin.
3. Play/scrub, cambiar de pestaña y volver.
4. Guardar/reload y deshacer batch operations.

Cubre A4.1-A6.6 y la regresión crítica de identidad.

### J5 — Generation determinista

Con fake provider:

1. Smart prompt y editable frame plan.
2. Sequential para 5 cels; cancel en el tercero; verificar cero late writes.
3. Recursive para 6 cels con locked edges y consistency audit.
4. Fill missing, regenerate single y reject/accept variante.
5. Correction de selección con vecinos y provider failure intermedio.
6. Ejecutar host new-image/variation/in-between/edit-context/full-sheet, attachments, model incompatibility y technical analysis.

Cubre A7.1-A9 y H2.1-H2.8; permite CI sin credenciales/coste.

### J6 — Alignment y colisiones

1. Alinear un cel con reference overlay; cancelar y luego aplicar/undo.
2. Crear hurtbox, hitbox, solid y trigger con tags.
3. Cambiar active variant/cel y verificar ownership.
4. Guardar/reload y exportar metadata.

Cubre A10 y C1.

### J7 — Export completo

1. Exportar sequence válida a PNG spritesheet, ZIP, GIF, MP4 y WebM.
2. Exportar metadata Generic/Unity JSON, Phaser 3 y Godot.
3. Validar frame count, naming, dimensions, FPS/duration, loop, background/alpha y schemas de engine.
4. Cancelar cada export y comprobar cleanup.
5. Intentar export con missing assets/cels y codec no soportado.

Cubre A9.1-A9.5/A11.

### J8 — Migración y recovery

1. Abrir fixture legacy completo y otro con Blob URL expirada.
2. Revisar preview/relink y cancelar sin cambiar proyecto activo.
3. Migrar, guardar/reload y comparar regions/compositions/sequences/collisions.
4. Probar schema futuro, JSON malformed, blob corrupto, cuota insuficiente e interrupción entre journal/commit.
5. En R1 abrir un backup mediante fallback aislado; durante soak no eliminar sus archivos. En R2 repetir recovery con canonical y recién entonces verificar que fallback/flags fueron removidos.

Cubre F3 y rollout R1/R2.

### J9 — Keyboard/accessibility

Completar import → Slice → commit → Compose → Animate → Export sin mouse. Verificar focus trap/return, skip navigation, labels, live regions de jobs, shortcuts no disparados en inputs, 200% zoom y reduced motion. Cambiar y recargar theme/accent/density, sound/tooltips, snap, frame labels y template views H6.

## Pruebas por capa

### ProjectEngine

- Unit por command con precondiciones, changed IDs, inverse y errors.
- Property tests: secuencias aleatorias de add/delete/reorder/duplicate/undo/redo no rompen referencias.
- Ownership tests: Layer tiene un solo Composition owner, Cel/VariantSet graphs deep-copy editables y assets compartidos; sources inválidos/cíclicos se rechazan.
- Un drag/scrub batch = una entrada; hover/playback = cero entradas.
- Selectors son puros, estables y no rerenderizan consumidores no afectados.
- Schema parsea `unknown`, rechaza extraños peligrosos y reporta paths exactos.

Threshold de release para `core/project`, `core/assets`, `core/persistence`:

- Lines/functions/statements ≥ 90%.
- Branches ≥ 85%.
- 100% de commands destructivos y migration steps cubiertos por behavior, no sólo líneas.

### Processing worker

- Unit de chroma/trim/resize/quantize/detect y property tests de bounds.
- Golden pixel/manifest tests contra el donante.
- Integration usa worker real y transferable objects.
- Concurrent request routing, abort before/start/mid/end, timeout, crash y recycle.
- Memory/resource assertions para ImageBitmap/URL/listener cleanup.

Threshold para processing logic: lines ≥ 90%, branches ≥ 85%; ningún archivo worker excluido del reporte.

### Features/UI

- Component tests para disabled/focus/labels/value semantics.
- Integration para command dispatch/selectors/history.
- E2E para journeys visibles y visual regression.
- Release global: lines ≥ 80%, branches ≥ 75%, con ratchet por PR y sin reducir cobertura de archivos tocados.

## Visual gate

Viewports requeridos:

- 1440×900 DPR 1: baseline principal.
- 1280×720 DPR 1: compact desktop, sin body scroll ni controles inaccesibles.
- 1920×1080 DPR 1: paneles expandidos y timeline completo.
- 1440×900 a 200% browser zoom: reflow/focus/scroll local utilizable.

Estados capturados:

- Empty/new project.
- Slice source + auto overlay + staged results + processing/error.
- Compose con dos layers, selected gizmo y guides.
- Animate con variants, multi-select, onion y playing.
- Collision con shapes/tags.
- Correction, alignment, project browser y Export Center modals.
- Missing asset, migration report, worker/provider/export error.

Criterios:

- Tokens/tipografía/spacing/radius/surfaces son Studio; no aparecen islands visuales Animoto/Grid.
- Main content cabe en viewport; scroll vive sólo en paneles/timeline designados.
- Menús/modales/tooltips usan portal/z-index contract, focus trap y return focus.
- Canvas, thumbnails y artifact export coinciden donde deben.
- Diferencias de pixels se aprueban por cambio intencional, no actualizando snapshots a ciegas.

## Performance budgets

Perfil de medición: release build local, Chrome estable, Windows, 1440×900 DPR 1; tres runs calientes y p95 cuando haya iteraciones suficientes. Registrar hardware en el manifest.

| Métrica | Budget release |
|---|---:|
| rAF durante 5 s idle después de settle | ≤ 1 callback propio sostenido; ningún loop continuo |
| Frame time p95 durante drag/gizmo | ≤ 20 ms |
| Input-to-paint p95 durante edición | ≤ 50 ms |
| Long tasks del main thread durante worker processing | Ninguna >100 ms; total >50 ms documentado/ratcheted |
| Abrir proyecto 100 assets / 100 cels | ≤ 2 s hasta interacción en hardware de referencia |
| Grid 3x3 fixture | ≤ 1 s caliente |
| 4096×4096, 256 celdas, crop+chroma+quantize | ≤ 10 s y cancel feedback ≤ 200 ms |
| Peak JS heap delta del caso 4096×4096 | ≤ 512 MB y vuelve cerca del baseline tras cleanup |
| Initial JS bundle gzip | ≤ 180 kB |
| Features AI/export codecs | Lazy chunks; no cargan antes de abrir su feature |
| Autosave después de command | Debounced; UI no bloqueada >50 ms |

Si hardware/browser vuelve inestable un tiempo absoluto, la evidencia incluye baseline vs candidate en el mismo run y exige no-regression >10% además del budget.

## Accessibility gate

- WCAG 2.2 AA como target.
- Axe: cero `critical` y `serious`; `moderate` requiere resolución o excepción con owner/fecha.
- Todo icon button tiene accessible name y tooltip sólo complementario.
- Sliders/number controls exponen label, value, min/max/step y keyboard semantics.
- DnD ofrece reorder por keyboard y announcement.
- Canvas tools tienen alternativa por controles/teclado; coordinates/selection se anuncian cuando aporta valor.
- Jobs usan live region throttled; no anuncian cada pixel/frame.
- Focus visible, logical order, trap/return en dialogs, Escape contextual y skip navigation.
- Contrast AA, checkerboard discernible y color nunca es la única señal.
- Reduced motion desactiva transiciones/animations decorativas sin romper progress/playback controlado.

## Seguridad, privacidad y supply chain

- API keys nunca entran en project, logs, artifacts, errors o URLs. Provider config queda en sesión/secure host configuration.
- Prompts/imágenes sólo se envían tras acción clara; UI describe provider, datos y coste estimado.
- Fake provider cubre CI. Live smoke usa cuenta/fixtures controladas.
- Import valida MIME real, dimensiones, archive paths, size total/compressed ratio, duplicate names y schema antes de extraer.
- Package ZIP rechaza path traversal y límites de decompression/memory.
- No se evalúa código de metadata/proyecto.
- Workers/codecs se construyen localmente; no hay fallback CDN runtime.
- CSP/worker URLs funcionan en release y object URLs se revocan.
- Release: cero vulnerabilidades críticas y cero highs alcanzables sin excepción documentada, owner y expiry.
- Dependency/lockfile diffs se revisan explícitamente; instalación CI es frozen/reproducible.

## Hostile-path autopsy por slice

Antes de cerrar, el owner intenta al menos:

- Ejecutar sin asset, con asset corrupto o que desaparece durante el job.
- Doble click/doble dispatch, rápido workspace switch, close modal y project switch durante async.
- Cancel justo antes/después de success y respuesta tardía de worker/provider.
- Reorder/delete mientras selection/hover/context menu apunta al elemento viejo.
- Undo/redo durante o inmediatamente después de batch/drag/generation.
- Save/reload en cada frontera de transaction y storage quota failure.
- Zero/one/max items, dimensiones extremas, alpha vacío, prompts vacíos y codec unsupported.
- Teclado solamente, reduced motion, zoom 200%, viewport compact y hidden tab.

El resultado queda en el ledger; un path no probado se declara `not-run/blocked`, no `pass`.

## Gates de esta misión documental

| Gate | Aplicabilidad | Resultado requerido para cerrar el plan |
|---|---|---|
| Scope y ownership | required | Sólo `docs/integration/**` más scratch local; cambios previos preservados |
| Inventario donante | required | Toda operación/UI de source state/components/hooks tiene behavior ID o consolidación explícita |
| No regresión host | required | H1-H6 preserva 47 behaviors actuales antes de X1/R2 |
| Arquitectura | required | Sin conceptos/stores/shells duplicados; invariantes consistentes |
| Ejecutabilidad | required | Cada slice tiene owner/model, dependencia, writable, deliverable, proof y return |
| Traceabilidad | required | Behavior IDs → slice → journey/gate |
| Source pointers/links | required | Paths y links internos existen |
| Consistencia documental | required | Sin conteos, estados o gates contradictorios |
| Independent reviewer | required | Revisión fresca antes del Loop 10, findings resueltos o registrados |
| Pressure/autopsy | required | Scope drift, interfaces ocultas y hostile paths auditados |
| Typecheck/lint/test/build del producto | N/A | Esta misión no cambia producto; baseline reciente se conserva como evidencia limitada |
| Browser/visual de producto | N/A | No hay UI nueva; runtime reciente sólo informa baseline |
| Security/dependency mutation | N/A | No se modifican dependencias ni runtime |

La misión documental termina sólo cuando todos los required de esta última tabla pasan y el Loop 10 registra un único verdict `continue`, `ask` o `stop`.

## Calibración de implementación W0 — 2026-07-14

Esta sección pertenece a la misión de implementación posterior y no reescribe
el cierre documental anterior. W0 queda `accept`: el contrato V1 está aceptado,
el fixture legacy sanitizado existe, el manifest golden fuente de Grid reproduce
4/4 hashes y la deuda previa está separada de las regresiones nuevas.

| Evidencia W0 | Resultado |
|---|---|
| Contrato canónico | 35/35 contract tests y review independiente `accept` |
| Regression acumulada | 12 suites / 118 tests al snapshot B0 |
| Typecheck/build | exit 0 |
| Lint | exit 0; 144 warnings legacy; slices nuevos 0 warnings |
| Inventario | 118 archivos, 19260 líneas, double-run byte-identical |
| Fixtures | legacy V0 + V1 disponibles; 9 journeys browser todavía missing |
| Grid golden source | 4 fixtures del commit donante `5322f823...`, 4/4 SHA-256 reproducibles |
| Coverage | 8.75% lines / 5.32% branches; `core/project/**` aún omitido por config |
| Bundle | 841827 bytes raw / 224866 bytes gzip level 9 |

“Calibrable” permite corregir el método, hardware y alcance instrumental con
evidencia; no permite relajar un gate para hacer verde una regresión:

- El target release del main bundle continúa en 180 kB gzip. Hasta que F8/G/A
  habiliten code splitting, 224866 bytes gzip es ratchet provisional de no
  crecimiento: superarlo requiere owner, explicación y artifact comparativo.
- Los thresholds 90% lines/functions/statements y 85% branches para módulos
  canónicos continúan vigentes. F8-04 debe incluir `core/project/**` antes de
  poder evaluarlos; el 8.75% global no se presenta como cobertura canónica.
- J1-J9 conservan estado `missing` hasta existir harness y ejecución browser;
  sus definiciones documentales no cuentan como evidencia de runtime.
- El manifest fuente Grid congela inputs/geometría/naming. G1/G2 deben copiar
  fixtures autorizadas y capturar outputs pixel-golden del worker real.

Artifacts de autoridad: `../../artifacts/quality/B0/2026-07-14/baseline.json`,
`fixtures-journeys.json`, `coverage-bundle.json` y
`grid-donor-golden-manifest.json`.

## Enforcement F8-04 — 2026-07-15

- `bun scripts/studio-gates.mjs --gate coverage` ejecuta 63 archivos/598 tests
  y mide 54/54 fuentes runtime `core/**` no-barrel, incluidas 13 de
  `core/project`; el perfil ratchet pasa en 82.29/76.75/91.72/86.15.
- `bun scripts/studio-quality-policy.mjs coverage --profile release` conserva
  90/85/90/90 y falla deliberadamente en statements/branches/lines. Este rojo
  es deuda release visible; no invalida el cierre instrumental de F8-04.
- `bun scripts/studio-gates.mjs --gate fixtures` valida dos roots y siete
  artifacts tracked por bytes/SHA-256 canónicos; missing, extra, drift,
  untracked o symlink fallan.
- Política y protocolo de actualización:
  [F8_QUALITY_POLICY.md](./F8_QUALITY_POLICY.md).

## Enforcement F8-05 — 2026-07-15

- El lint de repositorio pasa con cero warnings y `--deny-warnings`; se retiró
  el ratchet heredado de 47 sin cambiar dependencias.
- El bundle inicial mide 918655 bytes raw / 245999 bytes gzip level 9. El
  ratchet de no-regresión pasa y el perfil release de 180000 falla
  deliberadamente; code splitting sigue como deuda release obligatoria.
- Chrome productivo fresco a 1440x900 DPR 1 midió 0 rAF en 5 segundos idle,
  46.4 ms input-to-paint p95 sobre 15 transiciones calientes verificadas y 0
  long tasks.
- El árbol AX nativo expuso 15 interactivos, cero sin accessible name y un
  landmark `main`. Labels y URLs no se guardan en artifacts.
- Este gate Foundation no sustituye Axe/WCAG completo ni declara probados los
  budgets de drag, large-project, Grid, codecs o AI; permanecen en sus slices.

Política, método y límites: [F8_BUDGET_POLICY.md](./F8_BUDGET_POLICY.md).
Artifact de ejecución:
[`budgets.json`](../../artifacts/quality/F8/2026-07-15/budgets.json).
Review independiente `accept`; `--gate all` completó sus diez steps con exit 0.
