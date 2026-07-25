# Frontera y ownership canónico

Type: task
Status: resolved
Blocked by: None

## Question

¿Qué corte puede empezar ahora y qué contratos deben gobernar todos los cambios?

## Answer

El viewport Compose es el primer corte. ProjectStore gobierna el grafo,
AssetRepository resuelve bytes, el compositor aplica transforms/crops y
JobStore gobierna trabajo largo. Slice conserva ownership de extracción y no
recibe nuevas escrituras legacy.
