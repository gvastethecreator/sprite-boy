# F7-05 — ExportPort, writer and format registry

## Entry

F7-01 lifecycle and F7-04 Job Center are accepted. F5-05 supplies canonical raster blobs.

## Acceptance

- Unique, frozen, executable format registry.
- Frozen request handed to provider without leaking mutable caller metadata.
- Safe deterministic filename and exact MIME/extension.
- Native non-empty Blob and bounded bytes.
- Writer receipt matches request/artifact/file/byte count.
- Abort and provider/write failures become safe typed errors.
- Fake writer proves it is never called for invalid/unsupported/oversized artifacts.
- Typecheck, focal contract suite, strict lint, independent review and docs.

