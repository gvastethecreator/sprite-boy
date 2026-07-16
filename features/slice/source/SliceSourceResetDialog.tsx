import { AlertTriangle } from "lucide-react";
import { useRef, type RefObject } from "react";

import { StudioDialog } from "../../../components/studio/StudioDialog";

export interface SliceSourceResetDialogProps {
  readonly isOpen: boolean;
  readonly sourceName?: string | null;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function SliceSourceResetDialog({
  isOpen,
  sourceName,
  restoreFocusRef,
  onCancel,
  onConfirm,
}: SliceSourceResetDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onCancel}
      labelledBy="slice-source-reset-title"
      initialFocusRef={cancelRef}
      restoreFocusRef={restoreFocusRef}
      panelClassName="max-w-md"
    >
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10 text-amber-300">
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <h2 id="slice-source-reset-title" className="text-lg font-bold text-textMain">
          Reset the Slice source?
        </h2>
        <p className="mt-2 text-sm leading-6 text-textMuted">
          {sourceName ? `“${sourceName}”` : "The current source"}, its detected frames and
          source-derived canvas data will be cleared. Studio preferences and the asset library stay intact.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-white/10 bg-surface px-4 py-2 text-xs font-bold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Keep source
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-lg border border-amber-300/30 bg-amber-400/15 px-4 py-2 text-xs font-bold text-amber-100 hover:bg-amber-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Reset source
          </button>
        </div>
      </div>
    </StudioDialog>
  );
}

export default SliceSourceResetDialog;
