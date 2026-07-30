import {
  isEntityId,
  isISO8601Timestamp,
  type CompositionLayout,
  type EntityId,
  type ISO8601Timestamp,
  type ProjectCommandDiagnostic,
} from "../../../core/project";
import type { ProjectStore } from "../../../core/stores";
import { createGridLayerReflowCommands } from "./gridLayerPlacement";

export type CompositionLayoutEditResult =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false;
      readonly message: string;
      readonly diagnostics?: readonly ProjectCommandDiagnostic[];
    };

export function applyCompositionLayout(
  store: ProjectStore,
  input: {
    readonly compositionId: EntityId;
    readonly layout: CompositionLayout;
    readonly commandId: EntityId;
    readonly issuedAt: ISO8601Timestamp;
  },
): CompositionLayoutEditResult {
  if (!isEntityId(input.compositionId) || !isEntityId(input.commandId) || !isISO8601Timestamp(input.issuedAt)) {
    return Object.freeze({ ok: false, message: "Canvas layout request is invalid." });
  }
  const layoutCommand = {
    type: "composition.update",
    compositionId: input.compositionId,
    patch: { layout: input.layout, updatedAt: input.issuedAt },
  } as const;
  const reflow = createGridLayerReflowCommands(
    store.getSnapshot().project,
    input.compositionId,
    { layout: input.layout },
    input.issuedAt,
  );
  const result = store.dispatch({
    command: reflow.length > 0
      ? { type: "command.batch", commands: [...reflow, layoutCommand] }
      : layoutCommand,
    metadata: {
      commandId: input.commandId,
      origin: "user",
      history: "record",
      issuedAt: input.issuedAt,
    },
  });
  if (!result.result.ok) {
    return Object.freeze({
      ok: false,
      message: result.result.diagnostics[0]?.message ?? "Canvas layout could not be updated.",
      diagnostics: Object.freeze([...result.result.diagnostics]),
    });
  }
  return Object.freeze({ ok: true, revision: result.revision });
}
