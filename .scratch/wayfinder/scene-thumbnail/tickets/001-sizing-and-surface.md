# Choose thumbnail sizing and surface boundary

Type: decision
Status: resolved
Blocked by: None

## Question

Should the canonical thumbnail crop or letterbox into a fixed card, and should
it render a full-size intermediate canvas before resize?

## Answer

Neither crop nor letterbox belongs in the canonical adapter. It returns an
aspect-fit raster whose dimensions fit the requested maximum bounds. Consumers
decide card background/padding. Upscale is disabled by default so a 16x16 sprite
does not become a large encoded artifact merely because a card is 256x256.

The adapter creates one bounded output surface and passes its target to
`compositeScene`. The surface maps logical source coordinates into the output;
there is no source-sized intermediate allocation. A mandatory factory/target,
encode and dispose contract lets a software target prove pixel parity while the
browser factory uses Canvas2D/OffscreenCanvas.

PNG is the default. WebP is explicit and must be returned with the requested
MIME instead of silently falling back. Empty scenes return `null` without
touching resolver or surface ports. Cleanup runs after success and failure.
