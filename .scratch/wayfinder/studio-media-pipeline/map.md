# Wayfinder: Studio media pipeline

## Destination

Dejar una ruta implementable y verificable para controles, video, Compose,
modelos locales, control MCP y alineación frame por frame sobre el proyecto
canónico de SpriteBoy Studio.

## Notes

- Checkout limpio en `c8ee5ce`.
- Foundation y Grid/Slice están cerrados; Compose es el frontier real.
- Fuente principal:
  `docs/research/2026-07-25-studio-media-pipeline.md`.
- Todo cambio durable pasa por ProjectStore y AssetRepository.
- Jobs largos usan JobStore; pesos y tokens quedan fuera del proyecto.

## Decisions So Far

- [Frontera y ownership canónico](tickets/001-canonical-frontier.md) - Compose
  visible abre la secuencia y evita reabrir Grid.
- [Port de controles Toolcraft](tickets/002-toolcraft-port.md) - portar fuente
  usada, fijar commit y adaptar tokens.
- [Extracción de video](tickets/003-video-extraction.md) - Mediabunny y WebCodecs
  producen assets/regions con timestamps.
- [Perfiles de modelos locales](tickets/004-local-models.md) - BiRefNet Lite web
  y RMBG 2.0 gated, ambos con jobs verificados.
- [Control externo](tickets/005-control-protocol.md) - un protocolo interno y
  MCP; ACP consume el MCP.
- [Alineación por frame](tickets/006-frame-alignment.md) - composición privada,
  onion skin, guías y una transacción por ajuste.

## Not Yet Specified

- Credencial y tipo de licencia disponibles para RMBG 2.0 en esta máquina.
- Presupuesto de tiempo y memoria para GPU física hasta medir fixtures reales.
- Perfil local de BiRefNet 1024 si Lite 512 no alcanza la calidad pedida.

## Out Of Scope

- Guardar pesos de modelos o tokens en Git, packages o IndexedDB del proyecto.
- Montar el shell, store o rutas completas de Toolcraft.
- Servicio cloud obligatorio para decode, modelos o control.
- Crear un agente ACP propio antes de validar el servidor MCP.
