# Semántica durable de huérfanos

Type: research
Status: resolved
Blocked by: None

## Question

¿Qué debe significar “conservar huérfanos marcados” en preview/relink/reslice si
el contrato `StudioProjectV1` rechaza toda referencia colgante y
`DestructivePolicy` sólo admite `reject | cascade`?

## Answer

El documento canónico V1 nunca guarda referencias colgantes. “Huérfano” es un
estado prospectivo del análisis de impacto o un estado de recuperación externo
(`needs-relink`/blob sin owner), no una tercera policy destructiva ni una entidad
inválida dentro de `StudioProjectV1`.

Para una referencia del graph, la UI puede cancelar y conservar intacta la
entidad fuente, relinkear/reemplazar la referencia antes de borrar, o confirmar
una cascada sólo cuando `analyzeImpact` la declare legal. `reject | cascade`
permanece como `DestructivePolicy`; los blockers impiden cualquier commit que
dejaría un dangling reference. El preview puede denominar “huérfanos
prospectivos” a esas consecuencias, pero el command atómico debe terminar con
un graph válido.

Evidencia reconciliada: ADR-001 exige invariants después de cada command,
`validation.ts` emite `MISSING_REFERENCE`, y el schema de commands sólo admite
`reject | cascade`. La documentación de Foundation/Index se ajustó para que no
prometa persistir un estado que el contrato rechaza.
