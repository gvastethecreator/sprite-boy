# Alineación por frame

Type: task
Status: resolved
Blocked by: 001-canonical-frontier

## Question

¿Dónde viven posición, tamaño, onion skin y guías sin duplicar imágenes?

## Answer

Cada cel editable usa una composición privada con una layer que referencia el
Asset o Region inmutable. Position/scale/rotation quedan en Layer transform.
Onion skin, referencia, guías y preview viven en la sesión local. Aplicar el
ajuste crea una transacción y undo restaura el estado anterior.
