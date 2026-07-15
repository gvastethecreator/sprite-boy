# ADR-008: export job identity and diagnostic policy

- Estado: accepted for F7-07
- Fecha: 2026-07-15
- Decisores: Studio Foundation
- Implementa: F7-07+
- Extiende: [ADR-007](./ADR-007-export-port-and-writers.md)

## Contexto

ADR-007 separó provider, artifact y writer, pero el Studio todavía necesitaba
un único puente hacia JobRunner. Pasar un `ExportRequest` construido por cada
consumer permitiría separar la identidad del job de la del export, duplicar
señales de cancelación y traducir fallos de forma distinta en cada pantalla.
Reexponer mensajes de codec, worker, filesystem o provider también filtraría
paths, capacidad, stack o credenciales al Job Center.

## Decisión

- `core/processing/exportJobTask.ts` es el único adapter Job↔Export. ExportPort
  continúa sin depender de JobStore, JobRunner o UI.
- La configuración del task omite `requestId` y `signal`. Al ejecutar, ambos se
  derivan exclusivamente del `JobTaskContext` canónico del intento.
- Port, request primitivo y source opaco se capturan antes del boundary async.
  Options/request sólo aceptan own enumerable data properties exactas; getters,
  símbolos, identidad o signal extra se rechazan sin leerlos.
- Cada `ExportPortErrorCode` tiene un mapping exhaustivo y estable a
  `JobTaskError`: code, copy pública y retry policy. La causa/mensaje/stack
  original nunca cruza el adapter.
- `ExportPortError` usa brand runtime privado, valida code/message y se congela.
  Plain objects, prototype spoofing, mutation y proxies no obtienen confianza.
- Un `DOMException` nativo `QuotaExceededError` se reconoce por el slot getter
  de `DOMException.prototype`, nunca por una property `name` propia. Se publica
  como `quota-exceeded`, con instrucción de liberar espacio y retry habilitado.
- Cancel y timeout pertenecen a JobRunner. El runner reserva/commitea su terminal
  antes de abortar; el posterior `EXPORT_ABORTED` del adapter se descarta y no
  puede reemplazarlo por failure.
- Arrays/registries externos se snapshottean dentro de catches de redacción
  incondicional. Incluso un `ExportPortError` branded lanzado por un getter
  externo se trata como input no confiable.

## Matriz pública

| ExportPort | Job | Retry |
|---|---|---|
| invalid request | `invalid-input` | no |
| unsupported format | `unsupported` | no |
| provider failure | `provider-failure` | sí |
| native quota exceeded | `quota-exceeded` | sí, después de liberar espacio |
| writer failure | `storage-failure` | sí |
| invalid/conflicting config | `export-failure` | no |
| invalid/oversized artifact | `export-failure` | no |
| invalid receipt | `export-failure` | no |
| abort fallback | `export-failure` | sí; cancel/timeout del runner prevalece |
| unknown/spoofed | `export-failure` | sí, mensaje genérico |

## Consecuencias

- Job Center recibe sólo diagnostics seguros y retries realmente accionables.
- Cada retry usa un request ID nuevo sin reconstruir ni mutar el task capturado.
- Los providers/writers concretos de A11 sólo implementan ExportPort; no vuelven
  a definir lifecycle, error copy o signal ownership.
- La política deliberadamente no serializa causes. Un debug report futuro puede
  contar codes/timings, pero contenido sensible requiere un opt-in separado.

## Gate de aceptación

Exhaustividad runtime/TypeScript; native quota y spoof hostile; mutation/capture;
identity por intento; retry root→child; cancel/timeout authority; late rejection
redactado; snapshot/listener/active cleanup; suite contract, strict lint, build y
security review independiente.
