# Choose raster artifact boundary

Type: decision
Status: resolved
Blocked by: None

## Question

Should F5-05 reproduce the legacy ZIP/GIF/video exports, or expose the canonical
single-scene raster that later export workflows compose?

## Answer

Expose the canonical raster primitive only. `renderSceneExport` renders one
SceneProjection at its exact logical width/height through `compositeScene`, then
encodes PNG (default) or WebP with exact MIME. Result metadata includes project,
revision, workspace, dimensions, background, sampling, draw count and byte size.

No thumbnail resizing occurs. Allocation is rejected above 16384 per edge or
64M pixels. Empty scenes return `null` without touching ports. Surface creation,
encode and dispose are explicit; primary render/encode failure survives cleanup
failure. The browser factory may use OffscreenCanvas or HTMLCanvas fallback.

ZIP/GIF/video, names, URLs, downloads, hashing/persistence and job lifecycle
belong to F7/A11, which can compose this primitive without redefining pixels.
