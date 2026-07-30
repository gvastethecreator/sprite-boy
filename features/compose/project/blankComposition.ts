import {
  isEntityId,
  isISO8601Timestamp,
  type CompositionLayout,
  type CommandOrigin,
  type EntityId,
  type HistoryPolicy,
  type ISO8601Timestamp,
  type ProjectCommandDiagnostic,
  type WorkspaceId,
} from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import { DEFAULT_COMPOSITION_LAYOUT } from "../layout/compositionLayout";

export interface BlankCompositionRequest {
  readonly compositionId: EntityId;
  readonly commandId: EntityId;
  readonly issuedAt: ISO8601Timestamp;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly background?: string | null;
  readonly layout?: CompositionLayout;
  readonly origin?: CommandOrigin;
  readonly history?: HistoryPolicy;
  readonly activeWorkspace?: WorkspaceId;
}

export type BlankCompositionResult =
  | { readonly ok: true; readonly compositionId: EntityId; readonly revision: number }
  | {
      readonly ok: false;
      readonly message: string;
      readonly diagnostics?: readonly ProjectCommandDiagnostic[];
    };

export function createBlankComposition(
  store: ProjectStore,
  request: BlankCompositionRequest,
): BlankCompositionResult {
  if (!isEntityId(request.compositionId) || !isEntityId(request.commandId) || !isISO8601Timestamp(request.issuedAt)) {
    return Object.freeze({ ok: false, message: "Blank composition request is invalid." });
  }
  const width = request.width ?? 512;
  const height = request.height ?? 512;
  const result = store.dispatch({
    command: {
      type: "command.batch",
      commands: [
        {
          type: "composition.create",
          composition: {
            id: request.compositionId,
            name: request.name?.trim() || "Untitled composition",
            owner: { type: "project" },
            layerIds: [],
            width,
            height,
            background: request.background === undefined ? "#ffffff" : request.background,
            layout: request.layout ?? DEFAULT_COMPOSITION_LAYOUT,
            createdAt: request.issuedAt,
            updatedAt: request.issuedAt,
          },
          layers: [],
        },
        {
          type: "workspace.update",
          patch: {
            activeWorkspace: request.activeWorkspace ?? "compose",
            selectedAssetId: undefined,
            selectedRegionId: undefined,
            selectedCompositionId: request.compositionId,
            selectedLayerId: undefined,
          },
        },
      ],
    },
    metadata: {
      commandId: request.commandId,
      origin: request.origin ?? "user",
      history: request.history ?? "record",
      issuedAt: request.issuedAt,
    },
  });
  if (!result.result.ok) {
    return Object.freeze({
      ok: false,
      message: result.result.diagnostics[0]?.message ?? "Blank composition could not be created.",
      diagnostics: Object.freeze([...result.result.diagnostics]),
    });
  }
  return Object.freeze({ ok: true, compositionId: request.compositionId, revision: result.revision });
}
