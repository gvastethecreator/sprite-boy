/**
 * Slice → Compose handoff: open a committed region as a composition without
 * re-importing asset bytes. Uses the single canonical composition entry path.
 */
import type { EntityId, ISO8601Timestamp } from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import {
  openCompositionFromSource,
  type CompositionEntryOpenResult,
} from "../../compose/project/compositionEntry";

export interface SliceToComposeHandoffRequest {
  readonly regionId: EntityId;
  readonly commandId: EntityId;
  readonly issuedAt: ISO8601Timestamp;
}

/**
 * Opens Compose on an existing Region id. Does not create a new Asset or re-decode
 * the source image; identity is derived from the region already in the graph.
 */
export function handoffRegionToCompose(
  store: ProjectStore,
  request: SliceToComposeHandoffRequest,
): CompositionEntryOpenResult {
  return openCompositionFromSource(store, {
    source: { type: "region", id: request.regionId },
    commandId: request.commandId,
    issuedAt: request.issuedAt,
  });
}
