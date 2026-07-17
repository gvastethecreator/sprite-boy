# Wayfinder map — F7-05 export contracts

## Canonical route

1. Feature adapter requests an export through `core/export/ExportPort`.
2. `ExportFormatRegistry` resolves one executable provider by stable format ID.
3. Provider receives frozen identity/provenance plus opaque source and returns one Blob payload.
4. Port validates MIME, extension, filename and byte budget before calling `ArtifactWriter`.
5. Writer receives no project store, DOM or URL ownership and returns a validated receipt.
6. Only the caller may later commit completed provenance to `generatedArtifacts`; pending/error/progress remain in JobStore.

## Host ownership

- `core/render/sceneExport.ts`: canonical PNG/WebP pixel producer; stops at a validated Blob.
- `hooks/domains/useExportLogic.ts`: legacy ZIP/GIF encoder plus direct DOM download; future adapter, not contract owner.
- `components/overlays/ExportModal.tsx`: legacy presentation; remains untouched in F7-05.
- `core/project/schema.ts`: durable completed `GeneratedArtifact`; F7-05 does not change schema or write project state.
- New writable boundary: `core/export/**` and `tests/contract/exportPort.test.ts`.

## Donor evidence (read-only)

- Animoto `hooks/useExporter.ts:169-325`: ZIP/GIF/video mix codec, progress, toast, filename, URL and anchor ownership.
- Grid Splitter `src/lib/download.ts:1-8` plus `src/App.tsx:359-373`: per-result and batch actions directly click anchors.
- Both prove required capabilities but neither boundary is portable: neither has request identity, format registry, bounded artifacts, abort contract or validated receipt.

## Decisions

- Registry entries always include an executable provider; descriptor-only/inert formats are rejected.
- Request identity is `requestId + artifactId`; primitive metadata is captured
  before async work. Source remains an opaque caller-owned reference because it
  may be a runtime render input and is never traversed or persisted by the port.
- Filename is derived from a safe base name and the registry extension. Providers cannot inject paths or change MIME.
- Single-artifact byte budget is checked before writer invocation. Zero-byte or forged/mismatched Blob payloads never reach the writer.
- The port has no `document`, object URL, filesystem or download behavior. Writers own destinations and must echo a receipt that matches the request and exact byte count.
- Abort is checked before encode, before write and before success publication. F7-06 will inject writer/provider races and quota failures.

## Frontier

- In scope: types, validation, registry, orchestration, bounded write contract and fake-writer evidence.
- Out: concrete PNG/ZIP/GIF/video/data providers, JobRunner adapter, browser download writer, batch packaging and UI migration.
