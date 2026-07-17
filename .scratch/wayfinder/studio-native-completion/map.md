# Wayfinder: SpriteBoy Studio nativo completo

## Destination

Dejar una sola aplicación SpriteBoy Studio que replique y adapte de forma
nativa toda la funcionalidad e interfaz documentada de Animoto y Grid Splitter,
con el ledger de 198 tareas cerrado mediante evidencia y rollout seguro.

## Notes

- La autoridad de ejecución es `docs/integration/TASKS.md` y sus tres ledgers;
  este mapa no duplica tareas cuya ruta ya está especificada.
- `D:\DEV\animoto` y `D:\DEV\grid-splitter` son referencias de producto y
  comportamiento de sólo lectura; no se incrustan como aplicaciones separadas.
- `.scratch/planning/2026-07-14-studio-native-implementation/` conserva el
  estado de ejecución y Quality Obsessed conserva los gates de aceptación.
- El `package.json` modificado antes de esta misión pertenece al usuario y no se
  toca hasta reconciliar su ownership.

## Decisions So Far

- [Semántica durable de huérfanos](tickets/001-orphan-semantics.md) - V1 nunca
  persiste referencias colgantes; el preview marca huérfanos prospectivos y la
  operación sólo puede cancelar/relinkear o aplicar una cascada legal.

## Not Yet Specified

- [Ownership de dependencias y lockfile](tickets/002-dependency-ownership.md):
  determinar cuándo y cómo habilitar tareas F8 sin pisar cambios del usuario.

## Out Of Scope

- Integrar o embeber las aplicaciones donantes completas; se replica su
  funcionalidad dentro del dominio, shell y lenguaje visual de SpriteBoy.
- Escribir en los repositorios donantes.
- Duplicar en Wayfinder tareas que ya tienen ID, dependencias, entregable y
  prueba en el ledger de implementación.
