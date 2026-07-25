# Extracción de video

Type: research
Status: resolved
Blocked by: 001-canonical-frontier

## Question

¿Cómo extraer frames exactos, cancelables y durables dentro del navegador?

## Answer

Mediabunny demultiplexa y WebCodecs decodifica en worker.
VideoSampleSink conserva timestamps. Cada frame aceptado se codifica, persiste y
recibe Region completa. Una receta de video une fuente, rango, muestreo y orden.
Preflight y límite de frames protegen memoria y cuota.
